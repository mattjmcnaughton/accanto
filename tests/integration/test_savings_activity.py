"""Real database savings history and account opening protection.

Use a fresh migrated ACCANTO_TEST_DATABASE_URL ending in `_test`.
"""

import asyncio
import os
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import insert, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from accanto.app import create_app
from accanto.db import get_session
from accanto.models import monthly as m
from accanto.models import savings as s
from accanto.services.api_keys import issue_key

URL = os.environ.get("ACCANTO_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not URL, reason="Use an isolated migrated test database"
)


def test_saving_contributions_purchase_history_and_concurrency():
    asyncio.run(scenario())


async def scenario():
    assert URL and URL.rsplit("/", 1)[-1].endswith("_test")
    engine = create_async_engine(URL)
    sessions = async_sessionmaker(engine)
    async with sessions() as session, session.begin():
        user_id = await session.scalar(
            insert(m.users)
            .values(issuer="saving-activity-test", subject=str(uuid4()))
            .returning(m.users.c.id)
        )
        entity = await session.scalar(
            insert(m.entities)
            .values(owner_id=user_id, name="Synthetic Entity", time_zone="UTC")
            .returning(m.entities.c.uuid)
        )
        key = await issue_key(session, user_id, "Synthetic activity test")
    app = create_app()

    async def dependency():
        async with sessions() as session:
            yield session

    app.dependency_overrides[get_session] = dependency
    headers = {"Authorization": f"Bearer {key['key']}"}
    account_path = f"/api/entities/{entity}/savings-accounts"
    activity_path = f"/api/entities/{entity}/activity"
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test", headers=headers
    ) as client:

        async def write(method, path, body, request_key=None):
            return await client.request(
                method,
                path,
                json=body,
                headers={"Idempotency-Key": request_key or str(uuid4())},
            )

        account_response = await write(
            "POST",
            account_path,
            {
                "name": "Example savings",
                "opening_date": "2026-10-01",
                "opening_amount": "800.00",
                "goals": [
                    {
                        "name": "Laptop",
                        "kind": "finite",
                        "target": "1000.00",
                        "opening_amount": "800.00",
                    }
                ],
            },
        )
        assert account_response.status_code == 200, account_response.text
        account = account_response.json()
        goal = next(g for g in account["goals"] if g["name"] == "Laptop")

        def spending(amount="1000.00", *, goal_id=goal["uuid"]):
            return {
                "date": "2026-10-16",
                "category": "spending",
                "amount": amount,
                "note": "Synthetic purchase",
                "funding_origin": "savings",
                "saving_goal_id": goal_id,
            }

        def saving(amount="200.00", *, goal_id=goal["uuid"], adjustment=False):
            return {
                "date": "2026-10-16",
                "category": "saving",
                "amount": amount,
                "note": "Synthetic contribution",
                "saving_goal_id": goal_id,
                "is_adjustment": adjustment,
            }

        failed = await write("POST", activity_path, spending())
        assert (
            failed.status_code == 422
            and failed.json()["detail"]["code"] == "savings_shortfall"
        )
        assert (await client.get(activity_path)).json() == []
        assert (
            await write("POST", activity_path, {**saving(), "date": "2026-09-30"})
        ).status_code == 422
        assert (
            await write(
                "POST", activity_path, {**spending("100.00"), "date": "2026-09-30"}
            )
        ).status_code == 422
        for amount in ("200.00", "0.00"):
            bad = saving(amount, goal_id=None, adjustment=amount == "0.00")
            assert (await write("POST", activity_path, bad)).status_code == 422
        contribution = await write("POST", activity_path, saving())
        assert contribution.status_code == 200, contribution.text
        saved = contribution.json()
        purchase = await write("POST", activity_path, spending())
        assert purchase.status_code == 200, purchase.text
        bought = purchase.json()
        current = (await client.get(f"{account_path}/{account['uuid']}")).json()
        laptop = next(g for g in current["goals"] if g["uuid"] == goal["uuid"])
        assert current["balance"] == "0.00"
        assert laptop["contribution_progress"] == "200.00"
        assert laptop["remaining_saved"] == "0.00"
        activity = (await client.get(activity_path)).json()
        assert all("recording_order" not in row for row in activity)
        assert [(row["category"], row["amount"]) for row in activity] == [
            ("saving", "200.00"),
            ("spending", "1000.00"),
        ]

        async def opening_change(**changes):
            present = (await client.get(f"{account_path}/{account['uuid']}")).json()
            body = {
                "name": present["name"],
                "opening_date": present["opening_date"],
                "opening_amount": present["opening_amount"],
                "expected_revision": present["revision"],
                "designations": [
                    {"goal_id": g["uuid"], "opening_amount": g["opening_amount"]}
                    for g in present["goals"]
                    if g["role"] == "ordinary"
                ],
            }
            body.update(changes)
            return await write("PUT", f"{account_path}/{account['uuid']}", body)

        assert (await opening_change(opening_date="2026-09-30")).status_code == 422
        assert (await opening_change(opening_amount="900.00")).status_code == 422
        assert (
            await opening_change(
                designations=[{"goal_id": goal["uuid"], "opening_amount": "799.00"}]
            )
        ).status_code == 422
        deletion = await write(
            "DELETE",
            f"{activity_path}/{saved['uuid']}",
            {"expected_revision": saved["revision"]},
        )
        assert deletion.status_code == 422
        assert "200.00" in deletion.json()["detail"]["message"]
        assert goal["uuid"] in deletion.json()["detail"]["message"]
        assert "2026-10-16" in deletion.json()["detail"]["message"]
        assert (await client.get(activity_path)).json() == activity
        moved_later = await write(
            "PUT",
            f"{activity_path}/{saved['uuid']}",
            {**saving(), "date": "2026-10-17", "expected_revision": saved["revision"]},
        )
        assert moved_later.status_code == 422
        reduced = await write(
            "PUT",
            f"{activity_path}/{saved['uuid']}",
            {**saving("100.00"), "expected_revision": saved["revision"]},
        )
        assert reduced.status_code == 422
        assert (await client.get(activity_path)).json() == activity

        assert (
            await write(
                "DELETE",
                f"{activity_path}/{bought['uuid']}",
                {"expected_revision": bought["revision"]},
            )
        ).status_code == 200
        assert (
            await write(
                "DELETE",
                f"{activity_path}/{saved['uuid']}",
                {"expected_revision": saved["revision"]},
            )
        ).status_code == 200
        assert (await client.get(activity_path)).json() == []
        assert (await opening_change(opening_date="2026-09-30")).status_code == 422
        assert (await opening_change(opening_amount="900.00")).status_code == 422
        assert (
            await opening_change(
                designations=[{"goal_id": goal["uuid"], "opening_amount": "799.00"}]
            )
        ).status_code == 422

        moved_account = await write(
            "POST",
            account_path,
            {
                "name": "Second savings",
                "opening_date": "2026-10-01",
                "opening_amount": "0.00",
                "goals": [
                    {
                        "name": "Other purpose",
                        "kind": "ongoing",
                        "opening_amount": "0.00",
                    }
                ],
            },
        )
        assert moved_account.status_code == 200, moved_account.text
        other_goal = next(
            g for g in moved_account.json()["goals"] if g["name"] == "Other purpose"
        )
        first = await write("POST", activity_path, saving("100.00"))
        assert first.status_code == 200, first.text
        moved = await write(
            "PUT",
            f"{activity_path}/{first.json()['uuid']}",
            {
                **saving("100.00", goal_id=other_goal["uuid"]),
                "expected_revision": first.json()["revision"],
            },
        )
        assert moved.status_code == 200, moved.text
        assert (
            await client.get(f"{account_path}/{moved_account.json()['uuid']}")
        ).json()["balance"] == "100.00"
        assert (await opening_change(opening_date="2026-09-30")).status_code == 422
        async with sessions() as session:
            old_entity_id = await session.scalar(
                select(m.entities.c.id).where(m.entities.c.uuid == entity)
            )
            retained = (
                (
                    await session.execute(
                        select(s.linked_activity)
                        .where(
                            s.linked_activity.c.actual_entry_id
                            == await session.scalar(
                                select(m.entries.c.id).where(
                                    m.entries.c.uuid == first.json()["uuid"]
                                )
                            ),
                            s.linked_activity.c.entity_id == old_entity_id,
                        )
                        .order_by(s.linked_activity.c.id)
                    )
                )
                .mappings()
                .all()
            )
            assert len(retained) == 2
            assert retained[0]["deleted_at"] is not None
            assert retained[1]["deleted_at"] is None
            assert retained[0]["recording_order"] == retained[1]["recording_order"]
        income_correction = await write(
            "PUT",
            f"{activity_path}/{first.json()['uuid']}",
            {
                "date": "2026-10-16",
                "category": "income",
                "amount": "100.00",
                "note": "Synthetic correction",
                "expected_revision": moved.json()["revision"],
            },
        )
        assert income_correction.status_code == 200, income_correction.text
        assert (await opening_change(opening_date="2026-09-30")).status_code == 422
        restored_saving = await write(
            "PUT",
            f"{activity_path}/{first.json()['uuid']}",
            {
                **saving("100.00", goal_id=other_goal["uuid"]),
                "expected_revision": income_correction.json()["revision"],
            },
        )
        assert restored_saving.status_code == 200, restored_saving.text
        async with sessions() as session:
            entry = (
                (
                    await session.execute(
                        select(m.entries).where(
                            m.entries.c.uuid == first.json()["uuid"]
                        )
                    )
                )
                .mappings()
                .one()
            )
            links = (
                (
                    await session.execute(
                        select(s.linked_activity)
                        .where(s.linked_activity.c.actual_entry_id == entry["id"])
                        .order_by(s.linked_activity.c.id)
                    )
                )
                .mappings()
                .all()
            )
            assert len(links) == 3
            assert all(
                link["recording_order"] == entry["recording_order"] for link in links
            )
        known = {
            "date": "2026-10-17",
            "month": "2026-10-01",
            "category": "saving",
            "desired_total": "50.00",
            "saving_goal_id": other_goal["uuid"],
            "contributing_entries": [
                {
                    "uuid": first.json()["uuid"],
                    "revision": restored_saving.json()["revision"],
                }
            ],
        }
        assert (
            await write(
                "POST",
                f"{activity_path}/known-total",
                {**known, "saving_goal_id": None},
            )
        ).status_code == 422
        adjustment = await write("POST", f"{activity_path}/known-total", known)
        assert adjustment.status_code == 200, adjustment.text
        assert adjustment.json()["amount"] == "-50.00"
        assert (
            await client.get(f"{account_path}/{moved_account.json()['uuid']}")
        ).json()["balance"] == "50.00"

        race_account = await write(
            "POST",
            account_path,
            {
                "name": "Race savings",
                "opening_date": "2026-10-01",
                "opening_amount": "800.00",
                "goals": [
                    {
                        "name": "Race goal",
                        "kind": "ongoing",
                        "opening_amount": "800.00",
                    }
                ],
            },
        )
        assert race_account.status_code == 200, race_account.text
        race_goal = next(
            g for g in race_account.json()["goals"] if g["name"] == "Race goal"
        )
        results = await asyncio.gather(
            write("POST", activity_path, spending("600.00", goal_id=race_goal["uuid"])),
            write("POST", activity_path, spending("600.00", goal_id=race_goal["uuid"])),
        )
        assert sorted(result.status_code for result in results) == [200, 422]
        async with sessions() as session:
            links = (
                (
                    await session.execute(
                        select(s.linked_activity).where(
                            s.linked_activity.c.entity_id
                            == await session.scalar(
                                select(m.entities.c.id).where(
                                    m.entities.c.uuid == entity
                                )
                            )
                        )
                    )
                )
                .mappings()
                .all()
            )
            assert len([row for row in links if row["deleted_at"] is None]) == 3
        zero_key = str(uuid4())
        zero = await write(
            "POST",
            activity_path,
            saving("0.00", goal_id=other_goal["uuid"], adjustment=True),
            zero_key,
        )
        assert zero.status_code == 200, zero.text
        repeated = await write(
            "POST",
            activity_path,
            saving("0.00", goal_id=other_goal["uuid"], adjustment=True),
            zero_key,
        )
        assert repeated.json() == zero.json()
        inactive_race = await write(
            "PUT",
            f"{account_path}/{race_account.json()['uuid']}/goals/{race_goal['uuid']}",
            {
                "name": race_goal["name"],
                "kind": "ongoing",
                "target": None,
                "active": False,
                "expected_revision": race_goal["revision"],
            },
        )
        assert inactive_race.status_code == 200, inactive_race.text
        successful_outflow = next(
            result.json() for result in results if result.status_code == 200
        )
        new_contribution = await write(
            "PUT",
            f"{activity_path}/{successful_outflow['uuid']}",
            {
                **saving("600.00", goal_id=race_goal["uuid"]),
                "expected_revision": successful_outflow["revision"],
            },
        )
        assert new_contribution.status_code == 409
        assert new_contribution.json()["detail"]["code"] == "inactive_goal"
        assert (
            await client.get(f"{account_path}/{race_account.json()['uuid']}")
        ).json()["balance"] == "200.00"

        inactive_other = await write(
            "PUT",
            f"{account_path}/{moved_account.json()['uuid']}/goals/{other_goal['uuid']}",
            {
                "name": other_goal["name"],
                "kind": "ongoing",
                "target": None,
                "active": False,
                "expected_revision": other_goal["revision"],
            },
        )
        assert inactive_other.status_code == 200, inactive_other.text
        correction = await write(
            "PUT",
            f"{activity_path}/{restored_saving.json()['uuid']}",
            {
                **saving("100.00", goal_id=other_goal["uuid"]),
                "note": "Clarified synthetic contribution",
                "expected_revision": restored_saving.json()["revision"],
            },
        )
        assert correction.status_code == 200, correction.text
    await engine.dispose()
