"""Real Postgres workflow, atomicity and concurrent retry checks.

Set ACCANTO_TEST_DATABASE_URL to a migrated, isolated test database.
"""

import asyncio
import os
from uuid import UUID, uuid4

import httpx
import pytest
from sqlalchemy import func, insert, select, text, update
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from accanto.app import create_app
from accanto.db import get_session
from accanto.models import monthly as m
from accanto.services.api_keys import issue_key

URL = os.environ.get("ACCANTO_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not URL, reason="Set ACCANTO_TEST_DATABASE_URL for real Postgres tests"
)


def test_monthly_api_and_database_guarantees():
    asyncio.run(scenario())


async def scenario():
    assert URL and "test" in URL.rsplit("/", 1)[-1]
    admin = create_async_engine(URL)
    sessions = async_sessionmaker(admin)
    async with sessions() as session, session.begin():
        user = await session.scalar(
            insert(m.users)
            .values(issuer="test", subject=str(uuid4()))
            .returning(m.users.c.id)
        )
        other = await session.scalar(
            insert(m.users)
            .values(issuer="test", subject=str(uuid4()))
            .returning(m.users.c.id)
        )
        entity = (
            (
                await session.execute(
                    insert(m.entities)
                    .values(
                        owner_id=user, name="Test Entity", time_zone="America/New_York"
                    )
                    .returning(m.entities)
                )
            )
            .mappings()
            .one()
        )
        foreign_entity = await session.scalar(
            insert(m.entities)
            .values(owner_id=other, name="Other", time_zone="UTC")
            .returning(m.entities.c.uuid)
        )
        key = await issue_key(session, user, "Test")
        second_key = await issue_key(session, user, "Second interface")
    # Runtime role has no ability to mutate or truncate protected audit rows.
    async with admin.begin() as connection:
        await connection.execute(
            text("""DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles
            WHERE rolname='accanto_core_test_app') THEN
            CREATE ROLE accanto_core_test_app NOLOGIN;
          END IF;
        END $$""")
        )
        await connection.execute(
            text("GRANT USAGE ON SCHEMA public TO accanto_core_test_app")
        )
        await connection.execute(
            text(
                "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES "
                "IN SCHEMA public TO accanto_core_test_app"
            )
        )
        await connection.execute(
            text(
                "GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public "
                "TO accanto_core_test_app"
            )
        )
        await connection.execute(
            text(
                "REVOKE UPDATE, DELETE, TRUNCATE ON audit_log "
                "FROM accanto_core_test_app"
            )
        )
    runtime = create_async_engine(
        URL, connect_args={"server_settings": {"role": "accanto_core_test_app"}}
    )
    runtime_sessions = async_sessionmaker(runtime)
    app = create_app()

    async def session_dependency():
        async with runtime_sessions() as session:
            yield session

    app.dependency_overrides[get_session] = session_dependency
    prefix = f"/api/entities/{entity['uuid']}"
    headers = {"Authorization": f"Bearer {key['key']}"}
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test", headers=headers
    ) as client:

        async def post(path, body, identity=None, **kwargs):
            return await client.post(
                prefix + path,
                json=body,
                headers={
                    "Idempotency-Key": identity or str(uuid4()),
                    **kwargs.pop("headers", {}),
                },
                **kwargs,
            )

        plan_body = {
            "name": "Ordinary month",
            "incomes": [
                {"name": "Salary", "amount": "4000"},
                {"name": "Bonus", "amount": "0"},
            ],
            "spending": "4500",
        }
        assert (await client.post(prefix + "/plans", json=plan_body)).status_code == 422
        assert (
            await client.get(
                prefix + "/plans", headers={"Authorization": "Bearer invalid"}
            )
        ).status_code == 401
        assert (
            await client.get(f"/api/entities/{foreign_entity}/plans")
        ).status_code == 404
        identity = str(uuid4())
        created = await post("/plans", plan_body, identity)
        assert created.status_code == 200, created.text
        plan = created.json()
        assert plan["draft"]["unassigned"] == "-500.00"
        assert "id" not in plan["draft"]
        assert (await post("/plans", plan_body, identity)).json() == plan
        assert (
            await post("/plans", {**plan_body, "spending": "1"}, identity)
        ).status_code == 409
        version_result = await post(
            f"/plans/{plan['plan_id']}/versions", {"expected_revision": 1}
        )
        assert version_result.status_code == 200, version_result.text
        version = version_result.json()["version"]
        salary, bonus = [line["source_id"] for line in version["incomes"]]
        review = await post(
            "/reviews", {"month": "2026-10-01", "version_id": version["uuid"]}
        )
        assert review.status_code == 200, review.text
        earlier = await post(
            "/reviews", {"month": "2026-09-01", "version_id": version["uuid"]}
        )
        assert earlier.status_code == 200
        earlier_mark = await client.put(
            prefix + "/reviews/2026-09-01",
            json={
                "expected_revision": 1,
                "version_id": version["uuid"],
                "note": "Unknown is allowed",
                "reviewed": True,
            },
            headers={"Idempotency-Key": str(uuid4())},
        )
        assert earlier_mark.status_code == 200
        earlier_read = (await client.get(prefix + "/reviews/2026-09-01")).json()
        assert earlier_read["actual"]["income_incomplete"] is True
        assert (
            earlier_read["review"]["reviewed_at"]
            and not earlier_read["checkpoint_changed"]
        )
        changed_note = await client.put(
            prefix + "/reviews/2026-09-01",
            json={
                "expected_revision": 2,
                "version_id": version["uuid"],
                "note": "Revised synthetic takeaway",
                "reviewed": True,
            },
            headers={"Idempotency-Key": str(uuid4())},
        )
        assert changed_note.status_code == 200
        earlier_read = (await client.get(prefix + "/reviews/2026-09-01")).json()
        assert (
            earlier_read["checkpoint_changed"] and earlier_read["review"]["reviewed_at"]
        )
        assert (await client.get(prefix + "/reviews/2026-10-01")).json()["actual"][
            "income_recorded"
        ] is None
        entry_body = {
            "date": "2026-10-16",
            "category": "income",
            "amount": "4000",
            "source_id": salary,
            "note": "private financial note",
        }
        identity = str(uuid4())
        # Different credentials still contend on the same Entity and request key.
        a, b = await asyncio.gather(
            post("/activity", entry_body, identity),
            post(
                "/activity",
                entry_body,
                identity,
                headers={"Authorization": f"Bearer {second_key['key']}"},
            ),
        )
        assert a.status_code == b.status_code == 200, (a.text, b.text)
        assert a.json() == b.json()
        receipt = a.json()
        current = (await client.get(prefix + "/reviews/2026-10-01")).json()
        assert current["actual"]["income_recorded"] == "4000.00"
        assert current["income_difference"] is None
        assert len(current["entries"]) == 1
        assert (
            await post("/activity", {**entry_body, "amount": "0", "source_id": bonus})
        ).status_code == 200
        assert (
            await post(
                "/activity",
                {"date": "2026-10-16", "category": "spending", "amount": "100"},
            )
        ).status_code == 200
        current = (await client.get(prefix + "/reviews/2026-10-01")).json()
        assert current["income_difference"] == "0.00"
        assert current["spending_difference"] == "-4400.00"
        # Known total is a signed correction against the exact displayed entries.
        assert (
            await post(
                "/activity",
                {"date": "2026-10-16", "category": "spending", "amount": "110"},
            )
        ).status_code == 200
        spending = [
            entry
            for entry in (await client.get(prefix + "/activity")).json()
            if entry["category"] == "spending"
        ]
        fingerprint = [
            {"uuid": entry["uuid"], "revision": entry["revision"]} for entry in spending
        ]
        total_body = {
            "date": "2026-10-16",
            "month": "2026-10-01",
            "category": "spending",
            "desired_total": "250",
            "contributing_entries": fingerprint,
        }
        total = await post("/activity/known-total", total_body)
        assert total.status_code == 200, total.text
        adjustment = total.json()
        assert adjustment["amount"] == "40.00" and adjustment["is_adjustment"]
        assert (await client.get(prefix + "/reviews/2026-10-01")).json()["actual"][
            "spending_recorded"
        ] == "250.00"
        assert (
            await post(
                "/activity",
                {"date": "2026-10-16", "category": "income", "amount": "-1"},
            )
        ).status_code == 422
        assert (await post("/activity/known-total", total_body)).status_code == 409
        deleted_adjustment = await client.request(
            "DELETE",
            prefix + f"/activity/{adjustment['uuid']}",
            json={"expected_revision": 1},
            headers={"Idempotency-Key": str(uuid4())},
        )
        assert deleted_adjustment.status_code == 200
        assert (await client.get(prefix + "/reviews/2026-10-01")).json()["actual"][
            "spending_recorded"
        ] == "210.00"
        # Later detail adds; competing totals cannot share a fingerprint.
        again = await post("/activity/known-total", total_body)
        assert again.status_code == 200 and again.json()["amount"] == "40.00"
        assert (
            await post(
                "/activity",
                {"date": "2026-10-17", "category": "spending", "amount": "40"},
            )
        ).status_code == 200
        assert (await client.get(prefix + "/reviews/2026-10-01")).json()["actual"][
            "spending_recorded"
        ] == "290.00"
        spending = [
            entry
            for entry in (await client.get(prefix + "/activity")).json()
            if entry["category"] == "spending"
        ]
        raced_body = {
            **total_body,
            "contributing_entries": [
                {"uuid": entry["uuid"], "revision": entry["revision"]}
                for entry in spending
            ],
        }
        raced_totals = await asyncio.gather(
            post("/activity/known-total", {**raced_body, "desired_total": "300"}),
            post("/activity/known-total", {**raced_body, "desired_total": "310"}),
        )
        assert sorted(result.status_code for result in raced_totals) == [200, 409]
        # No entries is unknown until an explicit zero adjustment is recorded.
        zero = await post(
            "/activity/known-total",
            {
                "date": "2026-11-03",
                "month": "2026-11-01",
                "category": "spending",
                "desired_total": "0",
                "contributing_entries": [],
            },
        )
        assert zero.status_code == 200 and zero.json()["amount"] == "0.00"
        assert zero.json()["is_adjustment"] is True
        zero_edit = await client.put(
            prefix + f"/activity/{zero.json()['uuid']}",
            json={
                "date": "2026-11-03",
                "category": "spending",
                "amount": "-5",
                "is_adjustment": True,
                "expected_revision": 1,
            },
            headers={"Idempotency-Key": str(uuid4())},
        )
        assert zero_edit.status_code == 200 and zero_edit.json()["amount"] == "-5.00"
        assert (
            await client.request(
                "DELETE",
                prefix + f"/activity/{zero.json()['uuid']}",
                json={"expected_revision": 2},
                headers={"Idempotency-Key": str(uuid4())},
            )
        ).status_code == 200
        assert (
            await post("/activity", {**entry_body, "amount": "1.001"})
        ).status_code == 422
        assert (
            await post("/activity", {**entry_body, "category": "saving"})
        ).status_code == 422
        changed = {**entry_body, "expected_revision": 1, "amount": "4100"}
        change_key = str(uuid4())
        updated = await client.put(
            prefix + f"/activity/{receipt['uuid']}",
            json=changed,
            headers={"Idempotency-Key": change_key},
        )
        assert updated.status_code == 200, updated.text
        stale = await client.put(
            prefix + f"/activity/{receipt['uuid']}",
            json=changed,
            headers={"Idempotency-Key": str(uuid4())},
        )
        assert stale.status_code == 409
        assert (
            await client.put(
                prefix + f"/activity/{receipt['uuid']}",
                json=changed,
                headers={"Idempotency-Key": change_key},
            )
        ).json() == updated.json()
        # A rejected duplicate source after draft mutation must roll everything back.
        invalid = {
            **plan_body,
            "expected_revision": 1,
            "incomes": [
                {"source_id": salary, "name": "Salary", "amount": "1"},
                {"source_id": salary, "name": "Duplicate", "amount": "2"},
            ],
        }
        before = (await client.get(prefix + "/plans")).json()
        async with sessions() as session:
            audit_count = await session.scalar(
                select(func.count())
                .select_from(m.audit)
                .where(m.audit.c.entity_id == entity["id"])
            )
        failed = await client.put(
            prefix + f"/plans/{plan['plan_id']}/draft",
            json=invalid,
            headers={"Idempotency-Key": str(uuid4())},
        )
        assert failed.status_code == 409
        assert (await client.get(prefix + "/plans")).json() == before
        async with sessions() as session:
            assert (
                await session.scalar(
                    select(func.count())
                    .select_from(m.audit)
                    .where(m.audit.c.entity_id == entity["id"])
                )
                == audit_count
            )
        valid_edit = {
            **plan_body,
            "expected_revision": 1,
            "incomes": [
                {"source_id": salary, "name": "Salary", "amount": "4200"},
                {"source_id": bonus, "name": "Bonus", "amount": "0"},
            ],
        }
        raced = await asyncio.gather(
            *[
                client.put(
                    prefix + f"/plans/{plan['plan_id']}/draft",
                    json=valid_edit,
                    headers={"Idempotency-Key": str(uuid4())},
                )
                for _ in range(2)
            ]
        )
        assert sorted(r.status_code for r in raced) == [200, 409]
        assert (await client.get(prefix + "/reviews/2026-10-01")).json()[
            "version"
        ] == version
        # Unknowns do not prevent review, and later activity changes only the
        # informational checkpoint status.
        edit_path = prefix + "/reviews/2026-10-01"
        edit = {
            "expected_revision": 1,
            "version_id": version["uuid"],
            "note": "Synthetic takeaway",
            "reviewed": True,
        }
        review_key = str(uuid4())
        marked = await client.put(
            edit_path, json=edit, headers={"Idempotency-Key": review_key}
        )
        assert marked.status_code == 200, marked.text
        assert (
            await client.put(
                edit_path, json=edit, headers={"Idempotency-Key": review_key}
            )
        ).json() == marked.json()
        read = (await client.get(edit_path)).json()
        assert read["review"]["reviewed_at"] and not read["checkpoint_changed"]
        assert read["actual"]["income_incomplete"] is False
        changed_activity = await post(
            "/activity", {"date": "2026-10-20", "category": "spending", "amount": "7"}
        )
        assert changed_activity.status_code == 200
        read = (await client.get(edit_path)).json()
        assert read["checkpoint_changed"] and read["review"]["reviewed_at"]
        assert (
            await client.put(
                edit_path, json=edit, headers={"Idempotency-Key": str(uuid4())}
            )
        ).status_code == 409
        # Saving a later version leaves this Review pinned until deliberate edit.
        later = await post(
            f"/plans/{plan['plan_id']}/versions", {"expected_revision": 2}
        )
        assert later.status_code == 200, later.text
        second_version = later.json()["version"]
        assert (await client.get(edit_path)).json()["version"]["uuid"] == version[
            "uuid"
        ]
        revised = {
            **edit,
            "expected_revision": 2,
            "version_id": second_version["uuid"],
        }
        entries_before_retarget = (await client.get(prefix + "/activity")).json()
        raced_reviews = await asyncio.gather(
            *[
                client.put(
                    edit_path, json=revised, headers={"Idempotency-Key": str(uuid4())}
                )
                for _ in range(2)
            ]
        )
        assert sorted(r.status_code for r in raced_reviews) == [200, 409]
        read = (await client.get(edit_path)).json()
        assert read["version"]["uuid"] == second_version["uuid"]
        assert read["entries"] and read["checkpoint_changed"] is True
        assert (
            next(e for e in read["entries"] if e["uuid"] == receipt["uuid"])[
                "source_uuid"
            ]
            == salary
        )
        assert (
            await client.get(prefix + "/activity")
        ).json() == entries_before_retarget
        assert (await client.get(prefix + "/reviews/2026-09-01")).json() == earlier_read
        refreshed = await client.put(
            edit_path,
            json={**revised, "expected_revision": 3, "checkpoint": True},
            headers={"Idempotency-Key": str(uuid4())},
        )
        assert refreshed.status_code == 200
        assert (await client.get(edit_path)).json()["checkpoint_changed"] is False
        assert (await client.get(prefix + "/activity")).json()
        # A copied Plan has distinct source identity and cannot be selected here.
        copied = await post(
            f"/plans/{plan['plan_id']}/copies",
            {
                "name": "Separate scenario",
                "source_revision_id": second_version["uuid"],
                "expected_revision": second_version["revision"],
            },
        )
        assert copied.status_code == 200
        foreign_version = await post(
            f"/plans/{copied.json()['plan_id']}/versions", {"expected_revision": 1}
        )
        assert foreign_version.status_code == 200
        reject = await client.put(
            edit_path,
            json={
                **revised,
                "expected_revision": 4,
                "version_id": foreign_version.json()["version"]["uuid"],
            },
            headers={"Idempotency-Key": str(uuid4())},
        )
        assert reject.status_code == 409
        assert (await client.get(edit_path)).json()["version"][
            "uuid"
        ] == second_version["uuid"]
        cleared = await client.put(
            edit_path,
            json={
                **revised,
                "expected_revision": 4,
                "reviewed": False,
                "note": "",
            },
            headers={"Idempotency-Key": str(uuid4())},
        )
        assert cleared.status_code == 200
        assert (await client.get(edit_path)).json()["review"]["reviewed_at"] is None
        async with sessions() as session:
            edits = (
                (
                    await session.execute(
                        select(m.audit).where(
                            m.audit.c.record_uuid == UUID(marked.json()["uuid"]),
                            m.audit.c.action == "edit_review",
                        )
                    )
                )
                .mappings()
                .all()
            )
            assert len(edits) == 4
            assert sorted(row["before"]["revision"] for row in edits) == [1, 2, 3, 4]
            assert sorted(row["after"]["revision"] for row in edits) == [2, 3, 4, 5]
        # A failed audit insert must roll back its financial record and retry result.
        async with admin.begin() as connection:
            await connection.execute(
                text(f"""CREATE FUNCTION fail_this_audit() RETURNS trigger
                LANGUAGE plpgsql AS $$
                BEGIN IF NEW.entity_id = {entity["id"]} THEN
                  RAISE EXCEPTION 'injected audit failure';
                END IF; RETURN NEW; END $$""")
            )
            await connection.execute(
                text(
                    "CREATE TRIGGER fail_this_audit BEFORE INSERT ON audit_log "
                    "FOR EACH ROW EXECUTE FUNCTION fail_this_audit()"
                )
            )
        before_entries = (await client.get(prefix + "/activity")).json()
        before_review = (await client.get(edit_path)).json()
        failure_key = str(uuid4())
        total_failure_key = str(uuid4())
        failed_total_body = {
            **total_body,
            "desired_total": "320",
            "contributing_entries": [
                {"uuid": entry["uuid"], "revision": entry["revision"]}
                for entry in before_entries
                if entry["category"] == "spending"
            ],
        }
        async with sessions() as session:
            audit_before_failure = await session.scalar(
                select(func.count())
                .select_from(m.audit)
                .where(m.audit.c.entity_id == entity["id"])
            )
        try:
            failed_review = await client.put(
                edit_path,
                json={**revised, "expected_revision": 5, "reviewed": True},
                headers={"Idempotency-Key": failure_key},
            )
            assert failed_review.status_code == 503
            failed = await post("/activity", entry_body, failure_key)
            assert failed.status_code == 503
            assert "private financial note" not in failed.text
            failed_total = await post(
                "/activity/known-total", failed_total_body, total_failure_key
            )
            assert failed_total.status_code == 503
        finally:
            async with admin.begin() as connection:
                await connection.execute(
                    text("DROP TRIGGER fail_this_audit ON audit_log")
                )
                await connection.execute(text("DROP FUNCTION fail_this_audit()"))
        assert (await client.get(prefix + "/activity")).json() == before_entries
        assert (await client.get(edit_path)).json() == before_review
        async with sessions() as session:
            assert (
                await session.scalar(
                    select(func.count())
                    .select_from(m.audit)
                    .where(m.audit.c.entity_id == entity["id"])
                )
                == audit_before_failure
            )
            assert (
                await session.scalar(
                    select(func.count())
                    .select_from(m.outcomes)
                    .where(
                        m.outcomes.c.request_key.in_([failure_key, total_failure_key])
                    )
                )
                == 0
            )
        retried_total = await post(
            "/activity/known-total", failed_total_body, total_failure_key
        )
        assert retried_total.status_code == 200
        assert retried_total.json()["is_adjustment"] is True
        # Deletion retains stored data and restores unknown for the expected source.
        deleted = await client.request(
            "DELETE",
            prefix + f"/activity/{receipt['uuid']}",
            json={"expected_revision": 2},
            headers={"Idempotency-Key": str(uuid4())},
        )
        assert deleted.status_code == 200, deleted.text
        assert (await client.get(prefix + "/reviews/2026-10-01")).json()["actual"][
            "income_incomplete"
        ] is True
        fixed_body = {
            "name": "Synthetic fixed costs",
            "incomes": [{"name": "Example income", "amount": "1000.00"}],
            "spending": "100.00",
            "fixed_costs": [
                {"name": name, "amount": "100.00", "frequency": "annual"}
                for name in ("Service A", "Service B", "Service C")
            ],
        }
        fixed_created = await post("/plans", fixed_body)
        assert fixed_created.status_code == 200, fixed_created.text
        fixed_plan = fixed_created.json()
        fixed_draft = fixed_plan["draft"]
        assert [line["monthly_amount"] for line in fixed_draft["fixed_costs"]] == [
            "8.33",
            "8.33",
            "8.33",
        ]
        assert fixed_draft["fixed_cost_total"] == "24.99"
        assert [line["amount"] for line in fixed_draft["fixed_costs"]] == ["100.00"] * 3
        fixed_saved_response = await post(
            f"/plans/{fixed_plan['plan_id']}/versions", {"expected_revision": 1}
        )
        assert fixed_saved_response.status_code == 200, fixed_saved_response.text
        fixed_saved = fixed_saved_response.json()["version"]
        copied_response = await post(
            f"/plans/{fixed_plan['plan_id']}/copies",
            {
                "name": "Independent copy",
                "source_revision_id": fixed_saved["uuid"],
                "expected_revision": fixed_saved["revision"],
            },
        )
        assert copied_response.status_code == 200, copied_response.text
        copied = copied_response.json()["draft"]
        assert copied["fixed_cost_total"] == "24.99"
        assert {line["fixed_cost_id"] for line in copied["fixed_costs"]}.isdisjoint(
            line["fixed_cost_id"] for line in fixed_saved["fixed_costs"]
        )
        fixed_review = await post(
            "/reviews", {"month": "2026-11-01", "version_id": fixed_saved["uuid"]}
        )
        assert fixed_review.status_code == 200, fixed_review.text
        fixed_read = (await client.get(prefix + "/reviews/2026-11-01")).json()
        assert fixed_read["actual"]["fixed_cost_recorded"] is None
        assert len(fixed_read["actual"]["missing_fixed_costs"]) == 3
        cost_id = fixed_saved["fixed_costs"][0]["fixed_cost_id"]
        payment_body = {
            "date": "2026-11-10",
            "category": "fixed_cost",
            "amount": "10.00",
            "fixed_cost_id": cost_id,
        }
        payment_response = await post("/activity", payment_body)
        assert payment_response.status_code == 200, payment_response.text
        payment = payment_response.json()
        assert payment["fixed_cost_name"] == "Service A"
        assert payment["funding_origin"] == "income"
        corrected = await client.put(
            prefix + f"/activity/{payment['uuid']}",
            json={**payment_body, "amount": "12.00", "expected_revision": 1},
            headers={"Idempotency-Key": str(uuid4())},
        )
        assert corrected.status_code == 200, corrected.text
        unassigned = await post(
            "/activity",
            {
                "date": "2026-11-11",
                "category": "fixed_cost",
                "amount": "2.00",
            },
        )
        assert unassigned.status_code == 200, unassigned.text
        adjustment = await post(
            "/activity",
            {
                "date": "2026-11-12",
                "category": "fixed_cost",
                "amount": "-1.00",
                "is_adjustment": True,
            },
        )
        assert adjustment.status_code == 200, adjustment.text
        fixed_read = (await client.get(prefix + "/reviews/2026-11-01")).json()
        assert fixed_read["actual"]["fixed_cost_recorded"] == "13.00"
        assert fixed_read["actual"]["fixed_cost_incomplete"] is True
        assert len(fixed_read["actual"]["missing_fixed_costs"]) == 2
        assert fixed_read["fixed_cost_difference"] is None
        deleted_payment = await client.request(
            "DELETE",
            prefix + f"/activity/{payment['uuid']}",
            json={"expected_revision": 2},
            headers={"Idempotency-Key": str(uuid4())},
        )
        assert deleted_payment.status_code == 200, deleted_payment.text
        assert deleted_payment.json()["fixed_cost_name"] == "Service A"
        assert (await client.get(prefix + "/reviews/2026-11-01")).json()["actual"][
            "fixed_cost_recorded"
        ] == "1.00"
        # Removing access denies an already successful idempotency replay.
        async with sessions() as session, session.begin():
            await session.execute(
                update(m.entities)
                .where(m.entities.c.id == entity["id"])
                .values(owner_id=other)
            )
        assert (await post("/activity", entry_body, identity)).status_code == 404
        async with sessions() as session, session.begin():
            await session.execute(
                update(m.entities)
                .where(m.entities.c.id == entity["id"])
                .values(owner_id=user)
            )
        issued = await client.post("/api/keys", json={"name": "Disposable"})
        assert issued.status_code == 200
        issued = issued.json()
        assert (await client.delete(f"/api/keys/{issued['id']}")).status_code == 200
        assert (
            await client.get(
                prefix + "/plans", headers={"Authorization": f"Bearer {issued['key']}"}
            )
        ).status_code == 401
    async with sessions() as session:
        audit_rows = (
            (
                await session.execute(
                    select(m.audit).where(m.audit.c.entity_id == entity["id"])
                )
            )
            .mappings()
            .all()
        )
        assert any(
            row["before"]
            and row["before"].get("amount") == "4000.00"
            and row["after"].get("amount") == "4100.00"
            for row in audit_rows
        )
        assert all(
            row["actor_id"] == user and row["interface"] == "direct_api"
            for row in audit_rows
        )
        persisted = (
            (
                await session.execute(
                    select(m.entries).where(m.entries.c.uuid == UUID(receipt["uuid"]))
                )
            )
            .mappings()
            .one()
        )
        assert persisted["deleted_at"] is not None
        digest = await session.scalar(
            select(m.keys.c.digest).where(m.keys.c.uuid == UUID(key["id"]))
        )
        assert digest != key["key"] and len(digest) == 64
    # Real DB enforces immutability even if a service accidentally attempts a write.
    for statement in [
        "UPDATE audit_log SET action='changed'",
        "DELETE FROM audit_log",
        "TRUNCATE audit_log",
        "UPDATE plan_revision SET name='changed' WHERE saved",
        "UPDATE plan_income_line SET amount=0 WHERE plan_revision_id IN "
        "(SELECT id FROM plan_revision WHERE saved)",
    ]:
        async with runtime.begin() as connection:
            with pytest.raises(DBAPIError):
                await connection.execute(text(statement))
    await runtime.dispose()
    await admin.dispose()
