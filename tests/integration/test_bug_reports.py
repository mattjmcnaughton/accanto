"""Report bug (TDD 21): only listed Users file and read their own reports."""

import asyncio
import os
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import insert, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from accanto.app import create_app
from accanto.config import Settings
from accanto.db import get_session
from accanto.models import monthly as m
from accanto.models.bug_reports import bug_reports
from accanto.services.api_keys import issue_key
from accanto.services.browser_auth import admit_identity, csrf_token

URL = os.environ.get("ACCANTO_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="Requires isolated Postgres")
ORIGIN = "https://accanto.example.test"
CONFLICT = {
    "method": "POST",
    "path": "/api/entities/:id/inbox/:id/record",
    "status": 409,
    "ms": 61,
    "code": "stale_revision",
}
CONTEXT = {
    "screen": "inbox",
    "month": "2026-11",
    "build": "24f7b73",
    "viewport": {"width": 1280, "height": 800, "pixel_ratio": 2},
    "theme": "light",
    "user_agent": "Mozilla/5.0 (X11; Linux x86_64) Chrome/142.0",
    "api": [
        {
            "method": "GET",
            "path": "/api/entities/:id/inbox",
            "status": 200,
            "ms": 84,
            "code": None,
        },
        CONFLICT,
        {
            "method": "GET",
            "path": "/api/auth/session",
            "status": None,
            "ms": 3,
            "code": "network_unavailable",
        },
    ],
    "errors": [{"name": "TypeError"}],
}


def test_bug_reports():
    asyncio.run(scenario())


async def scenario():
    assert URL and "test" in URL.rsplit("/", 1)[-1]
    engine = create_async_engine(URL)
    sessions = async_sessionmaker(engine)
    issuer = f"https://issuer.example.test/{uuid4().hex}"
    config = Settings(
        oidc_issuer=issuer,
        browser_origin=ORIGIN,
        browser_csrf_secret="synthetic-csrf-secret-at-least-32-characters",
        oidc_allowed_emails=[
            "listed@example.test",
            "unlisted@example.test",
            "newcomer@example.test",
        ],
        report_bug_emails=["listed@example.test", "newcomer@example.test"],
    )
    async with sessions() as db, db.begin():
        users = {}
        for subject in ("listed", "unlisted"):
            users[subject] = await db.scalar(
                insert(m.users)
                .values(issuer=issuer, subject=subject)
                .returning(m.users.c.id)
            )
        key = await issue_key(db, users["listed"], "synthetic")

    async def sign_in(subject, settings=config):
        claims = {
            "iss": issuer,
            "sub": subject,
            "email": f"{subject}@example.test",
            "email_verified": True,
        }
        async with sessions() as db:
            token = (await admit_identity(db, claims, settings))["token"]
        return {
            "Cookie": f"accanto_session={token}",
            "Origin": ORIGIN,
            "X-CSRF-Token": csrf_token(token, settings),
        }

    app = create_app()
    app.state.auth_settings = config

    async def session_dependency():
        async with sessions() as db:
            yield db

    app.dependency_overrides[get_session] = session_dependency
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url=ORIGIN
    ) as client:
        listed, unlisted = await sign_in("listed"), await sign_in("unlisted")
        session = await client.get("/api/auth/session", headers=listed)
        assert session.json()["report_bug"] is True
        session = await client.get("/api/auth/session", headers=unlisted)
        assert session.json()["report_bug"] is False
        # A listed person created on first sign-in has it from that session.
        newcomer = await sign_in("newcomer")
        session = await client.get("/api/auth/session", headers=newcomer)
        assert session.json()["report_bug"] is True

        # A listed User files reports; the list is theirs, newest first.
        filed = []
        for kind, note in (("bug", "Pairing missed a match"), ("idea", "Link it")):
            response = await client.post(
                "/api/bug-reports",
                json={"kind": kind, "note": note, "context": CONTEXT},
                headers=listed,
            )
            assert response.status_code == 200, response.text
            filed.append(response.json())
        assert filed[0]["status"] == "open" and filed[0]["context"] == CONTEXT
        reports = (await client.get("/api/bug-reports", headers=listed)).json()
        assert [r["note"] for r in reports] == ["Link it", "Pairing missed a match"]

        closed = await client.patch(
            f"/api/bug-reports/{filed[0]['id']}",
            json={"status": "done"},
            headers=listed,
        )
        assert closed.status_code == 200, closed.text
        assert closed.json()["status"] == "done" and closed.json()["resolved_at"]
        reopened = await client.patch(
            f"/api/bug-reports/{filed[0]['id']}",
            json={"status": "open"},
            headers=listed,
        )
        assert reopened.json()["resolved_at"] is None

        # The context is an allowlist: page text, a payee in a path, an error
        # message or an unknown field is refused, and nothing is stored.
        async with sessions() as db:
            before = len((await db.execute(select(bug_reports.c.id))).all())
        for context in (
            {**CONTEXT, "page_text": "Example Grocer $45.10"},
            {
                **CONTEXT,
                "api": [
                    {
                        "method": "GET",
                        "path": "/api/entities/:id/payees/Example Grocer",
                        "status": 200,
                        "ms": 5,
                        "code": None,
                    }
                ],
            },
            {**CONTEXT, "errors": [{"name": "TypeError", "message": "$45.10"}]},
            {**CONTEXT, "errors": [{"name": "Error: amount 45.10 is invalid"}]},
            {**CONTEXT, "api": [{**CONFLICT, "code": "Example Grocer"}]},
            {**CONTEXT, "build": "Example Grocer"},
        ):
            response = await client.post(
                "/api/bug-reports",
                json={"note": "Synthetic", "context": context},
                headers=listed,
            )
            assert response.status_code == 422, context
        async with sessions() as db:
            assert len((await db.execute(select(bug_reports.c.id))).all()) == before

        # Anyone else sees no such feature, and cannot reach a listed User's report.
        for method, path, body in (
            ("GET", "/api/bug-reports", None),
            ("POST", "/api/bug-reports", {"note": "Synthetic", "context": CONTEXT}),
            ("PATCH", f"/api/bug-reports/{filed[1]['id']}", {"status": "done"}),
        ):
            response = await client.request(method, path, json=body, headers=unlisted)
            assert response.status_code == 404, (method, path)
        # Browser only: the listed User's own API key is refused.
        response = await client.get(
            "/api/bug-reports", headers={"Authorization": f"Bearer {key['key']}"}
        )
        assert response.status_code == 403

        # Removal from the list takes effect at the next sign-in.
        removed = config.model_copy(update={"report_bug_emails": []})
        app.state.auth_settings = removed
        again = await sign_in("listed", removed)
        assert (await client.get("/api/auth/session", headers=again)).json()[
            "report_bug"
        ] is False
        assert (await client.get("/api/bug-reports", headers=again)).status_code == 404
    await engine.dispose()
