"""Transactions inbox against real PostgreSQL and the fake YNAB server.

Every value is synthetic. Covers the TDD's rule-to-verification table: staging is
not recording, proposals never write entries, recording goes through the normal
entry/refund commands, failures change nothing, and retries do not duplicate.
"""

import asyncio
import os
from uuid import uuid4

import httpx
import pytest
from cryptography.fernet import Fernet
from pydantic import SecretStr
from sqlalchemy import func, insert, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from accanto.app import create_app
from accanto.config import settings
from accanto.db import get_session
from accanto.models import inbox as st
from accanto.models import monthly as m
from accanto.services.access import issue_session
from accanto.services.api_keys import issue_key
from accanto.services.browser_auth import csrf_token
from tests.fakes import ynab_server as y

URL = os.environ.get("ACCANTO_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not URL, reason="Use an isolated migrated test database"
)

TRANSACTIONS = [
    y.transaction("t-repair", "2026-11-06", -640000, "Sample Plumbing Co", "Rent"),
    y.transaction("t-shirt", "2026-11-03", -90000, "Example Outfitters", "Clothing"),
    y.transaction("t-return1", "2026-11-09", 48000, "Example Outfitters", "Clothing"),
    y.transaction("t-return2", "2026-11-10", 48000, "Example Outfitters", "Clothing"),
    y.transaction("t-coffee", "2026-11-04", -6500, "Example Coffee Cart", "Dining Out"),
    y.transaction("t-gift", "2026-11-12", -30000, "Fixture Food Bank", "Charity"),
    # Selected out: a card account is not imported in this scenario.
    y.transaction("t-card", "2026-11-05", -10000, "Mock Air", "Vacation", acct=y.CARD),
]


def test_transactions_inbox_end_to_end():
    asyncio.run(scenario())


