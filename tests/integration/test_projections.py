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
                "expected_revision": fire["revision"],
            },
        )
        assert fire == {
            "annual_spending": "800.00",
            "withdrawal_percent": "4.00",
            "revision": fire["revision"],
        }

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

    # The settings and FIRE changes are each audited on the Entity.
    async with sessions() as session:
        audited = await session.scalar(
            select(func.count())
            .select_from(m.audit)
            .where(m.audit.c.record_uuid == entity)
        )
        assert audited == 2
    await engine.dispose()
