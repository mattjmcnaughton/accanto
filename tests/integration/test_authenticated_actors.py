"""Synthetic actors exercise shared services against isolated Postgres."""

import asyncio
import os
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from sqlalchemy import func, insert, select, text, update
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from accanto.models import monthly as m
from accanto.services.access import (
    RejectionError,
    issue_session,
    resolve_actor,
    revoke_session,
)
from accanto.services.api_keys import issue_key
from accanto.services.monthly import read_plans, write

URL = os.environ.get("ACCANTO_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="Requires isolated Postgres")


def test_shared_actor_guarantees():
    asyncio.run(actor_scenario())


async def actor_scenario():
    assert URL and "test" in URL.rsplit("/", 1)[-1]
    engine = create_async_engine(URL)
    sessions = async_sessionmaker(engine)
    async with sessions() as db, db.begin():
        user = await db.scalar(
            insert(m.users)
            .values(issuer="test", subject=str(uuid4()))
            .returning(m.users.c.id)
        )
        other = await db.scalar(
            insert(m.users)
            .values(issuer="test", subject=str(uuid4()))
            .returning(m.users.c.id)
        )
        entity = await db.scalar(
            insert(m.entities)
            .values(owner_id=user, name="Synthetic", time_zone="UTC")
            .returning(m.entities.c.uuid)
        )
        foreign = await db.scalar(
            insert(m.entities)
            .values(owner_id=other, name="Other synthetic", time_zone="UTC")
            .returning(m.entities.c.uuid)
        )
        key = await issue_key(db, user, "synthetic")
        other_key = await issue_key(db, other, "other synthetic")
        browser = await issue_session(db, user)
        browser2 = await issue_session(db, user)
        actor = await resolve_actor(db, browser["token"], "session")
        actor2 = await resolve_actor(db, browser2["token"], "session")
        key_actor = await resolve_actor(db, key["key"])
        persisted = (
            (
                await db.execute(
                    select(m.sessions).where(m.sessions.c.uuid == UUID(browser["id"]))
                )
            )
            .mappings()
            .one()
        )
        assert persisted["digest"] != browser["token"]
        assert browser["token"] not in repr(actor)
        assert (
            timedelta(hours=11, minutes=59)
            < persisted["expires_at"] - datetime.now(UTC)
            <= timedelta(hours=12)
        )

    payload = {
        "name": "Synthetic Plan",
        "incomes": [{"name": "Synthetic income", "amount": "2000.00"}],
        "spending": "500.00",
    }
    identity = str(uuid4())

    async def create(credential, request_key=identity, entity_uuid=entity):
        async with sessions() as db:
            return await write(
                db, credential, entity_uuid, "create_plan", request_key, payload
            )

    foreign_plan = await create(other_key["key"], str(uuid4()), foreign)
    for credential in (actor, key_actor):
        scoped_identity = str(uuid4())
        async with sessions() as db:
            with pytest.raises(RejectionError) as rejected:
                await write(
                    db,
                    credential,
                    entity,
                    "save_version",
                    scoped_identity,
                    {"expected_revision": 1},
                    UUID(foreign_plan["plan_id"]),
                )
            assert rejected.value.code == "record_not_found"
            assert (
                await db.scalar(
                    select(func.count())
                    .select_from(m.outcomes)
                    .where(m.outcomes.c.request_key == scoped_identity)
                )
                == 0
            )

    first = await create(actor)
    assert await create(key_actor) == first
    assert await create(actor2) == first
    # Concurrent requests using distinct credentials still share the User retry scope.
    concurrent_key = str(uuid4())
    a, b = await asyncio.gather(
        create(actor, concurrent_key), create(key_actor, concurrent_key)
    )
    assert a == b
    async with sessions() as db:
        rows = (
            (
                await db.execute(
                    select(m.audit).where(
                        m.audit.c.record_uuid == UUID(first["draft"]["uuid"])
                    )
                )
            )
            .mappings()
            .all()
        )
        assert len(rows) == 1
        assert rows[0]["api_key_uuid"] is None
        assert rows[0]["session_uuid"] == actor.credential_uuid
        assert rows[0]["interface"] == "browser"
    # Adapters cannot gain authority by replacing the resolved User or public UUID.
    for forged in (
        replace(actor, user_id=other),
        replace(actor, credential_uuid=uuid4()),
    ):
        with pytest.raises(RejectionError) as rejected:
            await create(forged)
        assert rejected.value.status == 401
    with pytest.raises(RejectionError) as rejected:
        await create(actor, entity_uuid=foreign)
    assert rejected.value.status == 404
    async with sessions() as db:
        with pytest.raises(RejectionError) as rejected:
            await write(
                db,
                actor,
                foreign,
                "save_version",
                str(uuid4()),
                {"expected_revision": 1},
                UUID(first["plan_id"]),
            )
        assert rejected.value.status == 404

    # Removing current Entity ownership denies old successful outcomes for both kinds.
    async with sessions() as db, db.begin():
        await db.execute(
            update(m.entities).where(m.entities.c.uuid == entity).values(owner_id=other)
        )
    for credential in (actor, key_actor):
        with pytest.raises(RejectionError) as rejected:
            await create(credential)
        assert rejected.value.status == 404
    async with sessions() as db, db.begin():
        await db.execute(
            update(m.entities).where(m.entities.c.uuid == entity).values(owner_id=user)
        )

    # Failed audit leaves neither the Plan nor an idempotency success.
    trigger = "fail_session_audit_" + uuid4().hex
    async with engine.begin() as connection:
        await connection.execute(
            text(
                f"""CREATE FUNCTION {trigger}() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN IF NEW.session_uuid = '{actor.credential_uuid}'::uuid THEN
                RAISE EXCEPTION 'synthetic audit rejection'; END IF;
                RETURN NEW; END $$"""
            )
        )
        await connection.execute(
            text(
                f"CREATE TRIGGER {trigger} BEFORE INSERT ON audit_log "
                f"FOR EACH ROW EXECUTE FUNCTION {trigger}()"
            )
        )
    failed_identity = str(uuid4())
    async with sessions() as db:
        count = await db.scalar(select(func.count()).select_from(m.plans))
    try:
        with pytest.raises(DBAPIError):
            await create(actor, failed_identity)
        async with sessions() as db:
            assert await db.scalar(select(func.count()).select_from(m.plans)) == count
            assert (
                await db.scalar(
                    select(func.count())
                    .select_from(m.outcomes)
                    .where(m.outcomes.c.request_key == failed_identity)
                )
                == 0
            )
    finally:
        async with engine.begin() as connection:
            await connection.execute(text(f"DROP TRIGGER {trigger} ON audit_log"))
            await connection.execute(text(f"DROP FUNCTION {trigger}()"))
    await create(actor, failed_identity)

    async with sessions() as db:
        await revoke_session(db, actor)
    with pytest.raises(RejectionError) as rejected:
        await create(actor)
    assert rejected.value.status == 401
    async with sessions() as db, db.begin():
        await db.execute(
            update(m.sessions)
            .where(m.sessions.c.uuid == actor2.credential_uuid)
            .values(expires_at=datetime.now(UTC) - timedelta(seconds=1))
        )
        await db.execute(
            update(m.keys)
            .where(m.keys.c.uuid == key_actor.credential_uuid)
            .values(revoked_at=datetime.now(UTC))
        )
    for credential in (actor2, key_actor):
        with pytest.raises(RejectionError) as rejected:
            await create(credential)
        assert rejected.value.status == 401
        async with sessions() as db:
            with pytest.raises(RejectionError) as rejected:
                await read_plans(db, credential, entity)
            assert rejected.value.status == 401
    await engine.dispose()


def test_logout_waits_for_inflight_financial_command():
    asyncio.run(logout_race())


async def logout_race():
    assert URL and "test" in URL.rsplit("/", 1)[-1]
    engine = create_async_engine(URL)
    sessions = async_sessionmaker(engine)
    async with sessions() as db, db.begin():
        user = await db.scalar(
            insert(m.users)
            .values(issuer="test", subject=str(uuid4()))
            .returning(m.users.c.id)
        )
        entity = await db.scalar(
            insert(m.entities)
            .values(owner_id=user, name="Synthetic lock test", time_zone="UTC")
            .returning(m.entities.c.uuid)
        )
        browser = await issue_session(db, user)
        actor = await resolve_actor(db, browser["token"], "session")
    payload = {"name": "Synthetic", "incomes": [], "spending": "0"}
    identity = str(uuid4())
    # Bind sessions to dedicated connections so blocker PIDs are deterministic.
    async with (
        engine.connect() as blocker,
        engine.connect() as writer,
        engine.connect() as logout,
        engine.connect() as observer,
    ):
        blocker_pid = await blocker.scalar(text("SELECT pg_backend_pid()"))
        writer_pid = await writer.scalar(text("SELECT pg_backend_pid()"))
        logout_pid = await logout.scalar(text("SELECT pg_backend_pid()"))
        await writer.rollback()
        await logout.rollback()
        await blocker.execute(
            select(m.entities).where(m.entities.c.uuid == entity).with_for_update()
        )

        async def wait_for_block(waiter, holder, pending=None):
            async with asyncio.timeout(5):
                while True:
                    if pending is not None:
                        assert not pending.done(), (
                            "Logout completed before the in-flight command"
                        )
                    blocked_by = await observer.scalar(
                        text("SELECT pg_blocking_pids(:pid)"), {"pid": waiter}
                    )
                    if holder in blocked_by:
                        return
                    await asyncio.sleep(0.01)

        async with (
            sessions(bind=writer) as write_db,
            sessions(bind=logout) as logout_db,
        ):
            write_task = asyncio.create_task(
                write(write_db, actor, entity, "create_plan", identity, payload)
            )
            logout_task = None
            try:
                await wait_for_block(writer_pid, blocker_pid)
                logout_task = asyncio.create_task(revoke_session(logout_db, actor))
                await wait_for_block(logout_pid, writer_pid, logout_task)
            finally:
                await blocker.rollback()
                await write_task
                if logout_task:
                    await logout_task
    async with sessions() as db:
        with pytest.raises(RejectionError) as rejected:
            await write(db, actor, entity, "create_plan", identity, payload)
        assert rejected.value.status == 401
    await engine.dispose()
