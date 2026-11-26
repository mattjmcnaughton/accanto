"""One User with several Entities (TDD 04), against real PostgreSQL.

Synthetic data only: a "Synthetic Family" and a "Synthetic Personal" Entity for
one User, and a foreign User. Covers Create Entity (audited, validated, retried,
invisible to others), the Entity boundary between two owned Entities, one YNAB
plan per User at a time (including a concurrent race), the per-User daily
assistant cap and the sidebar's single-Entity context.
"""

import asyncio
import os
from datetime import date
from uuid import UUID, uuid4

import httpx
import pytest
from cryptography.fernet import Fernet
from pydantic import SecretStr
from sqlalchemy import func, insert, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from accanto.app import create_app
from accanto.config import settings
from accanto.db import get_session
from accanto.dtos import tools as t
from accanto.models import inbox as st
from accanto.models import monthly as m
from accanto.services.access import issue_session, resolve_actor
from accanto.services.api_keys import issue_key
from accanto.services.browser_auth import csrf_token
from accanto.services.tools import TOOLS, ToolContext
from tests.fakes import ynab_server as y

URL = os.environ.get("ACCANTO_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="Requires isolated Postgres")


def test_one_user_several_entities():
    asyncio.run(scenario())


async def scenario():
    assert URL and URL.rsplit("/", 1)[-1].endswith("_test")
    engine = create_async_engine(URL)
    sessions = async_sessionmaker(engine)
    async with sessions() as db, db.begin():
        user = await db.scalar(
            insert(m.users)
            .values(issuer="entities-test", subject=str(uuid4()))
            .returning(m.users.c.id)
        )
        family = await db.scalar(
            insert(m.entities)
            .values(owner_id=user, name="Synthetic Family", time_zone="UTC")
            .returning(m.entities.c.uuid)
        )
        key = await issue_key(db, user, "Synthetic owner key")
        browser = await issue_session(db, user)
        other = await db.scalar(
            insert(m.users)
            .values(issuer="entities-test", subject=str(uuid4()))
            .returning(m.users.c.id)
        )
        foreign_key = await issue_key(db, other, "Synthetic foreign key")
        actor = await resolve_actor(db, key["key"])

    config = settings.model_copy(
        update={
            "source_secret_key": SecretStr(Fernet.generate_key().decode()),
            "ynab_api_url": "http://fake-ynab/v1",
            "browser_origin": "http://test",
            "browser_csrf_secret": SecretStr("synthetic-entities-csrf-secret-long"),
            "agent_model": "stub",
            "agent_daily_message_cap": 2,
        }
    )
    app = create_app()
    app.state.auth_settings = config
    app.state.sessions = sessions
    app.state.ynab_transport = httpx.ASGITransport(app=y.FakeYnab(transactions=[]).app)

    async def dependency():
        async with sessions() as db:
            yield db

    app.dependency_overrides[get_session] = dependency
    transport = httpx.ASGITransport(app=app)

    async with (
        httpx.AsyncClient(
            transport=transport,
            base_url="http://test",
            headers={"Authorization": f"Bearer {key['key']}"},
        ) as owner,
        httpx.AsyncClient(
            transport=transport,
            base_url="http://test",
            headers={"Authorization": f"Bearer {foreign_key['key']}"},
        ) as foreign,
        httpx.AsyncClient(
            transport=transport,
            base_url="http://test",
            cookies={"accanto_session": browser["token"]},
            headers={
                "Origin": "http://test",
                "X-CSRF-Token": csrf_token(browser["token"], config),
            },
        ) as signed_in,
    ):

        async def send(client, method, path, body=None, request_key=None):
            return await client.request(
                method,
                path,
                json=body,
                headers={"Idempotency-Key": request_key or str(uuid4())},
            )

        # Create Entity: validated, audited, idempotent, starts empty.
        for invalid in (
            {"name": "Synthetic Personal", "time_zone": "Mars/Olympus"},
            {"name": "Synthetic Personal", "time_zone": "posix/UTC"},
            {"name": "   ", "time_zone": "UTC"},
            {"name": "Synthetic Personal", "time_zone": "UTC", "owner_id": 1},
        ):
            rejected = await send(owner, "POST", "/api/entities", invalid)
            assert rejected.status_code == 422, invalid
        assert (await send(owner, "POST", "/api/entities", {})).status_code == 422
        unauthenticated = await httpx.AsyncClient(
            transport=transport, base_url="http://test"
        ).post(
            "/api/entities",
            json={"name": "Synthetic Personal", "time_zone": "UTC"},
            headers={"Idempotency-Key": str(uuid4())},
        )
        assert unauthenticated.status_code == 401
        body = {"name": " Synthetic Personal ", "time_zone": "America/Chicago"}
        request_key = str(uuid4())
        created = await send(owner, "POST", "/api/entities", body, request_key)
        assert created.status_code == 200, created.text
        personal = created.json()
        assert personal["name"] == "Synthetic Personal"
        assert personal["time_zone"] == "America/Chicago"
        assert personal["revision"] == 1
        retried = await send(owner, "POST", "/api/entities", body, request_key)
        assert retried.json() == personal
        reused = await send(
            owner,
            "POST",
            "/api/entities",
            {**body, "name": "Synthetic Other"},
            request_key,
        )
        assert reused.status_code == 409
        assert reused.json()["detail"]["code"] == "key_reuse"
        async with sessions() as db:
            owned = await db.scalar(
                select(func.count())
                .select_from(m.entities)
                .where(m.entities.c.owner_id == user)
            )
            audit = (
                (
                    await db.execute(
                        select(m.audit).where(
                            m.audit.c.record_uuid == UUID(personal["id"])
                        )
                    )
                )
                .mappings()
                .all()
            )
        assert owned == 2
        assert [(row["action"], row["interface"]) for row in audit] == [
            ("create_entity", "direct_api")
        ]
        assert audit[0]["before"] is None
        assert audit[0]["after"]["name"] == "Synthetic Personal"
        assert audit[0]["actor_id"] == user
        # The browser uses the same command.
        from_browser = await send(
            signed_in,
            "POST",
            "/api/entities",
            {"name": "Synthetic Spare", "time_zone": "UTC"},
        )
        assert from_browser.status_code == 200, from_browser.text

        metadata = (await owner.get("/api/auth/session")).json()
        assert [e["name"] for e in metadata["entities"]] == [
            "Synthetic Family",
            "Synthetic Personal",
            "Synthetic Spare",
        ]
        personal_root = f"/api/entities/{personal['id']}"
        family_root = f"/api/entities/{family}"
        assert (await owner.get(personal_root + "/plans")).json() == []
        assert (await owner.get(personal_root + "/activity")).json() == []

        # A foreign User can neither see nor use it.
        foreign_meta = (await foreign.get("/api/auth/session")).json()
        assert foreign_meta["entities"] == []
        assert (await foreign.get(personal_root + "/settings")).status_code == 404
        assert (await foreign.get(personal_root + "/plans")).status_code == 404
        assert (
            await send(
                foreign,
                "POST",
                personal_root + "/activity",
                {"date": "2026-11-02", "category": "spending", "amount": "5.00"},
            )
        ).status_code == 404

        # The Entity boundary holds between two Entities of the same User.
        account = await send(
            owner,
            "POST",
            family_root + "/savings-accounts",
            {
                "name": "Synthetic family savings",
                "opening_date": "2026-11-01",
                "opening_amount": "500.00",
                "goals": [
                    {
                        "name": "Synthetic trip",
                        "kind": "finite",
                        "target": "900.00",
                        "opening_amount": "500.00",
                    }
                ],
            },
        )
        assert account.status_code == 200, account.text
        goal = next(g for g in account.json()["goals"] if g["name"] == "Synthetic trip")
        crossed = await send(
            owner,
            "POST",
            personal_root + "/activity",
            {
                "date": "2026-11-05",
                "category": "spending",
                "amount": "40.00",
                "funding_origin": "savings",
                "saving_goal_id": goal["uuid"],
            },
        )
        assert crossed.status_code == 404, crossed.text
        assert crossed.json()["detail"]["code"] == "record_not_found"
        assert (await owner.get(personal_root + "/activity")).json() == []
        assert (
            await owner.get(
                f"{personal_root}/savings-accounts/{account.json()['uuid']}"
            )
        ).status_code == 404

        # One YNAB plan feeds one of the User's Entities at a time.
        for root in (family_root, personal_root):
            saved = await send(
                signed_in,
                "PUT",
                root + "/transaction-provider",
                {"kind": "ynab", "access_token": y.FAKE_TOKEN, "expected_revision": 0},
            )
            assert saved.status_code == 200, saved.text

        async def connect(root):
            return await send(
                signed_in,
                "POST",
                root + "/sources/ynab",
                {"plan_id": y.PLAN, "start_date": "2026-11-01"},
            )

        in_family = await connect(family_root)
        assert in_family.status_code == 200, in_family.text
        elsewhere = await connect(personal_root)
        assert elsewhere.status_code == 409
        assert elsewhere.json()["detail"]["code"] == "source_connected_elsewhere"
        assert "Synthetic Family" in elsewhere.json()["detail"]["message"]
        assert (await owner.get(personal_root + "/sources")).json() == []
        source = in_family.json()
        disconnected = await send(
            signed_in,
            "DELETE",
            f"{family_root}/sources/{source['id']}",
            {"expected_revision": source["revision"]},
        )
        assert disconnected.status_code == 200, disconnected.text
        moved = await connect(personal_root)
        assert moved.status_code == 200, moved.text
        assert (await connect(family_root)).status_code == 409
        # A connect racing a competing one waits for the User lock, then sees it.
        await send(
            signed_in,
            "DELETE",
            f"{personal_root}/sources/{moved.json()['id']}",
            {"expected_revision": moved.json()["revision"]},
        )
        async with sessions() as holder, holder.begin():
            await holder.execute(
                select(m.users.c.id).where(m.users.c.id == user).with_for_update()
            )
            racing = asyncio.create_task(connect(personal_root))
            for _ in range(200):
                waiting = await holder.scalar(
                    text("SELECT count(*) FROM pg_locks WHERE NOT granted")
                )
                if waiting or racing.done():
                    break
                await asyncio.sleep(0.02)
            assert waiting and not racing.done()
            family_id = await holder.scalar(
                select(m.entities.c.id).where(m.entities.c.uuid == family)
            )
            await holder.execute(
                insert(st.sources).values(
                    entity_id=family_id,
                    kind="ynab",
                    external_ref=y.PLAN,
                    name="Synthetic competing connect",
                    start_date=date(2026, 11, 1),
                )
            )
        raced = await racing
        assert raced.status_code == 409, raced.text
        assert raced.json()["detail"]["code"] == "source_connected_elsewhere"

        # The assistant's daily cap counts the User's messages across Entities.
        for root in (family_root, personal_root):
            enabled = await send(
                signed_in,
                "PUT",
                root + "/agent/settings",
                {
                    "enabled": True,
                    "mode": "ask_first",
                    "instructions": "",
                    "expected_revision": 0,
                },
            )
            assert enabled.status_code == 200, enabled.text

        async def message(root):
            return await signed_in.post(
                root + "/agent/conversation/messages", data={"content": "Hello"}
            )

        assert "event: done" in (await message(family_root)).text
        assert "event: done" in (await message(personal_root)).text
        capped = await message(family_root)
        assert capped.status_code == 429
        assert capped.json()["detail"]["code"] == "daily_cap_reached"
        # Each Entity keeps its own conversation.
        for root in (family_root, personal_root):
            stored = (await signed_in.get(root + "/agent/conversation")).json()
            assert [row["role"] for row in stored] == ["owner", "agent"]

    # The sidebar's context holds only its Entity; MCP lists every owned Entity.
    sidebar = ToolContext(sessions, actor.acting_as("agent"), config=config)
    context = await TOOLS["get_context"].run(sidebar, family, t.NoInput(), "")
    assert isinstance(context, t.Context)
    assert [e.name for e in context.entities] == ["Synthetic Family"]
    assert context.entity and context.entity.name == "Synthetic Family"
    mcp = ToolContext(sessions, actor.acting_as("mcp"), config=config)
    listed = await TOOLS["get_context"].run(mcp, None, t.NoInput(), "")
    assert isinstance(listed, t.Context)
    assert [e.name for e in listed.entities] == [
        "Synthetic Family",
        "Synthetic Personal",
        "Synthetic Spare",
    ]
    # Write results name their Entity (Ask first drafts a Pending change).
    drafted = await TOOLS["save_activity"].run(
        mcp,
        UUID(personal["id"]),
        t.SaveActivity(date="2026-11-03", category="spending", amount="12.00"),
        str(uuid4()),
    )
    assert drafted.model_dump(mode="json")["entity"] == {
        "id": personal["id"],
        "name": {"untrusted": "Synthetic Personal"},
    }
    await engine.dispose()