async def scenario():
    assert URL and URL.rsplit("/", 1)[-1].endswith("_test")
    engine = create_async_engine(URL)
    sessions = async_sessionmaker(engine)
    async with sessions() as session, session.begin():
        user = await session.scalar(
            insert(m.users)
            .values(issuer="inbox-test", subject=str(uuid4()))
            .returning(m.users.c.id)
        )
        entity_row = await session.execute(
            insert(m.entities)
            .values(owner_id=user, name="Synthetic inbox Entity", time_zone="UTC")
            .returning(m.entities.c.uuid, m.entities.c.id)
        )
        entity, entity_id = entity_row.one()
        key = await issue_key(session, user, "Synthetic inbox test")
        # Source setup needs a browser session; API keys cannot reach it (TDD 03).
        browser = await issue_session(session, user)

    fake = y.FakeYnab(transactions=TRANSACTIONS)
    app = create_app()
    app.state.auth_settings = settings.model_copy(
        update={
            "source_secret_key": SecretStr(Fernet.generate_key().decode()),
            "ynab_api_url": "http://fake-ynab/v1",
            "browser_origin": "http://test",
            "browser_csrf_secret": SecretStr("synthetic-inbox-csrf-secret-long-enough"),
        }
    )
    app.state.ynab_transport = httpx.ASGITransport(app=fake.app)

    async def dependency():
        async with sessions() as session:
            yield session

    app.dependency_overrides[get_session] = dependency
    prefix = f"/api/entities/{entity}"

    async def count(table, *where):
        async with sessions() as session:
            return await session.scalar(
                select(func.count()).select_from(table).where(*where)
            )

    async def entries():
        return await count(
            m.entries,
            m.entries.c.entity_id == entity_id,
            m.entries.c.deleted_at.is_(None),
        )

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
        headers={"Authorization": f"Bearer {key['key']}"},
    ) as client:

        async def command(method, suffix, body, *, request_key=None):
            return await client.request(
                method,
                prefix + suffix,
                json=body,
                headers={"Idempotency-Key": request_key or str(uuid4())},
            )

        async def setup(method, suffix, body=None):
            """Source setup as the signed-in owner (cookie + CSRF, no API key)."""
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app),
                base_url="http://test",
                cookies={"accanto_session": browser["token"]},
            ) as owner:
                return await owner.request(
                    method,
                    prefix + suffix,
                    json=body,
                    headers={
                        "Idempotency-Key": str(uuid4()),
                        "Origin": "http://test",
                        "X-CSRF-Token": csrf_token(
                            browser["token"], app.state.auth_settings
                        ),
                    },
                )

        async def item(ref):
            rows = (
                await client.get(
                    prefix + "/inbox",
                    params={
                        "status": [
                            "waiting",
                            "skipped",
                            "recorded",
                            "conflict",
                            "removed",
                        ]
                    },
                )
            ).json()
            return next(r for r in rows if r["source_ref"] == ref)

        # Setup: a goal with $180 saved, and a Review for November.
        account = await command(
            "POST",
            "/savings-accounts",
            {
                "name": "Synthetic reserve",
                "opening_date": "2026-10-01",
                "opening_amount": "180.00",
                "goals": [
                    {
                        "name": "Home repair",
                        "kind": "ongoing",
                        "opening_amount": "180.00",
                    }
                ],
            },
        )
        assert account.status_code == 200, account.text
        goal = next(g for g in account.json()["goals"] if g["name"] == "Home repair")
        plan = await command(
            "POST",
            "/plans",
            {
                "name": "Synthetic inbox Plan",
                "incomes": [{"name": "Synthetic pay", "amount": "2000.00"}],
                "spending": "1000.00",
            },
        )
        saved = await command(
            "POST",
            f"/plans/{plan.json()['plan_id']}/versions",
            {"expected_revision": 1},
        )
        review = await command(
            "POST",
            "/reviews",
            {"month": "2026-11-01", "version_id": saved.json()["version"]["uuid"]},
        )
        assert review.status_code == 200, review.text

        # The token lives in Settings; sources cannot be set up before it.
        missing = await setup("GET", "/sources/ynab/plans")
        assert missing.status_code == 409
        assert missing.json()["detail"]["code"] == "provider_not_configured"
        keyed = await command(
            "PUT",
            "/transaction-provider",
            {"kind": "ynab", "access_token": y.FAKE_TOKEN, "expected_revision": 0},
        )
        assert keyed.status_code == 403
        wrong = await setup(
            "PUT",
            "/transaction-provider",
            {
                "kind": "ynab",
                "access_token": "synthetic-wrong-token",
                "expected_revision": 0,
            },
        )
        assert wrong.json()["detail"]["code"] == "source_unauthorized"
        assert (await setup("GET", "/transaction-provider")).json() == {
            "kind": None,
            "configured": False,
            "revision": 0,
        }
        saved = await setup(
            "PUT",
            "/transaction-provider",
            {"kind": "ynab", "access_token": y.FAKE_TOKEN, "expected_revision": 0},
        )
        assert saved.status_code == 200, saved.text
        assert saved.json() == {"kind": "ynab", "configured": True, "revision": 1}
        assert y.FAKE_TOKEN not in (await setup("GET", "/transaction-provider")).text
        async with sessions() as session:
            stored = await session.scalar(
                select(st.providers.c.secret_ciphertext).where(
                    st.providers.c.entity_id == entity_id
                )
            )
        assert stored and y.FAKE_TOKEN not in stored
        plans = await setup("GET", "/sources/ynab/plans")
        assert {p["id"] for p in plans.json()} >= {y.PLAN, y.EURO_PLAN}

        # Connect: only a USD plan the saved token can read.
        keyed = await command(
            "POST", "/sources/ynab", {"plan_id": y.PLAN, "start_date": "2026-11-01"}
        )
        assert keyed.status_code == 403
        euro = await setup(
            "POST",
            "/sources/ynab",
            {"plan_id": y.EURO_PLAN, "start_date": "2026-11-01"},
        )
        assert euro.status_code == 422
        assert euro.json()["detail"]["code"] == "unsupported_currency"
        connected = await setup(
            "POST",
            "/sources/ynab",
            {"plan_id": y.PLAN, "start_date": "2026-11-01"},
        )
        assert connected.status_code == 200, connected.text
        source = connected.json()
        sync_path = f"/sources/{source['id']}/sync"
        unselected = await client.post(prefix + sync_path)
        assert unselected.status_code == 422
        accounts = (await setup("GET", f"/sources/{source['id']}/accounts")).json()
        assert {a["id"] for a in accounts} == {
            y.CHECKING,
            y.CARD,
            y.SAVINGS,
            y.BROKERAGE,
        }
        selected = await setup(
            "PUT",
            f"/sources/{source['id']}/accounts",
            {"expected_revision": source["revision"], "account_ids": [y.CHECKING]},
        )
        assert selected.status_code == 200, selected.text

        # Failures change nothing: a YNAB 5xx leaves cursor and inbox unchanged.
        fake.failure = 500
        failed = await client.post(prefix + sync_path)
        fake.failure = None
        assert failed.status_code == 502
        assert failed.json()["detail"]["code"] == "source_unavailable"
        assert (await client.get(prefix + "/inbox")).json() == []
        assert not (await client.get(prefix + "/sources")).json()[0]["synced"]

        synced = await client.post(prefix + sync_path)
        assert synced.status_code == 200, synced.text
        assert synced.json()["counts"]["added"] == 6
        assert synced.json()["counts"]["ignored"] == 1
        detail = (await client.get(prefix + "/reviews/2026-11-01")).json()
        assert detail["inbox_waiting"] == 6
        assert detail["actual"]["spending_recorded"] is None
        again = await client.post(prefix + sync_path)
        assert again.json()["counts"]["added"] == 0
        assert again.json()["counts"]["unchanged"] == 0  # delta returned nothing

        # Proposals for every item create no entries; dry runs store rejections.
        # Guilt-free spending's assignment is a Spending subcategory (TDD 07).
        clothing = (
            await command("POST", "/spending-subcategories", {"name": "Clothing"})
        ).json()
        refs = {
            r: await item(r)
            for r in ("t-repair", "t-shirt", "t-return1", "t-return2", "t-coffee")
        }
        proposals = await command(
            "PUT",
            "/inbox/proposals",
            {
                "proposals": [
                    {
                        "item_id": refs["t-repair"]["id"],
                        "expected_revision": refs["t-repair"]["revision"],
                        "category": "spending",
                        "funding": goal["uuid"],
                        "rationale": "Home repair payee",
                    },
                    {
                        "item_id": refs["t-shirt"]["id"],
                        "expected_revision": refs["t-shirt"]["revision"],
                        "category": "spending",
                        "assignment": clothing["uuid"],
                        "rationale": "Clothing is guilt-free",
                    },
                    {
                        "item_id": refs["t-coffee"]["id"],
                        "expected_revision": refs["t-coffee"]["revision"],
                        "category": "saving",
                        "rationale": "Deliberately incomplete",
                    },
                    {
                        "item_id": refs["t-return2"]["id"],
                        "expected_revision": 99,
                        "skip": True,
                    },
                ]
            },
        )
        assert proposals.status_code == 200, proposals.text
        results = {r["item_id"]: r for r in proposals.json()["results"]}
        repair = results[refs["t-repair"]["id"]]["item"]
        assert repair["proposal"]["rationale"] == "Home repair payee"
        assert repair["proposal_rejection"] is not None  # $640 from $180 saved
        assert results[refs["t-shirt"]["id"]]["item"]["proposal_rejection"] is None
        coffee = results[refs["t-coffee"]["id"]]["item"]
        assert coffee["proposal_rejection"]["code"] == "needs_choice"
        assert results[refs["t-return2"]["id"]]["error"]["code"] == "stale_revision"
        assert await entries() == 0
        detail = (await client.get(prefix + "/reviews/2026-11-01")).json()
        assert detail["inbox_waiting"] == 6
        assert detail["actual"]["spending_recorded"] is None

        # Recording runs the real savings check under the Entity lock.
        rejected = await client.post(
            prefix + f"/inbox/{repair['id']}/record",
            json={"expected_revision": repair["revision"]},
        )
        assert rejected.status_code in {409, 422}, rejected.text
        repair = await item("t-repair")
        assert repair["status"] == "waiting"
        assert repair["rejection"]["code"] == rejected.json()["detail"]["code"]
        assert await entries() == 0
        recorded = await client.post(
            prefix + f"/inbox/{repair['id']}/record",
            json={
                "expected_revision": repair["revision"],
                "completion": {"category": "spending", "funding": "income"},
            },
        )
        assert recorded.status_code == 200, recorded.text
        assert recorded.json()["entry"]["amount"] == "640.00"
        assert recorded.json()["entry"]["funding_origin"] == "income"
        assert recorded.json()["item"]["status"] == "recorded"

        # A refund links to its purchase; the cap rejects a second $48.
        shirt = await item("t-shirt")
        purchase = await client.post(
            prefix + f"/inbox/{shirt['id']}/record",
            json={"expected_revision": shirt["revision"]},
        )
        assert purchase.status_code == 200, purchase.text
        purchase_id = purchase.json()["entry"]["uuid"]
        assert purchase.json()["entry"]["spending_subcategory_id"] == clothing["uuid"]
        first = await item("t-return1")
        spending_inflow = await client.post(
            prefix + f"/inbox/{first['id']}/record",
            json={
                "expected_revision": first["revision"],
                "completion": {"category": "spending"},
            },
        )
        assert spending_inflow.json()["detail"]["code"] == "needs_refund_link"
        refund = await client.post(
            prefix + f"/inbox/{first['id']}/record",
            json={
                "expected_revision": first["revision"],
                "completion": {"refund_of": purchase_id},
            },
        )
        assert refund.status_code == 200, refund.text
        assert refund.json()["entry"]["remaining_refundable"] == "42.00"
        assert refund.json()["entry"]["spending_subcategory_name"] == "Clothing"
        second = await item("t-return2")
        capped = await client.post(
            prefix + f"/inbox/{second['id']}/record",
            json={
                "expected_revision": second["revision"],
                "completion": {"refund_of": purchase_id},
            },
        )
        assert capped.status_code == 422
        assert capped.json()["detail"]["code"] == "invalid_refund"
        assert (await item("t-return2"))["rejection"]["code"] == "invalid_refund"

        # Contributions record through their own command; the proposal dry run too.
        recipient = await command(
            "POST", "/giving-recipients", {"name": "Fixture food bank", "target": None}
        )
        gift = await item("t-gift")
        gift_proposal = await command(
            "PUT",
            f"/inbox/{gift['id']}/proposal",
            {
                "expected_revision": gift["revision"],
                "category": "giving",
                "assignment": recipient.json()["uuid"],
                "rationale": "Synthetic: donations go to the food bank",
            },
        )
        assert gift_proposal.status_code == 200, gift_proposal.text
        assert gift_proposal.json()["proposal_rejection"] is None
        donated = await client.post(
            prefix + f"/inbox/{gift['id']}/record",
            json={"expected_revision": gift_proposal.json()["revision"]},
        )
        assert donated.status_code == 200, donated.text
        assert donated.json()["entry"]["category"] == "giving"
        assert (
            donated.json()["entry"]["giving_recipient_id"] == recipient.json()["uuid"]
        )

        # Skip and return to waiting.
        second = await item("t-return2")
        skipped = await command(
            "POST",
            f"/inbox/{second['id']}/skip",
            {"expected_revision": second["revision"]},
        )
        assert skipped.json()["status"] == "skipped"
        unskipped = await command(
            "POST",
            f"/inbox/{second['id']}/unskip",
            {"expected_revision": skipped.json()["revision"]},
        )
        assert unskipped.json()["status"] == "waiting"

        # Retries don't duplicate: Enter twice records one entry and one audit.
        coffee = await item("t-coffee")
        body = {
            "expected_revision": coffee["revision"],
            "completion": {"category": "spending"},
        }
        before_entries = await entries()
        first_press = await client.post(
            prefix + f"/inbox/{coffee['id']}/record", json=body
        )
        audits = await count(m.audit, m.audit.c.entity_id == entity_id)
        second_press = await client.post(
            prefix + f"/inbox/{coffee['id']}/record", json=body
        )
        assert first_press.status_code == second_press.status_code == 200
        assert first_press.json() == second_press.json()
        assert await entries() == before_entries + 1
        assert await count(m.audit, m.audit.c.entity_id == entity_id) == audits
        entry_audit = await count(
            m.audit,
            m.audit.c.record_type == "actual_entry",
            m.audit.c.interface == "inbox",
            m.audit.c.action == "create_entry",
            m.audit.c.record_uuid == first_press.json()["entry"]["uuid"],
        )
        assert entry_audit == 1

        # Undo soft-deletes through the normal delete command.
        coffee = await item("t-coffee")
        undone = await command(
            "POST",
            f"/inbox/{coffee['id']}/undo",
            {"expected_revision": coffee["revision"]},
        )
        assert undone.status_code == 200, undone.text
        assert undone.json()["item"]["status"] == "waiting"
        assert undone.json()["entry"]["deleted_at"] is not None
        assert await entries() == before_entries

        detail = (await client.get(prefix + "/reviews/2026-11-01")).json()
        assert detail["actual"]["spending_recorded"] == "682.00"  # 640 + 90 - 48
        assert detail["inbox_waiting"] == 2

        # F7 default: a deletion after recording flags a conflict, never edits.
        fake.delete("t-repair")
        fake.delete("t-return2")
        changes = await client.post(prefix + sync_path)
        assert changes.json()["counts"]["conflicts"] == 1
        assert changes.json()["counts"]["removed"] == 1
        repair = await item("t-repair")
        assert repair["status"] == "conflict"
        assert (await item("t-return2"))["status"] == "removed"
        assert await entries() == before_entries
        kept = await command(
            "POST",
            f"/inbox/{repair['id']}/resolve",
            {"expected_revision": repair["revision"], "resolution": "keep"},
        )
        assert kept.status_code == 200, kept.text
        assert kept.json()["status"] == "recorded"
        assert (await client.get(prefix + "/reviews/2026-11-01")).json()[
            "inbox_waiting"
        ] == 1

        # Removing the Settings token stops syncing; the source stays connected.
        removed = await setup(
            "DELETE", "/transaction-provider", {"expected_revision": 1}
        )
        assert removed.json() == {"kind": None, "configured": False, "revision": 2}
        orphaned = await client.post(prefix + sync_path)
        assert orphaned.json()["detail"]["code"] == "provider_not_configured"
        assert (await client.get(prefix + "/sources")).json()[0]["connected"]
    await engine.dispose()
