"""Real Postgres savings opening, retry, constraints and history boundary.

Use a fresh migrated ACCANTO_TEST_DATABASE_URL ending in `_test`.
"""

import asyncio
import os
from datetime import UTC, date, datetime
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import delete, func, insert, select, text, update
from sqlalchemy.exc import SQLAlchemyError
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


def test_savings_api_and_storage_guarantees():
    asyncio.run(scenario())


async def scenario():
    assert URL and URL.rsplit("/", 1)[-1].endswith("_test")
    engine = create_async_engine(URL)
    sessions = async_sessionmaker(engine)
    async with sessions() as session, session.begin():
        user = await session.scalar(
            insert(m.users)
            .values(issuer="saving-test", subject=str(uuid4()))
            .returning(m.users.c.id)
        )
        other = await session.scalar(
            insert(m.users)
            .values(issuer="saving-test", subject=str(uuid4()))
            .returning(m.users.c.id)
        )
        entity = await session.scalar(
            insert(m.entities)
            .values(owner_id=user, name="Synthetic Household", time_zone="UTC")
            .returning(m.entities.c.uuid)
        )
        foreign = await session.scalar(
            insert(m.entities)
            .values(owner_id=other, name="Other Synthetic Household", time_zone="UTC")
            .returning(m.entities.c.uuid)
        )
        key = await issue_key(session, user, "Savings test")
        other_key = await issue_key(session, other, "Other savings test")
    app = create_app()

    async def dependency():
        async with sessions() as session:
            yield session

    app.dependency_overrides[get_session] = dependency
    path = f"/api/entities/{entity}/savings-accounts"
    headers = {"Authorization": f"Bearer {key['key']}"}
    body = {
        "name": "Example savings",
        "opening_date": "2026-01-01",
        "opening_amount": "10000.00",
        "goals": [
            {
                "name": "Emergency",
                "kind": "finite",
                "target": "8000.00",
                "opening_amount": "5000.00",
            },
            {
                "name": "Laptop",
                "kind": "finite",
                "target": "1200.00",
                "opening_amount": "1000.00",
            },
        ],
    }
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test", headers=headers
    ) as client:

        async def request(method, suffix, value, identity=None):
            return await client.request(
                method,
                path + suffix,
                json=value,
                headers={"Idempotency-Key": identity or str(uuid4())},
            )

        assert (await client.get(path)).json() == []
        assert (
            await client.get(f"/api/entities/{foreign}/savings-accounts")
        ).status_code == 404
        bad = {**body, "goals": [{**body["goals"][0], "opening_amount": "10000.01"}]}
        excess = await request("POST", "", bad)
        assert excess.status_code == 422, excess.text
        assert (await client.get(path)).json() == []
        finite_zero = {**body, "goals": [{**body["goals"][0], "target": "0.00"}]}
        assert (await request("POST", "", finite_zero)).status_code == 422
        async with sessions() as session:
            entity_id = await session.scalar(
                select(m.entities.c.id).where(m.entities.c.uuid == entity)
            )
        failure_key = str(uuid4())
        async with engine.begin() as connection:
            await connection.execute(
                text(f"""CREATE FUNCTION fail_saving_audit() RETURNS trigger
                LANGUAGE plpgsql AS $$ BEGIN IF NEW.entity_id = {entity_id}
                THEN RAISE EXCEPTION 'injected audit failure'; END IF;
                RETURN NEW; END $$""")
            )
            await connection.execute(
                text(
                    "CREATE TRIGGER fail_saving_audit BEFORE INSERT ON audit_log "
                    "FOR EACH ROW EXECUTE FUNCTION fail_saving_audit()"
                )
            )
        try:
            failed = await request("POST", "", body, failure_key)
            assert failed.status_code == 503
        finally:
            async with engine.begin() as connection:
                await connection.execute(
                    text("DROP TRIGGER fail_saving_audit ON audit_log")
                )
                await connection.execute(text("DROP FUNCTION fail_saving_audit()"))
        assert (await client.get(path)).json() == []
        async with sessions() as session:
            assert (
                await session.scalar(
                    select(func.count())
                    .select_from(m.outcomes)
                    .where(m.outcomes.c.request_key == failure_key)
                )
                == 0
            )
            assert (
                await session.scalar(
                    select(func.count())
                    .select_from(s.goals)
                    .where(s.goals.c.entity_id == entity_id)
                )
                == 0
            )
        request_key = failure_key
        created = await request("POST", "", body, request_key)
        assert created.status_code == 200, created.text
        account = created.json()
        assert account["balance"] == "10000.00"
        assert {g["name"]: g["opening_amount"] for g in account["goals"]} == {
            "Unallocated": "4000.00",
            "Emergency": "5000.00",
            "Laptop": "1000.00",
        }
        assert all(g["contribution_progress"] == "0.00" for g in account["goals"])
        assert (
            next(g for g in account["goals"] if g["name"] == "Emergency")[
                "funded_status"
            ]
            == "Not yet funded"
        )
        assert (
            next(g for g in account["goals"] if g["role"] == "unallocated")[
                "funded_status"
            ]
            is None
        )
        assert (await request("POST", "", body, request_key)).json() == account
        assert (
            await request("POST", "", {**body, "name": "Different"}, request_key)
        ).status_code == 409
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://test",
            headers={"Authorization": f"Bearer {other_key['key']}"},
        ) as outsider:
            assert (await outsider.get(path)).status_code == 404
            assert (
                await outsider.post(
                    path, json=body, headers={"Idempotency-Key": request_key}
                )
            ).status_code == 404
        account_id = account["uuid"]
        ordinary = [g for g in account["goals"] if g["role"] == "ordinary"]
        correction = {
            "name": "Example savings",
            "opening_date": "2026-01-01",
            "opening_amount": "10000.00",
            "expected_revision": account["revision"],
            "designations": [
                {"goal_id": ordinary[0]["uuid"], "opening_amount": "5500.00"},
                {"goal_id": ordinary[1]["uuid"], "opening_amount": "1000.00"},
            ],
        }
        corrected = await request("PUT", f"/{account_id}", correction)
        assert corrected.status_code == 200, corrected.text
        account = corrected.json()
        assert account["balance"] == "10000.00"
        assert (
            next(g for g in account["goals"] if g["role"] == "unallocated")[
                "opening_amount"
            ]
            == "3500.00"
        )
        assert (await request("PUT", f"/{account_id}", correction)).status_code == 409
        added = await request(
            "POST",
            f"/{account_id}/goals",
            {
                "name": "Home repair",
                "kind": "ongoing",
                "target": None,
                "expected_account_revision": account["revision"],
            },
        )
        assert added.status_code == 200, added.text
        account = added.json()
        home = next(g for g in account["goals"] if g["name"] == "Home repair")
        assert home["opening_amount"] == "0.00" and home["target"] is None
        renamed = await request(
            "PUT",
            f"/{account_id}/goals/{home['uuid']}",
            {
                "name": "Repairs",
                "kind": "ongoing",
                "target": None,
                "active": False,
                "expected_revision": home["revision"],
            },
        )
        assert renamed.status_code == 200, renamed.text
        assert (
            next(g for g in renamed.json()["goals"] if g["uuid"] == home["uuid"])[
                "active"
            ]
            is False
        )
        unallocated = next(g for g in account["goals"] if g["role"] == "unallocated")
        assert (
            await request(
                "PUT",
                f"/{account_id}/goals/{unallocated['uuid']}",
                {
                    "name": "Changed",
                    "kind": "ongoing",
                    "target": None,
                    "active": False,
                    "expected_revision": unallocated["revision"],
                },
            )
        ).status_code == 409
        async with sessions() as session, session.begin():
            db_account = (
                (
                    await session.execute(
                        select(s.accounts).where(s.accounts.c.uuid == account_id)
                    )
                )
                .mappings()
                .one()
            )
            db_goal = (
                (
                    await session.execute(
                        select(s.goals).where(s.goals.c.uuid == home["uuid"])
                    )
                )
                .mappings()
                .one()
            )
            await session.execute(
                insert(s.linked_activity).values(
                    entity_id=db_account["entity_id"],
                    account_id=db_account["id"],
                    goal_id=db_goal["id"],
                    financial_date=date(2026, 1, 2),
                )
            )
            await session.execute(
                update(s.linked_activity)
                .where(s.linked_activity.c.goal_id == db_goal["id"])
                .values(deleted_at=datetime(2026, 1, 3, tzinfo=UTC))
            )
        current = renamed.json()
        current_designations = [
            {"goal_id": g["uuid"], "opening_amount": g["opening_amount"]}
            for g in current["goals"]
            if g["role"] == "ordinary"
        ]
        corrected_setup = {
            "name": current["name"],
            "opening_date": current["opening_date"],
            "opening_amount": current["opening_amount"],
            "designations": current_designations,
            "expected_revision": current["revision"],
        }
        for change in (
            {"opening_date": "2025-12-31"},
            {"opening_amount": "11000.00"},
            {
                "designations": [
                    {**current_designations[0], "opening_amount": "5600.00"},
                    *current_designations[1:],
                ]
            },
        ):
            frozen = await request(
                "PUT", f"/{account_id}", {**corrected_setup, **change}
            )
            assert frozen.status_code == 422, frozen.text
            assert frozen.json()["detail"]["code"] == "invalid_savings"
            assert "fixed after linked activity" in frozen.json()["detail"]["message"]
        assert (await client.get(f"{path}/{account_id}")).json()[
            "opening_date"
        ] == "2026-01-01"
        with pytest.raises(SQLAlchemyError, match="must be retained"):
            async with sessions() as session, session.begin():
                await session.execute(
                    delete(s.linked_activity).where(
                        s.linked_activity.c.account_id == db_account["id"]
                    )
                )
        with pytest.raises(SQLAlchemyError, match="immutable"):
            async with sessions() as session, session.begin():
                await session.execute(
                    update(s.goals)
                    .where(s.goals.c.uuid == unallocated["uuid"])
                    .values(role="ordinary")
                )
        with pytest.raises(SQLAlchemyError):
            async with sessions() as session, session.begin():
                await session.execute(
                    insert(s.goals).values(
                        entity_id=db_account["entity_id"],
                        account_id=db_account["id"],
                        name="Duplicate",
                        role="unallocated",
                        kind="ongoing",
                        opening_amount="0.00",
                    )
                )
        async with sessions() as session:
            audits = (
                (
                    await session.execute(
                        select(m.audit).where(
                            m.audit.c.entity_id == db_account["entity_id"],
                            m.audit.c.record_type.in_(
                                ["saving_account", "saving_goal"]
                            ),
                        )
                    )
                )
                .mappings()
                .all()
            )
            assert audits and all(a["after"] is not None for a in audits)
            assert (
                len(
                    (
                        await session.execute(
                            select(s.accounts).where(
                                s.accounts.c.entity_id == db_account["entity_id"]
                            )
                        )
                    ).all()
                )
                == 1
            )
        # Deferred existence/conservation checks reject direct incomplete writes.
        with pytest.raises(SQLAlchemyError, match="Saving opening requires"):
            async with sessions() as session, session.begin():
                await session.execute(
                    insert(s.accounts).values(
                        entity_id=db_account["entity_id"],
                        name="Incomplete",
                        opening_date=date(2026, 1, 1),
                        opening_amount="1.00",
                    )
                )
    await engine.dispose()
