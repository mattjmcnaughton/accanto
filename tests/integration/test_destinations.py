"""Investment/giving API and retained history on a fresh migrated test database."""

import asyncio
import os
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import func, insert, select, update
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from accanto.app import create_app
from accanto.db import get_session
from accanto.models import destinations as d
from accanto.models import monthly as m
from accanto.services.api_keys import issue_key
from tests.integration.read_cost import counted_get

URL = os.environ.get("ACCANTO_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not URL, reason="Use an isolated migrated test database"
)


def test_destination_lifecycle_activity_and_opening_boundary():
    asyncio.run(scenario())


async def scenario():
    assert URL and URL.rsplit("/", 1)[-1].endswith("_test")
    engine = create_async_engine(URL)
    sessions = async_sessionmaker(engine)
    async with sessions() as session, session.begin():
        user = await session.scalar(
            insert(m.users)
            .values(issuer="destination-test", subject=str(uuid4()))
            .returning(m.users.c.id)
        )
        other = await session.scalar(
            insert(m.users)
            .values(issuer="destination-test", subject=str(uuid4()))
            .returning(m.users.c.id)
        )
        entity = await session.scalar(
            insert(m.entities)
            .values(owner_id=user, name="Synthetic Household", time_zone="UTC")
            .returning(m.entities.c.uuid)
        )
        foreign = await session.scalar(
            insert(m.entities)
            .values(owner_id=other, name="Other Synthetic Household", time_zone="UTC")
            .returning(m.entities.c.uuid)
        )
        key = await issue_key(session, user, "Destination test")
        other_key = await issue_key(session, other, "Other destination test")
    app = create_app()

    async def dependency():
        async with sessions() as session:
            yield session

    app.dependency_overrides[get_session] = dependency
    path = f"/api/entities/{entity}"
    headers = {"Authorization": f"Bearer {key['key']}"}
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test", headers=headers
    ) as client:

        async def command(method, suffix, body, identity=None):
            return await client.request(
                method,
                path + suffix,
                json=body,
                headers={"Idempotency-Key": identity or str(uuid4())},
            )

        assert (await client.get(path + "/investments")).json() == []
        assert (await client.get(path + "/giving-recipients")).json() == []
        assert (
            await client.get(f"/api/entities/{foreign}/investments")
        ).status_code == 404
        invalid = await command(
            "POST",
            "/investments",
            {
                "name": "Example fund",
                "target": "0.00",
                "opening": None,
            },
        )
        assert invalid.status_code == 422
        investment_body = {
            "name": "Example fund",
            "target": "2000.00",
            "opening": {"date": "2026-01-01", "amount": "25000.00"},
        }
        request_key = str(uuid4())
        created = await command("POST", "/investments", investment_body, request_key)
        assert created.status_code == 200, created.text
        investment = created.json()
        assert investment["opening"]["amount"] == "25000.00"
        assert investment["contribution_progress"] == "0.00"
        assert (
            await command("POST", "/investments", investment_body, request_key)
        ).json() == investment
        assert (
            await command(
                "POST",
                "/investments",
                {
                    **investment_body,
                    "name": "Different",
                },
                request_key,
            )
        ).status_code == 409
        giving = await command(
            "POST",
            "/giving-recipients",
            {
                "name": "Example recipient",
                "target": "500.00",
            },
        )
        assert giving.status_code == 200, giving.text
        recipient = giving.json()
        assert recipient["opening"] is None
        assert (
            await command(
                "POST",
                "/giving-recipients",
                {
                    "name": "Invalid",
                    "opening": investment_body["opening"],
                },
            )
        ).status_code == 422
        assert (
            await client.get(f"/api/entities/{foreign}/giving-recipients")
        ).status_code == 404
        before = {
            "date": "2025-12-31",
            "amount": "100.00",
            "investment_id": investment["uuid"],
            "note": "",
            "is_adjustment": False,
        }
        assert (
            await command("POST", "/investment-activity", before)
        ).status_code == 422
        body = {**before, "date": "2026-01-01", "amount": "1000.00"}
        contribution = await command("POST", "/investment-activity", body)
        assert contribution.status_code == 200, contribution.text
        entry = contribution.json()
        assert entry["investment_id"] == investment["uuid"]
        assert (await client.get(path + "/investments")).json()[0][
            "contribution_progress"
        ] == "1000.00"
        assert (await client.get(path + "/investment-activity")).json()[0][
            "uuid"
        ] == entry["uuid"]
        assert (await client.get(path + "/activity")).json()[0][
            "investment_id"
        ] == investment["uuid"]
        generic = await command(
            "PUT",
            f"/activity/{entry['uuid']}",
            {
                "date": "2026-01-01",
                "category": "spending",
                "amount": "1000.00",
                "note": "",
                "is_adjustment": False,
            },
        )
        assert generic.status_code == 422
        assert (
            await command(
                "DELETE",
                f"/activity/{entry['uuid']}",
                {
                    "expected_revision": 1,
                },
            )
        ).status_code == 422
        inactive = await command(
            "PUT",
            f"/investments/{investment['uuid']}",
            {
                "name": "Example fund",
                "target": "2000.00",
                "active": False,
                "expected_revision": 1,
            },
        )
        assert inactive.status_code == 200, inactive.text
        assert (await command("POST", "/investment-activity", body)).status_code == 422
        corrected = await command(
            "PUT",
            f"/investment-activity/{entry['uuid']}",
            {
                **body,
                "amount": "900.00",
                "expected_revision": 1,
            },
        )
        assert corrected.status_code == 200, corrected.text
        assert corrected.json()["amount"] == "900.00"
        assert (
            await command(
                "PUT",
                f"/investment-activity/{entry['uuid']}",
                {
                    **body,
                    "amount": "800.00",
                    "expected_revision": 1,
                },
            )
        ).status_code == 409
        assert (
            await command(
                "PUT",
                f"/investment-activity/{entry['uuid']}",
                {
                    **body,
                    "date": "2025-12-31",
                    "expected_revision": 2,
                },
            )
        ).status_code == 422
        assert (
            await command(
                "DELETE",
                f"/investment-activity/{entry['uuid']}",
                {
                    "expected_revision": 2,
                },
            )
        ).status_code == 200
        assert (await client.get(path + "/investments")).json()[0][
            "contribution_progress"
        ] == "0.00"
        assert (await client.get(path + "/investment-activity")).json() == []
        async with sessions() as session:
            row = (
                (
                    await session.execute(
                        select(d.investment_entries).where(
                            d.investment_entries.c.actual_entry_id
                            == await session.scalar(
                                select(m.entries.c.id).where(
                                    m.entries.c.uuid == entry["uuid"]
                                )
                            )
                        )
                    )
                )
                .mappings()
                .one()
            )
            assert row["investment_id"] is not None
            opening_id = await session.scalar(
                select(d.observations.c.id).where(
                    d.observations.c.investment_id == row["investment_id"],
                    d.observations.c.is_opening,
                )
            )
            assert opening_id is not None
            with pytest.raises(SQLAlchemyError):
                await session.execute(
                    update(d.observations)
                    .where(d.observations.c.id == opening_id)
                    .values(amount="26000.00")
                )
            await session.rollback()
        donation = await command(
            "POST",
            "/giving-activity",
            {
                "date": "2026-02-01",
                "amount": "100.00",
                "giving_recipient_id": recipient["uuid"],
                "note": "",
                "is_adjustment": False,
            },
        )
        assert donation.status_code == 200, donation.text
        adjustment = await command(
            "POST",
            "/giving-activity",
            {
                "date": "2026-02-02",
                "amount": "-25.00",
                "giving_recipient_id": recipient["uuid"],
                "note": "Correction",
                "is_adjustment": True,
            },
        )
        assert adjustment.status_code == 200, adjustment.text
        assert adjustment.json()["giving_recipient_id"] == recipient["uuid"]
        wrong_field = await command(
            "POST",
            "/giving-activity",
            {
                "date": "2026-02-02",
                "amount": "5.00",
                "investment_id": recipient["uuid"],
            },
        )
        assert wrong_field.status_code == 422, wrong_field.text
        assert (await client.get(path + "/giving-recipients")).json()[0][
            "contribution_progress"
        ] == "75.00"
        assert (
            await command(
                "POST",
                "/investment-activity",
                {
                    "date": "2026-02-02",
                    "amount": "-1.00",
                    "investment_id": None,
                    "note": "",
                    "is_adjustment": False,
                },
            )
        ).status_code == 422
        unassigned = await command(
            "POST",
            "/investment-activity",
            {
                "date": "2026-02-02",
                "amount": "40.00",
                "investment_id": None,
                "note": "",
                "is_adjustment": False,
            },
        )
        assert unassigned.status_code == 200, unassigned.text
        assert (await client.get(path + "/investments")).json()[0][
            "contribution_progress"
        ] == "0.00"
        reopened = await command(
            "PUT",
            f"/investments/{investment['uuid']}",
            {
                "name": "Example fund",
                "target": "2000.00",
                "active": True,
                "expected_revision": 2,
            },
        )
        assert reopened.status_code == 200, reopened.text
        resumed = await command(
            "POST", "/investment-activity", {**body, "amount": "50.00"}
        )
        assert resumed.status_code == 200, resumed.text
        assert (await client.get(path + "/investments")).json()[0][
            "contribution_progress"
        ] == "50.00"
        one, small_cost = await counted_get(client, engine, path + "/investments")
        for i in range(11):
            created = await command("POST", "/investments", {"name": f"Synthetic {i}"})
            assert created.status_code == 200
        many, large_cost = await counted_get(client, engine, path + "/investments")
        assert len(one) == 1 and len(many) == 12
        assert many[:1] == one
        assert all(
            row["latest"] is None and row["contribution_progress"] == "0.00"
            for row in many[1:]
        )
        assert large_cost == small_cost
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://test",
            headers={"Authorization": f"Bearer {other_key['key']}"},
        ) as other_client:
            assert (
                await other_client.get(path + "/investment-activity")
            ).status_code == 404
            assert (
                await other_client.put(
                    path + f"/giving-recipients/{recipient['uuid']}",
                    json={
                        "name": "No access",
                        "target": None,
                        "active": False,
                        "expected_revision": 1,
                    },
                    headers={"Idempotency-Key": str(uuid4())},
                )
            ).status_code == 404
        async with sessions() as session:
            assert (
                await session.scalar(
                    select(func.count())
                    .select_from(m.audit)
                    .where(m.audit.c.record_uuid == entry["uuid"])
                )
                == 3
            )
        await moving_opening(client, command, sessions, path)
        await tax_treatment_and_liquidity(client, command, sessions, path)
    await engine.dispose()


