"""F6: sync stages a transaction only once its source reports it cleared.

Real PostgreSQL and the fake YNAB delta, every value synthetic. A later delta
must stage a transaction when it clears, a cancelled hold must never appear, and
a recorded item keeps F7's flag-only behavior whatever its cleared status.
"""

import asyncio
import os
from uuid import uuid4

import httpx
import pytest
from cryptography.fernet import Fernet
from pydantic import SecretStr
from sqlalchemy import insert
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from accanto.app import create_app
from accanto.config import settings
from accanto.db import get_session
from accanto.models import monthly as m
from accanto.services.access import issue_session
from accanto.services.api_keys import issue_key
from accanto.services.browser_auth import csrf_token
from tests.fakes import ynab_server as y

URL = os.environ.get("ACCANTO_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not URL, reason="Use an isolated migrated test database"
)
ALL = ["waiting", "skipped", "recorded", "conflict", "removed"]


def test_uncleared_transactions_wait_only_once_cleared():
    asyncio.run(scenario())


async def scenario():
    assert URL and URL.rsplit("/", 1)[-1].endswith("_test")
    engine = create_async_engine(URL)
    sessions = async_sessionmaker(engine)
    async with sessions() as session, session.begin():
        user = await session.scalar(
            insert(m.users)
            .values(issuer="uncleared-test", subject=str(uuid4()))
            .returning(m.users.c.id)
        )
        entity = await session.scalar(
            insert(m.entities)
            .values(owner_id=user, name="Synthetic uncleared Entity", time_zone="UTC")
            .returning(m.entities.c.uuid)
        )
        key = await issue_key(session, user, "Synthetic uncleared test")
        browser = await issue_session(session, user)

    fake = y.FakeYnab(
        transactions=[
            y.transaction(
                "t-posted", "2026-11-03", -25000, "Example Grocer", "Groceries"
            ),
            # A hold the bank later cancels, and a tab that posts with a tip.
            y.transaction(
                "t-hold",
                "2026-11-04",
                -10000,
                "Sample Fuel",
                "Groceries",
                cleared="uncleared",
                approved=False,
            ),
            y.transaction(
                "t-tab",
                "2026-11-05",
                -40000,
                "Demo Taqueria",
                "Dining Out",
                cleared="uncleared",
                approved=False,
            ),
        ]
    )
    app = create_app()
    app.state.auth_settings = settings.model_copy(
        update={
            "source_secret_key": SecretStr(Fernet.generate_key().decode()),
            "ynab_api_url": "http://fake-ynab/v1",
            "browser_origin": "http://test",
            "browser_csrf_secret": SecretStr("synthetic-uncleared-csrf-secret-long"),
        }
    )
    app.state.ynab_transport = httpx.ASGITransport(app=fake.app)

    async def dependency():
        async with sessions() as session:
            yield session

    app.dependency_overrides[get_session] = dependency
    prefix = f"/api/entities/{entity}"
    transport = httpx.ASGITransport(app=app)
    async with (
        httpx.AsyncClient(
            transport=transport,
            base_url="http://test",
            headers={"Authorization": f"Bearer {key['key']}"},
        ) as client,
        httpx.AsyncClient(
            transport=transport,
            base_url="http://test",
            cookies={"accanto_session": browser["token"]},
            headers={
                "Origin": "http://test",
                "X-CSRF-Token": csrf_token(browser["token"], app.state.auth_settings),
            },
        ) as owner,
    ):

        async def call(who, method, suffix, body=None):
            response = await who.request(
                method,
                prefix + suffix,
                json=body,
                headers={"Idempotency-Key": str(uuid4())},
            )
            return response

        async def ok(who, method, suffix, body=None):
            response = await call(who, method, suffix, body)
            assert response.status_code == 200, response.text
            return response.json()

        async def items(status=None):
            params = {"status": status} if status else None
            rows = (await client.get(prefix + "/inbox", params=params)).json()
            return {r["source_ref"]: r for r in rows}

        async def sync():
            return (await ok(client, "POST", f"/sources/{source['id']}/sync"))["counts"]

        token = {"kind": "ynab", "access_token": y.FAKE_TOKEN, "expected_revision": 0}
        await ok(owner, "PUT", "/transaction-provider", token)
        source = await ok(
            owner,
            "POST",
            "/sources/ynab",
            {"plan_id": y.PLAN, "start_date": "2026-11-01"},
        )
        await ok(
            owner,
            "PUT",
            f"/sources/{source['id']}/accounts",
            {"expected_revision": source["revision"], "account_ids": [y.CHECKING]},
        )

        # First sync: only the cleared transaction is staged; nothing is kept
        # for the two pending ones, in any status.
        counts = await sync()
        assert (counts["added"], counts["uncleared"]) == (1, 2)
        assert set(await items(ALL)) == {"t-posted"}
        assert (await client.get(prefix + "/sources")).json()[0]["waiting"] == 1
        assert (await ok(client, "GET", "/inbox/proposal-run"))["waiting"] == 1

        # The hold is cancelled and the tab posts with a tip. The next delta holds
        # only these two changes; the tab arrives as new at its posted amount and
        # the cancelled hold never appears.
        fake.delete("t-hold")
        fake.change("t-tab", amount=-48000, cleared="cleared", approved=True)
        counts = await sync()
        assert (counts["added"], counts["uncleared"], counts["removed"]) == (1, 0, 0)
        staged = await items(ALL)
        assert set(staged) == {"t-posted", "t-tab"}
        assert staged["t-tab"]["status"] == "waiting"
        assert staged["t-tab"]["amount"] == "-48.00"
        assert staged["t-tab"]["changed_after_staging"] is False

        # A recorded item keeps F7 whatever its cleared status: a change flags it.
        tab = staged["t-tab"]
        await ok(
            client,
            "POST",
            f"/inbox/{tab['id']}/record",
            {
                "expected_revision": tab["revision"],
                "completion": {"category": "spending", "funding": "income"},
            },
        )
        fake.change("t-tab", amount=-52000, cleared="uncleared")
        assert (await sync())["conflicts"] == 1
        assert (await items(["conflict"]))["t-tab"]["amount"] == "-52.00"
    await engine.dispose()
