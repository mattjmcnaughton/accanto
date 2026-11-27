"""Settings changes preserve financial history and share transactional guarantees."""

import asyncio
import os
from datetime import UTC, datetime
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import func, insert, select, text, update
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from accanto.app import create_app
from accanto.config import Settings
from accanto.db import get_session
from accanto.models import monthly as m
from accanto.services.access import issue_session, resolve_actor
from accanto.services.api_keys import issue_key
from accanto.services.browser_auth import csrf_token
from accanto.services.entity_settings import read_settings
from accanto.services.monthly import write

URL = os.environ.get("ACCANTO_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="Requires isolated Postgres")


def test_entity_settings_and_key_metadata():
    asyncio.run(scenario())


async def scenario():
    assert URL and "test" in URL.rsplit("/", 1)[-1]
    engine = create_async_engine(URL)
    sessions = async_sessionmaker(engine)
    async with sessions() as db, db.begin():
        user = await db.scalar(
            insert(m.users)
            .values(issuer="test", subject=str(uuid4()))
            .returning(m.users.c.id)
        )
        entity = (
            (
                await db.execute(
                    insert(m.entities)
                    .values(
                        owner_id=user,
                        name="Synthetic original",
                        time_zone="America/Los_Angeles",
                    )
                    .returning(m.entities)
                )
            )
            .mappings()
            .one()
        )
        key = await issue_key(db, user, "Synthetic key")
        second_key = await issue_key(db, user, "Second synthetic key")
        other = await db.scalar(
            insert(m.users)
            .values(issuer="test", subject=str(uuid4()))
            .returning(m.users.c.id)
        )
        other_key = await issue_key(db, other, "Foreign key")
        browser = await issue_session(db, user)
        actor = await resolve_actor(db, browser["token"], "session")
    app = create_app()

    async def session_dependency():
        async with sessions() as db:
            yield db

    app.dependency_overrides[get_session] = session_dependency
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="https://test",
        headers={"Authorization": f"Bearer {key['key']}"},
    ) as client:
        path = f"/api/entities/{entity['uuid']}/settings"

        async def post(resource, body):
            response = await client.post(
                f"/api/entities/{entity['uuid']}/{resource}",
                json=body,
                headers={"Idempotency-Key": str(uuid4())},
            )
            assert response.status_code == 200, response.text
            return response.json()

        plan = await post(
            "plans",
            {
                "name": "Synthetic historical Plan",
                "incomes": [{"name": "Synthetic income", "amount": "1000"}],
                "spending": "100",
            },
        )
        version = await post(
            f"plans/{plan['plan_id']}/versions", {"expected_revision": 1}
        )
        await post(
            "activity",
            {
                "date": "2026-10-31",
                "category": "spending",
                "amount": "25",
                "note": "Synthetic history",
            },
        )
        await post(
            "reviews", {"month": "2026-10-01", "version_id": version["version"]["uuid"]}
        )
        async with sessions() as db:
            history = {
                table.name: [
                    dict(row)
                    for row in (
                        await db.execute(
                            select(table).where(table.c.entity_id == entity["id"])
                        )
                    ).mappings()
                ]
                for table in (m.entries, m.reviews, m.revisions)
            }
        async with sessions() as db:
            assert (
                await read_settings(
                    db,
                    actor,
                    entity["uuid"],
                    instant=datetime(2026, 11, 1, 0, 30, tzinfo=UTC),
                )
            )["today"] == "2026-10-31"
        response = await client.get(path)
        assert response.status_code == 200, response.text
        assert response.json()["revision"] == 1
        payload = {
            "name": "Synthetic updated",
            "time_zone": "Pacific/Kiritimati",
            "expected_revision": 1,
        }
        headers = {"Idempotency-Key": str(uuid4())}
        updated = await client.put(path, json=payload, headers=headers)
        assert updated.status_code == 200, updated.text
        assert updated.json()["revision"] == 2
        assert updated.json()["id"] == str(entity["uuid"])
        async with sessions() as db:
            assert (
                await read_settings(
                    db,
                    actor,
                    entity["uuid"],
                    instant=datetime(2026, 11, 1, 0, 30, tzinfo=UTC),
                )
            )["today"] == "2026-11-01"
        async with sessions() as db:
            for table in (m.entries, m.reviews, m.revisions):
                after = [
                    dict(row)
                    for row in (
                        await db.execute(
                            select(table).where(table.c.entity_id == entity["id"])
                        )
                    ).mappings()
                ]
                assert after == history[table.name]
        # Session/key credentials of one User share the same retry scope.
        async with sessions() as db:
            assert (
                await write(
                    db,
                    actor,
                    entity["uuid"],
                    "edit_entity",
                    headers["Idempotency-Key"],
                    payload,
                )
                == updated.json()
            )
        assert (
            await client.put(
                path, json={**payload, "name": "Different"}, headers=headers
            )
        ).status_code == 409
        for zone in ("Mars/Olympus", "../UTC", "localtime"):
            assert (
                await client.put(
                    path,
                    json={**payload, "expected_revision": 2, "time_zone": zone},
                    headers={"Idempotency-Key": str(uuid4())},
                )
            ).status_code == 422
        assert (
            await client.put(path, json=payload, headers=headers)
        ).json() == updated.json()
        assert (
            await client.put(
                path, json=payload, headers={"Idempotency-Key": str(uuid4())}
            )
        ).status_code == 409
        # API keys never read or manage credentials, their own included.
        for method, url in (
            ("GET", "/api/keys"),
            ("POST", "/api/keys"),
            ("DELETE", f"/api/keys/{second_key['id']}"),
            ("DELETE", f"/api/keys/{key['id']}"),
        ):
            refused = await client.request(
                method,
                url,
                json={"name": "Synthetic minted"} if method == "POST" else None,
            )
            assert refused.status_code == 403, (method, url)
            assert refused.json()["detail"]["code"] == "browser_session_required"
            assert "key" not in refused.json()["detail"]
        async with sessions() as db:
            assert (
                await db.scalar(
                    select(func.count())
                    .select_from(m.keys)
                    .where(m.keys.c.user_id == user, m.keys.c.revoked_at.is_(None))
                )
                == 2
            )
        assert (
            await client.get(
                path, headers={"Authorization": f"Bearer {other_key['key']}"}
            )
        ).status_code == 404

        # A failing Entity audit rolls back settings and its retry outcome.
        trigger = "fail_settings_" + uuid4().hex
        async with engine.begin() as conn:
            await conn.execute(
                text(f"""CREATE FUNCTION {trigger}() RETURNS trigger
                LANGUAGE plpgsql AS $$ BEGIN IF NEW.entity_id={entity["id"]}
                AND NEW.record_type='entity' THEN RAISE EXCEPTION 'synthetic failure';
                END IF; RETURN NEW; END $$""")
            )
            await conn.execute(
                text(
                    f"CREATE TRIGGER {trigger} BEFORE INSERT ON audit_log "
                    f"FOR EACH ROW EXECUTE FUNCTION {trigger}()"
                )
            )
        failure_key = str(uuid4())
        try:
            failure = await client.put(
                path,
                json={**payload, "expected_revision": 2},
                headers={"Idempotency-Key": failure_key},
            )
            assert failure.status_code == 503
            assert (await client.get(path)).json()["revision"] == 2
            async with sessions() as db:
                assert (
                    await db.scalar(
                        select(func.count())
                        .select_from(m.outcomes)
                        .where(m.outcomes.c.request_key == failure_key)
                    )
                    == 0
                )
        finally:
            async with engine.begin() as conn:
                await conn.execute(text(f"DROP TRIGGER {trigger} ON audit_log"))
                await conn.execute(text(f"DROP FUNCTION {trigger}()"))
        # Current access also applies to successful settings replays.
        async with sessions() as db, db.begin():
            await db.execute(
                update(m.entities)
                .where(m.entities.c.id == entity["id"])
                .values(owner_id=other)
            )
        assert (
            await client.put(path, json=payload, headers=headers)
        ).status_code == 404
        async with sessions() as db, db.begin():
            await db.execute(
                update(m.entities)
                .where(m.entities.c.id == entity["id"])
                .values(owner_id=user)
            )

        # Competing settings revisions serialize; exactly one can commit.
        async def edit(name):
            return await client.put(
                path,
                json={**payload, "name": name, "expected_revision": 2},
                headers={"Idempotency-Key": str(uuid4())},
            )

        one, two = await asyncio.gather(edit("Concurrent one"), edit("Concurrent two"))
        assert sorted([one.status_code, two.status_code]) == [200, 409]
    async with sessions() as db:
        audits = (
            (
                await db.execute(
                    select(m.audit)
                    .where(
                        m.audit.c.entity_id == entity["id"],
                        m.audit.c.record_type == "entity",
                    )
                    .order_by(m.audit.c.id)
                )
            )
            .mappings()
            .all()
        )
        assert len(audits) == 2
        assert audits[0]["before"]["name"] == "Synthetic original"
        assert audits[0]["after"]["name"] == "Synthetic updated"
    config = Settings(
        browser_origin="https://test",
        browser_csrf_secret="synthetic-settings-csrf-secret-long-enough",
    )
    app.state.auth_settings = config
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="https://test",
        cookies={"accanto_session": browser["token"]},
    ) as browser_client:
        response = await browser_client.put(
            path,
            json={**payload, "name": "Browser settings", "expected_revision": 3},
            headers={
                "Origin": "https://test",
                "X-CSRF-Token": csrf_token(browser["token"], config),
                "Idempotency-Key": str(uuid4()),
            },
        )
        assert response.status_code == 200, response.text
        assert response.json()["revision"] == 4
        browser_write = {
            "Origin": "https://test",
            "X-CSRF-Token": csrf_token(browser["token"], config),
        }
        keys = await browser_client.get("/api/keys")
        assert keys.status_code == 200
        assert keys.json()[0]["id"] == key["id"]
        assert {row["id"] for row in keys.json()} == {key["id"], second_key["id"]}
        foreign = await browser_client.delete(
            f"/api/keys/{other_key['id']}", headers=browser_write
        )
        assert foreign.status_code == 404
        revoke = f"/api/keys/{second_key['id']}"
        assert (
            await browser_client.delete(revoke, headers=browser_write)
        ).status_code == 200
        revoked_first = (await browser_client.get("/api/keys")).json()[1]["revoked_at"]
        assert (
            await browser_client.delete(revoke, headers=browser_write)
        ).status_code == 200
        assert (await browser_client.get("/api/keys")).json()[1][
            "revoked_at"
        ] == revoked_first
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="https://test"
        ) as revoked_client:
            assert (
                await revoked_client.get(
                    path, headers={"Authorization": f"Bearer {second_key['key']}"}
                )
            ).status_code == 401
        # A browser without its CSRF token cannot manage keys either.
        assert (
            await browser_client.post("/api/keys", json={"name": "x"})
        ).status_code == 403
        listed = await browser_client.get("/api/keys")
        assert listed.status_code == 200
        assert all(
            set(row) == {"id", "name", "created_at", "revoked_at"}
            for row in listed.json()
        )
    async with sessions() as db:
        audit = (
            (
                await db.execute(
                    select(m.audit)
                    .where(
                        m.audit.c.entity_id == entity["id"],
                        m.audit.c.record_type == "entity",
                    )
                    .order_by(m.audit.c.id.desc())
                    .limit(1)
                )
            )
            .mappings()
            .one()
        )
        assert audit["session_uuid"] == actor.credential_uuid
        assert audit["api_key_uuid"] is None and audit["interface"] == "browser"
    await engine.dispose()
