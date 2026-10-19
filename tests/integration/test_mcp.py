"""Synthetic signed-provider + real PostgreSQL + MCP protocol service parity.

These checks do not establish compatibility with any hosted identity provider,
ChatGPT, or Claude. Set ACCANTO_TEST_DATABASE_URL to an isolated migrated DB.
"""

import asyncio
import os
from contextlib import asynccontextmanager
from uuid import uuid4

import httpx
import pytest
from accanto.mcp_auth import MCPTokenVerifier
from accanto.mcp_server import create_mcp_app
from sqlalchemy import func, insert, select, update
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from accanto.app import create_app
from accanto.db import get_session
from accanto.models import monthly as m
from accanto.services.api_keys import issue_key
from tests.mcp_fixture import SyntheticMCPProvider

URL = os.environ.get("ACCANTO_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="Requires isolated migrated PostgreSQL")


class MCPProtocol:
    """Exercise public Streamable HTTP JSON-RPC, without calling tool functions."""

    def __init__(self, client):
        self.client = client
        self.sequence = 0

    async def request(self, method, params=None, *, token=None):
        self.sequence += 1
        headers = {"MCP-Protocol-Version": "2025-03-26"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        return await self.client.post(
            "/mcp",
            json={
                "jsonrpc": "2.0",
                "id": self.sequence,
                "method": method,
                "params": params or {},
            },
            headers=headers,
        )

    async def call(self, name, arguments=None, *, error=False):
        response = await self.request(
            "tools/call", {"name": name, "arguments": arguments or {}}
        )
        assert response.status_code == 200, response.text
        result = response.json()["result"]
        assert result.get("isError", False) is error, result
        if error:
            return result
        return result["structuredContent"]


@asynccontextmanager
async def environment():
    assert URL and "test" in URL.rsplit("/", 1)[-1]
    engine = create_async_engine(URL)
    sessions = async_sessionmaker(engine)
    provider = SyntheticMCPProvider()
    provider.subject = f"synthetic-mcp-{uuid4()}"
    async with sessions() as session, session.begin():
        owner = await session.scalar(
            insert(m.users)
            .values(issuer=provider.issuer, subject=provider.subject)
            .returning(m.users.c.id)
        )
        other = await session.scalar(
            insert(m.users)
            .values(issuer=provider.issuer, subject=f"synthetic-other-{uuid4()}")
            .returning(m.users.c.id)
        )
        entity = (
            (
                await session.execute(
                    insert(m.entities)
                    .values(owner_id=owner, name="Synthetic MCP", time_zone="UTC")
                    .returning(m.entities)
                )
            )
            .mappings()
            .one()
        )
        foreign = await session.scalar(
            insert(m.entities)
            .values(owner_id=other, name="Synthetic foreign", time_zone="UTC")
            .returning(m.entities.c.uuid)
        )
        credential = await issue_key(session, owner, "Synthetic API parity")
    api = create_app()

    async def dependency():
        async with sessions() as session:
            yield session

    api.dependency_overrides[get_session] = dependency
    verifier = MCPTokenVerifier(
        provider.config, transport=httpx.ASGITransport(app=provider.app)
    )
    app = create_mcp_app(provider.config, sessions=sessions, verifier=verifier)
    try:
        async with (
            app.router.lifespan_context(app),
            httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app),
                base_url="http://127.0.0.1:55425",
                headers={
                    "Authorization": f"Bearer {provider.token()}",
                    "Accept": "application/json, text/event-stream",
                },
            ) as client,
            httpx.AsyncClient(
                transport=httpx.ASGITransport(app=api),
                base_url="http://test",
                headers={"Authorization": f"Bearer {credential['key']}"},
            ) as api_client,
        ):
            protocol = MCPProtocol(client)
            initialized = await protocol.request(
                "initialize",
                {
                    "protocolVersion": "2025-03-26",
                    "capabilities": {},
                    "clientInfo": {"name": "synthetic-integration", "version": "1"},
                },
            )
            assert initialized.status_code == 200, initialized.text
            assert "tools" in initialized.json()["result"]["capabilities"]
            yield provider, protocol, api_client, sessions, entity, foreign, other
    finally:
        await engine.dispose()


def test_mcp_service_parity_projection_and_authorized_retry():
    asyncio.run(parity_scenario())


