"""Synthetic signed access tokens and introspection; never a hosted login server."""

import base64
import time

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from joserfc import jwt
from joserfc.jwk import RSAKey

from accanto.config import Settings


class SyntheticMCPProvider:
    issuer = "http://127.0.0.1:55424"
    resource = "http://127.0.0.1:55425/mcp"
    subject = "synthetic-mcp-user"
    email = "synthetic-mcp@example.test"

    def __init__(self):
        self.key = RSAKey.generate_key(2048, parameters={"kid": "synthetic-mcp"})
        self.active = True
        self.introspection_overrides = {}
        self.calls = 0
        self.tokens = {}
        self.config = Settings(
            _env_file=None,
            mcp_resource_url=self.resource,
            mcp_issuer=self.issuer,
            mcp_jwks_uri=self.issuer + "/jwks",
            mcp_introspection_url=self.issuer + "/introspect",
            mcp_introspection_client_id="synthetic-resource",
            mcp_introspection_client_secret="synthetic-resource-secret",
            mcp_allowed_emails=[self.email],
        )
        self.app = FastAPI()

        @self.app.get("/jwks")
        async def jwks():
            return {"keys": [self.key.as_dict(private=False)]}

        @self.app.post("/introspect")
        async def introspect(request: Request):
            expected = base64.b64encode(
                b"synthetic-resource:synthetic-resource-secret"
            ).decode()
            if request.headers.get("authorization") != "Basic " + expected:
                return JSONResponse({"error": "invalid_client"}, status_code=401)
            self.calls += 1
            form = await request.form()
            token = str(form.get("token", ""))
            return {
                **self.tokens.get(token, {}),
                "active": self.active and token in self.tokens,
                **self.introspection_overrides,
            }

    def token(self, **overrides):
        claims = {
            "iss": self.issuer,
            "sub": self.subject,
            "aud": self.resource,
            "exp": int(time.time()) + 300,
            "scope": "accanto:read accanto:review",
            "email": self.email,
            "email_verified": True,
            **overrides,
        }
        token = jwt.encode({"alg": "RS256", "typ": "at+jwt"}, claims, self.key)
        self.tokens[token] = claims
        return token
