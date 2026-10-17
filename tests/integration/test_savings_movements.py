"""Savings movement API, ordered history and atomic rejection on an isolated DB."""

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


def test_movements_reconciliation_and_history():
    asyncio.run(scenario())


async def scenario():
    assert URL and URL.rsplit("/", 1)[-1].endswith("_test")
    engine = create_async_engine(URL)
    sessions = async_sessionmaker(engine)
    async with sessions() as session, session.begin():
        user_id = await session.scalar(
            insert(m.users)
            .values(issuer="movement-test", subject=str(uuid4()))
            .returning(m.users.c.id)
        )
        entity = await session.scalar(
            insert(m.entities)
            .values(owner_id=user_id, name="Synthetic Entity", time_zone="UTC")
            .returning(m.entities.c.uuid)
        )
        key = await issue_key(session, user_id, "Synthetic movement test")
    app = create_app()

    async def dependency():
        async with sessions() as session:
            yield session

    app.dependency_overrides[get_session] = dependency
    root = f"/api/entities/{entity}/savings-accounts"
    movements = f"{root}/movements"
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
        headers={"Authorization": f"Bearer {key['key']}"},
    ) as client:

        async def write(method, path, body, request_key=None):
            return await client.request(
                method,
                path,
                json=body,
                headers={"Idempotency-Key": request_key or str(uuid4())},
            )

        async def account(name, opening, goal_name, designated):
            response = await write(
                "POST",
                root,
                {
                    "name": name,
                    "opening_date": "2026-09-01",
                    "opening_amount": opening,
                    "goals": [
                        {
                            "name": goal_name,
                            "kind": "ongoing",
                            "target": None,
                            "opening_amount": designated,
                        }
                    ],
                },
            )
            assert response.status_code == 200, response.text
            data = response.json()
            return data, next(g for g in data["goals"] if g["name"] == goal_name)

        source_account, source = await account(
            "Source account", "100.00", "Source goal", "100.00"
        )
        destination_account, destination = await account(
            "Destination account", "0.00", "Destination goal", "0.00"
        )
        base = {
            "kind": "transfer",
            "date": "2026-09-15",
            "from_goal_id": source["uuid"],
            "to_goal_id": destination["uuid"],
            "amount": "200.00",
            "note": "Synthetic transfer",
        }
        failed = await write("POST", movements, base)
        assert (
            failed.status_code == 422
            and failed.json()["detail"]["code"] == "savings_shortfall"
        )
        contribution = await write(
            "POST",
            f"/api/entities/{entity}/activity",
            {
                "date": "2026-10-01",
                "category": "saving",
                "amount": "400.00",
                "note": "Synthetic contribution",
                "saving_goal_id": source["uuid"],
            },
        )
        assert contribution.status_code == 200, contribution.text
        assert (await write("POST", movements, base)).status_code == 422
        invalid_kind = await write("POST", movements, {**base, "kind": "reassignment"})
        assert invalid_kind.status_code == 422
        transfer_key = str(uuid4())
        transfer_body = {**base, "amount": "100.00"}
        transfer = await write("POST", movements, transfer_body, transfer_key)
        assert transfer.status_code == 200, transfer.text
        moved = transfer.json()
        repeated = await write("POST", movements, transfer_body, transfer_key)
        assert repeated.status_code == 200 and repeated.json() == moved
        changed_retry = await write(
            "POST", movements, {**base, "amount": "50.00"}, transfer_key
        )
        assert changed_retry.status_code == 409
        assert (
            await write(
                "POST",
                movements,
                {**base, "amount": "100.00", "to_goal_id": source["uuid"]},
            )
        ).status_code == 422
        accounts = (await client.get(root)).json()
        assert [account["balance"] for account in accounts] == ["400.00", "100.00"]
        assert sum(float(account["balance"]) for account in accounts) == 500
        purchase = await write(
            "POST",
            f"/api/entities/{entity}/activity",
            {
                "date": "2026-10-02",
                "category": "spending",
                "amount": "100.00",
                "note": "Synthetic purchase",
                "funding_origin": "savings",
                "saving_goal_id": destination["uuid"],
            },
        )
        assert purchase.status_code == 200, purchase.text
        before = (await client.get(movements)).json()
        deletion = await write(
            "DELETE",
            f"{movements}/{moved['uuid']}",
            {"kind": "transfer", "expected_revision": moved["revision"]},
        )
        assert deletion.status_code == 422
        correction = await write(
            "PUT",
            f"{movements}/{moved['uuid']}",
            {**base, "amount": "50.00", "expected_revision": moved["revision"]},
        )
        assert correction.status_code == 422
        assert (await client.get(movements)).json() == before
        async with sessions() as session:
            assert (
                len(
                    (
                        await session.execute(
                            select(m.audit.c.id).where(
                                m.audit.c.record_uuid == moved["uuid"]
                            )
                        )
                    ).all()
                )
                == 1
            )
            assert (
                await session.execute(
                    select(s.transfers.c.deleted_at).where(
                        s.transfers.c.uuid == moved["uuid"]
                    )
                )
            ).scalar_one() is None
        # One pot changes; opening and contribution totals stay recorded.
        third, goal = await account(
            "Reconcile account", "5200.00", "Other goal", "1000.00"
        )
        unallocated = next(g for g in third["goals"] if g["role"] == "unallocated")
        recon = await write(
            "POST",
            movements,
            {
                "kind": "reconciliation",
                "date": "2026-10-03",
                "goal_id": unallocated["uuid"],
                "known_amount": "4000.00",
                "note": "Synthetic known amount",
            },
        )
        assert recon.status_code == 200, recon.text
        assert recon.json()["amount"] == "-200.00"
        third_after = (await client.get(f"{root}/{third['uuid']}")).json()
        assert third_after["opening_amount"] == "5200.00"
        assert third_after["balance"] == "5000.00"
        by_id = {g["uuid"]: g for g in third_after["goals"]}
        assert by_id[goal["uuid"]]["remaining_saved"] == "1000.00"
        assert by_id[unallocated["uuid"]]["remaining_saved"] == "4000.00"
        assert all(g["contribution_progress"] == "0.00" for g in third_after["goals"])
        assert len((await client.get(movements)).json()) == 2
        # Reassignment changes goals in one account without moving account funds.
        source_unallocated = next(
            g for g in source_account["goals"] if g["role"] == "unallocated"
        )
        reassignment = await write(
            "POST",
            movements,
            {
                "kind": "reassignment",
                "date": "2026-10-04",
                "from_goal_id": source["uuid"],
                "to_goal_id": source_unallocated["uuid"],
                "amount": "100.00",
                "note": "Synthetic reassignment",
            },
        )
        assert reassignment.status_code == 200, reassignment.text
        source_after = (await client.get(f"{root}/{source_account['uuid']}")).json()
        assert source_after["balance"] == "400.00"
        assert (
            next(
                g
                for g in source_after["goals"]
                if g["uuid"] == source_unallocated["uuid"]
            )["remaining_saved"]
            == "100.00"
        )
        # Two competing $250 transfers cannot both spend the same $300 source goal.
        race_body = {**base, "date": "2026-10-05", "amount": "250.00"}
        raced = await asyncio.gather(
            write("POST", movements, race_body),
            write("POST", movements, race_body),
        )
        assert sorted(response.status_code for response in raced) == [200, 422]
        assert (await client.get(f"{root}/{source_account['uuid']}")).json()[
            "balance"
        ] == "150.00"
        # Funding recorded later on the same day cannot fund an earlier transfer.
        order_account, order_source = await account(
            "Order source", "100.00", "Order source goal", "100.00"
        )
        _, order_destination = await account(
            "Order destination", "0.00", "Order destination goal", "0.00"
        )
        ordered_body = {
            **base,
            "date": "2026-10-10",
            "amount": "100.00",
            "from_goal_id": order_source["uuid"],
            "to_goal_id": order_destination["uuid"],
        }
        ordered = (await write("POST", movements, ordered_body)).json()
        later_funding = await write(
            "POST",
            f"/api/entities/{entity}/activity",
            {
                "date": "2026-10-10",
                "category": "saving",
                "amount": "100.00",
                "note": "Synthetic later funding",
                "saving_goal_id": order_source["uuid"],
            },
        )
        assert later_funding.status_code == 200, later_funding.text
        ordered_edit = await write(
            "PUT",
            f"{movements}/{ordered['uuid']}",
            {
                **ordered_body,
                "amount": "200.00",
                "expected_revision": ordered["revision"],
            },
        )
        assert ordered_edit.status_code == 422
        assert (await client.get(f"{root}/{order_account['uuid']}")).json()[
            "balance"
        ] == "100.00"
        inactive = await write(
            "PUT",
            f"{root}/{order_account['uuid']}/goals/{order_source['uuid']}",
            {
                "name": "Order source goal",
                "kind": "ongoing",
                "target": None,
                "active": False,
                "expected_revision": order_source["revision"],
            },
        )
        assert inactive.status_code == 200, inactive.text
        retained_correction = await write(
            "PUT",
            f"{movements}/{ordered['uuid']}",
            {
                **ordered_body,
                "note": "Corrected synthetic note",
                "expected_revision": ordered["revision"],
            },
        )
        assert retained_correction.status_code == 200, retained_correction.text
    await engine.dispose()
