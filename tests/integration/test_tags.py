"""Tags on real PostgreSQL: entries, refunds, archive, delete and Review checkpoints."""

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

URL = os.environ.get("ACCANTO_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not URL, reason="Use an isolated migrated test database"
)


def test_tags_across_entries_refunds_and_lifecycle():
    asyncio.run(scenario())


async def scenario():
    assert URL and URL.rsplit("/", 1)[-1].endswith("_test")
    engine = create_async_engine(URL)
    sessions = async_sessionmaker(engine)
    async with sessions() as session, session.begin():
        user = await session.scalar(
            insert(m.users)
            .values(issuer="tag-test", subject=str(uuid4()))
            .returning(m.users.c.id)
        )
        entity, other = [
            await session.scalar(
                insert(m.entities)
                .values(
                    owner_id=user, name=f"Synthetic tag Entity {n}", time_zone="UTC"
                )
                .returning(m.entities.c.uuid)
            )
            for n in (1, 2)
        ]
        key = await issue_key(session, user, "Synthetic tag test")
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

        async def send(method, suffix, body, request_key=None, base=prefix):
            return await client.request(
                method,
                base + suffix,
                json=body,
                headers={"Idempotency-Key": request_key or str(uuid4())},
            )

        async def ok(method, suffix, body, request_key=None):
            response = await send(method, suffix, body, request_key)
            assert response.status_code == 200, response.text
            return response.json()

        trip = await ok("POST", "/tags", {"name": "  Italy   trip "})
        kids = await ok("POST", "/tags", {"name": "Kids"})
        assert trip["name"] == "Italy trip"
        duplicate = await send("POST", "/tags", {"name": "ITALY TRIP"})
        assert duplicate.status_code == 409
        foreign = await ok_other(send, other)

        # One entry carries several tags; a tag from another Entity is unavailable.
        dinner_body = {
            "date": "2026-10-10",
            "category": "spending",
            "amount": "90.00",
            "note": "Synthetic dinner",
            "tag_ids": [kids["uuid"], trip["uuid"], kids["uuid"]],
        }
        dinner = await ok("POST", "/activity", dinner_body)
        assert dinner["tag_ids"] == [kids["uuid"], trip["uuid"]]
        stray = await send(
            "POST", "/activity", {**dinner_body, "tag_ids": [foreign["uuid"]]}
        )
        assert stray.status_code == 404, stray.text

        # An edit that omits tag_ids keeps them; one that sends [] clears them.
        untouched = {k: v for k, v in dinner_body.items() if k != "tag_ids"}
        kept = await ok(
            "PUT",
            f"/activity/{dinner['uuid']}",
            {**untouched, "note": "Synthetic dinner out", "expected_revision": 1},
        )
        assert kept["tag_ids"] == dinner["tag_ids"]

        # Every category takes tags, including giving contributions.
        recipient = await ok("POST", "/giving-recipients", {"name": "Example charity"})
        gift = await ok(
            "POST",
            "/giving-activity",
            {
                "date": "2026-10-12",
                "amount": "50.00",
                "giving_recipient_id": recipient["uuid"],
                "tag_ids": [trip["uuid"]],
            },
        )
        assert gift["tag_ids"] == [trip["uuid"]]

        # A refund inherits its purchase's tags and follows later changes.
        refund = await ok(
            "POST",
            f"/activity/{dinner['uuid']}/refunds",
            {"date": "2026-11-02", "amount": "30.00"},
        )
        assert refund["tag_ids"] == [kids["uuid"], trip["uuid"]]
        own = await send(
            "POST",
            "/activity/tags",
            {
                "entries": [
                    {
                        "entry_id": refund["uuid"],
                        "expected_revision": refund["revision"],
                        "tag_ids": [],
                    }
                ]
            },
        )
        assert own.status_code == 422 and own.json()["detail"]["code"] == "refund_tags"

        # Review checkpoint for October, then a label-only edit marks it changed.
        version = await reviewed_october(ok)
        label_key = str(uuid4())
        label_body = {
            "entries": [
                {
                    "entry_id": dinner["uuid"],
                    "expected_revision": kept["revision"],
                    "tag_ids": [trip["uuid"]],
                }
            ]
        }
        labelled = await ok("POST", "/activity/tags", label_body, label_key)
        relabelled = labelled["entries"][0]
        assert relabelled["tag_ids"] == [trip["uuid"]]
        assert relabelled["revision"] == kept["revision"] + 1
        assert relabelled["amount"] == "90.00" and relabelled["note"] == kept["note"]
        # A retry returns the recorded outcome without another revision.
        assert await ok("POST", "/activity/tags", label_body, label_key) == labelled
        review = (await client.get(prefix + "/reviews/2026-10-01")).json()
        assert review["checkpoint_changed"] is True
        assert review["version"]["uuid"] == version
        rows = {r["uuid"]: r for r in (await client.get(prefix + "/activity")).json()}
        assert rows[refund["uuid"]]["tag_ids"] == [trip["uuid"]]
        assert rows[refund["uuid"]]["revision"] == refund["revision"] + 1

        # Filter by tag.
        tagged = (
            await client.get(prefix + "/activity", params={"tag_id": trip["uuid"]})
        ).json()
        assert {r["uuid"] for r in tagged} == {
            dinner["uuid"],
            gift["uuid"],
            refund["uuid"],
        }

        # Archive: kept on existing entries, not addable to others.
        archived = await ok(
            "PUT",
            f"/tags/{trip['uuid']}",
            {"name": "Italy trip", "active": False, "expected_revision": 1},
        )
        assert archived["active"] is False and archived["entries"] == 3
        new_entry = await send(
            "POST",
            "/activity",
            {**dinner_body, "date": "2026-10-20", "tag_ids": [trip["uuid"]]},
        )
        assert new_entry.status_code == 422
        assert new_entry.json()["detail"]["code"] == "archived_tag"
        await ok(
            "PUT",
            f"/activity/{dinner['uuid']}",
            {
                **dinner_body,
                "tag_ids": [trip["uuid"], kids["uuid"]],
                "expected_revision": relabelled["revision"],
            },
        )

        # Delete: removed from every entry, each audited; the name is reusable.
        async with sessions() as session:
            audits_before = await session.scalar(
                select(func.count()).select_from(m.audit)
            )
        deleted = await ok("DELETE", f"/tags/{trip['uuid']}", {"expected_revision": 2})
        assert deleted["entries_changed"] == 3
        rows = (await client.get(prefix + "/activity")).json()
        assert all(trip["uuid"] not in r["tag_ids"] for r in rows)
        async with sessions() as session:
            audits_after = await session.scalar(
                select(func.count()).select_from(m.audit)
            )
        assert (audits_after or 0) - (audits_before or 0) == 4  # three entries, the tag
        listed = (await client.get(prefix + "/tags")).json()
        assert [t["name"] for t in listed] == ["Kids"]
        assert (await send("POST", "/tags", {"name": "Italy trip"})).status_code == 200
    await engine.dispose()


async def ok_other(send, other):
    response = await send(
        "POST", "/tags", {"name": "Elsewhere"}, base=f"/api/entities/{other}"
    )
    assert response.status_code == 200, response.text
    return response.json()


async def reviewed_october(ok):
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
        await ok("POST", f"/plans/{plan['plan_id']}/versions", {"expected_revision": 1})
    )["version"]["uuid"]
    await ok("POST", "/reviews", {"month": "2026-10-01", "version_id": version})
    await ok(
        "PUT",
        "/reviews/2026-10-01",
        {
            "expected_revision": 1,
            "version_id": version,
            "note": "",
            "reviewed": True,
        },
    )
    return version
