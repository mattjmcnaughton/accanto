"""Real-Postgres estimate persistence, retry, isolation, and audit guarantees.

Use a migrated, isolated ACCANTO_TEST_DATABASE_URL ending in `_test`.
"""

import asyncio
import os
from datetime import UTC, datetime
from uuid import UUID, uuid4

import httpx
import pytest
from sqlalchemy import func, insert, select, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from accanto.app import create_app
from accanto.db import get_session
from accanto.models import income_estimates as em
from accanto.models import monthly as m
from accanto.services.api_keys import issue_key

URL = os.environ.get("ACCANTO_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not URL, reason="Use an isolated migrated test database"
)


def test_estimate_api_and_database_guarantees():
    asyncio.run(scenario())


async def scenario():
    assert URL and URL.rsplit("/", 1)[-1].endswith("_test")
    admin = create_async_engine(URL)
    sessions = async_sessionmaker(admin)
    async with sessions() as session, session.begin():
        user = await session.scalar(
            insert(m.users)
            .values(issuer="estimate-test", subject=str(uuid4()))
            .returning(m.users.c.id)
        )
        other = await session.scalar(
            insert(m.users)
            .values(issuer="estimate-test", subject=str(uuid4()))
            .returning(m.users.c.id)
        )
        entity = await session.scalar(
            insert(m.entities)
            .values(owner_id=user, name="Synthetic Entity", time_zone="UTC")
            .returning(m.entities.c.uuid)
        )
        foreign = await session.scalar(
            insert(m.entities)
            .values(owner_id=other, name="Other Entity", time_zone="UTC")
            .returning(m.entities.c.uuid)
        )
        key = await issue_key(session, user, "Estimate test")
        other_key = await issue_key(session, other, "Other test")
    async with admin.begin() as connection:
        await connection.execute(
            text("""DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='accanto_est_app')
            THEN CREATE ROLE accanto_est_app NOLOGIN; END IF; END $$""")
        )
        await connection.execute(
            text("GRANT USAGE ON SCHEMA public TO accanto_est_app")
        )
        await connection.execute(
            text(
                "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES "
                "IN SCHEMA public TO accanto_est_app"
            )
        )
        await connection.execute(
            text(
                "GRANT USAGE, SELECT ON ALL SEQUENCES "
                "IN SCHEMA public TO accanto_est_app"
            )
        )
        await connection.execute(
            text("REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM accanto_est_app")
        )
    runtime = create_async_engine(
        URL, connect_args={"server_settings": {"role": "accanto_est_app"}}
    )
    runtime_sessions = async_sessionmaker(runtime)
    app = create_app()

    async def session_dependency():
        async with runtime_sessions() as session:
            yield session

    app.dependency_overrides[get_session] = session_dependency
    prefix = f"/api/entities/{entity}/income-estimates"
    body = {
        "name": "Two roles",
        "lines": [
            {
                "name": "Role A",
                "gross": "6000",
                "withholding": "1200",
                "payroll": "300",
                "frequency": "monthly",
            },
            {
                "name": "Role B",
                "gross": "4000",
                "withholding": "800",
                "payroll": "200",
                "frequency": "monthly",
            },
        ],
    }
    headers = {"Authorization": f"Bearer {key['key']}"}
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test", headers=headers
    ) as client:

        async def post(path, data, request_key=None):
            return await client.post(
                prefix + path,
                json=data,
                headers={"Idempotency-Key": request_key or str(uuid4())},
            )

        assert (await client.get(prefix)).json() == []
        assert (
            await client.get(f"/api/entities/{foreign}/income-estimates")
        ).status_code == 404
        assert (await client.post(prefix, json=body)).status_code == 422
        request_key = str(uuid4())
        created = await post("", body, request_key)
        assert created.status_code == 200, created.text
        original = created.json()
        assert original["monthly_total"] == "7500.00"
        assert [line["monthly_net"] for line in original["lines"]] == [
            "4500.00",
            "3000.00",
        ]
        assert (await post("", body, request_key)).json() == original
        assert (
            await post("", {**body, "name": "Different"}, request_key)
        ).status_code == 409
        assert (await client.get(prefix + "/" + original["uuid"])).json() == original
        assert (
            await client.get(
                prefix + "/" + original["uuid"],
                headers={"Authorization": f"Bearer {other_key['key']}"},
            )
        ).status_code == 404

        edited_body = {
            **body,
            "expected_revision": 1,
            "lines": [
                {
                    **body["lines"][0],
                    "line_id": original["lines"][0]["uuid"],
                    "gross": "6100",
                },
                {**body["lines"][1], "line_id": original["lines"][1]["uuid"]},
            ],
        }
        edited = await client.put(
            prefix + "/" + original["uuid"],
            json=edited_body,
            headers={"Idempotency-Key": str(uuid4())},
        )
        assert edited.status_code == 200, edited.text
        edited_result = edited.json()
        assert edited_result["revision"] == 2
        assert edited_result["monthly_total"] == "7600.00"
        assert [line["uuid"] for line in edited_result["lines"]] == [
            line["uuid"] for line in original["lines"]
        ]
        assert (
            await client.put(
                prefix + "/" + original["uuid"],
                json=edited_body,
                headers={"Idempotency-Key": str(uuid4())},
            )
        ).status_code == 409
        duplicate = await post(
            "/" + original["uuid"] + "/duplicate",
            {"name": "Alternative", "expected_revision": 2},
        )
        assert duplicate.status_code == 200, duplicate.text
        copy = duplicate.json()
        assert copy["uuid"] != original["uuid"]
        assert copy["monthly_total"] == "7600.00"
        assert {line["uuid"] for line in copy["lines"]}.isdisjoint(
            {line["uuid"] for line in edited_result["lines"]}
        )
        copy_edit = {
            "name": "Alternative edited",
            "expected_revision": 1,
            "lines": [{**body["lines"][0], "line_id": copy["lines"][0]["uuid"]}],
        }
        assert (
            await client.put(
                prefix + "/" + copy["uuid"],
                json=copy_edit,
                headers={"Idempotency-Key": str(uuid4())},
            )
        ).status_code == 200
        assert (
            await client.get(prefix + "/" + original["uuid"])
        ).json() == edited_result
        assert len((await client.get(prefix)).json()) == 2
        async with sessions() as session:
            entity_id = await session.scalar(
                select(m.entities.c.id).where(m.entities.c.uuid == entity)
            )
            assert (
                await session.scalar(
                    select(func.count())
                    .select_from(m.plans)
                    .where(m.plans.c.entity_id == entity_id)
                )
                == 0
            )
            assert (
                await session.scalar(
                    select(func.count())
                    .select_from(m.entries)
                    .where(m.entries.c.entity_id == entity_id)
                )
                == 0
            )
            audits = (
                (
                    await session.execute(
                        select(m.audit)
                        .where(
                            m.audit.c.entity_id == entity_id,
                            m.audit.c.record_type == "income_estimate",
                        )
                        .order_by(m.audit.c.id)
                    )
                )
                .mappings()
                .all()
            )
            assert len(audits) == 4
            assert audits[0]["before"] is None
            assert audits[1]["before"]["monthly_total"] == "7500.00"
            assert audits[2]["before"] is None  # duplicate creates a new record
        assert all(row["actor_id"] == user for row in audits)

        # A line from another estimate cannot be adopted into this estimate.
        invalid_edit = {
            **edited_body,
            "expected_revision": 2,
            "lines": [{**edited_body["lines"][0], "line_id": copy["lines"][0]["uuid"]}],
        }
        assert (
            await client.put(
                prefix + "/" + original["uuid"],
                json=invalid_edit,
                headers={"Idempotency-Key": str(uuid4())},
            )
        ).status_code == 409
        assert (
            await client.get(prefix + "/" + original["uuid"])
        ).json() == edited_result

        # Entity locking makes two competing same-key requests one create.
        race_key = str(uuid4())
        raced = await asyncio.gather(
            post("", {**body, "name": "Race"}, race_key),
            post("", {**body, "name": "Race"}, race_key),
        )
        assert [response.status_code for response in raced] == [200, 200]
        assert raced[0].json() == raced[1].json()
        assert len((await client.get(prefix)).json()) == 3

        # Audit failure rolls back both estimate and recorded retry outcome.
        failure_key = str(uuid4())
        before_failure = (await client.get(prefix)).json()
        async with admin.begin() as connection:
            await connection.execute(
                text(f"""CREATE FUNCTION fail_estimate_audit() RETURNS trigger
                LANGUAGE plpgsql AS $$ BEGIN IF NEW.entity_id = {entity_id}
                THEN RAISE EXCEPTION 'injected audit failure'; END IF;
                RETURN NEW; END $$""")
            )
            await connection.execute(
                text(
                    "CREATE TRIGGER fail_estimate_audit BEFORE INSERT ON audit_log "
                    "FOR EACH ROW EXECUTE FUNCTION fail_estimate_audit()"
                )
            )
        try:
            failed = await post("", {**body, "name": "Should roll back"}, failure_key)
            assert failed.status_code == 503
        finally:
            async with admin.begin() as connection:
                await connection.execute(
                    text("DROP TRIGGER fail_estimate_audit ON audit_log")
                )
                await connection.execute(text("DROP FUNCTION fail_estimate_audit()"))
        assert (await client.get(prefix)).json() == before_failure
        async with sessions() as session:
            assert (
                await session.scalar(
                    select(func.count())
                    .select_from(m.outcomes)
                    .where(m.outcomes.c.request_key == failure_key)
                )
                == 0
            )

        # A raw SQL write cannot persist daily frequency without explicit paid days.
        async with sessions() as session:
            estimate_id = await session.scalar(
                select(em.estimates.c.id).where(
                    em.estimates.c.uuid == UUID(copy["uuid"])
                )
            )
        with pytest.raises(IntegrityError):
            async with admin.begin() as connection:
                await connection.execute(
                    insert(em.lines).values(
                        estimate_id=estimate_id,
                        entity_id=entity_id,
                        position=99,
                        name="Invalid daily",
                        gross=1,
                        withholding=0,
                        payroll=0,
                        frequency="daily",
                        paid_days=None,
                        monthly_net=0,
                    )
                )
        # Counts beyond JavaScript's safe-integer range preserve entered digits.
        daily = await post(
            "",
            {
                "name": "Zero-day scenario",
                "lines": [
                    {
                        "name": "Daily assumption",
                        "gross": "0.00",
                        "withholding": "0.00",
                        "payroll": "0.00",
                        "frequency": "daily",
                        "paid_days": "9007199254740993",
                    }
                ],
            },
        )
        assert daily.status_code == 200, daily.text
        assert daily.json()["lines"][0]["paid_days"] == "9007199254740993"
        assert daily.json()["monthly_total"] == "0.00"
        async with sessions() as session, session.begin():
            await session.execute(
                update(m.keys)
                .where(m.keys.c.uuid == UUID(key["id"]))
                .values(revoked_at=datetime.now(UTC))
            )
        assert (await client.get(prefix)).status_code == 401
        assert (await post("", body, request_key)).status_code == 401
    await runtime.dispose()
    await admin.dispose()
