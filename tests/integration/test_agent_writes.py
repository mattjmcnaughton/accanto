"""Agent mode dispatch, Pending changes and agent-free settings (TDD 03).

Real PostgreSQL. Every value is synthetic; expected totals come from the worked
examples in each step, not from the implementation.
"""

import asyncio
import os
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import func, insert, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from accanto.app import create_app
from accanto.config import Settings
from accanto.db import get_session
from accanto.dtos import tools as t
from accanto.dtos.monthly import ActivityInput
from accanto.models import agent as a
from accanto.models import monthly as m
from accanto.services import agent_settings
from accanto.services.access import RejectionError, issue_session, resolve_actor
from accanto.services.api_keys import issue_key
from accanto.services.browser_auth import csrf_token
from accanto.services.monthly import write
from accanto.services.tools import TOOLS, ToolContext, apply_pending

URL = os.environ.get("ACCANTO_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="Requires isolated Postgres")


def test_agent_mode_dispatch_and_pending_changes():
    asyncio.run(scenario())


async def scenario():
    assert URL and URL.rsplit("/", 1)[-1].endswith("_test")
    engine = create_async_engine(URL)
    sessions = async_sessionmaker(engine)
    async with sessions() as db, db.begin():
        user = await db.scalar(
            insert(m.users)
            .values(issuer="agent-test", subject=str(uuid4()))
            .returning(m.users.c.id)
        )
        entity, entity_id = (
            await db.execute(
                insert(m.entities)
                .values(owner_id=user, name="Synthetic agent Entity", time_zone="UTC")
                .returning(m.entities.c.uuid, m.entities.c.id)
            )
        ).one()
        other = await db.scalar(
            insert(m.users)
            .values(issuer="agent-test", subject=str(uuid4()))
            .returning(m.users.c.id)
        )
        foreign = await db.scalar(
            insert(m.entities)
            .values(owner_id=other, name="Synthetic foreign", time_zone="UTC")
            .returning(m.entities.c.uuid)
        )
        key = await issue_key(db, user, "Synthetic agent key")
        browser = await issue_session(db, user)
        api_actor = await resolve_actor(db, key["key"], "api_key")
        owner = await resolve_actor(db, browser["token"], "session")
    mcp = ToolContext(sessions, api_actor.acting_as("mcp"))
    sidebar = ToolContext(sessions, owner.acting_as("agent"))
    owner_ctx = ToolContext(sessions, owner)

    async def count(table, *where):
        async with sessions() as db:
            return await db.scalar(
                select(func.count()).select_from(table).where(*where)
            )

    async def entries():
        return await count(
            m.entries,
            m.entries.c.entity_id == entity_id,
            m.entries.c.deleted_at.is_(None),
        )

    async def audits(interface=None):
        where = [m.audit.c.entity_id == entity_id]
        if interface:
            where.append(m.audit.c.interface == interface)
        return await count(m.audit, *where)

    async def call(ctx, tool, args, request_key=None):
        spec = TOOLS[tool]
        return await spec.run(
            ctx, entity, spec.input.model_validate(args), request_key or str(uuid4())
        )

    async def set_mode(mode):
        async with sessions() as db:
            current = await agent_settings.read_settings(db, owner, entity)
        async with sessions() as db:
            await agent_settings.update_settings(
                db,
                owner,
                entity,
                str(uuid4()),
                {
                    "enabled": True,
                    "mode": mode,
                    "instructions": "Synthetic standing instruction.",
                    "expected_revision": current["revision"],
                },
            )

    coffee = {"date": "2026-11-05", "category": "spending", "amount": "12.34"}

    # Propose mode is the default: an MCP save_activity records nothing.
    baseline = await audits()
    drafted = await call(mcp, "save_activity", coffee, "mcp-key-1")
    assert drafted.status == "pending" and drafted.pending_change
    assert drafted.pending_change.created_by_interface == "mcp"
    assert await entries() == 0
    assert await audits() == baseline
    # Replay returns the same Pending change; changed input is key_reuse.
    again = await call(mcp, "save_activity", coffee, "mcp-key-1")
    assert again.pending_change and again.pending_change.id == drafted.pending_change.id
    with pytest.raises(RejectionError) as reused:
        await call(mcp, "save_activity", {**coffee, "amount": "99.00"}, "mcp-key-1")
    assert reused.value.code == "key_reuse"
    assert await count(a.pending, a.pending.c.entity_id == entity_id) == 1

    # A domain rejection at draft time leaves no Pending change.
    with pytest.raises(RejectionError):
        await call(
            mcp,
            "save_activity",
            {
                "date": "2026-11-05",
                "category": "saving",
                "amount": "50.00",
                "saving_goal_id": str(uuid4()),
            },
        )
    assert await count(a.pending, a.pending.c.entity_id == entity_id) == 1

    # The pending change is listed for agents and applied once by the owner.
    listed = await call(mcp, "list_pending_changes", {})
    assert [p.id for p in listed.pending_changes] == [drafted.pending_change.id]
    applied = await apply_pending(owner_ctx, entity, drafted.pending_change.id)
    assert applied.status == "recorded" and applied.record_id
    assert await entries() == 1
    assert await audits("agent") == 1
    retried = await apply_pending(owner_ctx, entity, drafted.pending_change.id)
    assert retried.record_id == applied.record_id
    assert await entries() == 1 and await audits("agent") == 1
    with pytest.raises(RejectionError) as changed:
        await apply_pending(
            owner_ctx, entity, drafted.pending_change.id, {**coffee, "amount": "1.00"}
        )
    assert changed.value.code == "key_reuse"
    assert (await call(mcp, "list_pending_changes", {})).pending_changes == []
    # Worked example: one $12.34 spending entry in November.
    activity = await call(mcp, "list_activity", {"month": "2026-11-01"})
    assert [e.amount for e in activity.entries] == ["12.34"]

    # Record mode: MCP writes run once, audited as mcp.
    await set_mode("record")
    lunch = {"date": "2026-11-06", "category": "spending", "amount": "20.00"}
    recorded = await call(mcp, "save_activity", lunch, "mcp-key-2")
    assert recorded.status == "recorded"
    assert await entries() == 2 and await audits("mcp") == 1
    replay = await call(mcp, "save_activity", lunch, "mcp-key-2")
    assert replay.record_id == recorded.record_id
    assert await entries() == 2 and await audits("mcp") == 1

    # The built-in agent never writes from a model run, even in record mode.
    sidebar_draft = await call(sidebar, "save_activity", lunch)
    assert sidebar_draft.status == "pending"
    assert sidebar_draft.pending_change
    assert sidebar_draft.pending_change.created_by_interface == "agent"
    assert await entries() == 2

    # Stale: draft a correction, change the entry, then apply.
    entry_id = recorded.record_id
    correction = await call(
        sidebar,
        "save_activity",
        {**lunch, "amount": "21.00", "id": entry_id, "expected_revision": 1},
    )
    assert correction.pending_change
    async with sessions() as db:
        await write(
            db,
            owner,
            entity,
            "edit_entry",
            str(uuid4()),
            ActivityInput.model_validate(
                {**lunch, "amount": "22.00", "expected_revision": 1}
            ).model_dump(),
            entry_id,
        )
    with pytest.raises(RejectionError) as stale:
        await apply_pending(owner_ctx, entity, correction.pending_change.id)
    assert stale.value.code == "stale_revision"
    activity = await call(mcp, "list_activity", {"month": "2026-11-01"})
    assert sorted(e.amount for e in activity.entries) == ["12.34", "22.00"]

    # Irreversible deletes pend in both modes, even for MCP in record mode.
    observation = await call(
        mcp,
        "save_observation",
        {
            "kind": "investment",
            "values": {"date": "2026-11-01", "amount": "17.00", "account_id": None},
        },
    )
    assert observation.status == "recorded" and observation.record_id
    delete = {"kind": "investment", "id": observation.record_id, "expected_revision": 1}
    for mode in ("record", "propose"):
        await set_mode(mode)
        pended = await call(mcp, "delete_observation", delete)
        assert pended.status == "pending", mode
        assert len((await call(mcp, "list_investment_observations", {})).observations)

    # Foreign Entity is unavailable to every tool.
    with pytest.raises(RejectionError) as missing:
        await TOOLS["list_activity"].run(
            mcp, foreign, t.ActivityQuery(month="2026-11-01"), "k"
        )
    assert missing.value.status == 404

    # Agent settings and source setup refuse API keys; the session may use them.
    config = Settings(
        browser_origin="https://test",
        browser_csrf_secret="synthetic-agent-csrf-secret-long-enough",
    )
    app = create_app()
    app.state.auth_settings = config

    async def dependency():
        async with sessions() as db:
            yield db

    app.dependency_overrides[get_session] = dependency
    app.state.sessions = sessions
    prefix = f"/api/entities/{entity}"
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="https://test"
    ) as client:
        bearer = {"Authorization": f"Bearer {key['key']}", "Idempotency-Key": "k1"}
        for method, path, body in (
            ("GET", "/agent/settings", None),
            (
                "PUT",
                "/agent/settings",
                {"enabled": True, "mode": "record", "expected_revision": 3},
            ),
            ("GET", "/agent/pending-changes", None),
            (
                "POST",
                f"/agent/pending-changes/{correction.pending_change.id}/apply",
                {},
            ),
            ("POST", "/sources/ynab/plans", {"access_token": "synthetic-token-x"}),
            (
                "POST",
                "/sources/ynab",
                {
                    "access_token": "synthetic-token-x",
                    "plan_id": "p",
                    "start_date": "2026-11-01",
                },
            ),
        ):
            response = await client.request(
                method, prefix + path, json=body, headers=bearer
            )
            assert response.status_code == 403, (path, response.text)
            assert response.json()["detail"]["code"] == "browser_session_required"
        assert (
            await client.get(prefix + "/sources", headers=bearer)
        ).status_code == 200
        cookie = {"accanto_session": browser["token"]}
        client.cookies.update(cookie)
        settings = await client.get(prefix + "/agent/settings")
        assert settings.status_code == 200
        assert settings.json()["mode"] == "propose"
        pending = await client.get(prefix + "/agent/pending-changes")
        assert {p["tool"] for p in pending.json()} == {
            "save_activity",
            "delete_observation",
        }
        dismissed = await client.post(
            prefix + f"/agent/pending-changes/{correction.pending_change.id}/dismiss",
            json={"expected_revision": 1},
            headers={
                "Origin": "https://test",
                "X-CSRF-Token": csrf_token(browser["token"], config),
            },
        )
        assert dismissed.status_code == 200, dismissed.text
        assert dismissed.json()["status"] == "dismissed"
    await engine.dispose()
