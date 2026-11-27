"""Spending alerts on real PostgreSQL (TDD 23): rules, progress, pushes, tools.

Every value is synthetic. The clock is passed in, so November 2026's ticks run
by hand; the canary note and amounts must never reach a push payload.
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
from accanto.models import monthly as m
from accanto.models import notifications as n
from accanto.models import spending_alerts as sa
from accanto.services import agent_settings, notifications
from accanto.services import spending_alerts as service
from accanto.services.access import resolve_actor
from accanto.services.api_keys import issue_key
from accanto.services.push import PushResult
from accanto.services.tools import TOOLS, ToolContext
from tests.integration.read_cost import counted_get
from tests.unit.test_notifications import AUTH, PRIVATE, PUBLIC

URL = os.environ.get("ACCANTO_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="Requires isolated PostgreSQL")
DAY = date(2026, 11, 20)
CANARY = "synthetic-canary-payee-alert"


def at(hour: int, day: date = DAY) -> datetime:
    return datetime(day.year, day.month, day.day, hour, tzinfo=UTC)


class Sender:
    def __init__(self):
        self.sent: list[dict] = []

    async def send(self, device, notice):
        self.sent.append(notice.payload("https://accanto.example.test"))
        return PushResult.DELIVERED


def test_spending_alerts_end_to_end(monkeypatch):
    asyncio.run(scenario(monkeypatch))


async def scenario(monkeypatch):
    assert URL and URL.rsplit("/", 1)[-1].endswith("_test")
    monkeypatch.setattr(service, "clock", lambda: at(12))
    monkeypatch.setattr(settings, "vapid_private_key", SecretStr(PRIVATE))
    engine = create_async_engine(URL)
    sessions = async_sessionmaker(engine)
    async with sessions() as db, db.begin():
        user = await db.scalar(
            insert(m.users)
            .values(issuer="spending-alert-test", subject=str(uuid4()))
            .returning(m.users.c.id)
        )
        entity, other = [
            await db.scalar(
                insert(m.entities)
                .values(owner_id=user, name=f"Synthetic alerts {i}", time_zone="UTC")
                .returning(m.entities.c.uuid)
            )
            for i in (1, 2)
        ]
        key = await issue_key(db, user, "Synthetic alert key")
        await db.execute(
            insert(n.devices).values(
                user_id=user,
                endpoint=f"https://web.push.apple.com/{uuid4()}",
                p256dh=PUBLIC,
                auth=AUTH,
            )
        )
        actor = await resolve_actor(db, key["key"], "api_key")
    app = create_app()

    async def dependency():
        async with sessions() as session:
            yield session

    app.dependency_overrides[get_session] = dependency
    prefix = f"/api/entities/{entity}"
    sender = Sender()

    async def tick(hour):
        before = len(sender.sent)
        await notifications.send_due(sessions, now=at(hour), sender=sender)
        # Earlier runs' Users stay in the test database; keep this Entity's.
        return [
            p["notification"]["body"]
            for p in sender.sent[before:]
            if str(entity) in p["notification"]["tag"]
        ]

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
        headers={"Authorization": f"Bearer {key['key']}"},
    ) as client:

        async def send(method, suffix, body=None, base=prefix):
            return await client.request(
                method,
                base + suffix,
                json=body,
                headers={"Idempotency-Key": str(uuid4())},
            )

        async def ok(method, suffix, body=None, base=prefix):
            response = await send(method, suffix, body, base)
            assert response.status_code == 200, response.text
            return response.json()

        async def code(method, suffix, body=None, base=prefix):
            response = await send(method, suffix, body, base)
            assert response.status_code in {404, 409, 422}, response.text
            detail = response.json()["detail"]
            return detail["code"] if isinstance(detail, dict) else "invalid"

        async def alerts():
            listed = await ok("GET", "/spending-alerts")
            return listed, {a["name"]: a for a in listed["spending_alerts"]}

        eating = await ok("POST", "/spending-subcategories", {"name": "Eating out"})
        books = await ok("POST", "/spending-subcategories", {"name": "Books"})
        foreign = await ok(
            "POST",
            "/spending-subcategories",
            {"name": "Elsewhere"},
            base=f"/api/entities/{other}",
        )

        # Without a saved Plan version a rule saves and waits.
        guilt = await ok(
            "POST", "/spending-alerts", {"category": "spending", "thresholds": [90, 70]}
        )
        assert (
            guilt["thresholds"] == [70, 90] and guilt["name"] == "Guilt-free spending"
        )
        listed, by_name = await alerts()
        assert listed["version"] is None and listed["month"] == "2026-11"
        assert by_name["Guilt-free spending"]["waiting"] == "no_plan_version"

        plan = await ok(
            "POST",
            "/plans",
            {
                "name": "Synthetic Everyday",
                "incomes": [{"name": "Synthetic salary", "amount": "5000.00"}],
                "spending": "1200.00",
                "fixed_costs": [
                    {"name": "Internet", "amount": "65.00", "frequency": "monthly"}
                ],
            },
        )
        draft = plan["draft"]
        version = (
            await ok(
                "PUT",
                f"/plans/{plan['plan_id']}/draft",
                {
                    "name": "Synthetic Everyday",
                    "incomes": [
                        {
                            "name": "Synthetic salary",
                            "amount": "5000.00",
                            "source_id": draft["incomes"][0]["source_id"],
                        }
                    ],
                    "spending": "1200.00",
                    "fixed_costs": [
                        {
                            "fixed_cost_id": draft["fixed_costs"][0]["fixed_cost_id"],
                            "name": "Internet",
                            "amount": "65.00",
                            "frequency": "monthly",
                        }
                    ],
                    "spending_estimates": [
                        {"spending_subcategory_id": eating["uuid"], "amount": "150.00"}
                    ],
                    "expected_revision": draft["revision"],
                },
            )
        )["draft"]
        saved = await ok(
            "POST",
            f"/plans/{plan['plan_id']}/versions",
            {"expected_revision": version["revision"]},
        )
        internet = saved["version"]["fixed_costs"][0]["fixed_cost_id"]

        # One rule per target; targets stay in their category and Entity.
        await ok(
            "POST",
            "/spending-alerts",
            {
                "category": "spending",
                "spending_subcategory_id": eating["uuid"],
                "thresholds": [70, 100, 125],
            },
        )
        await ok(
            "POST",
            "/spending-alerts",
            {
                "category": "spending",
                "spending_subcategory_id": books["uuid"],
                "thresholds": [70],
            },
        )
        await ok(
            "POST",
            "/spending-alerts",
            {"category": "fixed_cost", "fixed_cost_id": internet, "thresholds": [100]},
        )
        assert (
            await code(
                "POST", "/spending-alerts", {"category": "spending", "thresholds": [50]}
            )
            == "spending_alert_exists"
        )
        for bad in (
            {
                "category": "fixed_cost",
                "spending_subcategory_id": eating["uuid"],
                "thresholds": [70],
            },
            {"category": "spending", "thresholds": [1000]},
            {"category": "spending", "thresholds": []},
        ):
            assert await code("POST", "/spending-alerts", bad) == "invalid"
        assert (
            await code(
                "POST",
                "/spending-alerts",
                {
                    "category": "spending",
                    "spending_subcategory_id": foreign["uuid"],
                    "thresholds": [70],
                },
            )
            == "record_not_found"
        )

        # $104.99 of the $150 estimate is 69.99%: below 70. A cent more reaches it.
        async def spend(amount, subcategory=None, day="2026-11-10", **extra):
            return await ok(
                "POST",
                "/activity",
                {
                    "date": day,
                    "category": extra.pop("category", "spending"),
                    "amount": amount,
                    "note": CANARY,
                    "spending_subcategory_id": subcategory,
                    **extra,
                },
            )

        await spend("104.99", eating["uuid"])
        await spend("999.00", day="2026-10-31")  # October: not this month
        _, by_name = await alerts()
        dinner = by_name["Eating out"]
        assert (dinner["amount"], dinner["recorded"], dinner["percent"]) == (
            "150.00",
            "104.99",
            69,
        )
        assert dinner["reached"] is None and dinner["basis"] == "estimate"
        assert by_name["Books"]["waiting"] == "no_estimate"
        assert by_name["Internet"]["recorded"] is None
        await spend("0.01", eating["uuid"])
        await spend("760.00")
        await ok(
            "POST",
            "/activity",
            {
                "date": "2026-11-03",
                "category": "fixed_cost",
                "amount": "65.00",
                "note": CANARY,
                "fixed_cost_id": internet,
            },
        )
        listed, by_name = await alerts()
        assert listed["version"]["number"] == saved["version"]["number"]
        # Guilt-free: $105 + $760 = $865 of $1,200 is 72.08%.
        assert [
            (a["name"], a["percent"], a["reached"]) for a in listed["spending_alerts"]
        ] == [
            ("Guilt-free spending", 72, 70),
            ("Books", None, None),
            ("Eating out", 70, 70),
            ("Internet", 100, 100),
        ]

        # Pushes go from the 9:00 preference on, once per threshold a month.
        assert await tick(8) == []
        first = await tick(10)
        assert first == [
            "Guilt-free spending passed 70% of its plan; Eating out passed 70% "
            "of its estimate; Internet passed 100% of its plan."
        ]
        assert CANARY not in json.dumps(sender.sent)
        assert "$" not in json.dumps(first)
        assert await tick(11) == []
        # $82.50 more is $187.50 of $150, 125%: 100 and 125 claimed, 125 named.
        await spend("82.50", eating["uuid"])
        assert await tick(13) == ["Eating out passed 125% of its estimate."]
        # A refund drops it back under; reaching 125% again pushes nothing.
        purchase = await spend("40.00", eating["uuid"])
        await ok(
            "POST",
            f"/activity/{purchase['uuid']}/refunds",
            {"date": "2026-11-12", "amount": "40.00"},
        )
        assert await tick(14) == []
        async with sessions() as db:
            pushed = (
                await db.execute(
                    select(sa.notices.c.threshold, sa.notices.c.outcome)
                    .where(sa.notices.c.user_id == user)
                    .order_by(sa.notices.c.threshold)
                )
            ).all()
        assert [tuple(r) for r in pushed] == [
            (70, "delivered"),
            (70, "delivered"),
            (100, "delivered"),
            (100, "delivered"),
            (125, "delivered"),
        ]

        # Dismissing hides a reached alert for this User until its next threshold.
        guilt_id = guilt["uuid"]
        dismissed = await ok("POST", f"/spending-alerts/{guilt_id}/dismissal")
        assert dismissed["dismissed"] and dismissed["reached"] == 70
        books_id = by_name["Books"]["uuid"]
        assert (
            await code("POST", f"/spending-alerts/{books_id}/dismissal")
            == "spending_alert_not_reached"
        )
        # $105 + $760 + $82.50 + $40 − $40 refunded + $230 = $1,177.50 of $1,200: 98%.
        await spend("230.00")
        _, by_name = await alerts()
        assert by_name["Guilt-free spending"]["reached"] == 90
        assert not by_name["Guilt-free spending"]["dismissed"]

        # A later saved version is read until the month's Review links one.
        later = await ok(
            "PUT",
            f"/plans/{plan['plan_id']}/draft",
            {
                "name": "Synthetic Everyday",
                "incomes": [
                    {
                        "name": "Synthetic salary",
                        "amount": "5000.00",
                        "source_id": draft["incomes"][0]["source_id"],
                    }
                ],
                "spending": "2355.00",
                "fixed_costs": [
                    {
                        "fixed_cost_id": internet,
                        "name": "Internet",
                        "amount": "65.00",
                        "frequency": "monthly",
                    }
                ],
                "expected_revision": saved["draft"]["revision"],
            },
        )
        await ok(
            "POST",
            f"/plans/{plan['plan_id']}/versions",
            {"expected_revision": later["draft"]["revision"]},
        )
        _, by_name = await alerts()
        # $1,177.50 of $2,355 is exactly 50%; the new version has no estimates.
        assert by_name["Guilt-free spending"]["percent"] == 50
        assert by_name["Eating out"]["waiting"] == "no_estimate"
        await ok(
            "POST",
            "/reviews",
            {"month": "2026-11-01", "version_id": saved["version"]["uuid"]},
        )
        _, by_name = await alerts()
        assert by_name["Guilt-free spending"]["percent"] == 98

        # Edits need the current revision; a delete removes its notices too.
        eating_alert = by_name["Eating out"]
        assert (
            await code(
                "PUT",
                f"/spending-alerts/{eating_alert['uuid']}",
                {"thresholds": [80], "expected_revision": 9},
            )
            == "stale_revision"
        )
        edited = await ok(
            "PUT",
            f"/spending-alerts/{eating_alert['uuid']}",
            {"thresholds": [80, 150], "expected_revision": 1},
        )
        assert (edited["thresholds"], edited["revision"]) == ([80, 150], 2)
        await ok(
            "DELETE",
            f"/spending-alerts/{eating_alert['uuid']}",
            {"expected_revision": 2},
        )
        _, by_name = await alerts()
        assert "Eating out" not in by_name
        # Left: Guilt-free 70 (pushed, then dismissed) and Internet 100.
        async with sessions() as db:
            entity_id = await db.scalar(
                select(m.entities.c.id).where(m.entities.c.uuid == entity)
            )
            assert (
                await db.scalar(
                    select(func.count())
                    .select_from(sa.notices)
                    .where(sa.notices.c.user_id == user)
                )
                == 2
            )
            audited = await db.scalar(
                select(func.count())
                .select_from(m.audit)
                .where(
                    m.audit.c.entity_id == entity_id,
                    m.audit.c.record_type == "spending_alert",
                )
            )
            assert audited == 6

        # The switch turns spending alert pushes off.
        prefs = await ok("GET", "/api/notifications/preferences", base="")
        await client.put(
            "/api/notifications/preferences", json={**prefs, "spending_alerts": False}
        )
        await spend("200.00", day="2026-11-11")  # $1,377.50 of $1,200: 114%
        await ok(
            "PUT",
            f"/spending-alerts/{guilt_id}",
            {"thresholds": [70, 90, 100], "expected_revision": 1},
        )
        assert await tick(15) == []

        # Constitution §9: the list costs the same statements for 3 and 23 rules.
        _, small = await counted_get(client, engine, prefix + "/spending-alerts")
        for i in range(20):
            sub = await ok(
                "POST", "/spending-subcategories", {"name": f"Synthetic {i}"}
            )
            await ok(
                "POST",
                "/spending-alerts",
                {
                    "category": "spending",
                    "spending_subcategory_id": sub["uuid"],
                    "thresholds": [70],
                },
            )
        body, large = await counted_get(client, engine, prefix + "/spending-alerts")
        assert len(body["spending_alerts"]) == 23 and small == large

    # Agent tools: list directly; saving pends in Ask first.
    mcp = ToolContext(sessions, actor.acting_as("mcp"))

    async def call(tool, args):
        spec = TOOLS[tool]
        return await spec.run(
            mcp, entity, spec.input.model_validate(args), str(uuid4())
        )

    async with sessions() as db:
        current = await agent_settings.read_settings(db, actor, entity)
    async with sessions() as db:
        await agent_settings.update_settings(
            db,
            actor,
            entity,
            str(uuid4()),
            {
                "enabled": True,
                "mode": "ask_first",
                "instructions": "",
                "expected_revision": current["revision"],
            },
        )
    listed = await call("list_spending_alerts", {})
    dumped = listed.model_dump(mode="json")
    assert dumped["spending_alerts"][0]["name"] == {"untrusted": "Guilt-free spending"}
    assert dumped["spending_alerts"][0]["reached"] == 100
    drafted = await call(
        "save_spending_alert",
        {"values": {"category": "fixed_cost", "thresholds": [90]}},
    )
    assert drafted.status == "pending"
    await engine.dispose()