async def moving_opening(client, command, sessions, path):
    """An opening date moves only where no current activity would predate it."""
    created = await command(
        "POST",
        "/investments",
        {
            "name": "Synthetic brokerage",
            "opening": {"date": "2026-03-01", "amount": "100.00"},
        },
    )
    uuid = created.json()["uuid"]
    contribution = await command(
        "POST",
        "/investment-activity",
        {"date": "2026-03-10", "amount": "10.00", "investment_id": uuid},
    )
    assert contribution.status_code == 200, contribution.text
    observed = await command(
        "POST",
        "/investment-observations",
        {"date": "2026-03-20", "amount": "120.00", "account_id": uuid},
    )
    assert observed.status_code == 200, observed.text

    def edit(day, revision):
        return {
            "name": "Synthetic brokerage",
            "target": None,
            "active": True,
            "expected_revision": revision,
            "opening_date": day,
        }

    key = str(uuid4())
    earlier = await command("PUT", f"/investments/{uuid}", edit("2026-02-01", 1), key)
    assert earlier.status_code == 200, earlier.text
    assert earlier.json()["opening"] == {"date": "2026-02-01", "amount": "100.00"}
    assert earlier.json()["revision"] == 2
    replay = await command("PUT", f"/investments/{uuid}", edit("2026-02-01", 1), key)
    assert replay.json() == earlier.json()
    assert (
        await command("PUT", f"/investments/{uuid}", edit("2026-02-15", 1))
    ).status_code == 409
    # The contribution on 03-10 blocks a move past it, and nothing changes.
    blocked = await command("PUT", f"/investments/{uuid}", edit("2026-03-11", 2))
    assert blocked.status_code == 422
    assert blocked.json()["detail"]["code"] == "activity_before_opening"
    listed = next(
        row
        for row in (await client.get(path + "/investments")).json()
        if row["uuid"] == uuid
    )
    assert (listed["opening"]["date"], listed["revision"]) == ("2026-02-01", 2)
    entry = contribution.json()
    assert (
        await command(
            "DELETE",
            f"/investment-activity/{entry['uuid']}",
            {"expected_revision": entry["revision"]},
        )
    ).status_code == 200
    # With the contribution deleted, the observation on 03-20 is the boundary:
    # one day later is refused, the same day is allowed.
    assert (await command("PUT", f"/investments/{uuid}", edit("2026-03-21", 2))).json()[
        "detail"
    ]["code"] == "activity_before_opening"
    later = await command("PUT", f"/investments/{uuid}", edit("2026-03-20", 2))
    assert later.status_code == 200, later.text
    assert later.json()["opening"]["date"] == "2026-03-20"
    assert (
        await command(
            "POST",
            "/investment-activity",
            {"date": "2026-03-19", "amount": "5.00", "investment_id": uuid},
        )
    ).json()["detail"]["code"] == "before_opening"
    unchanged = await command("PUT", f"/investments/{uuid}", edit("2026-03-20", 3))
    assert unchanged.status_code == 200, unchanged.text
    no_opening = (await command("POST", "/investments", {"name": "No opening"})).json()
    assert (
        await command(
            "PUT", f"/investments/{no_opening['uuid']}", edit("2026-03-01", 1)
        )
    ).json()["detail"]["code"] == "no_opening"
    recipient = (
        await command("POST", "/giving-recipients", {"name": "Synthetic"})
    ).json()
    assert (
        await command(
            "PUT", f"/giving-recipients/{recipient['uuid']}", edit("2026-03-01", 1)
        )
    ).json()["detail"]["code"] == "invalid_opening"
    async with sessions() as session:
        opening = (
            (
                await session.execute(
                    select(d.observations)
                    .join(
                        d.investments,
                        d.investments.c.id == d.observations.c.investment_id,
                    )
                    .where(d.investments.c.uuid == uuid, d.observations.c.is_opening)
                )
            )
            .mappings()
            .one()
        )
        # Created, then moved twice; the same-date edit and the replay add nothing.
        assert opening["revision"] == 3
        audits = (
            await session.execute(
                select(m.audit.c.before, m.audit.c.after)
                .where(m.audit.c.record_uuid == opening["uuid"])
                .order_by(m.audit.c.id)
            )
        ).all()
        assert [row.after["financial_date"] for row in audits] == [
            "2026-03-01",
            "2026-02-01",
            "2026-03-20",
        ]
        assert audits[1].before["financial_date"] == "2026-03-01"
        # The database refuses a move past current activity even outside the service.
        with pytest.raises(SQLAlchemyError):
            await session.execute(
                update(d.observations)
                .where(d.observations.c.id == opening["id"])
                .values(financial_date="2026-03-21")
            )
        await session.rollback()


