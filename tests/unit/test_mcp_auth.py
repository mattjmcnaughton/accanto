"""Local signed provider validates OAuth constraints without external accounts."""

import asyncio
import logging
import time

import httpx
import pytest
from joserfc import jwt
from joserfc.jwk import OctKey, RSAKey

from accanto.config import Settings
from accanto.mcp_auth import MCPTokenVerifier
from accanto.services.access import RejectionError
from tests.mcp_fixture import SyntheticMCPProvider


def test_valid_token_and_current_revocation():
    async def scenario():
        fixture = SyntheticMCPProvider()
        verifier = MCPTokenVerifier(
            fixture.config, transport=httpx.ASGITransport(app=fixture.app)
        )
        token = fixture.token()
        result = await verifier.verify_token(token)
        assert result and result.subject == fixture.subject
        count = fixture.calls
        assert await verifier.verify_identity(token) == (
            fixture.issuer,
            fixture.subject,
        )
        assert fixture.calls > count
        fixture.active = False
        assert await verifier.verify_token(token) is None

    asyncio.run(scenario())


@pytest.mark.parametrize(
    "overrides",
    [
        {"iss": "https://wrong.example.test"},
        {"aud": "other-resource"},
        {"exp": 1},
        {"exp": None},
        {"exp": "tomorrow"},
        {"exp": True},
        {"nbf": int(time.time()) + 3600},
        {"sub": ""},
        {"email_verified": False},
        {"email": "other@example.test"},
        {"scope": "accanto:review"},
    ],
)
def test_invalid_claims_fail_closed(overrides, caplog):
    async def scenario():
        fixture = SyntheticMCPProvider()
        verifier = MCPTokenVerifier(
            fixture.config, transport=httpx.ASGITransport(app=fixture.app)
        )
        assert await verifier.verify_token(fixture.token(**overrides)) is None

    with caplog.at_level(logging.DEBUG):
        asyncio.run(scenario())
    assert "synthetic-mcp@example.test" not in caplog.text
    assert "tomorrow" not in caplog.text


@pytest.mark.parametrize(
    "failure", ["signature", "algorithm", "algorithm_rs512", "id_token", "malformed"]
)
def test_invalid_signature_and_token_type(failure):
    async def scenario():
        fixture = SyntheticMCPProvider()
        valid = fixture.token()
        claims = fixture.tokens[valid]
        token = {
            "signature": lambda: jwt.encode(
                {"alg": "RS256", "typ": "at+jwt"}, claims, RSAKey.generate_key(2048)
            ),
            "algorithm": lambda: jwt.encode(
                {"alg": "HS256", "typ": "at+jwt"}, claims, OctKey.generate_key(256)
            ),
            "algorithm_rs512": lambda: jwt.encode(
                {"alg": "RS512", "typ": "at+jwt"},
                claims,
                fixture.key,
                algorithms=["RS512"],
            ),
            "id_token": lambda: jwt.encode(
                {"alg": "RS256", "typ": "JWT"}, claims, fixture.key
            ),
            "malformed": lambda: "invalid-bearer",
        }[failure]()
        # Even an active introspection response cannot bypass JWT verification.
        fixture.tokens[token] = claims
        verifier = MCPTokenVerifier(
            fixture.config, transport=httpx.ASGITransport(app=fixture.app)
        )
        assert await verifier.verify_token(token) is None

    asyncio.run(scenario())


@pytest.mark.parametrize(
    "override",
    [
        {"active": "true"},
        {"iss": "wrong"},
        {"sub": "other"},
        {"aud": "wrong"},
        {"exp": 1},
        {"scope": "accanto:review"},
    ],
)
def test_introspection_must_agree(override):
    async def scenario():
        fixture = SyntheticMCPProvider()
        fixture.introspection_overrides = override
        verifier = MCPTokenVerifier(
            fixture.config, transport=httpx.ASGITransport(app=fixture.app)
        )
        assert await verifier.verify_token(fixture.token()) is None

    asyncio.run(scenario())


def test_provider_outage_and_malformed_response_fail_closed():
    async def scenario():
        fixture = SyntheticMCPProvider()
        token = fixture.token()
        for response in (
            httpx.Response(503),
            httpx.Response(200, json=[]),
            httpx.Response(200, text="bad"),
        ):
            verifier = MCPTokenVerifier(
                fixture.config,
                transport=httpx.MockTransport(
                    lambda request, response=response: response
                ),
            )
            assert await verifier.verify_token(token) is None

    asyncio.run(scenario())


def test_missing_expiry_and_scoped_execution():
    async def scenario():
        fixture = SyntheticMCPProvider()
        verifier = MCPTokenVerifier(
            fixture.config, transport=httpx.ASGITransport(app=fixture.app)
        )
        token = fixture.token(scope="accanto:read")
        assert await verifier.verify_token(token)

        with pytest.raises(RejectionError):
            await verifier.verify_identity(token, "accanto:review")
        claims = fixture.tokens[token].copy()
        del claims["exp"]
        missing = jwt.encode({"alg": "RS256", "typ": "at+jwt"}, claims, fixture.key)
        assert await verifier.verify_token(missing) is None

    asyncio.run(scenario())


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(503),
        httpx.Response(200, json=[]),
        httpx.Response(200, text="bad"),
    ],
)
def test_introspection_outage_or_malformed_response(response):
    async def scenario():
        fixture = SyntheticMCPProvider()

        def handler(request):
            if request.url.path == "/jwks":
                return httpx.Response(
                    200, json={"keys": [fixture.key.as_dict(private=False)]}
                )
            return response

        verifier = MCPTokenVerifier(
            fixture.config, transport=httpx.MockTransport(handler)
        )
        assert await verifier.verify_token(fixture.token()) is None

    asyncio.run(scenario())


@pytest.mark.parametrize(
    "updates",
    [
        {"mcp_resource_url": ""},
        {"mcp_resource_url": "http://untrusted.example/mcp"},
        {"mcp_resource_url": "https://accanto.example/nested/mcp"},
        {"mcp_jwks_uri": "https://issuer.example/jwks?secret=forbidden"},
        {"mcp_issuer": "https://user:password@issuer.example"},
        {"mcp_introspection_client_secret": ""},
        {"mcp_allowed_emails": []},
    ],
)
def test_incomplete_or_untrusted_configuration_rejects(updates):
    fixture = SyntheticMCPProvider()

    config = Settings(_env_file=None, **{**fixture.config.model_dump(), **updates})
    with pytest.raises(ValueError, match="complete trusted"):
        MCPTokenVerifier(config)
