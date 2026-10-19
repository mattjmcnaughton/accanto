"""Synthetic complete Review, history, funding and coherent-read API examples."""

import asyncio
import os
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import func, insert, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from accanto.app import create_app
from accanto.db import get_session
from accanto.models import monthly as m
from accanto.services import monthly as service
from accanto.services.api_keys import issue_key

URL = os.environ.get("ACCANTO_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="Requires isolated migrated PostgreSQL")


def test_full_monthly_comparison_and_metrics():
    asyncio.run(scenario())


async def scenario():
    assert URL and URL.endswith("_test")
    engine = create_async_engine(URL)
    sessions = async_sessionmaker(engine)
    async with sessions() as session, session.begin():
        owner = await session.scalar(
            insert(m.users)
            .values(issuer="review-synthetic", subject=str(uuid4()))
            .returning(m.users.c.id)
        )
        entity = await session.scalar(
            insert(m.entities)
            .values(owner_id=owner, name="Synthetic comparison", time_zone="UTC")
            .returning(m.entities.c.uuid)
        )
        key = await issue_key(session, owner, "Synthetic comparison")
        second = await issue_key(session, owner, "Independent synthetic writer")
    app = create_app()

    async def dependency():
        async with sessions() as session:
            yield session

    app.dependency_overrides[get_session] = dependency
    prefix = f"/api/entities/{entity}"
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
        headers={"Authorization": f"Bearer {key['key']}"},
    ) as client:

        async def command(method, path, body, credential=None, status=200):
            headers = {"Idempotency-Key": str(uuid4())}
            if credential:
                headers["Authorization"] = f"Bearer {credential}"
            response = await client.request(
                method, prefix + path, json=body, headers=headers
            )
            assert response.status_code == status, response.text
            return response.json()

        async def read():
            response = await client.get(prefix + "/reviews/2026-10-01")
            assert response.status_code == 200, response.text
            return response.json()

        account = await command(
            "POST",
            "/savings-accounts",
            {
                "name": "Synthetic reserve",
                "opening_date": "2026-01-01",
                "opening_amount": "5000.00",
                "goals": [],
            },
        )
        goal = account["goals"][0]["uuid"]
        investment = await command(
            "POST", "/investments", {"name": "Synthetic investment", "target": None}
        )
        recipient = await command(
            "POST", "/giving-recipients", {"name": "Synthetic giving", "target": None}
        )
        plan = await command(
            "POST",
            "/plans",
            {
                "name": "Synthetic October",
                "incomes": [
                    {"name": "Same label", "amount": "4000.00"},
                    {"name": "Same label", "amount": "0.00"},
                ],
                "fixed_costs": [
                    {
                        "name": "Synthetic fixed",
                        "amount": "2500.00",
                        "frequency": "monthly",
                    }
                ],
                "spending": "200.00",
                "savings_funding": [
                    {"account_id": account["uuid"], "amount": "1000.00"}
                ],
                "saving_goals": [{"goal_id": goal, "amount": "500.00"}],
                "investments": [
                    {"destination_id": investment["uuid"], "amount": "2000.00"}
                ],
                "giving": [{"destination_id": recipient["uuid"], "amount": "100.00"}],
            },
        )
        saved = await command(
            "POST", f"/plans/{plan['plan_id']}/versions", {"expected_revision": 1}
        )
        version = saved["version"]
        await command(
            "POST", "/reviews", {"month": "2026-10-01", "version_id": version["uuid"]}
        )
        empty = await read()
        assert "comparison" in empty
        assert all(
            c["recorded"] is None and c["difference"] is None
            for c in empty["comparison"].values()
        )
        planned = {r["label"]: r for r in empty["metrics"] if r["basis"] == "planned"}
        assert planned["All fixed costs ÷ planned net income"]["percentage"] == "62.50"
        assert (
            planned["All fixed costs ÷ planned total funding"]["percentage"] == "50.00"
        )
        assert planned["All fixed costs ÷ planned total funding"]["components"][1] == {
            "name": "Selected savings: Synthetic reserve",
            "amount": "1000.00",
        }
        assert all(
            r["percentage"] is None for r in empty["metrics"] if r["basis"] == "actual"
        )
        async with sessions() as session:
            entity_id = await session.scalar(
                select(m.entities.c.id).where(m.entities.c.uuid == entity)
            )
            assert (
                await session.scalar(
                    select(func.count())
                    .select_from(m.entries)
                    .where(m.entries.c.entity_id == entity_id)
                )
                == 0
            )
        income = await command(
            "POST",
            "/activity",
            {
                "date": "2026-10-05",
                "category": "income",
                "amount": "4000.00",
                "source_id": version["incomes"][0]["source_id"],
            },
        )
        unplanned = await command(
            "POST",
            "/activity",
            {"date": "2026-10-05", "category": "income", "amount": "50.00"},
        )
        partial = await read()
        assert partial["comparison"]["income"]["recorded"] == "4050.00"
        assert partial["comparison"]["income"]["incomplete"]
        assert partial["income_difference"] is None
        assert partial["comparison"]["income"]["items"][1]["recorded"] is None
        assert [e["uuid"] for e in partial["comparison"]["income"]["unplanned"]] == [
            unplanned["uuid"]
        ]
        await command(
            "POST",
            "/activity",
            {
                "date": "2026-10-05",
                "category": "income",
                "amount": "0.00",
                "source_id": version["incomes"][1]["source_id"],
            },
        )
        fixed = await command(
            "POST",
            "/activity",
            {
                "date": "2026-10-06",
                "category": "fixed_cost",
                "amount": "2500.00",
                "fixed_cost_id": version["fixed_costs"][0]["fixed_cost_id"],
            },
        )
        await command(
            "POST",
            "/activity",
            {
                "date": "2026-10-07",
                "category": "saving",
                "amount": "500.00",
                "saving_goal_id": goal,
            },
        )
        purchase = await command(
            "POST",
            "/activity",
            {
                "date": "2026-10-08",
                "category": "spending",
                "amount": "1000.00",
                "funding_origin": "savings",
                "saving_goal_id": goal,
            },
        )
        before_investment = await read()
        assert before_investment["summary"]["net_saving"] is None
        assert before_investment["summary"]["savings_used_incomplete"]
        for path, identity in (
            ("/investment-activity", investment["uuid"]),
            ("/giving-activity", recipient["uuid"]),
        ):
            await command(
                "POST",
                path,
                {"date": "2026-10-08", "amount": "0.00", "destination_id": identity},
            )
        known = await read()
        assert known["summary"]["net_saving"] == "-500.00"
        assert not known["summary"]["savings_used_incomplete"]
        await command(
            "POST",
            "/investment-activity",
            {
                "date": "2026-10-09",
                "amount": "2000.00",
                "destination_id": investment["uuid"],
                "funding_origin": "savings",
                "saving_goal_id": goal,
            },
        )
        await command(
            "POST",
            "/giving-activity",
            {
                "date": "2026-10-09",
                "amount": "100.00",
                "destination_id": recipient["uuid"],
            },
        )
        complete = await read()
        assert complete["summary"]["total_investing"] == "2000.00"
        assert complete["summary"]["income_funded_investing"] == "0.00"
        assert complete["summary"]["savings_used"] == "3000.00"
        assert complete["summary"]["net_saving"] == "-2500.00"
        assert complete["income_difference"] == "50.00"
        assert (
            complete["comparison"]["fixed_cost"]["items"][0]["entries"][0]["uuid"]
            == fixed["uuid"]
        )
        review = complete["review"]
        await command(
            "PUT",
            "/reviews/2026-10-01",
            {
                "expected_revision": review["revision"],
                "version_id": version["uuid"],
                "note": "Synthetic checkpoint",
                "reviewed": True,
            },
        )
        assert not (await read())["checkpoint_changed"]
        adjustment = await command(
            "POST",
            "/activity/known-total",
            {
                "month": "2026-10-01",
                "date": "2026-10-10",
                "category": "spending",
                "desired_total": "1040.00",
                "contributing_entries": [
                    {"uuid": purchase["uuid"], "revision": purchase["revision"]}
                ],
            },
        )
        changed = await read()
        assert changed["checkpoint_changed"] and changed["review"]["reviewed_at"]
        assert changed["comparison"]["spending"]["adjustments"][0]["amount"] == "40.00"
        assert len(changed["comparison"]["spending"]["adjustments"]) == 1
        await command(
            "DELETE",
            f"/activity/{adjustment['uuid']}",
            {"expected_revision": adjustment["revision"]},
        )
        restored = await read()
        assert restored["comparison"]["spending"]["recorded"] == "1000.00"
        assert restored["version"] == version
        # Invalid saving totals cannot create an unattributed/partial adjustment.
        async with sessions() as session:
            count = await session.scalar(
                select(func.count())
                .select_from(m.audit)
                .where(m.audit.c.entity_id == entity_id)
            )
        await command(
            "POST",
            "/activity/known-total",
            {
                "month": "2026-10-01",
                "date": "2026-10-10",
                "category": "saving",
                "desired_total": "600.00",
                "contributing_entries": [],
            },
            status=422,
        )
        async with sessions() as session:
            assert count == await session.scalar(
                select(func.count())
                .select_from(m.audit)
                .where(m.audit.c.entity_id == entity_id)
            )

        # Existing checkpoint canonical covers every category without invalidating
        # saved checkpoints on upgrade or counting refunds in another month.
        for path, body in (
            (
                "/activity",
                {
                    "date": "2026-10-12",
                    "category": "saving",
                    "amount": "0.00",
                    "saving_goal_id": goal,
                },
            ),
            (
                "/investment-activity",
                {
                    "date": "2026-10-12",
                    "amount": "0.00",
                    "destination_id": investment["uuid"],
                },
            ),
            (
                "/giving-activity",
                {
                    "date": "2026-10-12",
                    "amount": "0.00",
                    "destination_id": recipient["uuid"],
                },
            ),
        ):
            current = (await read())["review"]
            await command(
                "PUT",
                "/reviews/2026-10-01",
                {
                    "expected_revision": current["revision"],
                    "version_id": version["uuid"],
                    "note": "Synthetic checkpoint",
                    "reviewed": True,
                    "checkpoint": True,
                },
            )
            assert not (await read())["checkpoint_changed"]
            await command("POST", path, body)
            assert (await read())["checkpoint_changed"]
        current = (await read())["review"]
        await command(
            "PUT",
            "/reviews/2026-10-01",
            {
                "expected_revision": current["revision"],
                "version_id": version["uuid"],
                "note": "Synthetic checkpoint",
                "reviewed": True,
                "checkpoint": True,
            },
        )
        later_refund = await command(
            "POST",
            f"/activity/{purchase['uuid']}/refunds",
            {"date": "2026-11-01", "amount": "10.00"},
        )
        assert not (await read())["checkpoint_changed"]
        await command(
            "DELETE",
            f"/activity/refunds/{later_refund['uuid']}",
            {"expected_revision": later_refund["revision"]},
        )

        # Reader pauses after monthly entry/aggregate reads; independent writer
        # switches funding. The Entity lock must prevent a mixed response.
        original_snapshot = service.entry_snapshot
        reader_reached = asyncio.Event()
        paused = False

        async def pause_snapshot(session, record):
            nonlocal paused
            if not paused:
                paused = True
                reader_reached.set()
                await asyncio.sleep(0.25)
            return await original_snapshot(session, record)

        patch = pytest.MonkeyPatch()
        patch.setattr(service, "entry_snapshot", pause_snapshot)
        try:
            reader = asyncio.create_task(read())
            await asyncio.wait_for(reader_reached.wait(), timeout=3)
            writer = asyncio.create_task(
                command(
                    "PUT",
                    f"/activity/{purchase['uuid']}",
                    {
                        "date": "2026-10-08",
                        "category": "spending",
                        "amount": "1000.00",
                        "funding_origin": "income",
                        "expected_revision": purchase["revision"],
                    },
                    second["key"],
                )
            )
            coherent, _ = await asyncio.gather(reader, writer)
            assert (
                coherent["actual"]["savings_used"]
                == coherent["summary"]["savings_used"]
                == "3000.00"
            )
            assert (
                next(e for e in coherent["entries"] if e["uuid"] == purchase["uuid"])[
                    "funding_origin"
                ]
                == "savings"
            )
        finally:
            patch.undo()
        assert (await read())["summary"]["savings_used"] == "2000.00"
        assert income["source_id"] != version["incomes"][1]["source_id"]
    await engine.dispose()
