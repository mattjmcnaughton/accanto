"""MCP v1 at /mcp over real Streamable HTTP JSON-RPC and PostgreSQL (TDD 03).

API keys as Bearer tokens, the exact catalog, annotations, Entity boundary,
revocation, and parity between REST, MCP and the built-in agent's projections.
Synthetic data only; set ACCANTO_TEST_DATABASE_URL to an isolated migrated DB.
"""

import asyncio
import os
from datetime import UTC, datetime
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import func, insert, select, update
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from accanto.app import create_app
from accanto.db import get_session
from accanto.dtos import tools as t
from accanto.models import agent as a
from accanto.models import monthly as m
from accanto.services.access import issue_session, resolve_actor
from accanto.services.api_keys import issue_key
from accanto.services.tools import TOOLS, ToolContext
from tests.unit.test_tool_catalog import CATALOG_NAMES

URL = os.environ.get("ACCANTO_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="Requires isolated migrated PostgreSQL")


class MCPProtocol:
    """Public Streamable HTTP JSON-RPC, without calling tool functions."""

    def __init__(self, client, token):
        self.client, self.token, self.sequence = client, token, 0

    async def request(self, method, params=None, *, headers=None):
        self.sequence += 1
        return await self.client.post(
            "/mcp",
            json={
                "jsonrpc": "2.0",
                "id": self.sequence,
                "method": method,
                "params": params or {},
            },
            headers={
                "MCP-Protocol-Version": "2025-03-26",
                "Accept": "application/json, text/event-stream",
                **(
                    headers
                    if headers is not None
                    else {"Authorization": f"Bearer {self.token}"}
                ),
            },
        )

    async def call(self, name, arguments=None, *, error=False):
        response = await self.request(
            "tools/call", {"name": name, "arguments": arguments or {}}
        )
        assert response.status_code == 200, response.text
        result = response.json()["result"]
        assert result.get("isError", False) is error, result
        return result if error else result["structuredContent"]


def test_mcp_v1_catalog_auth_and_parity():
    asyncio.run(scenario())


async def scenario():
    assert URL and URL.rsplit("/", 1)[-1].endswith("_test")
    engine = create_async_engine(URL)
    sessions = async_sessionmaker(engine)
    async with sessions() as db, db.begin():
        user = await db.scalar(
            insert(m.users)
            .values(issuer="mcp-test", subject=str(uuid4()))
            .returning(m.users.c.id)
        )
        entity, entity_id = (
            await db.execute(
                insert(m.entities)
                .values(owner_id=user, name="Synthetic MCP Entity", time_zone="UTC")
                .returning(m.entities.c.uuid, m.entities.c.id)
            )
        ).one()
        other = await db.scalar(
            insert(m.users)
            .values(issuer="mcp-test", subject=str(uuid4()))
            .returning(m.users.c.id)
        )
        foreign = await db.scalar(
            insert(m.entities)
            .values(owner_id=other, name="Synthetic foreign", time_zone="UTC")
            .returning(m.entities.c.uuid)
        )
        key = await issue_key(db, user, "Synthetic MCP key")
        browser = await issue_session(db, user)
        owner = await resolve_actor(db, browser["token"], "session")

    app = create_app()
    app.state.sessions = sessions

    async def dependency():
        async with sessions() as db:
            yield db

    app.dependency_overrides[get_session] = dependency
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

            # Unauthenticated and cookie-only requests are refused.
            assert (await mcp.request("tools/list", headers={})).status_code == 401
            cookie_only = await mcp.request(
                "tools/list", headers={"Cookie": f"accanto_session={browser['token']}"}
            )
            assert cookie_only.status_code == 401
            assert cookie_only.headers["cache-control"] == "no-store"
            wrong = await mcp.request(
                "tools/list", headers={"Authorization": "Bearer not-a-real-key"}
            )
            assert wrong.status_code == 401

            initialized = await mcp.request(
                "initialize",
                {
                    "protocolVersion": "2025-03-26",
                    "capabilities": {},
                    "clientInfo": {"name": "synthetic", "version": "1"},
                },
            )
            assert initialized.status_code == 200, initialized.text
            assert "get_context" in initialized.json()["result"]["instructions"]

            # Exactly the catalog, with annotations and approval metadata.
            listed = (await mcp.request("tools/list")).json()["result"]["tools"]
            assert [tool["name"] for tool in listed] == CATALOG_NAMES
            by_name = {tool["name"]: tool for tool in listed}
            for name, tool in by_name.items():
                spec = TOOLS[name]
                hints = tool["annotations"]
                assert hints["readOnlyHint"] is (spec.kind == "read"), name
                assert hints["destructiveHint"] is (spec.kind == "delete"), name
                needs_approval = (tool.get("_meta") or {}).get(
                    "anthropic/requiresUserInteraction"
                )
                assert bool(needs_approval) is (spec.build is not None), name
                if spec.pure:
                    assert "entity_id" not in tool["inputSchema"]["properties"]
                elif name != "get_context":
                    assert tool["inputSchema"]["required"][0] == "entity_id"
                if spec.kind != "read":
                    assert "idempotency_key" in tool["inputSchema"]["required"]

            context = await mcp.call("get_context")
            assert [e["id"] for e in context["entities"]] == [str(entity)]
            assert context["entities"][0]["name"] == {
                "untrusted": "Synthetic MCP Entity"
            }

            # Pure arithmetic needs no Entity; rejections never echo the input.
            calculated = await mcp.call("calculate", {"expression": "0.1 + 0.2"})
            assert calculated == {
                "expression": "0.1 + 0.2",
                "result": "0.3",
                "cents": "0.30",
            }
            rejected = await mcp.call(
                "calculate", {"expression": "84.31 / 0"}, error=True
            )
            assert (
                "invalid_arguments: Division by zero." in rejected["content"][0]["text"]
            )
            assert "84.31" not in rejected["content"][0]["text"]

            # Entity boundary: a foreign Entity is unavailable.
            denied = await mcp.call(
                "list_activity",
                {"entity_id": str(foreign), "month": "2026-11-01"},
                error=True,
            )
            assert "entity_not_found" in denied["content"][0]["text"]
            invalid = await mcp.call(
                "list_activity",
                {"entity_id": str(entity), "month": "2026-11-15"},
                error=True,
            )
            assert "invalid_arguments" in invalid["content"][0]["text"]
            assert "2026-11-15" not in invalid["content"][0]["text"]

            # Parity: a Plan, a Review and two entries made through REST.
            async def post(path, body):
                response = await client.post(
                    prefix + path,
                    json=body,
                    headers={**api, "Idempotency-Key": str(uuid4())},
                )
                assert response.status_code == 200, response.text
                return response.json()

            plan = await post(
                "/plans",
                {
                    "name": "Synthetic parity Plan",
                    "incomes": [{"name": "Synthetic pay", "amount": "3000.00"}],
                    "spending": "900.00",
                },
            )
            version = (
                await post(
                    f"/plans/{plan['plan_id']}/versions", {"expected_revision": 1}
                )
            )["version"]
            await post(
                "/reviews", {"month": "2026-11-01", "version_id": version["uuid"]}
            )
            for amount, note in (("45.10", "Synthetic market"), ("4.90", "")):
                await post(
                    "/activity",
                    {
                        "date": "2026-11-03",
                        "category": "spending",
                        "amount": amount,
                        "note": note,
                    },
                )
            sidebar = ToolContext(sessions, owner.acting_as("agent"))
            month = t.ActivityQuery(month="2026-11-01")
            rest_rows = (await client.get(prefix + "/activity", headers=api)).json()
            rest = t.ActivityList(
                entries=[t.project_entry(r) for r in rest_rows], truncated=False
            ).model_dump(mode="json")
            over_mcp = await mcp.call(
                "list_activity", {"entity_id": str(entity), "month": "2026-11-01"}
            )
            in_process = (
                await TOOLS["list_activity"].run(sidebar, entity, month, "")
            ).model_dump(mode="json")
            assert rest == over_mcp == in_process
            assert sorted(e["amount"] for e in over_mcp["entries"]) == ["4.90", "45.10"]

            # Summaries: October has no entries (unknown) and November is in
            # progress, so nothing is averaged; a note filter keeps one entry.
            span = {"start": "2026-10-01", "end": "2026-11-30"}
            summary = await mcp.call(
                "summarize_activity", {"entity_id": str(entity), **span}
            )
            assert summary == (
                await TOOLS["summarize_activity"].run(
                    sidebar, entity, t.ActivitySummaryQuery.model_validate(span), ""
                )
            ).model_dump(mode="json")
            spent = summary["categories"][0]
            assert (spent["category"], spent["total"], spent["entries"]) == (
                "spending",
                "50.00",
                2,
            )
            assert spent["monthly_average"] is None
            assert spent["months_without_entries"] == ["2026-10-01"]
            assert summary["saving_rate"]["denominator"] is None
            market = await mcp.call(
                "summarize_activity",
                {"entity_id": str(entity), **span, "note_contains": "MARKET"},
            )
            assert market["categories"][0]["total"] == "45.10"

            rest_review = (
                await client.get(prefix + "/reviews/2026-11-01", headers=api)
            ).json()
            review = await mcp.call(
                "get_monthly_review", {"entity_id": str(entity), "month": "2026-11-01"}
            )
            assert review == t.project_review_view(rest_review).model_dump(mode="json")
            assert review == (
                await TOOLS["get_monthly_review"].run(
                    sidebar, entity, t.MonthInput(month="2026-11-01"), ""
                )
            ).model_dump(mode="json")
            # Worked example: $45.10 + $4.90 = $50.00 recorded against $900.00
            # planned spending, a difference of -$850.00.
            spending = next(
                c for c in review["categories"] if c["category"] == "spending"
            )
            assert (
                spending["planned"],
                spending["recorded"],
                spending["difference"],
            ) == (
                "900.00",
                "50.00",
                "-850.00",
            )
            income = next(c for c in review["categories"] if c["category"] == "income")
            assert income["recorded"] is None  # unknown, not zero

            # Ask first (default): an MCP write records nothing and pends.
            async def entries():
                async with sessions() as db:
                    return await db.scalar(
                        select(func.count()).where(
                            m.entries.c.entity_id == entity_id,
                            m.entries.c.deleted_at.is_(None),
                        )
                    )

            drafted = await mcp.call(
                "save_activity",
                {
                    "entity_id": str(entity),
                    "idempotency_key": "synthetic-mcp-1",
                    "date": "2026-11-04",
                    "category": "spending",
                    "amount": "8.00",
                },
            )
            assert drafted["status"] == "pending"
            assert drafted["pending_change"]["created_by_interface"] == "mcp"
            assert await entries() == 2
            missing_key = await mcp.call(
                "save_activity",
                {
                    "entity_id": str(entity),
                    "date": "2026-11-04",
                    "category": "spending",
                    "amount": "8.00",
                },
                error=True,
            )
            assert "idempotency_key" in missing_key["content"][0]["text"]

            # Read only: MCP writes are refused, sync and proposals included.
            async with sessions() as db, db.begin():
                await db.execute(
                    insert(a.settings).values(
                        entity_id=entity_id, enabled=True, mode="read_only"
                    )
                )
            for name, arguments in (
                (
                    "save_activity",
                    {
                        "date": "2026-11-04",
                        "category": "spending",
                        "amount": "9.00",
                    },
                ),
                ("sync_source", {"source_id": str(uuid4())}),
                (
                    "set_proposals",
                    {
                        "proposals": [
                            {
                                "item_id": str(uuid4()),
                                "expected_revision": 1,
                                "skip": True,
                                "rationale": "Synthetic",
                            }
                        ]
                    },
                ),
            ):
                refused = await mcp.call(
                    name,
                    {
                        "entity_id": str(entity),
                        "idempotency_key": f"synthetic-read-only-{name}",
                        **arguments,
                    },
                    error=True,
                )
                assert refused["content"][0]["text"].startswith("read_only:"), name
            assert await entries() == 2
            async with sessions() as db:
                assert (
                    await db.scalar(
                        select(func.count()).where(a.pending.c.entity_id == entity_id)
                    )
                    == 1
                )

            # The SPA never swallows /mcp.
            assert (await client.get("/mcp")).headers.get(
                "content-type", ""
            ).startswith("text/html") is False

            # Revoking the key denies the next call.
            async with sessions() as db, db.begin():
                await db.execute(
                    update(m.keys)
                    .where(m.keys.c.uuid == key["id"])
                    .values(revoked_at=datetime.now(UTC))
                )
            assert (await mcp.request("tools/list")).status_code == 401
    finally:
        await engine.dispose()
