"""Real PostgreSQL refund atomicity and Entity-lock races using synthetic records."""

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


@pytest.mark.parametrize("race_case", ["refunds", "purchase_edit"])
def test_linked_refunds_and_racing_writes(race_case):
    asyncio.run(scenario(race_case))


async def scenario(race_case):
    assert URL and URL.rsplit("/", 1)[-1].endswith("_test")
    engine = create_async_engine(URL)
    sessions = async_sessionmaker(engine)
    async with sessions() as session, session.begin():
        user = await session.scalar(
            insert(m.users)
            .values(issuer="refund-test", subject=str(uuid4()))
            .returning(m.users.c.id)
        )
        entity = await session.scalar(
            insert(m.entities)
            .values(owner_id=user, name="Synthetic refund Entity", time_zone="UTC")
            .returning(m.entities.c.uuid)
        )
        key = await issue_key(session, user, "Synthetic refund test")
        competing_key = await issue_key(
            session, user, "Synthetic competing refund test"
        )
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

        async def command(method, suffix, body, *, credential=None):
            return await client.request(
                method,
                prefix + suffix,
                json=body,
                headers={
                    "Idempotency-Key": str(uuid4()),
                    "Authorization": f"Bearer {credential or key['key']}",
                },
            )

        account = await command(
            "POST",
            "/savings-accounts",
            {
                "name": "Synthetic cash",
                "opening_date": "2026-10-01",
                "opening_amount": "1000.00",
                "goals": [
                    {
                        "name": "Example purchase",
                        "kind": "finite",
                        "target": "1000.00",
                        "opening_amount": "1000.00",
                    }
                ],
            },
        )
        assert account.status_code == 200, account.text
        goal = next(
            g for g in account.json()["goals"] if g["name"] == "Example purchase"
        )
        purchase_body = {
            "date": "2026-10-10",
            "category": "spending",
            "amount": "1000.00",
            "note": "Synthetic item",
            "funding_origin": "savings",
            "saving_goal_id": goal["uuid"],
        }
        purchase_result = await command("POST", "/activity", purchase_body)
        assert purchase_result.status_code == 200, purchase_result.text
        purchase = purchase_result.json()
        refund_path = f"/activity/{purchase['uuid']}/refunds"
        early = await command(
            "POST",
            refund_path,
            {
                "date": "2026-10-09",
                "amount": "300.00",
            },
        )
        assert early.status_code == 422
        first_result = await command(
            "POST",
            refund_path,
            {
                "date": "2026-11-04",
                "amount": "300.00",
            },
        )
        assert first_result.status_code == 200, first_result.text
        first = first_result.json()
        assert first["refund_of"] == purchase["uuid"]
        assert first["funding_origin"] == "savings"
        assert first["saving_goal_id"] == goal["uuid"]
        assert first["amount"] == "-300.00"
        assert first["remaining_refundable"] == "700.00"
        harmless = await command(
            "PUT",
            f"/activity/{purchase['uuid']}",
            {
                **purchase_body,
                "note": "Corrected synthetic item",
                "expected_revision": 1,
            },
        )
        assert harmless.status_code == 200, harmless.text
        assert harmless.json()["revision"] == 2
        rows = (await client.get(prefix + "/activity")).json()
        assert [(r["financial_date"], r["amount"]) for r in rows] == [
            ("2026-10-10", "1000.00"),
            ("2026-11-04", "-300.00"),
        ]
        assert rows[0]["remaining_refundable"] == "700.00"
        plan_result = await command(
            "POST",
            "/plans",
            {
                "name": "Synthetic refund comparison",
                "incomes": [{"name": "Synthetic source", "amount": "2000.00"}],
                "spending": "1000.00",
            },
        )
        assert plan_result.status_code == 200, plan_result.text
        plan = plan_result.json()
        saved = await command(
            "POST", f"/plans/{plan['plan_id']}/versions", {"expected_revision": 1}
        )
        assert saved.status_code == 200, saved.text
        version = saved.json()["version"]
        for month, expected in (("2026-10-01", "1000.00"), ("2026-11-01", "-300.00")):
            review = await command(
                "POST",
                "/reviews",
                {
                    "month": month,
                    "version_id": version["uuid"],
                },
            )
            assert review.status_code == 200, review.text
            detail = await client.get(prefix + f"/reviews/{month}")
            assert detail.status_code == 200, detail.text
            assert detail.json()["actual"]["spending_recorded"] == expected
            assert detail.json()["actual"]["income_recorded"] is None
        async with sessions() as session:
            entity_id = await session.scalar(
                select(m.entities.c.id).where(m.entities.c.uuid == entity)
            )
            audit_count = await session.scalar(
                select(func.count())
                .select_from(m.audit)
                .where(m.audit.c.entity_id == entity_id)
            )
            outcome_count = await session.scalar(
                select(func.count())
                .select_from(m.outcomes)
                .where(m.outcomes.c.entity_id == entity_id)
            )
        for invalid in (
            {**purchase_body, "date": "2026-11-05", "expected_revision": 2},
            {**purchase_body, "amount": "299.00", "expected_revision": 2},
            {
                **purchase_body,
                "funding_origin": "income",
                "saving_goal_id": None,
                "expected_revision": 2,
            },
        ):
            failure = await command("PUT", f"/activity/{purchase['uuid']}", invalid)
            assert failure.status_code == 422, failure.text
        assert (
            await command(
                "DELETE", f"/activity/{purchase['uuid']}", {"expected_revision": 2}
            )
        ).status_code == 422
        oversized = await command(
            "POST",
            refund_path,
            {
                "date": "2026-11-05",
                "amount": "701.00",
            },
        )
        assert oversized.status_code == 422
        assert "Remaining refundable: $700.00" in oversized.json()["detail"]["message"]
        async with sessions() as session:
            assert (
                await session.scalar(
                    select(func.count())
                    .select_from(m.audit)
                    .where(m.audit.c.entity_id == entity_id)
                )
                == audit_count
            )
            assert (
                await session.scalar(
                    select(func.count())
                    .select_from(m.outcomes)
                    .where(m.outcomes.c.entity_id == entity_id)
                )
                == outcome_count
            )
        assert (await client.get(prefix + "/activity")).json() == rows
        # Two writers see the same remaining amount; the Entity lock permits one.
        first_competitor = command(
            "POST", refund_path, {"date": "2026-11-05", "amount": "700.00"}
        )
        if race_case == "refunds":
            winners = await asyncio.gather(
                first_competitor,
                command(
                    "POST",
                    refund_path,
                    {"date": "2026-11-05", "amount": "700.00"},
                    credential=competing_key["key"],
                ),
            )
            assert sorted(result.status_code for result in winners) == [200, 422], [
                r.text for r in winners
            ]
        else:
            winners = [await first_competitor]
            assert winners[0].status_code == 200, winners[0].text
        second = next(result.json() for result in winners if result.status_code == 200)
        assert second["remaining_refundable"] == "0.00"
        # Editing a refund replaces its old amount and preserves the original link.
        edited = await command(
            "PUT",
            f"/activity/refunds/{first['uuid']}",
            {
                "date": "2026-11-04",
                "amount": "200.00",
                "expected_revision": 1,
            },
        )
        assert edited.status_code == 200, edited.text
        assert edited.json()["refund_of"] == purchase["uuid"]
        assert edited.json()["remaining_refundable"] == "100.00"
        deleted = await command(
            "DELETE", f"/activity/refunds/{second['uuid']}", {"expected_revision": 1}
        )
        assert deleted.status_code == 200, deleted.text
        assert deleted.json()["refund_of"] == purchase["uuid"]
        # Purchase deletion remains blocked until every current refund is deleted.
        assert (
            await command(
                "DELETE", f"/activity/{purchase['uuid']}", {"expected_revision": 2}
            )
        ).status_code == 422
        removed_first = await command(
            "DELETE", f"/activity/refunds/{first['uuid']}", {"expected_revision": 2}
        )
        assert removed_first.status_code == 200, removed_first.text
        removed_purchase = await command(
            "DELETE", f"/activity/{purchase['uuid']}", {"expected_revision": 2}
        )
        assert removed_purchase.status_code == 200, removed_purchase.text
        # A competing purchase reduction and new refund must not both commit.
        second_purchase_body = {
            "date": "2026-10-12",
            "category": "spending",
            "amount": "1000.00",
        }
        second_purchase_result = await command(
            "POST", "/activity", second_purchase_body
        )
        assert second_purchase_result.status_code == 200, second_purchase_result.text
        second_purchase = second_purchase_result.json()
        edit_competitor = command(
            "PUT",
            f"/activity/{second_purchase['uuid']}",
            {
                **second_purchase_body,
                "amount": "500.00",
                "expected_revision": 1,
            },
        )
        if race_case == "purchase_edit":
            competing = await asyncio.gather(
                edit_competitor,
                command(
                    "POST",
                    f"/activity/{second_purchase['uuid']}/refunds",
                    {"date": "2026-11-05", "amount": "700.00"},
                    credential=competing_key["key"],
                ),
            )
        else:
            edited_purchase = await edit_competitor
            rejected_refund = await command(
                "POST",
                f"/activity/{second_purchase['uuid']}/refunds",
                {"date": "2026-11-05", "amount": "700.00"},
                credential=competing_key["key"],
            )
            competing = [edited_purchase, rejected_refund]
        assert sorted(result.status_code for result in competing) == [200, 422], [
            r.text for r in competing
        ]
        current_purchase = next(
            r
            for r in (await client.get(prefix + "/activity")).json()
            if r["uuid"] == second_purchase["uuid"]
        )
        assert (
            current_purchase["amount"],
            current_purchase["remaining_refundable"],
        ) in {("500.00", "500.00"), ("1000.00", "300.00")}

        # Fixed costs with debt, giving, and investing draw from one goal without
        # manufacturing new income saving; refunds return to the same goal.
        second_account_result = await command(
            "POST",
            "/savings-accounts",
            {
                "name": "Synthetic reserve",
                "opening_date": "2026-10-01",
                "opening_amount": "3000.00",
                "goals": [
                    {
                        "name": "General reserve",
                        "kind": "ongoing",
                        "opening_amount": "3000.00",
                    }
                ],
            },
        )
        assert second_account_result.status_code == 200, second_account_result.text
        second_account = second_account_result.json()
        reserve = next(
            g for g in second_account["goals"] if g["name"] == "General reserve"
        )
        loan_result = await command(
            "POST",
            "/debts",
            {
                "name": "Synthetic loan",
                "opening": {"date": "2026-10-01", "amount": "1000.00"},
            },
        )
        assert loan_result.status_code == 200, loan_result.text
        fixed = await command(
            "POST",
            "/activity",
            {
                "date": "2026-10-15",
                "category": "fixed_cost",
                "amount": "100.00",
                "debt_account_id": loan_result.json()["uuid"],
                "funding_origin": "savings",
                "saving_goal_id": reserve["uuid"],
            },
        )
        assert fixed.status_code == 200, fixed.text
        assert fixed.json()["debt_account_id"] == loan_result.json()["uuid"]
        assert fixed.json()["funding_origin"] == "savings"
        gift_result = await command(
            "POST",
            "/giving-recipients",
            {
                "name": "Synthetic recipient",
                "target": "1000.00",
            },
        )
        investment_result = await command(
            "POST",
            "/investments",
            {
                "name": "Synthetic investment",
                "target": "1000.00",
            },
        )
        assert gift_result.status_code == investment_result.status_code == 200
        gift = None
        for path, destination in (
            ("/giving-activity", gift_result.json()),
            ("/investment-activity", investment_result.json()),
        ):
            result = await command(
                "POST",
                path,
                {
                    "date": "2026-10-16",
                    "amount": "100.00",
                    "destination_id": destination["uuid"],
                    "funding_origin": "savings",
                    "saving_goal_id": reserve["uuid"],
                },
            )
            assert result.status_code == 200, result.text
            assert result.json()["funding_origin"] == "savings"
            if path == "/giving-activity":
                gift = result.json()
        assert (await client.get(prefix + "/investments")).json()[0][
            "contribution_progress"
        ] == "100.00"
        account_after = (
            await client.get(prefix + f"/savings-accounts/{second_account['uuid']}")
        ).json()
        reserve_after = next(
            g for g in account_after["goals"] if g["uuid"] == reserve["uuid"]
        )
        assert account_after["balance"] == "2700.00"
        assert reserve_after["contribution_progress"] == "0.00"
        fixed_refund = await command(
            "POST",
            f"/activity/{fixed.json()['uuid']}/refunds",
            {
                "date": "2026-11-01",
                "amount": "40.00",
            },
        )
        assert fixed_refund.status_code == 200, fixed_refund.text
        assert fixed_refund.json()["debt_account_id"] == loan_result.json()["uuid"]
        assert fixed_refund.json()["funding_origin"] == "savings"
        assert (
            await client.get(prefix + f"/savings-accounts/{second_account['uuid']}")
        ).json()["balance"] == "2740.00"
        assert gift is not None
        gift_refund = await command(
            "POST",
            f"/activity/{gift['uuid']}/refunds",
            {"date": "2026-11-01", "amount": "40.00"},
        )
        assert gift_refund.status_code == 200, gift_refund.text
        assert gift_refund.json()["destination_id"] == gift_result.json()["uuid"]
        assert gift_refund.json()["funding_origin"] == "savings"
        assert (await client.get(prefix + "/giving-recipients")).json()[0][
            "contribution_progress"
        ] == "60.00"
        assert (
            await client.get(prefix + f"/savings-accounts/{second_account['uuid']}")
        ).json()["balance"] == "2780.00"
    await engine.dispose()
