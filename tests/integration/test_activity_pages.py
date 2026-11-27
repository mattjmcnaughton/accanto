"""Activity pages on real PostgreSQL: order, cursors, filters, search and cost.

Every value is synthetic. Expected orders are written out by hand from the
dates and recording order below, not read back from the implementation.
"""

import asyncio
import os
from datetime import date
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import insert
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from accanto.app import create_app
from accanto.db import get_session
from accanto.models import monthly as m
from accanto.services.access import resolve_actor
from accanto.services.api_keys import issue_key
from accanto.services.tools import TOOLS, ToolContext
from tests.integration.read_cost import counted_get

URL = os.environ.get("ACCANTO_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not URL, reason="Use an isolated migrated test database"
)


def test_activity_pages():
    asyncio.run(scenario())


async def scenario():
    assert URL and URL.rsplit("/", 1)[-1].endswith("_test")
    engine = create_async_engine(URL)
    sessions = async_sessionmaker(engine)
    async with sessions() as db, db.begin():
        user = await db.scalar(
            insert(m.users)
            .values(issuer="activity-pages", subject=str(uuid4()))
            .returning(m.users.c.id)
        )
        (entity, entity_id), (other, _) = [
            (
                await db.execute(
                    insert(m.entities)
                    .values(owner_id=user, name=f"Synthetic pages {n}", time_zone="UTC")
                    .returning(m.entities.c.uuid, m.entities.c.id)
                )
            ).one()
            for n in (1, 2)
        ]
        key = await issue_key(db, user, "Synthetic pages key")
        actor = await resolve_actor(db, key["key"], "api_key")
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

        async def ok(method, path, body, base=prefix):
            response = await client.request(
                method,
                base + path,
                json=body,
                headers={"Idempotency-Key": str(uuid4())},
            )
            assert response.status_code == 200, response.text
            return response.json()

        async def page(**params):
            response = await client.get(prefix + "/activity/page", params=params)
            assert response.status_code == 200, response.text
            return response.json()

        async def record(date, note, amount="10.00", category="spending", **extra):
            body = {"date": date, "category": category, "amount": amount, "note": note}
            return (await ok("POST", "/activity", {**body, **extra}))["uuid"]

        trip = await ok("POST", "/tags", {"name": "Synthetic lake trip"})
        # Recorded out of date order; three share 2026-10-20.
        a = await record("2026-10-20", "Synthetic café visit", "12.50")
        b = await record("2026-09-05", "Synthetic bookshop")
        c = await record("2026-10-20", "Synthetic 100% juice", "4.00")
        d = await record("2026-10-31", "Synthetic hardware store", "25.00")
        e = await record(
            "2026-10-20", "Synthetic ferry", "30.00", tag_ids=[trip["uuid"]]
        )
        f = await record("2026-10-02", "Synthetic paycheck", "900.00", "income")
        refund = (
            await ok(
                "POST",
                f"/activity/{b}/refunds",
                {"date": "2026-10-25", "amount": "5.00"},
            )
        )["uuid"]
        newest_first = [d, refund, a, c, e, f, b]

        # Walking the cursor returns every entry once, newest date first and in
        # recording order within a date, even when a page ends inside a date.
        walked, cursor, pages = [], None, 0
        while True:
            body = await page(limit=2, **({"cursor": cursor} if cursor else {}))
            walked += [row["uuid"] for row in body["entries"]]
            pages += 1
            assert (body["total"], body["matching"]) == (7, 7)
            cursor = body["next_cursor"]
            if not cursor:
                break
        assert walked == newest_first and pages == 4

        # A refund's purchase comes with the page when the page does not hold it.
        first = await page(limit=2)
        assert [row["uuid"] for row in first["purchases"]] == [b]
        assert first["entries"][1]["refund_of"] == b
        assert (await page())["purchases"] == []

        # The month scopes total; filters and search narrow matching.
        october = await page(month="2026-10-01")
        assert [row["uuid"] for row in october["entries"]] == [d, refund, a, c, e, f]
        assert october["total"] == 6
        income = await page(month="2026-10-01", category="income")
        assert [row["uuid"] for row in income["entries"]] == [f]
        assert (income["total"], income["matching"]) == (6, 1)
        tagged = await page(tag_id=trip["uuid"])
        assert [row["uuid"] for row in tagged["entries"]] == [e]
        single = await page(entry_id=c)
        assert [row["uuid"] for row in single["entries"]] == [c]

        async def found(q, **params):
            return [row["uuid"] for row in (await page(q=q, **params))["entries"]]

        assert await found("CAFE") == [a]  # folded case and accents
        assert await found("lake trip") == [e]  # tag names; every word must match
        assert await found("lake bookshop") == []
        assert await found("12.5") == [a]  # an amount matches exactly
        assert await found("-5") == [refund]  # signed: the refund only
        assert await found("+5") == []  # and no entry is +5.00
        assert await found("%") == [c]  # a literal, not a wildcard
        assert await found("refund bookshop") == [refund]  # its purchase's note
        assert await found("Oct 31, 2026") == [d]  # the date as the screen shows it
        assert await found("income") == [f]  # the category's name
        assert await found("synthetic", month="2026-09-01") == [b]
        searched = await page(q="synthetic", limit=3)
        assert searched["matching"] == 7 and searched["next_cursor"] == a

        # Cursors and pages stay in their Entity.
        bad = await client.get(
            prefix + "/activity/page", params={"cursor": str(uuid4())}
        )
        assert bad.status_code == 422
        foreign = await client.get(
            f"/api/entities/{other}/activity/page", params={"cursor": a}
        )
        assert foreign.status_code == 422
        assert (
            await client.get(prefix + "/activity/page?limit=501")
        ).status_code == 422

        # A page costs the same number of statements for 7 and 207 entries,
        # with and without a search.
        path = prefix + "/activity/page?limit=50"
        _, small = await counted_get(client, engine, path)
        _, small_search = await counted_get(client, engine, path + "&q=synthetic")
        async with sessions() as db, db.begin():
            await db.execute(
                insert(m.entries),
                [
                    {
                        "uuid": uuid4(),
                        "entity_id": entity_id,
                        "financial_date": date(2025, n % 12 + 1, n % 28 + 1),
                        "category": "spending",
                        "amount": "1.00",
                        "note": f"Synthetic bulk {n}",
                    }
                    for n in range(200)
                ],
            )
        body, large = await counted_get(client, engine, path)
        assert len(body["entries"]) == 50 and body["total"] == 207
        _, large_search = await counted_get(client, engine, path + "&q=synthetic")
        assert (small, small_search) == (large, large_search)

    # MCP: list_activity pages a month with the same cursor.
    mcp = ToolContext(sessions, actor.acting_as("mcp"))
    spec = TOOLS["list_activity"]

    async def listed(**args):
        query = spec.input.model_validate({"month": "2026-10-01", **args})
        return await spec.run(mcp, entity, query, str(uuid4()))

    whole = await listed()
    assert [str(row.id) for row in whole.entries] == [d, refund, a, c, e, f]
    assert not whole.truncated and whole.next_cursor is None
    rest = await listed(cursor=a)
    assert [str(row.id) for row in rest.entries] == [c, e, f]
    await engine.dispose()