async def tax_treatment_and_liquidity(client, command, sessions, path):
    """Investments default to taxable and liquid; an edit that omits either keeps it."""
    plain = (await command("POST", "/investments", {"name": "Synthetic index"})).json()
    assert (plain["tax_treatment"], plain["liquidity"]) == ("taxable", "liquid")
    house = (
        await command(
            "POST",
            "/investments",
            {
                "name": "Synthetic house",
                "tax_treatment": "tax_advantaged",
                "liquidity": "illiquid",
            },
        )
    ).json()
    assert (house["tax_treatment"], house["liquidity"]) == (
        "tax_advantaged",
        "illiquid",
    )
    base = {"name": "Synthetic house", "target": None, "active": True}
    renamed = await command(
        "PUT", f"/investments/{house['uuid']}", base | {"expected_revision": 1}
    )
    assert renamed.status_code == 200, renamed.text
    assert (renamed.json()["tax_treatment"], renamed.json()["liquidity"]) == (
        "tax_advantaged",
        "illiquid",
    )
    changed = await command(
        "PUT",
        f"/investments/{house['uuid']}",
        base | {"expected_revision": 2, "tax_treatment": "taxable"},
    )
    assert (changed.json()["tax_treatment"], changed.json()["liquidity"]) == (
        "taxable",
        "illiquid",
    )
    listed = {
        row["uuid"]: row for row in (await client.get(path + "/investments")).json()
    }
    assert listed[house["uuid"]]["tax_treatment"] == "taxable"
    assert listed[plain["uuid"]]["liquidity"] == "liquid"
    assert (
        await command(
            "PUT",
            f"/investments/{house['uuid']}",
            base | {"expected_revision": 3, "liquidity": "frozen"},
        )
    ).status_code == 422
    refused = await command(
        "POST", "/giving-recipients", {"name": "Synthetic", "liquidity": "liquid"}
    )
    assert refused.json()["detail"]["code"] == "invalid_traits"
    async with sessions() as session:
        audits = (
            await session.execute(
                select(m.audit.c.after)
                .where(m.audit.c.record_uuid == house["uuid"])
                .order_by(m.audit.c.id)
            )
        ).scalars()
        assert [row["tax_treatment"] for row in audits] == [
            "tax_advantaged",
            "tax_advantaged",
            "taxable",
        ]
        # The database refuses a value outside each set even outside the service.
        with pytest.raises(SQLAlchemyError):
            await session.execute(
                update(d.investments)
                .where(d.investments.c.uuid == house["uuid"])
                .values(liquidity="frozen")
            )
        await session.rollback()
