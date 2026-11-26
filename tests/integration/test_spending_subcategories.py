"""Spending subcategories on real PostgreSQL: assignment, refunds, archive, rename
and the Review breakdown (TDD 07). Every value is synthetic."""

import asyncio
import os
from decimal import Decimal
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import insert
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from accanto.app import create_app
from accanto.db import get_session
from accanto.models import monthly as m
from accanto.services.api_keys import issue_key

URL = os.environ.get("ACCANTO_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not URL, reason="Use an isolated migrated test database"
)


def test_spending_subcategories_assign_refunds_archive_and_review():
    asyncio.run(scenario())


async def scenario():
    assert URL and URL.rsplit("/", 1)[-1].endswith("_test")
    engine = create_async_engine(URL)
    sessions = async_sessionmaker(engine)
    async with sessions() as session, session.begin():
        user = await session.scalar(
            insert(m.users)
            .values(issuer="subcategory-test", subject=str(uuid4()))
            .returning(m.users.c.id)
        )
        entity, other = [
            await session.scalar(
                insert(m.entities)
                .values(owner_id=user, name=f"Synthetic Entity {n}", time_zone="UTC")
                .returning(m.entities.c.uuid)
            )
            for n in (1, 2)
        ]
        key = await issue_key(session, user, "Synthetic subcategory test")
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

        async def code(method, suffix, body):
            response = await send(method, suffix, body)
            assert response.status_code in {404, 409, 422}, response.text
            return response.json()["detail"]["code"]

        eating = await ok("POST", "/spending-subcategories", {"name": " Eating   out "})
        books = await ok("POST", "/spending-subcategories", {"name": "Books"})
        assert eating["name"] == "Eating out"
        assert (
            await code("POST", "/spending-subcategories", {"name": "EATING OUT"})
            == "spending_subcategory_exists"
        )
        foreign = await ok(
            "POST",
            "/spending-subcategories",
            {"name": "Elsewhere"},
            base=f"/api/entities/{other}",
        )

        dinner_body = {
            "date": "2026-10-10",
            "category": "spending",
            "amount": "62.10",
            "note": "Synthetic dinner",
            "spending_subcategory_id": eating["uuid"],
        }
        dinner = await ok("POST", "/activity", dinner_body)
        assert dinner["spending_subcategory_id"] == eating["uuid"]
        assert dinner["spending_subcategory_name"] == "Eating out"
        novel = await ok(
            "POST",
            "/activity",
            {
                **dinner_body,
                "amount": "18.40",
                "spending_subcategory_id": books["uuid"],
            },
        )
        loose = await ok(
            "POST",
            "/activity",
            {**dinner_body, "amount": "7.05", "spending_subcategory_id": None},
        )
        assert loose["spending_subcategory_id"] is None

        # Only this Entity's subcategories, and only on guilt-free spending.
        assert (
            await code(
                "POST",
                "/activity",
                {**dinner_body, "spending_subcategory_id": foreign["uuid"]},
            )
            == "spending_subcategory_not_found"
        )
        wrong = await send(
            "POST", "/activity", {**dinner_body, "category": "fixed_cost"}
        )
        assert wrong.status_code == 422

        # A refund inherits its purchase's subcategory and follows a change to it.
        refund = await ok(
            "POST",
            f"/activity/{novel['uuid']}/refunds",
            {"date": "2026-10-20", "amount": "18.40"},
        )
        assert refund["spending_subcategory_id"] == books["uuid"]
        novel = await ok(
            "PUT",
            f"/activity/{novel['uuid']}",
            {
                **dinner_body,
                "amount": "18.40",
                "spending_subcategory_id": eating["uuid"],
                "expected_revision": novel["revision"],
            },
        )
        rows = {r["uuid"]: r for r in await ok("GET", "/activity")}
        assert rows[refund["uuid"]]["spending_subcategory_id"] == eating["uuid"]
        assert rows[refund["uuid"]]["revision"] == refund["revision"] + 1
        novel = await ok(
            "PUT",
            f"/activity/{novel['uuid']}",
            {
                **dinner_body,
                "amount": "18.40",
                "spending_subcategory_id": books["uuid"],
                "expected_revision": novel["revision"],
            },
        )

        # Archive: entries keep it and stay correctable; new entries cannot choose it.
        archived = await ok(
            "PUT",
            f"/spending-subcategories/{books['uuid']}",
            {"name": "Books", "active": False, "expected_revision": 1},
        )
        assert archived["active"] is False and archived["entries"] == 2
        assert (
            await code(
                "POST",
                "/activity",
                {**dinner_body, **{"spending_subcategory_id": books["uuid"]}},
            )
            == "archived_spending_subcategory"
        )
        corrected = await ok(
            "PUT",
            f"/activity/{novel['uuid']}",
            {
                **dinner_body,
                "amount": "18.40",
                "note": "Synthetic paperback",
                "spending_subcategory_id": books["uuid"],
                "expected_revision": novel["revision"],
            },
        )
        assert corrected["spending_subcategory_name"] == "Books"

        # Rename relabels past entries; there is no name snapshot.
        await ok(
            "PUT",
            f"/spending-subcategories/{eating['uuid']}",
            {"name": "Restaurants", "active": True, "expected_revision": 1},
        )
        rows = {r["uuid"]: r for r in await ok("GET", "/activity")}
        assert rows[dinner["uuid"]]["spending_subcategory_name"] == "Restaurants"
        listed = await ok("GET", "/spending-subcategories")
        assert [(r["name"], r["entries"]) for r in listed] == [
            ("Books", 2),
            ("Restaurants", 1),
        ]

        # The Review groups spending by subcategory; the groups add up exactly.
        await ok(
            "POST",
            "/activity",
            {
                "date": "2026-10-31",
                "category": "spending",
                "amount": "-2.50",
                "is_adjustment": True,
            },
        )
        plan = await ok(
            "POST",
            "/plans",
            {
                "name": "Synthetic Plan",
                "incomes": [{"name": "Primary salary", "amount": "1000.00"}],
                "spending": "200.00",
            },
        )
        version = (
            await ok(
                "POST", f"/plans/{plan['plan_id']}/versions", {"expected_revision": 1}
            )
        )["version"]["uuid"]
        await ok("POST", "/reviews", {"month": "2026-10-01", "version_id": version})
        review = await ok("GET", "/reviews/2026-10-01")
        spending = review["comparison"]["spending"]
        assert [(g["name"], g["recorded"]) for g in spending["breakdown"]] == [
            ("Restaurants", "62.10"),
            ("Books", "0.00"),
            (None, "4.55"),
        ]
        assert spending["recorded"] == review["actual"]["spending_recorded"] == "66.65"
        assert sum(Decimal(g["recorded"]) for g in spending["breakdown"]) == Decimal(
            spending["recorded"]
        )
        assert spending["items"] == []
        assert review["spending_difference"] == "-133.35"
    await engine.dispose()
