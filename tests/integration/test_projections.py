"""Projection assumptions and the Projection read through the API (TDD 14)."""

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
from accanto.services.api_keys import issue_key
from tests.integration.read_cost import counted_get

URL = os.environ.get("ACCANTO_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not URL, reason="Use an isolated migrated test database"
)


def test_projection_assumptions_and_read():
    asyncio.run(scenario())


async def scenario():
    assert URL and URL.rsplit("/", 1)[-1].endswith("_test")
    engine = create_async_engine(URL)
    sessions = async_sessionmaker(engine)
    async with sessions() as session, session.begin():
        user = await session.scalar(
            insert(m.users)
            .values(issuer="projection-test", subject=str(uuid4()))
            .returning(m.users.c.id)
        )
        other = await session.scalar(
            insert(m.users)
            .values(issuer="projection-test", subject=str(uuid4()))
            .returning(m.users.c.id)
        )
        entity = await session.scalar(
            insert(m.entities)
            .values(owner_id=user, name="Synthetic projections", time_zone="UTC")
            .returning(m.entities.c.uuid)
        )
        key = await issue_key(session, user, "Projection test")
        other_key = await issue_key(session, other, "Other projection test")
    app = create_app()

    async def dependency():
        async with sessions() as session:
            yield session

    app.dependency_overrides[get_session] = dependency
    path = f"/api/entities/{entity}"
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
        headers={"Authorization": f"Bearer {key['key']}"},
    ) as client:

        async def command(method, suffix, body):
            response = await client.request(
                method,
                path + suffix,
                json=body,
                headers={"Idempotency-Key": str(uuid4())},
            )
            return response

        async def accepted(method, suffix, body):
            response = await command(method, suffix, body)
            assert response.status_code == 200, response.text
            return response.json()

        empty = (await client.get(path + "/projections?years=10")).json()
        assert empty["investments"] == [] and empty["today"]["net_worth"] == "0.00"

        # Assumptions are set on create and read back; a percent out of range,
        # or one on a giving recipient, is refused.
        fund = await accepted(
            "POST",
            "/investments",
            {
                "name": "Synthetic fund",
                "opening": {"date": "2026-01-01", "amount": "10000.00"},
                "expected_return_percent": "0",
                "expected_contribution": "1200.00",
                "expected_contribution_frequency": "annual",
            },
        )
        assert fund["expected_return_percent"] == "0.00"
        assert fund["expected_contribution"] == "1200.00"
        assert fund["expected_contribution_frequency"] == "annual"
        for body in (
            {"name": "Too hopeful", "expected_return_percent": "30.01"},
            {"name": "Bad frequency", "expected_contribution_frequency": "weekly"},
        ):
            assert (await command("POST", "/investments", body)).status_code == 422
        assert (
            await command(
                "POST",
                "/giving-recipients",
                {"name": "Synthetic charity", "expected_return_percent": "5"},
            )
        ).status_code == 422

        # An edit that leaves the assumptions out keeps them; null clears one.
        renamed = await accepted(
            "PUT",
            f"/investments/{fund['uuid']}",
            {"name": "Renamed fund", "active": True, "expected_revision": 1},
        )
        assert renamed["expected_contribution"] == "1200.00"
        assert renamed["expected_return_percent"] == "0.00"
        cleared = await accepted(
            "PUT",
            f"/investments/{fund['uuid']}",
            {
                "name": "Renamed fund",
                "active": True,
                "expected_revision": renamed["revision"],
                "expected_return_percent": None,
            },
        )
        assert cleared["expected_return_percent"] is None
        assert cleared["expected_contribution"] == "1200.00"

        # The Entity's default return applies to it now; settings carry it.
        settings = (await client.get(path + "/settings")).json()
        assert settings["default_return_percent"] == "6.00"
        settings = await accepted(
            "PUT",
            "/settings",
            {
                "name": "Synthetic projections",
                "time_zone": "UTC",
                "default_return_percent": "0",
                "expected_revision": settings["revision"],
            },
        )
        assert settings["default_return_percent"] == "0.00"

        await accepted(
            "POST",
            "/savings-accounts",
            {
                "name": "Synthetic cash",
                "opening_date": "2026-01-01",
                "opening_amount": "2000.00",
            },
        )
        await accepted(
            "POST",
            "/debts",
            {
                "name": "Synthetic loan",
                "opening": {"date": "2026-01-01", "amount": "500.00"},
            },
        )

        fire = (await client.get(path + "/fire-assumptions")).json()
        assert fire["annual_spending"] is None and fire["withdrawal_percent"] == "4.00"
        assert (
            await command(
                "PUT",
                "/fire-assumptions",
                {"withdrawal_percent": "0", "expected_revision": fire["revision"]},
            )
        ).status_code == 422
        fire = await accepted(
            "PUT",
            "/fire-assumptions",
            {
                "annual_spending": "800.00",
                "withdrawal_percent": "4",
                "inflation_percent": "0",
                "expected_revision": fire["revision"],
            },
        )
        assert fire == {
            "annual_spending": "800.00",
            "withdrawal_percent": "4.00",
            "inflation_percent": "0.00",
            "revision": fire["revision"],
        }
        assert (
            await command(
                "PUT",
                "/fire-assumptions",
                {
                    "withdrawal_percent": "4",
                    "inflation_percent": "15.01",
                    "expected_revision": fire["revision"],
                },
            )
        ).status_code == 422

        # At 0% the fund adds $100 a month: 10,000 + 100 × 60 after five years.
        projection = (await client.get(path + "/projections?years=10")).json()
        assert projection["today"] == {
            "investments": "10000.00",
            "savings": "2000.00",
            "loans": "500.00",
            "net_worth": "11500.00",
        }
        five = projection["milestones"][0]
        assert five["investments"] == "16000.00" and five["net_worth"] == "17500.00"
        assert len(projection["timeline"]) == 11
        # Target 800 / 4% = 20,000: reached after 100 months of $100.
        assert projection["fire"]["target"] == "20000.00"
        assert projection["fire"]["months_to_target"] == 100
        assert projection["investments"][0]["return_source"] == "default"
        assert projection["dollars"] == "today"
        assert projection["planned_fixed_costs"] is None

        # TDD 17: the active month's planned fixed costs from the latest saved
        # version, and the full list of costs held level, set with FIRE.
        plan = await accepted(
            "POST",
            "/plans",
            {
                "name": "Synthetic month",
                "incomes": [{"name": "Example income", "amount": "4000.00"}],
                "fixed_costs": [
                    {
                        "name": "Fixed mortgage",
                        "amount": "20.00",
                        "frequency": "monthly",
                    },
                    {"name": "Groceries", "amount": "120.00", "frequency": "annual"},
                ],
                "spending": "100.00",
            },
        )
        await accepted(
            "POST", f"/plans/{plan['plan_id']}/versions", {"expected_revision": 1}
        )
        costs = {c["name"]: c["fixed_cost_id"] for c in plan["draft"]["fixed_costs"]}
        planned = (await client.get(path + "/projections?years=10")).json()[
            "planned_fixed_costs"
        ]
        assert planned["plan_name"] == "Synthetic month"
        assert planned["version_number"] == 1
        assert (planned["monthly_total"], planned["annual_total"]) == (
            "30.00",
            "360.00",
        )
        assert planned["steady_annual"] == "0.00"
        assert all(line["rises_with_inflation"] for line in planned["lines"])
        foreign = str(uuid4())
        assert (
            await command(
                "PUT",
                "/fire-assumptions",
                {
                    "annual_spending": "800.00",
                    "withdrawal_percent": "4",
                    "fixed_costs_not_rising_with_inflation": [foreign],
                    "expected_revision": fire["revision"],
                },
            )
        ).status_code == 404
        fire = await accepted(
            "PUT",
            "/fire-assumptions",
            {
                "annual_spending": "800.00",
                "withdrawal_percent": "4",
                "inflation_percent": "3",
                "fixed_costs_not_rising_with_inflation": [costs["Fixed mortgage"]],
                "expected_revision": fire["revision"],
            },
        )
        assert fire["inflation_percent"] == "3.00"
        real = (await client.get(path + "/projections?years=10")).json()
        nominal = (
            await client.get(path + "/projections?years=10&dollars=future")
        ).json()
        assert real["planned_fixed_costs"]["steady_annual"] == "240.00"
        assert real["fire"]["steady_spending"] == "240.00"
        assert real["fire"]["target_today"] == "20000.00"
        # Target 240/4% level + 560/4% inflating: later than the flat 100 months.
        months = real["fire"]["months_to_target"]
        assert months == nominal["fire"]["months_to_target"] and months > 100
        # $10,000 grows nothing at 0%; deflated at 3% over five years.
        assert nominal["milestones"][0]["investments"] == "16000.00"
        assert real["milestones"][0]["investments"] < "16000.00"
        assert (await client.get(path + "/projections?dollars=past")).status_code == 422
        # The held-level flag is read by agents' plan detail too; an omitted list
        # keeps it.
        fire = await accepted(
            "PUT",
            "/fire-assumptions",
            {
                "annual_spending": "800.00",
                "withdrawal_percent": "4",
                "inflation_percent": "0",
                "expected_revision": fire["revision"],
            },
        )
        kept = (await client.get(path + "/projections?years=10")).json()
        assert kept["planned_fixed_costs"]["steady_annual"] == "240.00"

        # An active investment without an observed value makes totals unknown.
        await accepted("POST", "/investments", {"name": "Unobserved fund"})
        unknown = (await client.get(path + "/projections")).json()
        assert unknown["today"]["net_worth"] is None
        assert unknown["milestones"][2]["net_worth"] is None
        assert unknown["fire"]["months_to_target"] is None
        assert unknown["investments"][1]["status"] == "no_value"

        assert (await client.get(path + "/projections?years=0")).status_code == 422
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://test",
            headers={"Authorization": f"Bearer {other_key['key']}"},
        ) as outsider:
            assert (await outsider.get(path + "/projections")).status_code == 404
            assert (await outsider.get(path + "/fire-assumptions")).status_code == 404

        # Constitution §9: the read costs the same SQL for 2 or 12 investments.
        _, small_cost = await counted_get(client, engine, path + "/projections")
        for i in range(10):
            await accepted(
                "POST",
                "/investments",
                {
                    "name": f"Synthetic {i}",
                    "opening": {"date": "2026-01-01", "amount": "100.00"},
                },
            )
        many, large_cost = await counted_get(client, engine, path + "/projections")
        assert len(many["investments"]) == 12
        assert large_cost == small_cost
        print(f"projection read: {small_cost} statements for 2 and 12 investments")

        # TDD 15: fixed-rate loan terms, the payoff schedule and amortizing loans.
        car = await accepted(
            "POST",
            "/debts",
            {
                "name": "Synthetic car loan",
                "opening": {"date": "2026-01-01", "amount": "10000.00"},
                "interest_rate_percent": "6",
                "monthly_payment": "193.33",
            },
        )
        assert (car["interest_rate_percent"], car["monthly_payment"]) == (
            "6.00",
            "193.33",
        )
        assert car["payoff"]["status"] == "scheduled"
        assert car["payoff"]["months"] == 60
        assert car["payoff"]["payoff_date"] == "2031-01-01"
        for bad in (
            {"interest_rate_percent": "40.01"},
            {"interest_rate_percent": "-1"},
            {"monthly_payment": "0"},
        ):
            response = await command(
                "POST",
                "/debts",
                {
                    "name": "Bad terms",
                    "opening": {"date": "2026-01-01", "amount": "1.00"},
                    **bad,
                },
            )
            assert response.status_code == 422
        schedule = (
            await client.get(f"{path}/debts/{car['uuid']}/payoff-schedule")
        ).json()
        assert len(schedule["rows"]) == 60 and schedule["rows"][-1]["balance"] == "0.00"
        assert schedule["rows"][0] == {
            "month": 1,
            "date": "2026-02-01",
            "payment": "193.33",
            "interest": "50.00",
            "principal": "143.33",
            "balance": "9856.67",
        }
        # A rename that omits the terms keeps them; an explicit null clears one.
        renamed = await accepted(
            "PUT",
            f"/debts/{car['uuid']}",
            {
                "name": "Synthetic auto loan",
                "active": True,
                "expected_revision": car["revision"],
            },
        )
        assert renamed["monthly_payment"] == "193.33"
        cleared = await accepted(
            "PUT",
            f"/debts/{car['uuid']}",
            {
                "name": "Synthetic auto loan",
                "active": True,
                "monthly_payment": None,
                "expected_revision": renamed["revision"],
            },
        )
        assert cleared["monthly_payment"] is None
        assert cleared["interest_rate_percent"] == "6.00"
        assert cleared["payoff"]["status"] == "no_terms"
        car = await accepted(
            "PUT",
            f"/debts/{car['uuid']}",
            {
                "name": "Synthetic auto loan",
                "active": True,
                "monthly_payment": "193.33",
                "expected_revision": cleared["revision"],
            },
        )
        # A payment at or under the interest is flagged, not an endless schedule.
        stuck = await accepted(
            "POST",
            "/debts",
            {
                "name": "Synthetic stuck loan",
                "opening": {"date": "2026-01-01", "amount": "1000.00"},
                "interest_rate_percent": "12",
                "monthly_payment": "10.00",
            },
        )
        assert stuck["payoff"]["status"] == "interest_not_covered"
        stuck_schedule = (
            await client.get(f"{path}/debts/{stuck['uuid']}/payoff-schedule")
        ).json()
        assert stuck_schedule["rows"] == [] and stuck_schedule["months"] is None

        # Projections: the car loan is repaid within ten years; others stay flat.
        paid_down = (await client.get(path + "/projections?years=10")).json()
        assert paid_down["today"]["loans"] == "11500.00"
        assert paid_down["timeline"][10]["loans"] == "1500.00"
        by_name = {line["name"]: line for line in paid_down["loans"]}
        assert by_name["Synthetic auto loan"]["status"] == "amortizing"
        assert by_name["Synthetic stuck loan"]["status"] == "interest_not_covered"
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://test",
            headers={"Authorization": f"Bearer {other_key['key']}"},
        ) as outsider:
            response = await outsider.get(f"{path}/debts/{car['uuid']}/payoff-schedule")
            assert response.status_code == 404

        # §9 again: the same SQL for 3 or 13 loans.
        _, few_loans = await counted_get(client, engine, path + "/projections")
        for i in range(10):
            await accepted(
                "POST",
                "/debts",
                {
                    "name": f"Synthetic loan {i}",
                    "opening": {"date": "2026-01-01", "amount": "100.00"},
                    "interest_rate_percent": "5",
                    "monthly_payment": "10.00",
                },
            )
        loaded, many_loans = await counted_get(client, engine, path + "/projections")
        assert len(loaded["loans"]) == 13
        assert many_loans == few_loans == large_cost
        print(f"projection read: {few_loans} statements for 3 and 13 loans")

    # The settings and FIRE changes are each audited on the Entity.
    async with sessions() as session:
        audited = await session.scalar(
            select(func.count())
            .select_from(m.audit)
            .where(m.audit.c.record_uuid == entity)
        )
        assert audited == 4
        flags = await session.scalar(
            select(func.count())
            .select_from(m.audit)
            .where(m.audit.c.record_uuid == costs["Fixed mortgage"])
        )
        # Created with the Plan, then held level once; the omitted list wrote nothing.
        assert flags == 2
    await engine.dispose()
