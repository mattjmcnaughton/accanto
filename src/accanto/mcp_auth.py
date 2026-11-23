"""MCP credential verification: API keys (v1) and the later hosted-OAuth verifier.

MCPTokenVerifier (external OAuth resource verification) is kept for the hosted
OAuth phase but is not mounted in v1 (TDD 03).
"""

import math
import time
from urllib.parse import urlsplit

import httpx
from fastmcp.server.auth import AccessToken, TokenVerifier
from joserfc import jwt
from joserfc.jwk import KeySet

from accanto.config import Settings
from accanto.oidc import trusted_url
from accanto.services.access import invalid_credential

READ_SCOPE = "accanto:read"
REVIEW_SCOPE = "accanto:review"


def validate_config(config: Settings):
    urls = (
        config.mcp_resource_url,
        config.mcp_issuer,
        config.mcp_jwks_uri,
        config.mcp_introspection_url,
    )
    if (
        any(not trusted_url(value) or urlsplit(value).query for value in urls)
        or urlsplit(config.mcp_resource_url).path != "/mcp"
        or not config.mcp_introspection_client_id
        or not config.mcp_introspection_client_secret.get_secret_value()
        or not config.mcp_allowed_emails
    ):
        raise ValueError(
            "MCP requires complete trusted resource/provider configuration."
        )


def _expiry(claims):
    expiry = claims.get("exp")
    return (
        type(expiry) in (int, float) and math.isfinite(expiry) and expiry > time.time()
    )


def _audience(claims, expected):
    audience = claims.get("aud")
    return audience == expected or (
        isinstance(audience, list)
        and bool(audience)
        and all(isinstance(value, str) and value for value in audience)
        and expected in audience
    )


def _scopes(claims):
    value = claims.get("scope")
    return value.split() if isinstance(value, str) else []


class MCPTokenVerifier(TokenVerifier):
    """Strict JWT verification plus uncached current RFC 7662 active status.

    Network/claim failures are deliberately silent: upstream errors may contain
    tokens or arbitrary response bodies. Introspection must be repeated inside
    application authorization, not merely at protocol session creation.
    """

    def __init__(self, config: Settings, *, transport=None):
        validate_config(config)
        super().__init__(required_scopes=[READ_SCOPE])
        self.config = config
        self.transport = transport

    async def _verify(self, token, required_scope):
        config = self.config
        async with httpx.AsyncClient(
            transport=self.transport, timeout=5, follow_redirects=False
        ) as client:
            response = await client.get(config.mcp_jwks_uri)
            response.raise_for_status()
            decoded = jwt.decode(
                token, KeySet.import_key_set(response.json()), algorithms=["RS256"]
            )
            claims = decoded.claims
            not_before = claims.get("nbf")
            if (
                decoded.header.get("typ") != "at+jwt"
                or claims.get("iss") != config.mcp_issuer
                or not _audience(claims, config.mcp_resource_url)
                or not _expiry(claims)
                or not isinstance(claims.get("sub"), str)
                or not claims["sub"]
                or claims.get("email_verified") is not True
                or claims.get("email") not in config.mcp_allowed_emails
                or not {READ_SCOPE, required_scope}.issubset(_scopes(claims))
                or (
                    not_before is not None
                    and (
                        type(not_before) not in (int, float)
                        or not math.isfinite(not_before)
                        or not_before > time.time()
                    )
                )
            ):
                return None
            response = await client.post(
                config.mcp_introspection_url,
                data={"token": token, "token_type_hint": "access_token"},
                auth=(
                    config.mcp_introspection_client_id,
                    config.mcp_introspection_client_secret.get_secret_value(),
                ),
            )
            response.raise_for_status()
            active = response.json()
            if (
                not isinstance(active, dict)
                or active.get("active") is not True
                or active.get("iss") != claims["iss"]
                or active.get("sub") != claims["sub"]
                or not _audience(active, config.mcp_resource_url)
                or not _expiry(active)
                or not {READ_SCOPE, required_scope}.issubset(_scopes(active))
                or not _expiry(claims)
            ):
                return None
            return AccessToken(
                token=token,
                client_id=str(claims.get("client_id") or claims["sub"]),
                subject=claims["sub"],
                scopes=_scopes(claims),
                expires_at=int(claims["exp"]),
                resource=config.mcp_resource_url,
                claims={"iss": claims["iss"], "sub": claims["sub"]},
            )

    async def verify_token(self, token: str) -> AccessToken | None:
        try:
            return await self._verify(token, READ_SCOPE)
        except Exception:
            # Includes malformed JWKS/claims, JOSE failures and provider outages.
            # Never attach the original exception to a user-visible tool error.
            return None

    async def verify_identity(self, token: str, required_scope=READ_SCOPE):
        try:
            access = await self._verify(token, required_scope)
        except Exception:
            access = None
        if access is None:
            raise invalid_credential()
        return access.claims["iss"], access.subject


class APIKeyVerifier(TokenVerifier):
    """MCP v1: the owner's API key as a Bearer token, checked on every request.

    Resolution reads current revocation from the database, so a revoked key is
    denied on its next call. Browser sessions and OAuth tokens are not accepted.
    """

    def __init__(self, state):
        super().__init__()
        self.state = state

    async def verify_token(self, token: str) -> AccessToken | None:
        from accanto.db import async_session
        from accanto.services.access import resolve_actor

        sessions = getattr(self.state, "sessions", None) or async_session
        try:
            async with sessions() as session, session.begin():
                actor = await resolve_actor(session, token, "api_key")
        except Exception:
            # Unknown, revoked, malformed or unavailable: never echo the cause.
            return None
        return AccessToken(
            token=token,
            client_id=str(actor.credential_uuid),
            scopes=[],
            claims={},
        )
