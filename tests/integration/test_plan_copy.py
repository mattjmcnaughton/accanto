"""Synthetic Plan-copy workflows against a dedicated migrated PostgreSQL DB."""

import asyncio
import os
from uuid import UUID, uuid4

import httpx
import pytest
from sqlalchemy import func, insert, select, text, update
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from accanto.app import create_app
from accanto.db import get_session
from accanto.models import monthly as m
from accanto.services.api_keys import issue_key

URL = os.environ.get("ACCANTO_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="Requires isolated migrated test DB")


def test_plan_copy_is_independent_atomic_and_retry_safe():
    asyncio.run(copy_scenario())


async def copy_scenario():
    assert URL and "test" in URL.rsplit("/", 1)[-1]
    engine = create_async_engine(URL)
    sessions = async_sessionmaker(engine)
    async with sessions() as session, session.begin():
        owner = await session.scalar(
            insert(m.users)
            .values(issuer="copy-test", subject=str(uuid4()))
            .returning(m.users.c.id)
        )
        entity = await session.scalar(
            insert(m.entities)
            .values(owner_id=owner, name="Synthetic scenarios", time_zone="UTC")
            .returning(m.entities.c.uuid)
        )
        foreign_owner = await session.scalar(
            insert(m.users)
            .values(issuer="copy-test", subject=str(uuid4()))
            .returning(m.users.c.id)
        )
        foreign = await session.scalar(
            insert(m.entities)
            .values(
                owner_id=foreign_owner,
                name="Other synthetic workspace",
                time_zone="UTC",
            )
            .returning(m.entities.c.uuid)
        )
        credential = await issue_key(session, owner, "Copy test")
    app = create_app()

    async def dependency():
        async with sessions() as session:
            yield session

    app.dependency_overrides[get_session] = dependency
    prefix = f"/api/entities/{entity}"
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
        headers={"Authorization": f"Bearer {credential['key']}"},
    ) as client:

        async def post(path, body, key=None):
            return await client.post(
                prefix + path,
                json=body,
                headers={"Idempotency-Key": key or str(uuid4())},
            )

        original = (
            await post(
                "/plans",
                {
                    "name": "Baseline",
                    "incomes": [
                        {"name": "Synthetic income", "amount": "4000"},
                        {"name": "Other income", "amount": "0"},
                    ],
                    "spending": "800",
                },
            )
        ).json()
        plan_id = original["plan_id"]
        # Seed a deliberately synthetic older rule while the draft is mutable.
        async with sessions() as session, session.begin():
            await session.execute(
                update(m.revisions)
                .where(m.revisions.c.uuid == UUID(original["draft"]["uuid"]))
                .values(rule_version="synthetic-older-rule", tithe_target="375.00")
            )
        saved = (
            await post(f"/plans/{plan_id}/versions", {"expected_revision": 1})
        ).json()
        version = saved["version"]
        assert (
            await post(
                "/reviews", {"month": "2026-10-01", "version_id": version["uuid"]}
            )
        ).status_code == 200
        changed_original = await client.put(
            prefix + f"/plans/{plan_id}/draft",
            json={
                "name": "Baseline draft",
                "incomes": version["incomes"],
                "spending": "850",
                "expected_revision": 1,
            },
            headers={"Idempotency-Key": str(uuid4())},
        )
        assert changed_original.status_code == 200
        before = (await client.get(prefix + "/plans")).json()
        stored = next(r for r in before[0]["revisions"] if r["saved"])
        assert stored["rule_version"] == "synthetic-older-rule"
        assert stored["tithe_target"] == "375.00"
        review_before = (await client.get(prefix + "/reviews/2026-10-01")).json()
        body = {
            "name": "Alternative",
            "source_revision_id": version["uuid"],
            "expected_revision": version["revision"],
        }
        copy_path = f"/plans/{plan_id}/copies"
        key = str(uuid4())
        a, b = await asyncio.gather(
            post(copy_path, body, key), post(copy_path, body, key)
        )
        assert a.status_code == b.status_code == 200, a.text
        copied = a.json()
        assert copied == b.json()
        assert copied["plan_id"] != plan_id
        assert {x["source_id"] for x in copied["draft"]["incomes"]}.isdisjoint(
            x["source_id"] for x in version["incomes"]
        )
        assert [(x["name"], x["amount"]) for x in copied["draft"]["incomes"]] == [
            ("Synthetic income", "4000.00"),
            ("Other income", "0.00"),
        ]
        assert copied["draft"]["spending"] == "800.00"
        assert copied["draft"]["rule_version"] == "monthly-net-1"
        assert copied["draft"]["tithe_target"] == "400.00"
        assert (
            await post(copy_path, {**body, "name": "Changed"}, key)
        ).status_code == 409
        assert (
            await post(copy_path, {**body, "expected_revision": 999})
        ).status_code == 409
        assert (
            await post(
                copy_path, {**body, "source_revision_id": copied["draft"]["uuid"]}
            )
        ).status_code == 404
        assert (
            await client.post(
                f"/api/entities/{foreign}/plans/{plan_id}/copies",
                json=body,
                headers={"Idempotency-Key": str(uuid4())},
            )
        ).status_code == 404
        edit = {
            "name": "Alternative edited",
            "incomes": copied["draft"]["incomes"],
            "spending": "900",
            "expected_revision": 1,
        }
        edited = await client.put(
            prefix + f"/plans/{copied['plan_id']}/draft",
            json=edit,
            headers={"Idempotency-Key": str(uuid4())},
        )
        assert edited.status_code == 200, edited.text
        assert (
            await post(f"/plans/{copied['plan_id']}/versions", {"expected_revision": 2})
        ).status_code == 200
        after = (await client.get(prefix + "/plans")).json()
        assert next(p for p in after if p["plan_id"] == plan_id) == before[0]
        assert (
            await client.get(prefix + "/reviews/2026-10-01")
        ).json() == review_before
        # Explicit draft selection uses its current inputs, not the saved version.
        draft_body = {
            **body,
            "source_revision_id": edited.json()["draft"]["uuid"],
            "expected_revision": 2,
        }
        # Saving freezes that revision and increments it; stale selection is rejected.
        assert (
            await post(f"/plans/{copied['plan_id']}/copies", draft_body)
        ).status_code == 409
        current = next(p for p in after if p["plan_id"] == copied["plan_id"])
        draft = next(r for r in current["revisions"] if not r["saved"])
        draft_copy = await post(
            f"/plans/{copied['plan_id']}/copies",
            {
                **body,
                "source_revision_id": draft["uuid"],
                "expected_revision": draft["revision"],
            },
        )
        assert draft_copy.status_code == 200, draft_copy.text
        assert draft_copy.json()["draft"]["spending"] == "900.00"
        async with sessions() as session:
            counts = {
                table.name: await session.scalar(
                    select(func.count()).select_from(table)
                )
                for table in (
                    m.plans,
                    m.revisions,
                    m.sources,
                    m.income_lines,
                    m.audit,
                    m.outcomes,
                )
            }
            copied_audit = (
                (
                    await session.execute(
                        select(m.audit).where(
                            m.audit.c.record_uuid == UUID(copied["plan_id"]),
                            m.audit.c.action == "copy_plan",
                        )
                    )
                )
                .mappings()
                .one()
            )
            assert copied_audit["before"] is None
            assert copied_audit["after"]["uuid"] == copied["plan_id"]
        # Fail at the final Plan audit, after its revision and sources are inserted.
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    "CREATE FUNCTION reject_copy_test() RETURNS trigger "
                    "LANGUAGE plpgsql AS $$ BEGIN "
                    "RAISE EXCEPTION 'synthetic audit failure'; END $$"
                )
            )
            await conn.execute(
                text(
                    "CREATE TRIGGER reject_copy_test BEFORE INSERT ON audit_log "
                    "FOR EACH ROW WHEN (NEW.action = 'copy_plan' "
                    "AND NEW.record_type = 'plan') "
                    "EXECUTE FUNCTION reject_copy_test()"
                )
            )
        try:
            assert (await post(copy_path, body)).status_code == 503
            async with sessions() as session:
                assert {
                    table.name: await session.scalar(
                        select(func.count()).select_from(table)
                    )
                    for table in (
                        m.plans,
                        m.revisions,
                        m.sources,
                        m.income_lines,
                        m.audit,
                        m.outcomes,
                    )
                } == counts
        finally:
            async with engine.begin() as conn:
                await conn.execute(text("DROP TRIGGER reject_copy_test ON audit_log"))
                await conn.execute(text("DROP FUNCTION reject_copy_test()"))
    await engine.dispose()
