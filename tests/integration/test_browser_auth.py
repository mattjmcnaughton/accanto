"""Signed local OIDC protocol and browser authorization integration tests."""

import asyncio
import os
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, urlsplit
from uuid import uuid4
from zoneinfo import ZoneInfo

import httpx
import pytest
from sqlalchemy import func, insert, select, update
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from accanto.app import create_app
from accanto.config import Settings
from accanto.db import get_session
from accanto.models import monthly as m
from accanto.oidc import OIDCProvider
from accanto.services.access import RejectionError, resolve_actor
from accanto.services.api_keys import issue_key, manage_key
from accanto.services.browser_auth import digest
from tests.oidc_fixture import SyntheticOIDC

URL = os.environ.get("ACCANTO_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="Requires isolated Postgres")


def test_browser_auth_protocol():
    asyncio.run(scenario())


async def scenario():
    assert URL and "test" in URL.rsplit("/", 1)[-1]
    engine = create_async_engine(URL)
    sessions = async_sessionmaker(engine)
    provider = SyntheticOIDC()
    # Unique issuer isolates every fixture; local transport never uses a network.
    provider.issuer += "/" + uuid4().hex
    config = Settings(
        oidc_issuer=provider.issuer,
        oidc_client_id="synthetic-client",
        oidc_client_secret="synthetic-client-secret",
        browser_origin=provider.origin,
        browser_csrf_secret="synthetic-csrf-secret-at-least-32-characters",
        oidc_allowed_emails=["synthetic@example.test"],
    )
    async with sessions() as db, db.begin():
        user = (
            (
                await db.execute(
                    insert(m.users)
                    .values(issuer=provider.issuer, subject="synthetic-user")
                    .returning(m.users)
                )
            )
            .mappings()
            .one()
        )
        entity = (
            (
                await db.execute(
                    insert(m.entities)
                    .values(
                        owner_id=user["id"],
                        name="Synthetic Entity",
                        time_zone="Pacific/Kiritimati",
                    )
                    .returning(m.entities)
                )
            )
            .mappings()
            .one()
        )
        key = await issue_key(db, user["id"], "synthetic")
    app = create_app()
    app.state.auth_settings = config

    async def provider_request(request):
        # Strip unique issuer prefix while routing to the in-process fixture.
        url = request.url.copy_with(path="/" + request.url.path.split("/", 2)[-1])
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=provider.app)
        ) as client:
            return await client.request(
                request.method, url, content=request.content, headers=request.headers
            )

    app.state.oidc_provider = OIDCProvider(
        config, transport=httpx.MockTransport(provider_request)
    )

    async def session_dependency():
        async with sessions() as db:
            yield db

    app.dependency_overrides[get_session] = session_dependency
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url=provider.origin
    ) as browser:

        async def start():
            response = await browser.get("/api/auth/login")
            assert response.status_code == 302, response.text
            assert response.headers["cache-control"] == "no-store"
            assert "Secure" in response.headers["set-cookie"]
            auth = await provider_request(
                httpx.Request("GET", response.headers["location"])
            )
            return auth.headers["location"]

        async def sign_in(overrides=None):
            provider.claim_overrides = overrides or {}
            callback = await start()
            response = await browser.get(callback)
            return response, callback

        assert (await browser.get("/api/auth/session")).status_code == 401
        response, callback = await sign_in()
        assert response.status_code == 303, response.text
        async with sessions() as db:
            # The admitted, verified email is kept for adding members (TDD 19).
            assert (
                await db.scalar(
                    select(m.users.c.email).where(m.users.c.id == user["id"])
                )
                == "synthetic@example.test"
            )
        assert "HttpOnly" in response.headers["set-cookie"]
        assert "SameSite=lax" in response.headers["set-cookie"]
        assert "Max-Age=43200" in response.headers["set-cookie"]
        metadata = await browser.get("/api/auth/session")
        assert metadata.status_code == 200, metadata.text
        assert metadata.headers["cache-control"] == "no-store"
        account = metadata.json()
        assert account["user"]["id"] == str(user["uuid"])
        assert account["entities"] == [
            {
                "id": str(entity["uuid"]),
                "name": "Synthetic Entity",
                "time_zone": "Pacific/Kiritimati",
                "today": datetime.now(UTC)
                .astimezone(ZoneInfo("Pacific/Kiritimati"))
                .date()
                .isoformat(),
                "role": "owner",
            }
        ]
        headers = {
            "Origin": provider.origin,
            "X-CSRF-Token": account["csrf_token"],
            "Idempotency-Key": str(uuid4()),
        }
        body = {
            "name": "Synthetic Plan",
            "incomes": [{"name": "Synthetic", "amount": "0"}],
            "spending": "0",
        }
        path = f"/api/entities/{entity['uuid']}/plans"
        for forged in (
            {},
            {"Origin": "https://evil.test", "X-CSRF-Token": account["csrf_token"]},
            {"Origin": provider.origin, "X-CSRF-Token": "wrong"},
        ):
            response = await browser.post(
                path, json=body, headers={"Idempotency-Key": str(uuid4()), **forged}
            )
            assert response.status_code == 403
        malformed = await browser.post(
            path,
            json=body,
            headers={
                b"Origin": provider.origin.encode(),
                b"X-CSRF-Token": b"\xff",
                b"Idempotency-Key": uuid4().hex.encode(),
            },
        )
        assert malformed.status_code == 403
        saved = await browser.post(path, json=body, headers=headers)
        assert saved.status_code == 200, saved.text
        assert saved.headers["cache-control"] == "no-store"
        assert (
            await browser.post(path, json=body, headers=headers)
        ).json() == saved.json()
        assert (
            await browser.get(path, headers={"Authorization": f"Bearer {key['key']}"})
        ).status_code == 401
        # Service boundaries reject malformed actor kinds, not only HTTP inputs.
        async with sessions() as db, db.begin():
            actor = await resolve_actor(
                db, browser.cookies["accanto_session"], "session"
            )
            keys_before = await db.scalar(select(func.count()).select_from(m.keys))
        async with sessions() as db:
            with pytest.raises(RejectionError) as rejected:
                await manage_key(
                    db, replace(actor, credential_kind="invalid"), name="forged"
                )
            assert rejected.value.status == 401
            assert (
                await db.scalar(select(func.count()).select_from(m.keys)) == keys_before
            )
        assert (await browser.get(callback)).status_code == 401
        assert (await browser.post("/api/auth/logout")).status_code == 403
        assert (
            await browser.post("/api/auth/logout", headers=headers)
        ).status_code == 200
        assert (await browser.get("/api/auth/session")).status_code == 401
        # A direct key continues working without browser state/CSRF.
        assert (
            await browser.get(path, headers={"Authorization": f"Bearer {key['key']}"})
        ).status_code == 200

        for claims, status in [
            ({"nonce": "wrong"}, 401),
            ({"nonce": None}, 401),
            ({"nonce": "wrong", "nonce_supported": False}, 401),
            ({"iss": "https://other.test"}, 401),
            ({"aud": "other-client"}, 401),
            ({"exp": int(datetime.now(UTC).timestamp()) - 1}, 401),
            ({"email_verified": False}, 403),
            ({"email_verified": "true"}, 403),
            ({"email": "unadmitted@example.test"}, 403),
            ({"sub": "another-user"}, 403),
        ]:
            response, _ = await sign_in(claims)
            assert response.status_code == status, (claims, response.text)
            assert "accanto_session" not in browser.cookies

        # A login transaction expires independently of the provider's code/token.
        provider.claim_overrides = {}
        expired_callback = await start()
        state = parse_qs(urlsplit(expired_callback).query)["state"][0]
        async with sessions() as db, db.begin():
            await db.execute(
                update(m.login_transactions)
                .where(m.login_transactions.c.state_digest == digest(state))
                .values(expires_at=datetime.now(UTC) - timedelta(seconds=1))
            )
        before = provider.exchange_count
        assert (await browser.get(expired_callback)).status_code == 401
        assert provider.exchange_count == before

        # Single use survives concurrent callback requests with the same binding.
        provider.claim_overrides = {}
        concurrent_callback = await start()
        first, second = await asyncio.gather(
            browser.get(concurrent_callback), browser.get(concurrent_callback)
        )
        assert sorted([first.status_code, second.status_code]) == [303, 401]
        assert provider.exchange_count == before + 1
        browser.cookies.clear()

        # Browser binding and state are required before any code exchange.
        provider.claim_overrides = {}
        callback = await start()
        binding = browser.cookies.get("accanto_login")
        assert binding
        before = provider.exchange_count
        browser.cookies.clear()
        assert (await browser.get(callback)).status_code == 401
        browser.cookies.set("accanto_login", binding, domain="accanto.test", path="/")
        assert (
            await browser.get(callback.replace("state=", "state=wrong"))
        ).status_code == 401
        assert provider.exchange_count == before
        assert (await browser.get(callback)).status_code == 303
        async with sessions() as db, db.begin():
            await db.execute(
                update(m.sessions)
                .where(m.sessions.c.user_id == user["id"])
                .values(expires_at=datetime.now(UTC) - timedelta(seconds=1))
            )
        assert (await browser.get("/api/auth/session")).status_code == 401
        async with sessions() as db:
            assert (
                await db.scalar(
                    select(m.entities.c.uuid).where(m.entities.c.id == entity["id"])
                )
                == entity["uuid"]
            )
    await engine.dispose()
