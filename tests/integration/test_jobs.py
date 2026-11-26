"""Job runs and the finite tick against real PostgreSQL (TDD 11). Synthetic data.

Each test uses its own job kind, so runs left by other tests are never claimed.
"""

import asyncio
import os
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import insert, select, update
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from accanto.config import settings
from accanto.jobs import tick
from accanto.models import agent as a
from accanto.models import jobs as j
from accanto.models import monthly as m
from accanto.repositories import jobs
from accanto.services.jobs import JobRunner, Step

URL = os.environ.get("ACCANTO_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="Requires isolated PostgreSQL")


async def database():
    assert URL and URL.rsplit("/", 1)[-1].endswith("_test")
    engine = create_async_engine(URL, hide_parameters=True)
    return engine, async_sessionmaker(engine, expire_on_commit=False)


async def entity(sessions):
    async with sessions() as db, db.begin():
        user = await db.scalar(
            insert(m.users)
            .values(issuer="jobs-test", subject=str(uuid4()))
            .returning(m.users.c.id)
        )
        entity_id = await db.scalar(
            insert(m.entities)
            .values(owner_id=user, name="Synthetic jobs Entity", time_zone="UTC")
            .returning(m.entities.c.id)
        )
    return user, entity_id


async def row(sessions, run_uuid):
    async with sessions() as db:
        return (
            (await db.execute(select(j.runs).where(j.runs.c.uuid == run_uuid)))
            .one()
            ._mapping
        )


def test_claim_takes_a_lease_once():
    async def scenario():
        engine, sessions = await database()
        kind = f"test-{uuid4().hex[:8]}"
        _, first_entity = await entity(sessions)
        _, second_entity = await entity(sessions)
        async with sessions() as db, db.begin():
            first, created = await jobs.start(db, first_entity, kind)
            again, created_again = await jobs.start(db, first_entity, kind)
        async with sessions() as db, db.begin():
            second, _ = await jobs.start(db, second_entity, kind)
        # One active run per Entity and kind: starting again returns it.
        assert created and not created_again and again == first

        # Two concurrent claimers get different runs (SKIP LOCKED), and a third
        # finds nothing: both leases are fresh.
        async def claim():
            async with sessions() as db, db.begin():
                return await jobs.claim(db, [kind], stale_after=600)

        claimed = await asyncio.gather(claim(), claim())
        assert {c.uuid for c in claimed if c} == {first, second}
        assert await claim() is None
        stored = await row(sessions, first)
        assert stored["state"] == "running" and stored["claimed_at"] is not None
        assert stored["claims"] == 1

        # Another kind is never claimed.
        async with sessions() as db, db.begin():
            assert await jobs.claim(db, ["other-kind"], stale_after=0) is None
        await engine.dispose()

    asyncio.run(scenario())


def test_stale_lease_is_claimed_again_and_the_old_claim_cannot_settle():
    async def scenario():
        engine, sessions = await database()
        kind = f"test-{uuid4().hex[:8]}"
        _, entity_id = await entity(sessions)
        async with sessions() as db, db.begin():
            run_uuid, _ = await jobs.start(db, entity_id, kind)
        async with sessions() as db, db.begin():
            crashed = await jobs.claim(db, [kind], stale_after=600)
        assert crashed
        # Ten minutes is not stale yet under an 11-minute window...
        async with sessions() as db, db.begin():
            await db.execute(
                update(j.runs)
                .where(j.runs.c.uuid == run_uuid)
                .values(claimed_at=datetime.now(UTC) - timedelta(minutes=10))
            )
            assert await jobs.claim(db, [kind], stale_after=660) is None
        # ...and is stale under a 9-minute window.
        async with sessions() as db, db.begin():
            reclaimed = await jobs.claim(db, [kind], stale_after=540)
        assert reclaimed and reclaimed.uuid == run_uuid and reclaimed.claims == 2

        # The crashed step finishing late changes nothing.
        async with sessions() as db, db.begin():
            assert not await jobs.settle(
                db, crashed, counts={"proposed": 25}, state="succeeded"
            )
        async with sessions() as db, db.begin():
            assert await jobs.settle(
                db, reclaimed, counts={"proposed": 7}, state="succeeded"
            )
        stored = await row(sessions, run_uuid)
        assert stored["state"] == "succeeded" and stored["counts"] == {"proposed": 7}
        assert stored["claimed_at"] is None and stored["finished_at"] is not None
        await engine.dispose()

    asyncio.run(scenario())


def test_runner_steps_until_done_and_shuts_down_cleanly():
    async def scenario():
        engine, sessions = await database()
        kind = f"test-{uuid4().hex[:8]}"
        _, entity_id = await entity(sessions)
        async with sessions() as db, db.begin():
            run_uuid, _ = await jobs.start(db, entity_id, kind)
        config = settings.model_copy(
            update={"job_reconciler_interval": 0.02, "job_concurrent_steps": 1}
        )

        entered, cancelled = asyncio.Event(), asyncio.Event()

        async def blocking(_run):
            entered.set()
            try:
                await asyncio.Event().wait()
            except asyncio.CancelledError:
                cancelled.set()
                raise
            raise AssertionError("unreachable")

        runner = JobRunner(config, sessions, {kind: blocking})
        await runner.start()
        await asyncio.wait_for(entered.wait(), 5)
        await runner.stop()
        # The step was cancelled, nothing is left running, and the claim was
        # released, so the run is claimable at once rather than after the lease.
        assert cancelled.is_set() and len(runner.registry) == 0
        stored = await row(sessions, run_uuid)
        assert stored["state"] == "queued" and stored["claimed_at"] is None
        assert stored["steps"] == 0

        # A new process picks it up; each step adds its counts until done.
        calls = []

        async def three_steps(run):
            calls.append(run.steps)
            return Step({"proposed": 25 - 10 * run.steps}, done=run.steps == 2)

        runner = JobRunner(config, sessions, {kind: three_steps})
        for _ in range(3):
            assert await runner.tick() == 1
            await runner.registry.join()
        assert await runner.tick() == 0
        stored = await row(sessions, run_uuid)
        # 25 + 15 + 5 proposed over three steps.
        assert calls == [0, 1, 2] and stored["counts"] == {"proposed": 45}
        assert stored["state"] == "succeeded" and stored["steps"] == 3

        # A failing step fails the run with a fixed code, not its message.
        async with sessions() as db, db.begin():
            failing_uuid, _ = await jobs.start(db, entity_id, kind)

        async def failing(_run):
            raise ValueError("synthetic-secret-payee 123.45")

        runner = JobRunner(config, sessions, {kind: failing})
        assert await runner.tick() == 1
        await runner.registry.join()
        stored = await row(sessions, failing_uuid)
        assert stored["state"] == "failed" and stored["error_code"] == "step_failed"
        await engine.dispose()

    asyncio.run(scenario())


def test_tick_steps_are_isolated(capfd, monkeypatch):
    async def scenario():
        engine, sessions = await database()
        monkeypatch.setattr(tick.db, "async_session", sessions)
        user, entity_id = await entity(sessions)
        now = datetime.now(UTC)
        async with sessions() as db, db.begin():
            expired, kept = (
                await db.scalars(
                    insert(a.conversations)
                    .values(
                        [
                            {
                                "user_id": user,
                                "entity_id": entity_id,
                                "expires_at": now - timedelta(days=1),
                            },
                            {
                                "user_id": user,
                                "entity_id": entity_id,
                                "expires_at": now + timedelta(days=1),
                            },
                        ]
                    )  # fmt: skip
                    .returning(a.conversations.c.id)
                )
            ).all()
            await db.execute(
                insert(a.messages).values(
                    conversation_id=expired,
                    position=1,
                    role="owner",
                    content="synthetic-tick-canary 987.65",
                )
            )

        async def broken():
            raise RuntimeError("synthetic-tick-canary 987.65")

        async def slow():
            await asyncio.sleep(10)
            return {}

        status = await tick.run_steps(
            [
                ("broken", broken),
                ("slow", slow),
                ("conversation_retention", tick.conversation_retention),
            ],
            timeout=0.2,
        )
        async with sessions() as db:
            left = set(
                await db.scalars(
                    select(a.conversations.c.id).where(
                        a.conversations.c.id.in_([expired, kept])
                    )
                )
            )
        await engine.dispose()
        return status, left, kept

    status, left, kept = asyncio.run(scenario())
    # The failed and timed-out steps did not stop retention, and fail the tick.
    assert status == 1 and left == {kept}
    out, err = capfd.readouterr()
    logs = out + err
    assert "RuntimeError" in logs and "TimeoutError" in logs
    assert "synthetic-tick-canary" not in logs and "987.65" not in logs
