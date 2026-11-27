"""Entity settings through MCP, the built-in agent and REST (TDD 03, Settings).

Real PostgreSQL and real Streamable HTTP JSON-RPC. The safe settings (name, time
zone, default expected return, FIRE assumptions) follow the Agent mode like any
write: Ask first pends, Apply directly records and audits, Read only refuses.
Sensitive settings (the Agent mode and enablement, the YNAB token and source
setup) stay browser-only, and no response carries the stored token. Synthetic data only.
"""

import asyncio
import json
import os
from uuid import uuid4

import httpx
import pytest
from cryptography.fernet import Fernet
from sqlalchemy import insert, select, update
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from accanto.app import create_app
from accanto.db import get_session
from accanto.models import agent as a
from accanto.models import inbox as i
from accanto.models import monthly as m
from accanto.services.access import issue_session, resolve_actor
from accanto.services.api_keys import issue_key
from accanto.services.tools import TOOLS, ToolContext, apply_pending
from tests.integration.test_mcp import MCPProtocol

URL = os.environ.get("ACCANTO_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="Requires isolated migrated PostgreSQL")
TOKEN = f"synthetic-ynab-token-{uuid4().hex}"


def test_settings_tools_follow_the_agent_mode_and_refuse_sensitive_settings():
    asyncio.run(scenario())


async def scenario():
    assert URL and URL.rsplit("/", 1)[-1].endswith("_test")
    engine = create_async_engine(URL)
    sessions = async_sessionmaker(engine)
    ciphertext = Fernet(Fernet.generate_key()).encrypt(TOKEN.encode()).decode()
    async with sessions() as db, db.begin():
        user = await db.scalar(
            insert(m.users)
            .values(issuer="settings-test", subject=str(uuid4()))
            .returning(m.users.c.id)
        )
        entity, entity_id = (
            await db.execute(
                insert(m.entities)
                .values(
                    owner_id=user, name="Synthetic Settings Entity", time_zone="UTC"
                )
                .returning(m.entities.c.uuid, m.entities.c.id)
            )
        ).one()
        await db.execute(
            insert(i.providers).values(
                entity_id=entity_id, kind="ynab", secret_ciphertext=ciphertext
            )
        )
        await db.execute(
            insert(a.settings).values(
                entity_id=entity_id, enabled=True, mode="ask_first"
            )
        )
        key = await issue_key(db, user, "Synthetic settings key")
        browser = await issue_session(db, user)
        owner = await resolve_actor(db, browser["token"], "session")

    async def mode():
        async with sessions() as db:
            return await db.scalar(
                select(a.settings.c.mode).where(a.settings.c.entity_id == entity_id)
            )

    async def set_mode(value):
        async with sessions() as db, db.begin():
            await db.execute(
                update(a.settings)
                .where(a.settings.c.entity_id == entity_id)
                .values(mode=value)
            )

    async def stored():
        async with sessions() as db:
            return (
                (
                    await db.execute(
                        select(m.entities).where(m.entities.c.id == entity_id)
                    )
                )
                .mappings()
                .one()
            )

    async def audits():
        async with sessions() as db:
            return (
                (
                    await db.execute(
                        select(m.audit.c.interface, m.audit.c.action)
                        .where(m.audit.c.entity_id == entity_id)
                        .order_by(m.audit.c.id)
                    )
                )
                .tuples()
                .all()
            )

    app = create_app()
    app.state.sessions = sessions

    async def dependency():
        async with sessions() as db:
            yield db

    app.dependency_overrides[get_session] = dependency
    responses = []
    try:
        async with (
            app.router.lifespan_context(app),
            httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="http://127.0.0.1"
            ) as client,
        ):
            mcp = MCPProtocol(client, key["key"])
            api = {"Authorization": f"Bearer {key['key']}"}
            prefix = f"/api/entities/{entity}"

            async def call(name, arguments=None, *, error=False):
                result = await mcp.call(
                    name, {"entity_id": str(entity), **(arguments or {})}, error=error
                )
                responses.append(json.dumps(result))
                return result

            # Read: every safe setting with one revision, and nothing sensitive.
            current = await call("get_settings")
            assert current == {
                "name": {"untrusted": "Synthetic Settings Entity"},
                "time_zone": "UTC",
                "today": current["today"],
                "default_return_percent": "6.00",
                "fire_annual_spending": None,
                "fire_withdrawal_percent": "4.00",
                "inflation_percent": "3.00",
                "revision": 1,
            }

            # Ask first: the edit is a Pending change; nothing is saved or audited.
            rename = {
                "idempotency_key": "settings-1",
                "name": "Synthetic Renamed Entity",
                "time_zone": "America/Chicago",
                "default_return_percent": "5.5",
                "expected_revision": 1,
            }
            drafted = await call("save_entity_settings", rename)
            assert drafted["status"] == "pending"
            change = drafted["pending_change"]
            assert change["tool"] == "save_entity_settings"
            assert change["created_by_interface"] == "mcp"
            assert drafted["entity"]["name"] == {
                "untrusted": "Synthetic Settings Entity"
            }
            assert (await stored())["name"] == "Synthetic Settings Entity"
            assert await audits() == []
            # Retry with the same key replays; other input under it is refused.
            assert (await call("save_entity_settings", rename))["pending_change"][
                "id"
            ] == change["id"]
            reused = await call(
                "save_entity_settings", {**rename, "name": "Other"}, error=True
            )
            assert reused["content"][0]["text"].startswith("key_reuse:")

            # The owner applies it: saved once, audited, the revision advances.
            applied = await apply_pending(
                ToolContext(sessions, owner), entity, change["id"]
            )
            assert applied.status == "recorded" and applied.revision == 2
            row = await stored()
            assert (
                row["name"],
                row["time_zone"],
                str(row["default_return_percent"]),
            ) == (
                "Synthetic Renamed Entity",
                "America/Chicago",
                "5.50",
            )
            assert await audits() == [("agent", "edit_entity")]

            # A stale revision is refused, never silently overwritten.
            stale = await call(
                "save_fire_assumptions",
                {
                    "idempotency_key": "fire-stale",
                    "annual_spending": "48000.00",
                    "withdrawal_percent": "3.5",
                    "expected_revision": 1,
                },
                error=True,
            )
            assert stale["content"][0]["text"].startswith("stale_revision:")

            # Apply directly: recorded at once and audited as MCP.
            await set_mode("apply_directly")
            fire = {
                "idempotency_key": "fire-1",
                "annual_spending": "48000.00",
                "withdrawal_percent": "3.5",
                "expected_revision": 2,
            }
            recorded = await call("save_fire_assumptions", fire)
            assert recorded["status"] == "recorded" and recorded["revision"] == 3
            assert (await call("save_fire_assumptions", fire)) == recorded
            assert await audits() == [
                ("agent", "edit_entity"),
                ("mcp", "edit_fire_assumptions"),
            ]
            # REST reads what MCP wrote; omitting the default return keeps it.
            rest = (await client.get(prefix + "/fire-assumptions", headers=api)).json()
            assert rest == {
                "annual_spending": "48000.00",
                "withdrawal_percent": "3.50",
                "inflation_percent": "3.00",
                "revision": 3,
            }
            kept = await call(
                "save_entity_settings",
                {
                    "idempotency_key": "settings-2",
                    "name": "Synthetic Renamed Entity",
                    "time_zone": "UTC",
                    "expected_revision": 3,
                },
            )
            assert kept["status"] == "recorded"
            assert (await call("get_settings"))["default_return_percent"] == "5.50"

            # The built-in assistant has the same tools under the same mode.
            sidebar = ToolContext(sessions, owner.acting_as("agent"))
            await set_mode("ask_first")
            spec = TOOLS["save_fire_assumptions"]
            sidebar_draft = await spec.run(
                sidebar,
                entity,
                spec.input.model_validate(
                    {
                        "annual_spending": None,
                        "withdrawal_percent": "4",
                        "expected_revision": 4,
                    }
                ),
                "sidebar-fire-1",
            )
            drafted_here = sidebar_draft.model_dump(mode="json")
            assert drafted_here["status"] == "pending"
            assert drafted_here["pending_change"]["created_by_interface"] == "agent"

            # Read only: every settings write is refused, reads still work.
            await set_mode("read_only")
            refused = await call(
                "save_entity_settings",
                {**rename, "idempotency_key": "settings-3", "expected_revision": 4},
                error=True,
            )
            assert refused["content"][0]["text"].startswith("read_only:")
            assert (await call("get_settings"))["revision"] == 4

            # Sensitive settings: no tool reaches them and smuggled fields fail.
            await set_mode("ask_first")
            for extra in (
                {"mode": "apply_directly"},
                {"enabled": False},
                {"access_token": "synthetic-other-token"},
                {"instructions": "Synthetic smuggled instruction."},
            ):
                smuggled = await call(
                    "save_entity_settings",
                    {
                        **rename,
                        "idempotency_key": f"smuggle-{next(iter(extra))}",
                        "expected_revision": 4,
                        **extra,
                    },
                    error=True,
                )
                assert smuggled["content"][0]["text"].startswith("invalid_arguments:")
            unknown = await mcp.request(
                "tools/call",
                {
                    "name": "edit_agent_settings",
                    "arguments": {"entity_id": str(entity), "mode": "apply_directly"},
                },
            )
            assert "structuredContent" not in unknown.text
            assert await mode() == "ask_first"

            # REST: the same safe settings take an API key; sensitive ones refuse it.
            settings = await client.put(
                prefix + "/settings",
                json={
                    "name": "Synthetic Renamed Entity",
                    "time_zone": "UTC",
                    "expected_revision": 4,
                    "mode": "apply_directly",
                },
                headers={**api, "Idempotency-Key": str(uuid4())},
            )
            assert settings.status_code == 422
            for method, path, body in (
                (
                    "PUT",
                    "/agent/settings",
                    {
                        "enabled": True,
                        "mode": "apply_directly",
                        "instructions": "",
                        "expected_revision": 1,
                    },
                ),
                ("GET", "/agent/settings", None),
                (
                    "PUT",
                    "/transaction-provider",
                    {
                        "kind": "ynab",
                        "access_token": "synthetic-x",
                        "expected_revision": 1,
                    },
                ),
                ("GET", "/transaction-provider", None),
                ("GET", "/sources/ynab/plans", None),
                ("GET", "/api/keys", None),
                ("POST", "/api/keys", {"name": "Synthetic minted"}),
                ("DELETE", f"/api/keys/{key['id']}", None),
            ):
                response = await client.request(
                    method,
                    path if path.startswith("/api/") else prefix + path,
                    json=body,
                    headers={**api, "Idempotency-Key": str(uuid4())},
                )
                assert response.status_code == 403, (method, path)
                assert response.json()["detail"]["code"] == "browser_session_required"
                responses.append(response.text)
            assert await mode() == "ask_first"
            async with sessions() as db:
                assert (
                    await db.scalar(
                        select(i.providers.c.secret_ciphertext).where(
                            i.providers.c.entity_id == entity_id
                        )
                    )
                    == ciphertext
                )

            # No response carried the stored token or its ciphertext.
            for text in responses:
                assert TOKEN not in text and ciphertext not in text
    finally:
        await engine.dispose()
