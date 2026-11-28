"""Notifications on real PostgreSQL (TDD 20): Devices, preferences, the tick step.

Every value is synthetic. The clock is passed in, so a day's ticks are run by
hand; the canary amount and note must never reach a push payload.
"""

import asyncio
import json
import os
from datetime import UTC, date, datetime
from uuid import uuid4

import httpx
import pytest
from pydantic import SecretStr
from sqlalchemy import func, insert, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from accanto.app import create_app
from accanto.config import settings
from accanto.db import get_session
from accanto.models import inbox as st
from accanto.models import monthly as m
from accanto.models import notifications as n
from accanto.models import schedules as sc
from accanto.services import notifications, schedules
from accanto.services.access import issue_session
from accanto.services.api_keys import issue_key
from accanto.services.browser_auth import csrf_token
from accanto.services.push import PushResult
from tests.unit.test_notifications import AUTH, PRIVATE, PUBLIC

URL = os.environ.get("ACCANTO_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="Requires isolated PostgreSQL")
ORIGIN = "https://accanto.example.test"
SATURDAY = date(2026, 11, 28)
CANARY_NOTE = "synthetic-canary-payee-notification"
CANARY_AMOUNT = "4321.98"


def at(hour: int) -> datetime:
    return datetime(SATURDAY.year, SATURDAY.month, SATURDAY.day, hour, tzinfo=UTC)


class Sender:
    """Records each payload; answers with a fixed result per endpoint."""

    def __init__(self):
        self.sent: list[tuple[str, dict]] = []
        self.results: dict[str, PushResult] = {}

    async def send(self, device, notice):
        self.sent.append((device["endpoint"], notice.payload(ORIGIN)))
        return self.results.get(device["endpoint"], PushResult.DELIVERED)


def test_notifications_end_to_end(monkeypatch):
    asyncio.run(scenario(monkeypatch))


async def scenario(monkeypatch):
    assert URL and URL.rsplit("/", 1)[-1].endswith("_test")
    engine = create_async_engine(URL)
    sessions = async_sessionmaker(engine)
    monkeypatch.setattr(schedules, "clock", lambda: at(3))
    async with sessions() as db, db.begin():
        user = await db.scalar(
            insert(m.users)
            .values(issuer="notification-test", subject=str(uuid4()))
            .returning(m.users.c.id)
        )
        entity, entity_id = (
            await db.execute(
                insert(m.entities)
                .values(owner_id=user, name="Synthetic notices", time_zone="UTC")
                .returning(m.entities.c.uuid, m.entities.c.id)
            )
        ).one()
        key = await issue_key(db, user, "Synthetic notification key")
        browser = await issue_session(db, user)
        other = await db.scalar(
            insert(m.users)
            .values(issuer="notification-test", subject=str(uuid4()))
            .returning(m.users.c.id)
        )
        other_browser = await issue_session(db, other)
        # A member of the Entity (TDD 19) is notified with the owner, separately.
        await db.execute(
            insert(m.members).values(
                entity_id=entity_id, user_id=other, name="Synthetic member"
            )
        )
    app = create_app()
    config = settings.model_copy(
        update={
            "browser_origin": ORIGIN,
            "browser_csrf_secret": SecretStr("synthetic-csrf-secret-32-characters!!"),
        }
    )
    app.state.auth_settings = config

    async def dependency():
        async with sessions() as session:
            yield session

    app.dependency_overrides[get_session] = dependency
    transport = httpx.ASGITransport(app=app)

    def browser_client(token):
        return httpx.AsyncClient(
            transport=transport,
            base_url=ORIGIN,
            cookies={"accanto_session": token},
            headers={"Origin": ORIGIN, "X-CSRF-Token": csrf_token(token, config)},
        )

    api = httpx.AsyncClient(
        transport=transport,
        base_url=ORIGIN,
        headers={"Authorization": f"Bearer {key['key']}"},
    )
    phone = "https://web.push.apple.com/synthetic-phone"
    laptop = "https://fcm.googleapis.com/fcm/send/synthetic-laptop"
    member = "https://updates.push.services.mozilla.com/synthetic-member"
    subscription = {"keys": {"p256dh": PUBLIC, "auth": AUTH}}
    async with browser_client(browser["token"]) as web, api:
        # Without a VAPID key push is off and every control hides.
        monkeypatch.setattr(settings, "vapid_private_key", SecretStr(""))
        assert (await web.get("/api/notifications/config")).status_code == 404
        monkeypatch.setattr(settings, "vapid_private_key", SecretStr(PRIVATE))
        config_response = await web.get("/api/notifications/config")
        assert config_response.json()["public_key"].startswith("BP4z9KsN")

        # Quiet defaults before anything is saved; API keys may change them.
        defaults = await api.get("/api/notifications/preferences")
        assert defaults.json() == {
            "hour": 9,
            "routines_due": True,
            "scheduled_entries": True,
            "transactions_waiting": False,
        }
        bad_hour = {**defaults.json(), "hour": 24}
        assert (
            await api.put("/api/notifications/preferences", json=bad_hour)
        ).status_code == 422

        # Devices: browser only, known push services only, upsert on endpoint.
        devices = "/api/notifications/devices"
        refused = await api.post(devices, json={"endpoint": phone, **subscription})
        assert refused.status_code == 403
        for endpoint in ("https://evil.example/push", "https://127.0.0.1/x"):
            bad = await web.post(devices, json={"endpoint": endpoint, **subscription})
            assert bad.status_code == 422
            assert bad.json()["detail"]["code"] == "push_endpoint_not_allowed"
        bad_keys = {"endpoint": phone, "keys": {"p256dh": "AAAA", "auth": AUTH}}
        assert (await web.post(devices, json=bad_keys)).status_code == 422
        first = await web.post(devices, json={"endpoint": phone, **subscription})
        again = await web.post(devices, json={"endpoint": phone, **subscription})
        assert first.json() == again.json()
        phone_id = first.json()["id"]
        laptop_id = (
            await web.post(devices, json={"endpoint": laptop, **subscription})
        ).json()["id"]
        async with browser_client(other_browser["token"]) as stranger:
            assert (await stranger.delete(f"{devices}/{phone_id}")).status_code == 404
            missing = await stranger.post(f"{devices}/{phone_id}/test")
            assert missing.status_code == 404
            joined = await stranger.post(
                devices, json={"endpoint": member, **subscription}
            )
            assert joined.status_code == 200, joined.text

        # A Routine due today, and an Entry schedule whose date is today.
        prefix = f"/api/entities/{entity}"
        headers = {"Idempotency-Key": str(uuid4())}
        routine = await api.post(
            f"{prefix}/routines",
            json={
                "name": "Synthetic Saturday check",
                "cadence": {"frequency": "weekly", "weekdays": ["sat"]},
                "starts_on": "2026-11-07",
                "steps": [{"title": "Synthetic step"}],
            },
            headers=headers,
        )
        assert routine.status_code == 200, routine.text
        later = await api.post(
            f"{prefix}/routines",
            json={
                "name": "Synthetic Sunday check",
                "cadence": {"frequency": "weekly", "weekdays": ["sun"]},
                "starts_on": "2026-11-08",
                "steps": [{"title": "Synthetic step"}],
            },
            headers={"Idempotency-Key": str(uuid4())},
        )
        assert later.status_code == 200, later.text
        schedule = await api.post(
            f"{prefix}/schedules",
            json={
                "name": "Synthetic weekly transfer",
                "cadence": {"frequency": "weekly", "interval": 1, "weekdays": ["sat"]},
                "starts_on": SATURDAY.isoformat(),
                "lines": [
                    {
                        "category": "spending",
                        "amount": CANARY_AMOUNT,
                        "note": CANARY_NOTE,
                    }
                ],
            },
            headers={"Idempotency-Key": str(uuid4())},
        )
        assert schedule.status_code == 200, schedule.text
        # stage_due covers every Entity in this shared database; count only this one's.
        assert (await schedules.stage_due(sessions))["staged"] >= 1
        async with sessions() as db:
            staged = await db.scalar(
                select(func.count())
                .select_from(sc.occurrences)
                .where(
                    sc.occurrences.c.entity_id == entity_id,
                    sc.occurrences.c.scheduled_on == SATURDAY,
                    sc.occurrences.c.status == "staged",
                )
            )
        assert staged == 1
        # A synced transaction still waiting, from a synthetic source.
        async with sessions() as db, db.begin():
            source = await db.scalar(
                insert(st.sources)
                .values(
                    entity_id=entity_id,
                    kind="ynab",
                    external_ref=str(uuid4()),
                    name="Synthetic budget",
                    start_date=date(2026, 11, 1),
                )
                .returning(st.sources.c.id)
            )
            await db.execute(
                insert(st.staged).values(
                    entity_id=entity_id,
                    source_id=source,
                    source_ref="synthetic-1",
                    financial_date=SATURDAY,
                    latest={"memo": CANARY_NOTE, "amount": CANARY_AMOUNT},
                )
            )

        sender = Sender()

        async def tick(hour):
            return await notifications.send_due(sessions, at(hour), sender)

        async def sends():
            async with sessions() as db:
                return await db.scalar(
                    select(func.count())
                    .select_from(n.sends)
                    .where(n.sends.c.entity_id == entity_id)
                )

        # Before the hour nothing is sent.
        assert (await tick(8))["notified"] == 0 and sender.sent == []
        # At or after it, each enabled kind once, to every Device.
        # Two kinds, for the owner and the member.
        assert (await tick(10)) == {"notified": 4, "delivered": 4, "not_delivered": 0}
        bodies = sorted({p["notification"]["body"] for _, p in sender.sent})
        assert bodies == [
            "1 scheduled entry is waiting in your inbox.",
            "Synthetic Saturday check is due today.",
        ]
        assert sorted(e for e, _ in sender.sent) == sorted([phone, laptop, member] * 2)
        assert {p["notification"]["navigate"] for _, p in sender.sent} == {
            ORIGIN + "/#/routines",
            ORIGIN + "/#/inbox",
        }
        # Later ticks the same day send nothing again.
        assert (await tick(11))["notified"] == 0 and await sends() == 4

        # Turning transactions on sends it once that day too; a gone Device
        # is forgotten.
        on = {**defaults.json(), "transactions_waiting": True}
        assert (await web.put("/api/notifications/preferences", json=on)).json() == on
        sender.sent.clear()
        sender.results[laptop] = PushResult.GONE
        assert (await tick(12))["notified"] == 1
        assert [p["notification"]["body"] for _, p in sender.sent] == [
            "1 transaction is waiting in your inbox.",
            "1 transaction is waiting in your inbox.",
        ]
        async with sessions() as db:
            left = list(
                await db.scalars(
                    select(n.devices.c.uuid).where(n.devices.c.user_id == user)
                )
            )
        assert [str(d) for d in left] == [phone_id]
        assert (await web.post(f"{devices}/{laptop_id}/test")).status_code == 404

        # Nothing financial reaches a payload.
        everything = json.dumps(sender.sent)
        assert CANARY_NOTE not in everything and CANARY_AMOUNT not in everything
        # Formatted forms of the amount; a bare "4321" can occur inside a random UUID.
        assert "4,321" not in everything and "4321." not in everything
        assert "Synthetic notices" not in everything

        # Signing out on the phone removes its Device.
        assert (await web.delete(f"{devices}/{phone_id}")).status_code == 204
        assert (await web.delete(f"{devices}/{phone_id}")).status_code == 404
    await engine.dispose()
