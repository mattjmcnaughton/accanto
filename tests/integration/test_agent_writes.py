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
from accanto.services import agent_settings, agent_writes
from accanto.services.access import RejectionError, issue_session, resolve_actor
from accanto.services.api_keys import issue_key
from accanto.services.browser_auth import csrf_token
from accanto.services.monthly import write
from accanto.services.tools import (
    TOOLS,
    ToolContext,
    apply_all_pending,
    apply_pending,
)

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

    # Ask first is the default: an MCP save_activity records nothing.
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

    # Apply directly: MCP writes run once, audited as mcp.
    await set_mode("apply_directly")
    lunch = {"date": "2026-11-06", "category": "spending", "amount": "20.00"}
    recorded = await call(mcp, "save_activity", lunch, "mcp-key-2")
    assert recorded.status == "recorded"
    assert await entries() == 2 and await audits("mcp") == 1
    replay = await call(mcp, "save_activity", lunch, "mcp-key-2")
    assert replay.record_id == recorded.record_id
    assert await entries() == 2 and await audits("mcp") == 1

    # The built-in agent records directly too, audited as agent (October, so
    # November's worked example below is unchanged).
    october_lunch = {**lunch, "date": "2026-10-06"}
    sidebar_recorded = await call(sidebar, "save_activity", october_lunch)
    assert sidebar_recorded.status == "recorded"
    assert await entries() == 3 and await audits("agent") == 2

    # Ask first: the built-in agent's writes become Pending changes too.
    await set_mode("ask_first")
    sidebar_draft = await call(sidebar, "save_activity", lunch)
    assert sidebar_draft.status == "pending"
    assert sidebar_draft.pending_change
    assert sidebar_draft.pending_change.created_by_interface == "agent"
    assert await entries() == 3

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

    # Irreversible deletes pend in Ask first and in Apply directly.
    observation = await call(
        mcp,
        "save_observation",
        {
            "kind": "investment",
            "values": {"date": "2026-11-01", "amount": "17.00", "account_id": None},
        },
    )
    assert observation.status == "pending" and observation.pending_change
    observation = await apply_pending(owner_ctx, entity, observation.pending_change.id)
    assert observation.record_id
    delete = {"kind": "investment", "id": observation.record_id, "expected_revision": 1}
    for mode in ("apply_directly", "ask_first"):
        await set_mode(mode)
        pended = await call(mcp, "delete_observation", delete)
        assert pended.status == "pending", mode
        assert len((await call(mcp, "list_investment_observations", {})).observations)

    # Read only: every write tool is refused on both surfaces, before it runs,
    # including sync_source and set_proposals. Reads still work.
    await set_mode("read_only")
    writes = [name for name, spec in TOOLS.items() if spec.kind != "read"]
    assert {"sync_source", "set_proposals", "delete_tag"} <= set(writes)
    before = (
        await entries(),
        await audits(),
        await count(a.pending, a.pending.c.entity_id == entity_id),
    )
    for ctx in (mcp, sidebar):
        for name in writes:
            with pytest.raises(RejectionError) as refused:
                await TOOLS[name].run(ctx, entity, None, str(uuid4()))
            assert (refused.value.code, refused.value.status) == ("read_only", 403)
        # The dispatcher also refuses under the Entity lock (no mode race).
        with pytest.raises(RejectionError) as locked:
            await agent_writes.dispatch(
                sessions,
                ctx.actor,
                entity,
                "save_activity",
                coffee,
                agent_writes.Command(
                    "create_entry", ActivityInput.model_validate(coffee).model_dump()
                ),
                str(uuid4()),
                "Synthetic",
            )
        assert locked.value.code == "read_only"
    assert (
        await entries(),
        await audits(),
        await count(a.pending, a.pending.c.entity_id == entity_id),
    ) == before
    assert (await call(mcp, "get_context", {})).agent_mode == "read_only"
    # The owner still applies Pending changes drafted earlier.
    applied_delete = await apply_pending(owner_ctx, entity, pended.pending_change.id)
    assert applied_delete.status == "recorded"
    assert (await call(mcp, "list_investment_observations", {})).observations == []
    await set_mode("ask_first")

    # Goal creates drafted together apply in a row: each create bumps the
    # account revision, so applying rebases onto it. Edits stay strict.
    opened = await call(
        mcp,
        "save_savings_account",
        {
            "values": {
                "name": "Synthetic reserve",
                "opening_date": "2026-11-01",
                "opening_amount": "0.00",
            }
        },
    )
    assert opened.pending_change
    account_id = (
        await apply_pending(owner_ctx, entity, opened.pending_change.id)
    ).record_id
    goal_drafts = [
        await call(
            mcp,
            "save_goal",
            {
                "account_id": account_id,
                "values": {
                    "name": name,
                    "kind": "finite",
                    "target": target,
                    "expected_account_revision": 1,
                },
            },
        )
        for name, target in (
            ("Synthetic repairs", "600.00"),
            ("Synthetic trip", "450.00"),
        )
    ]
    archive = await call(
        mcp,
        "set_savings_account_status",
        {"account_id": account_id, "status": "archived", "expected_revision": 1},
    )
    gifts = await call(
        mcp,
        "save_goal",
        {
            "account_id": account_id,
            "values": {
                "name": "Synthetic gifts",
                "kind": "finite",
                "target": "300.00",
                "expected_account_revision": 1,
            },
        },
    )
    # Apply all runs in drafted order whatever order it is sent in, and stops at
    # the stale archive: the gifts draft after it is left pending, untouched.
    drafted = [d.pending_change for d in (*goal_drafts, archive, gifts)]
    assert all(drafted)
    drafted_ids = [change.id for change in drafted if change]
    batch = {pending_id: None for pending_id in reversed(drafted_ids)}
    applied_all = await apply_all_pending(owner_ctx, entity, batch)
    assert [(r["id"], r["status"]) for r in applied_all["results"]] == [
        (str(drafted_ids[0]), "applied"),
        (str(drafted_ids[1]), "applied"),
        (str(drafted_ids[2]), "failed"),
        (str(drafted_ids[3]), "not_applied"),
    ]
    assert applied_all["results"][0]["result"]["status"] == "recorded"
    assert applied_all["results"][2]["error"]["code"] == "stale_revision"
    # Sending the same batch again replays the applied goals instead of adding more.
    resent = await apply_all_pending(owner_ctx, entity, batch)
    assert [r["status"] for r in resent["results"]] == [
        "applied",
        "applied",
        "failed",
        "not_applied",
    ]
    with pytest.raises(RejectionError) as unknown:
        await apply_all_pending(owner_ctx, entity, {**batch, uuid4(): None})
    assert unknown.value.status == 404
    async with sessions() as db:
        await agent_writes.dismiss(db, owner, entity, drafted_ids[2], 1)
    async with sessions() as db:
        left = await agent_writes.read_pending(db, owner, entity, status="pending")
    assert {str(i) for i in drafted_ids} & {c["id"] for c in left} == {
        str(drafted_ids[3])
    }
    # The list names the records a draft refers to, so the card shows no ids.
    [gifts_view] = [c for c in left if c["id"] == str(drafted_ids[3])]
    assert gifts_view["labels"] == {str(account_id): "Synthetic reserve"}
    last = await apply_all_pending(owner_ctx, entity, {drafted_ids[3]: None})
    assert last["results"][0]["status"] == "applied"
    [reserve] = [
        account
        for account in (await call(mcp, "list_savings", {})).accounts
        if account.id == account_id
    ]
    assert reserve.active and reserve.revision == 4
    assert sorted(g.target for g in reserve.goals if g.role == "ordinary") == [
        "300.00",
        "450.00",
        "600.00",
    ]

    # Foreign Entity is unavailable to every tool.
    with pytest.raises(RejectionError) as missing:
        await TOOLS["list_activity"].run(
            mcp, foreign, t.ActivityQuery(month="2026-11-01"), "k"
        )
    assert missing.value.status == 404

    # AGENT.md (TDD 09): any caller reads it; an agent only drafts a new one,
    # which pends even in Apply directly and changes neither enablement nor mode.
    await set_mode("apply_directly")
    read = await call(mcp, "get_agent_instructions", {})
    assert read.instructions == "Synthetic standing instruction."
    revision = read.revision
    new_md = "## Categories\n- Synthetic Grocer is groceries."
    baseline = await audits()
    drafts = [
        (
            await call(
                ctx,
                "propose_agent_instructions",
                {"instructions": new_md, "expected_revision": revision},
            )
        ).pending_change
        for ctx in (mcp, sidebar)
    ]
    assert all(drafts)
    assert await audits() == baseline
    assert (await call(owner_ctx, "get_agent_instructions", {})).revision == revision
    from_mcp, from_sidebar = drafts
    assert from_mcp and from_sidebar
    applied_md = await apply_pending(owner_ctx, entity, from_sidebar.id)
    assert applied_md.status == "recorded"
    async with sessions() as db:
        after = await agent_settings.read_settings(db, owner, entity)
    assert after["instructions"] == new_md and after["revision"] == revision + 1
    assert after["mode"] == "apply_directly" and after["enabled"] is True
    assert await audits() == baseline + 1
    # The MCP draft was based on the old revision: applying it is stale, and a
    # new draft against the old revision is rejected when drafted.
    with pytest.raises(RejectionError) as outdated:
        await apply_pending(owner_ctx, entity, from_mcp.id)
    assert outdated.value.code == "stale_revision"
    with pytest.raises(RejectionError) as late:
        await call(
            mcp,
            "propose_agent_instructions",
            {"instructions": "Synthetic overwrite.", "expected_revision": revision},
        )
    assert late.value.code == "stale_revision"
    async with sessions() as db:
        await agent_writes.dismiss(db, owner, entity, from_mcp.id, 1)
    async with sessions() as db:
        unchanged = await agent_settings.read_settings(db, owner, entity)
    assert unchanged["instructions"] == new_md
    await set_mode("ask_first")

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
                {"enabled": True, "mode": "apply_directly", "expected_revision": 3},
            ),
            ("GET", "/agent/pending-changes", None),
            (
                "POST",
                f"/agent/pending-changes/{correction.pending_change.id}/apply",
                {},
            ),
            (
                "POST",
                "/agent/pending-changes/apply-all",
                {"changes": [{"id": str(correction.pending_change.id)}]},
            ),
            ("GET", "/sources/ynab/plans", None),
            ("POST", "/sources/ynab", {"plan_id": "p", "start_date": "2026-11-01"}),
            ("GET", "/transaction-provider", None),
            (
                "PUT",
                "/transaction-provider",
                {
                    "kind": "ynab",
                    "access_token": "synthetic-token-x",
                    "expected_revision": 0,
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
        md = await client.get(prefix + "/agent/instructions", headers=bearer)
        assert md.status_code == 200, md.text
        assert md.json()["instructions"] == "Synthetic standing instruction."
        cookie = {"accanto_session": browser["token"]}
        client.cookies.update(cookie)
        settings = await client.get(prefix + "/agent/settings")
        assert settings.status_code == 200
        assert settings.json()["mode"] == "ask_first"
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