async def parity_scenario():
    async with environment() as (
        provider,
        protocol,
        api,
        sessions,
        entity,
        foreign,
        other,
    ):
        prefix = f"/api/entities/{entity['uuid']}"

        async def command(path, body):
            response = await api.post(
                prefix + path,
                json=body,
                headers={"Idempotency-Key": str(uuid4())},
            )
            assert response.status_code == 200, response.text
            return response.json()

        tools = await protocol.request("tools/list")
        assert tools.status_code == 200, tools.text
        assert {tool["name"] for tool in tools.json()["result"]["tools"]} == {
            "list_entities",
            "list_plan_versions",
            "get_monthly_review",
            "start_monthly_review",
        }
        entities = await protocol.call("list_entities")
        assert [value["id"] for value in entities["entities"]] == [str(entity["uuid"])]
        plan = await command(
            "/plans",
            {
                "name": "Synthetic immutable plan",
                "spending": "200.00",
                "incomes": [
                    {"name": "Synthetic earned", "amount": "4000.00"},
                    {"name": "Synthetic unknown", "amount": "0.00"},
                ],
            },
        )
        version = (
            await command(
                f"/plans/{plan['plan_id']}/versions", {"expected_revision": 1}
            )
        )["version"]
        versions = await protocol.call(
            "list_plan_versions", {"entity_id": str(entity["uuid"])}
        )
        assert versions == {
            "versions": [
                {
                    "plan_id": plan["plan_id"],
                    "version_id": version["uuid"],
                    "name": "Synthetic immutable plan",
                    "number": 1,
                    "revision": version["revision"],
                }
            ]
        }
        identity = str(uuid4())
        arguments = {
            "entity_id": str(entity["uuid"]),
            "month": "2026-10-01",
            "version_id": version["uuid"],
            "idempotency_key": identity,
        }
        started = await protocol.call("start_monthly_review", arguments)
        assert started["version_id"] == version["uuid"] and started["revision"] == 1
        assert await protocol.call("start_monthly_review", arguments) == started
        await command(
            "/activity",
            {
                "date": "2026-10-09",
                "category": "income",
                "amount": "4000.00",
                "source_id": version["incomes"][0]["source_id"],
                "note": "Synthetic note excluded from MCP",
            },
        )
        await command(
            "/activity",
            {
                "date": "2026-10-10",
                "category": "spending",
                "amount": "25.00",
            },
        )
        api_review = (await api.get(prefix + "/reviews/2026-10-01")).json()
        projected = await protocol.call(
            "get_monthly_review",
            {
                "entity_id": str(entity["uuid"]),
                "month": "2026-10-01",
            },
        )
        assert set(projected) == {
            "month",
            "version_id",
            "categories",
            "summary",
            "metrics",
        }
        assert projected["version_id"] == version["uuid"]
        assert projected["summary"] == api_review["summary"]
        assert projected["metrics"] == api_review["metrics"]
        for category in projected["categories"]:
            original = api_review["comparison"][category["category"]]
            assert category == {
                "category": category["category"],
                **{
                    key: original[key]
                    for key in ("planned", "recorded", "incomplete", "difference")
                },
                "items": [
                    {
                        key: item[key]
                        for key in ("id", "name", "planned", "recorded", "difference")
                    }
                    for item in original["items"]
                ],
            }
        income = next(c for c in projected["categories"] if c["category"] == "income")
        assert income["recorded"] == "4000.00" and income["incomplete"]
        assert income["difference"] is None
        assert income["items"][1]["recorded"] is None
        assert "Synthetic note excluded from MCP" not in str(projected)

        async def counts():
            async with sessions() as session:
                return tuple(
                    [
                        await session.scalar(
                            select(func.count())
                            .select_from(table)
                            .where(table.c.entity_id == entity["id"])
                        )
                        for table in (m.entries, m.reviews, m.audit, m.outcomes)
                    ]
                )

        baseline = await counts()
        await protocol.call(
            "start_monthly_review", {**arguments, "month": "2026-11-01"}, error=True
        )
        await protocol.call(
            "start_monthly_review",
            {**arguments, "version_id": str(uuid4()), "idempotency_key": str(uuid4())},
            error=True,
        )
        await protocol.call(
            "list_plan_versions", {"entity_id": str(foreign)}, error=True
        )
        await protocol.call(
            "start_monthly_review",
            {**arguments, "entity_id": str(foreign), "idempotency_key": str(uuid4())},
            error=True,
        )
        await protocol.call(
            "get_monthly_review",
            {"entity_id": str(entity["uuid"]), "month": "2026-10-02"},
            error=True,
        )
        await protocol.call(
            "get_monthly_review",
            {
                "entity_id": str(entity["uuid"]),
                "month": "2026-10-01",
                "include_notes": True,
            },
            error=True,
        )
        assert await counts() == baseline
        async with sessions() as session:
            rows = (
                (
                    await session.execute(
                        select(m.audit).where(
                            m.audit.c.entity_id == entity["id"],
                            m.audit.c.interface == "mcp",
                        )
                    )
                )
                .mappings()
                .all()
            )
            assert len(rows) == 1 and rows[0]["actor_id"] == entity["owner_id"]
            assert (
                await session.scalar(
                    select(func.count())
                    .select_from(m.entries)
                    .where(m.entries.c.entity_id == entity["id"])
                )
                == 2
            )  # Only the explicit API activity; starting a Review moved no money.
        provider.active = False
        denied = await protocol.request(
            "tools/call", {"name": "start_monthly_review", "arguments": arguments}
        )
        assert denied.status_code == 401, denied.text
        provider.active = True
        expired = await protocol.request("tools/list", token=provider.token(exp=1))
        assert expired.status_code == 401, expired.text
        async with sessions() as session, session.begin():
            await session.execute(
                update(m.entities)
                .where(m.entities.c.id == entity["id"])
                .values(owner_id=other)
            )
        await protocol.call("start_monthly_review", arguments, error=True)
        await protocol.call(
            "get_monthly_review",
            {"entity_id": str(entity["uuid"]), "month": "2026-10-01"},
            error=True,
        )
        assert (await protocol.call("list_entities"))["entities"] == []
        assert await counts() == baseline
