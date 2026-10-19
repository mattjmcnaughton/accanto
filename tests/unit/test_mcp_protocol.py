"""Exercise protected-resource discovery over actual ASGI HTTP protocol."""

import asyncio

import httpx

from accanto.mcp_auth import MCPTokenVerifier
from accanto.mcp_server import create_mcp_app
from tests.mcp_fixture import SyntheticMCPProvider


def test_resource_metadata_and_bearer_challenge():
    async def scenario():
        provider = SyntheticMCPProvider()
        verifier = MCPTokenVerifier(
            provider.config, transport=httpx.ASGITransport(app=provider.app)
        )
        app = create_mcp_app(provider.config, verifier=verifier)
        async with (
            app.router.lifespan_context(app),
            httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app),
                base_url="http://127.0.0.1:55425",
            ) as client,
        ):
            response = await client.post(
                "/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"}
            )
            assert response.status_code == 401
            challenge = response.headers["www-authenticate"]
            assert (
                'resource_metadata="http://127.0.0.1:55425/.well-known/oauth-protected-resource/mcp"'
                in challenge
            )
            metadata = await client.get("/.well-known/oauth-protected-resource/mcp")
            assert metadata.status_code == 200
            data = metadata.json()
            assert data["resource"] == provider.resource
            assert data["authorization_servers"] == [provider.issuer]
            assert set(data["scopes_supported"]) == {"accanto:read", "accanto:review"}
            assert data["bearer_methods_supported"] == ["header"]
            assert (
                metadata.headers["cache-control"]
                == response.headers["cache-control"]
                == "no-store"
            )
            assert (
                await client.get("/.well-known/oauth-authorization-server")
            ).status_code == 404

    asyncio.run(scenario())
