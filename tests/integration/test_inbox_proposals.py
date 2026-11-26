"""The inbox proposal run against real PostgreSQL with the stub model (TDD 12).

Synthetic data only. Covers the run's contract: it chunks every waiting item
without a proposal, leaves unsure items with an empty proposal, records
nothing, keeps existing proposals, and stops when its credential is revoked,
the assistant is Read only, or the owner stops it.
"""

import asyncio
import os
from datetime import UTC, date, datetime
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import func, insert, select, update
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from accanto.app import create_app
from accanto.config import settings
from accanto.db import get_session
from accanto.models import agent as a
from accanto.models import inbox as st
from accanto.models import jobs as j
from accanto.models import monthly as m
from accanto.services import inbox_proposals
from accanto.services.api_keys import issue_key
from accanto.services.jobs import JobRunner

URL = os.environ.get("ACCANTO_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="Requires isolated PostgreSQL")


def latest(ref, day, amount, payee, kind="ordinary"):
    return {
        "source_ref": ref,
        "parent_ref": None,
        "account_ref": "acct",
        "account_name": "Example Checking",
        "financial_date": day.isoformat(),
        "amount": amount,
        "payee": payee,
        "source_category": None,
        "memo": None,
        "kind": kind,
        "cleared": True,
        "approved": True,
        "deleted": False,
    }


def test_proposal_run_covers_the_batch_and_stops_when_it_must():
    asyncio.run(scenario())


async def scenario():
    assert URL and URL.rsplit("/", 1)[-1].endswith("_test")
    engine = create_async_engine(URL, hide_parameters=True)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as db, db.begin():
        user = await db.scalar(
            insert(m.users)
            .values(issuer="proposal-run-test", subject=str(uuid4()))
            .returning(m.users.c.id)
        )
        entity, entity_id = (
            await db.execute(
                insert(m.entities)
                .values(owner_id=user, name="Synthetic run Entity", time_zone="UTC")
                .returning(m.entities.c.uuid, m.entities.c.id)
            )
        ).one()
        key = await issue_key(db, user, "Synthetic run test")
        await db.execute(
            insert(a.settings).values(
                entity_id=entity_id, enabled=True, mode="ask_first"
            )
        )
        source = await db.scalar(
            insert(st.sources)
            .values(
                entity_id=entity_id,
                kind="ynab",
                external_ref=f"synthetic-{uuid4()}",
                name="Synthetic source",
                start_date=date(2026, 10, 1),
            )
            .returning(st.sources.c.id)
        )
        rows = [
            latest(
                f"shop-{n}",
                date(2026, 10, 1 + n % 28),
                f"-{10 + n}.00",
                f"Sample Shop {n}",
            )
            for n in range(27)
        ] + [
            latest("unknown", date(2026, 10, 30), "-42.00", "Unknown Vendor"),
            latest(
                "transfer",
                date(2026, 10, 30),
                "-500.00",
                "Transfer",
                "transfer_on_budget",
            ),
            latest("pay", date(2026, 10, 31), "3100.00", "Demo Payroll Co"),
            latest("kept", date(2026, 10, 2), "-7.00", "Example Coffee Cart"),
        ]
        for row in rows:
            await db.execute(
                insert(st.staged).values(
                    entity_id=entity_id,
                    source_id=source,
                    source_ref=row["source_ref"],
                    financial_date=date.fromisoformat(row["financial_date"]),
                    latest=row,
                    # The owner's own proposal on one item must survive the run.
                    proposal={"category": "spending", "rationale": "Mine."}
                    if row["source_ref"] == "kept"
                    else None,
                )
            )

    config = settings.model_copy(
        update={"agent_model": "stub", "browser_origin": "http://test"}
    )
    app = create_app()
    app.state.auth_settings = config

    async def dependency():
        async with sessions() as db:
            yield db

    app.dependency_overrides[get_session] = dependency
    runner = JobRunner(
        config,
        sessions,
        {inbox_proposals.KIND: inbox_proposals.proposal_step(config, sessions)},
    )

    async def advance(run_id, limit=10):
        """Step the runner until this run finishes; leftover runs may also step."""
        for _ in range(limit):
            await runner.tick()
            await runner.registry.join()
            state = await stored(run_id)
            if state["state"] not in j.ACTIVE:
                return state
        raise AssertionError("the run did not finish")

    async def stored(run_id):
        async with sessions() as db:
            return (
                (await db.execute(select(j.runs).where(j.runs.c.uuid == run_id)))
                .one()
                ._mapping
            )

    async def item(ref):
        async with sessions() as db:
            return (
                (
                    await db.execute(
                        select(st.staged).where(
                            st.staged.c.source_id == source,
                            st.staged.c.source_ref == ref,
                        )
                    )
                )
                .one()
                ._mapping
            )

    path = f"/api/entities/{entity}/inbox/proposal-run"
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
        headers={"Authorization": f"Bearer {key['key']}"},
    ) as client:
        started = await client.post(path)
        assert started.status_code == 202, started.text
        again = (await client.post(path)).json()
        run_id = started.json()["run"]["id"]
        # One active run per Entity: starting again returns it.
        assert again["run"]["id"] == run_id
        assert again["waiting"] == 31 and again["proposed"] == 1

        finished = await advance(run_id)
        # 30 items without a proposal: a step of 25, then one of 5.
        assert finished["state"] == "succeeded" and finished["steps"] == 2
        assert finished["counts"] == {"proposed": 29, "needs_you": 1, "failed": 0}

        unsure = await item("unknown")
        assert unsure["proposal"]["category"] is None
        assert unsure["proposal"]["rationale"].startswith("Not sure")
        assert unsure["proposal_rejection"]["code"] == "needs_choice"
        assert (await item("transfer"))["proposal"]["skip"] is True
        assert (await item("pay"))["proposal"]["category"] == "income"
        assert (await item("kept"))["proposal"]["rationale"] == "Mine."
        shop = await item("shop-3")
        assert shop["proposal"]["category"] == "spending"
        assert shop["proposed_interface"] == "agent" and shop["status"] == "waiting"

        view = (await client.get(path)).json()
        assert view["run"]["state"] == "succeeded"
        assert (view["waiting"], view["proposed"], view["needs_you"]) == (31, 31, 1)
        # A chunked read for MCP clients and the flow.
        page = await client.get(
            f"/api/entities/{entity}/inbox", params={"status": "waiting", "limit": 5}
        )
        assert [i["payee"] for i in page.json()][:1] == ["Sample Shop 0"]
        assert len(page.json()) == 5

        async with sessions() as db:
            assert not await db.scalar(
                select(func.count())
                .select_from(m.entries)
                .where(m.entries.c.entity_id == entity_id)
            )

        # Read only: agents cannot change the Entity, so no run starts.
        async with sessions() as db, db.begin():
            await db.execute(
                update(a.settings)
                .where(a.settings.c.entity_id == entity_id)
                .values(mode="read_only")
            )
        blocked = await client.post(path)
        assert (
            blocked.status_code == 403
            and blocked.json()["detail"]["code"] == "read_only"
        )
        async with sessions() as db, db.begin():
            await db.execute(
                update(a.settings)
                .where(a.settings.c.entity_id == entity_id)
                .values(mode="ask_first")
            )
            await db.execute(
                update(st.staged)
                .where(
                    st.staged.c.source_ref == "shop-0", st.staged.c.source_id == source
                )
                .values(proposal=None)
            )

        # The owner stops a run: it is cancelled and its steps cannot settle.
        stopping = (await client.post(path)).json()["run"]["id"]
        stopped = (await client.delete(path)).json()
        assert (
            stopped["run"]["id"] == stopping and stopped["run"]["state"] == "cancelled"
        )

        # A revoked key stops the run at its next step, with a fixed code.
        revoked_run = (await client.post(path)).json()["run"]["id"]
        async with sessions() as db, db.begin():
            await db.execute(
                update(m.keys)
                .where(m.keys.c.user_id == user)
                .values(revoked_at=datetime.now(UTC))
            )
        failed = await advance(revoked_run)
        assert failed["state"] == "failed"
        assert failed["error_code"] == "invalid_credential"
        assert (await item("shop-0"))["proposal"] is None

    await engine.dispose()
