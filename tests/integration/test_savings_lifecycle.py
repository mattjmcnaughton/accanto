"""Synthetic lifecycle API history, rollback and independent-credential PG races."""

# ruff: noqa: E501 -- Synthetic SQL trigger definitions remain readable.

import asyncio
import os
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import func, insert, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from accanto.app import create_app
from accanto.db import get_session
from accanto.models import monthly as m
from accanto.models import savings as s
from accanto.services.api_keys import issue_key

URL = os.environ.get("ACCANTO_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not URL, reason="Use an isolated migrated test database"
)


def test_savings_lifecycle_history_and_atomicity():
    asyncio.run(scenario())


@pytest.mark.parametrize("race_case", ["archive_activity", "completion_refund_edit"])
def test_savings_lifecycle_races(race_case):
    asyncio.run(scenario(race_case))


async def scenario(race_case=None):
    assert URL and URL.rsplit("/", 1)[-1].endswith("_test")
    engine = create_async_engine(URL)
    sessions = async_sessionmaker(engine)
    async with sessions() as session, session.begin():
        user = await session.scalar(
            insert(m.users)
            .values(issuer="lifecycle-test", subject=str(uuid4()))
            .returning(m.users.c.id)
        )
        entity = await session.scalar(
            insert(m.entities)
            .values(owner_id=user, name="Synthetic lifecycle Entity", time_zone="UTC")
            .returning(m.entities.c.uuid)
        )
        key = await issue_key(session, user, "Synthetic lifecycle")
        other_key = await issue_key(session, user, "Independent lifecycle racer")
    app = create_app()

    async def dependency():
        async with sessions() as session:
            yield session

    app.dependency_overrides[get_session] = dependency
    prefix = f"/api/entities/{entity}"
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
        headers={"Authorization": f"Bearer {key['key']}"},
    ) as client:

        async def command(method, path, body, *, other=False, retry=None):
            return await client.request(
                method,
                prefix + path,
                json=body,
                headers={
                    "Authorization": f"Bearer {(other_key if other else key)['key']}",
                    "Idempotency-Key": retry or str(uuid4()),
                },
            )

        async def accepted(method, path, body):
            response = await command(method, path, body)
            assert response.status_code == 200, response.text
            return response.json()

        async def counts():
            async with sessions() as session:
                return tuple(
                    [
                        await session.scalar(select(func.count()).select_from(table))
                        for table in (
                            m.entries,
                            s.reassignments,
                            m.audit,
                            m.outcomes,
                        )
                    ]
                )

        async def rejected(method, path, body, status=422):
            before = await counts()
            response = await command(method, path, body)
            assert response.status_code == status, response.text
            assert await counts() == before

        account = await accepted(
            "POST",
            "/savings-accounts",
            {
                "name": "Synthetic lifecycle cash",
                "opening_date": "2026-10-01",
                "opening_amount": "1000.00",
                "goals": [
                    {
                        "name": "Example finite purpose",
                        "kind": "finite",
                        "target": "1000.00",
                        "opening_amount": "1000.00",
                    },
                    {
                        "name": "Example ongoing",
                        "kind": "ongoing",
                        "opening_amount": "0.00",
                    },
                    {
                        "name": "Example inactive",
                        "kind": "ongoing",
                        "opening_amount": "0.00",
                    },
                ],
            },
        )
        path = f"/savings-accounts/{account['uuid']}"
        goal = next(g for g in account["goals"] if g["kind"] == "finite")
        unallocated = next(g for g in account["goals"] if g["role"] == "unallocated")
        ongoing = next(g for g in account["goals"] if g["name"] == "Example ongoing")
        inactive = next(g for g in account["goals"] if g["name"] == "Example inactive")
        complete = path + f"/goals/{goal['uuid']}/complete"
        purchase_body = {
            "date": "2026-10-02",
            "category": "spending",
            "amount": "1000.00",
            "funding_origin": "savings",
            "saving_goal_id": goal["uuid"],
        }
        purchase = await accepted("POST", "/activity", purchase_body)
        if race_case:
            # Delay at the final retry-outcome insert, after every financial read
            # including response snapshots. An earlier audit delay could let a
            # repeated balance read mask a missing Entity lock. Independent keys
            # ensure the production Entity lock supplies serialization.
            trigger = "lifecycle_overlap_" + uuid4().hex
            async with engine.begin() as connection:
                await connection.execute(
                    text(f"""CREATE FUNCTION {trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
                    IF split_part(NEW.operation, ':', 1) IN ('archive_saving_account', 'create_entry', 'complete_saving_goal', 'edit_refund')
                    THEN PERFORM pg_sleep(0.25); END IF; RETURN NEW; END $$""")
                )
                await connection.execute(
                    text(
                        f"CREATE TRIGGER {trigger} BEFORE INSERT ON idempotency_outcome FOR EACH ROW EXECUTE FUNCTION {trigger}()"
                    )
                )
            try:
                if race_case == "archive_activity":
                    competitors = await asyncio.gather(
                        command("POST", path + "/archive", {"expected_revision": 1}),
                        command(
                            "POST",
                            "/activity",
                            {
                                "date": "2026-11-02",
                                "category": "saving",
                                "amount": "100.00",
                                "saving_goal_id": ongoing["uuid"],
                            },
                            other=True,
                        ),
                    )
                    assert sorted(r.status_code for r in competitors) in (
                        [200, 409],
                        [200, 422],
                    ), [r.text for r in competitors]
                    current = (await client.get(prefix + path)).json()
                    assert (current["active"], current["balance"]) in {
                        (False, "0.00"),
                        (True, "100.00"),
                    }
                else:
                    refund = await accepted(
                        "POST",
                        f"/activity/{purchase['uuid']}/refunds",
                        {"date": "2026-11-01", "amount": "200.00"},
                    )
                    competitors = await asyncio.gather(
                        command(
                            "POST",
                            complete,
                            {
                                "date": "2026-11-02",
                                "expected_revision": 1,
                                "expected_return": "200.00",
                            },
                        ),
                        command(
                            "PUT",
                            f"/activity/refunds/{refund['uuid']}",
                            {
                                "date": "2026-11-01",
                                "amount": "100.00",
                                "expected_revision": 1,
                            },
                            other=True,
                        ),
                    )
                    assert sorted(r.status_code for r in competitors) in (
                        [200, 409],
                        [200, 422],
                    ), [r.text for r in competitors]
                    current = (await client.get(prefix + path)).json()
                    now = next(g for g in current["goals"] if g["uuid"] == goal["uuid"])
                    assert (
                        now["completed"],
                        now["remaining_saved"],
                        current["balance"],
                    ) in {(True, "0.00", "200.00"), (False, "100.00", "100.00")}
            finally:
                async with engine.begin() as connection:
                    await connection.execute(
                        text(f"DROP TRIGGER {trigger} ON idempotency_outcome")
                    )
                    await connection.execute(text(f"DROP FUNCTION {trigger}()"))
            return
        # Preserve a saved Plan and a draft allocation verbatim through lifecycle.
        plan = await accepted(
            "POST",
            "/plans",
            {
                "name": "Synthetic lifecycle Plan",
                "incomes": [{"name": "Example income", "amount": "2000.00"}],
                "spending": "100.00",
                "saving_goals": [{"goal_id": goal["uuid"], "amount": "100.00"}],
                "savings_funding": [
                    {"account_id": account["uuid"], "amount": "100.00"}
                ],
            },
        )
        await accepted(
            "POST", f"/plans/{plan['plan_id']}/versions", {"expected_revision": 1}
        )
        saved_before = (await client.get(prefix + "/plans")).json()
        # Complete a zero goal: no reassignment. A stale retry does not duplicate.
        request = {
            "date": "2026-10-03",
            "expected_revision": 1,
            "expected_return": "0.00",
        }
        before = await counts()
        identity = str(uuid4())
        response = await command("POST", complete, request, retry=identity)
        assert response.status_code == 200, response.text
        assert await counts() == (before[0], before[1], before[2] + 1, before[3] + 1)
        assert (
            await command("POST", complete, request, retry=identity)
        ).json() == response.json()
        assert (await client.get(prefix + "/plans")).json() == saved_before
        account = response.json()
        assert next(g for g in account["goals"] if g["uuid"] == goal["uuid"])[
            "completed"
        ]
        await rejected(
            "POST",
            "/activity",
            {
                "date": "2026-11-01",
                "category": "saving",
                "amount": "100.00",
                "saving_goal_id": goal["uuid"],
            },
            422,
        )
        await rejected("POST", "/activity", {**purchase_body, "amount": "0.00"})
        movable_body = {
            **purchase_body,
            "saving_goal_id": unallocated["uuid"],
            "amount": "0.00",
        }
        movable = await accepted("POST", "/activity", movable_body)
        await rejected(
            "PUT",
            f"/activity/{movable['uuid']}",
            {**movable_body, "saving_goal_id": goal["uuid"], "expected_revision": 1},
        )
        await rejected(
            "PUT",
            path + f"/goals/{goal['uuid']}",
            {
                "name": goal["name"],
                "kind": "finite",
                "target": "1000.00",
                "active": True,
                "expected_revision": 2,
            },
        )
        # Linked refund returns money to the completed original goal; no automatic return.
        refund = await accepted(
            "POST",
            f"/activity/{purchase['uuid']}/refunds",
            {"date": "2026-11-01", "amount": "200.00"},
        )
        account = (await client.get(prefix + path)).json()
        returned = next(g for g in account["goals"] if g["uuid"] == goal["uuid"])
        assert (
            returned["remaining_saved"],
            returned["completed"],
            returned["active"],
            returned["contribution_progress"],
        ) == ("200.00", True, False, "0.00")
        await rejected("POST", path + "/archive", {"expected_revision": 1})
        await rejected(
            "POST",
            "/savings-accounts/movements",
            {
                "kind": "reassignment",
                "date": "2026-11-02",
                "from_goal_id": goal["uuid"],
                "to_goal_id": ongoing["uuid"],
                "amount": "200.00",
            },
        )
        await accepted(
            "POST",
            "/savings-accounts/movements",
            {
                "kind": "reassignment",
                "date": "2026-11-02",
                "from_goal_id": goal["uuid"],
                "to_goal_id": unallocated["uuid"],
                "amount": "200.00",
            },
        )
        # Removing the refund would expose a later historical shortfall.
        await rejected(
            "DELETE", f"/activity/refunds/{refund['uuid']}", {"expected_revision": 1}
        )
        final_use = await accepted(
            "POST",
            "/activity",
            {
                "date": "2026-11-03",
                "category": "spending",
                "amount": "200.00",
                "funding_origin": "savings",
                "saving_goal_id": unallocated["uuid"],
            },
        )
        account = await accepted(
            "PUT",
            path + f"/goals/{inactive['uuid']}",
            {
                "name": inactive["name"],
                "kind": "ongoing",
                "target": None,
                "active": False,
                "expected_revision": 1,
            },
        )
        archived = await accepted(
            "POST", path + "/archive", {"expected_revision": account["revision"]}
        )
        assert not archived["active"] and all(
            not g["active"] for g in archived["goals"]
        )
        assert {g["uuid"] for g in archived["goals"] if g["archived_by_account"]} == {
            unallocated["uuid"],
            ongoing["uuid"],
        }
        # An archived original origin cannot be bypassed by switching accounts.
        other = await accepted(
            "POST",
            "/savings-accounts",
            {
                "name": "Other synthetic cash",
                "opening_date": "2026-10-01",
                "opening_amount": "1000.00",
            },
        )
        before_correction = await counts()
        correction = await command(
            "PUT",
            f"/activity/{final_use['uuid']}",
            {
                "date": "2026-11-03",
                "category": "spending",
                "amount": "200.00",
                "funding_origin": "savings",
                "saving_goal_id": other["goals"][0]["uuid"],
                "expected_revision": 1,
            },
        )
        assert correction.status_code == 409, correction.text
        assert correction.json()["detail"]["code"] == "archived_account"
        assert await counts() == before_correction
        await rejected(
            "PUT",
            f"/activity/{purchase['uuid']}",
            {
                **purchase_body,
                "saving_goal_id": other["goals"][0]["uuid"],
                "expected_revision": 1,
            },
        )
        await rejected(
            "PUT",
            f"/activity/refunds/{refund['uuid']}",
            {"date": "2026-11-01", "amount": "200.00", "expected_revision": 1},
            409,
        )
        await rejected(
            "POST",
            f"/activity/{purchase['uuid']}/refunds",
            {"date": "2026-11-04", "amount": "100.00"},
            409,
        )
        reopened = await accepted(
            "POST", path + "/reopen", {"expected_revision": archived["revision"]}
        )
        assert (
            reopened["uuid"] == account["uuid"]
            and reopened["opening_date"] == account["opening_date"]
        )
        assert {g["uuid"] for g in reopened["goals"] if g["active"]} == {
            unallocated["uuid"],
            ongoing["uuid"],
        }
        assert next(g for g in reopened["goals"] if g["uuid"] == goal["uuid"])[
            "completed"
        ]
        # Positive completion is atomic and its linked movement cannot be corrected independently.
        positive = await accepted(
            "POST",
            other_path := f"/savings-accounts/{other['uuid']}/goals",
            {
                "name": "Positive finite",
                "kind": "finite",
                "target": "100.00",
                "expected_account_revision": 1,
            },
        )
        finite = next(g for g in positive["goals"] if g["kind"] == "finite")
        await accepted(
            "POST",
            "/savings-accounts/movements",
            {
                "kind": "reassignment",
                "date": "2026-10-02",
                "from_goal_id": other["goals"][0]["uuid"],
                "to_goal_id": finite["uuid"],
                "amount": "100.00",
            },
        )
        positive_complete = other_path + f"/{finite['uuid']}/complete"
        trigger = "lifecycle_fail_" + uuid4().hex
        async with engine.begin() as connection:
            await connection.execute(
                text(
                    f"CREATE FUNCTION {trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'complete_saving_goal' THEN RAISE EXCEPTION 'synthetic failure'; END IF; RETURN NEW; END $$"
                )
            )
            await connection.execute(
                text(
                    f"CREATE TRIGGER {trigger} BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION {trigger}()"
                )
            )
        before = await counts()
        try:
            failed = await command(
                "POST",
                positive_complete,
                {
                    "date": "2026-10-03",
                    "expected_revision": 1,
                    "expected_return": "100.00",
                },
            )
            assert failed.status_code == 503, failed.text
            assert await counts() == before
        finally:
            async with engine.begin() as connection:
                await connection.execute(text(f"DROP TRIGGER {trigger} ON audit_log"))
                await connection.execute(text(f"DROP FUNCTION {trigger}()"))
        positive = await accepted(
            "POST",
            positive_complete,
            {"date": "2026-10-03", "expected_revision": 1, "expected_return": "100.00"},
        )
        assert positive["balance"] == "1000.00"
        completed_finite = next(
            g for g in positive["goals"] if g["uuid"] == finite["uuid"]
        )
        assert (
            completed_finite["remaining_saved"],
            completed_finite["completed"],
            completed_finite["active"],
            completed_finite["contribution_progress"],
        ) == ("0.00", True, False, "0.00")
        assert (
            next(g for g in positive["goals"] if g["role"] == "unallocated")[
                "remaining_saved"
            ]
            == "1000.00"
        )
        moves = (await client.get(prefix + "/savings-accounts/movements")).json()
        completion_movement = next(
            r for r in moves if r["note"] == "Goal completion return"
        )
        await rejected(
            "DELETE",
            f"/savings-accounts/movements/{completion_movement['uuid']}",
            {"kind": "reassignment", "expected_revision": 1},
        )
    await engine.dispose()
