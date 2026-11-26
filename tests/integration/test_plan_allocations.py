"""Synthetic Plan allocations, saved history, and Review destination comparisons."""

import asyncio
import os
from uuid import UUID, uuid4

import httpx
import pytest
from sqlalchemy import func, insert, select, text, update
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from accanto.app import create_app
from accanto.db import get_session
from accanto.models import monthly as m
from accanto.services.api_keys import issue_key
from tests.integration.read_cost import counted_get

URL = os.environ.get("ACCANTO_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="Requires isolated migrated test DB")


def test_plan_allocations_and_monthly_shortfall():
    asyncio.run(scenario())


async def scenario():
    assert URL and URL.rsplit("/", 1)[-1].endswith("_test")
    engine = create_async_engine(URL)
    sessions = async_sessionmaker(engine)
    async with sessions() as session, session.begin():
        owner = await session.scalar(
            insert(m.users)
            .values(issuer="allocation-test", subject=str(uuid4()))
            .returning(m.users.c.id)
        )
        entity = await session.scalar(
            insert(m.entities)
            .values(owner_id=owner, name="Synthetic household", time_zone="UTC")
            .returning(m.entities.c.uuid)
        )
        credential = await issue_key(session, owner, "Allocation test")
    app = create_app()

    async def dependency():
        async with sessions() as session:
            yield session

    app.dependency_overrides[get_session] = dependency
    prefix = f"/api/entities/{entity}"
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
        headers={"Authorization": f"Bearer {credential['key']}"},
    ) as client:

        async def command(method, path, body):
            response = await client.request(
                method,
                prefix + path,
                json=body,
                headers={"Idempotency-Key": str(uuid4())},
            )
            assert response.status_code == 200, response.text
            return response.json()

        account = await command(
            "POST",
            "/savings-accounts",
            {
                "name": "Example cash reserve",
                "opening_date": "2026-01-01",
                "opening_amount": "1000.00",
                "goals": [
                    {
                        "name": "Laptop",
                        "kind": "finite",
                        "target": "500.00",
                        "opening_amount": "0.00",
                    },
                    {
                        "name": "Emergency",
                        "kind": "ongoing",
                        "target": None,
                        "opening_amount": "0.00",
                    },
                ],
            },
        )
        goals = {goal["name"]: goal["uuid"] for goal in account["goals"]}
        investment = await command(
            "POST", "/investments", {"name": "Example investment", "target": None}
        )
        recipient = await command(
            "POST", "/giving-recipients", {"name": "Example recipient", "target": None}
        )
        debt = await command(
            "POST",
            "/debts",
            {
                "name": "Example loan",
                "opening": {"date": "2026-01-01", "amount": "0.00"},
            },
        )
        plan = await command(
            "POST",
            "/plans",
            {
                "name": "Synthetic month",
                "incomes": [{"name": "Example income", "amount": "4000.00"}],
                "fixed_costs": [
                    {
                        "name": "Loan payment",
                        "amount": "500.00",
                        "frequency": "monthly",
                        "debt_account_id": debt["uuid"],
                    }
                ],
                "savings_funding": [
                    {"account_id": account["uuid"], "amount": "1000.00"}
                ],
                "saving_goals": [
                    {"goal_id": goals["Laptop"], "amount": "200.00"},
                    {"goal_id": goals["Emergency"], "amount": "300.00"},
                ],
                "investments": [
                    {"destination_id": investment["uuid"], "amount": "400.00"}
                ],
                "giving": [{"destination_id": recipient["uuid"], "amount": "600.00"}],
                "spending": "3300.00",
            },
        )
        draft = plan["draft"]
        one_plan, small_cost = await counted_get(client, engine, prefix + "/plans")
        assert one_plan == [{"plan_id": plan["plan_id"], "revisions": [draft]}]
        assert draft["income"] == "4000.00"
        assert draft["funding_total"] == "5000.00"
        assert draft["tithe_target"] == "400.00"
        assert draft["giving_difference"] == "200.00"
        assert draft["allocation_total"] == "5300.00"
        assert draft["unassigned"] == "-300.00"
        assert draft["rule_version"] == "monthly-allocation-2"
        assert draft["fixed_costs"][0]["debt_account_name"] == "Example loan"
        async with sessions() as session:
            entity_key = await session.scalar(
                select(m.entities.c.id).where(m.entities.c.uuid == entity)
            )
            assert (
                await session.scalar(
                    select(func.count())
                    .select_from(m.entries)
                    .where(m.entries.c.entity_id == entity_key)
                )
                == 0
            )

        saved = await command(
            "POST", f"/plans/{plan['plan_id']}/versions", {"expected_revision": 1}
        )
        version = saved["version"]
        assert saved["draft"]["saving_goals"] == version["saving_goals"]
        copied = await command(
            "POST",
            f"/plans/{plan['plan_id']}/copies",
            {
                "name": "Alternative",
                "source_revision_id": version["uuid"],
                "expected_revision": version["revision"],
            },
        )
        assert copied["draft"]["funding_total"] == "5000.00"
        assert copied["draft"]["saving_goals"] == version["saving_goals"]
        assert (
            copied["draft"]["incomes"][0]["source_id"]
            != version["incomes"][0]["source_id"]
        )

        # Rename/inactivate references; saved labels and explicit draft links survive.
        await command(
            "PUT",
            f"/investments/{investment['uuid']}",
            {
                "name": "Renamed investment",
                "target": None,
                "active": False,
                "expected_revision": investment["revision"],
            },
        )
        await command(
            "PUT",
            f"/giving-recipients/{recipient['uuid']}",
            {
                "name": "Renamed recipient",
                "target": None,
                "active": False,
                "expected_revision": recipient["revision"],
            },
        )
        await command(
            "PUT",
            f"/debts/{debt['uuid']}",
            {
                "name": "Renamed loan",
                "active": False,
                "expected_revision": debt["revision"],
            },
        )
        plans, larger_cost = await counted_get(client, engine, prefix + "/plans")
        by_plan = {p["plan_id"]: p["revisions"] for p in plans}
        assert by_plan[copied["plan_id"]] == [copied["draft"]]
        preserved = next(row for row in by_plan[plan["plan_id"]] if row["saved"])
        assert preserved["investments"][0]["destination_name"] == "Example investment"
        assert preserved["giving"][0]["destination_name"] == "Example recipient"
        assert preserved["fixed_costs"][0]["debt_account_name"] == "Example loan"
        assert larger_cost == small_cost
        archived_copy = await command(
            "POST",
            f"/plans/{plan['plan_id']}/copies",
            {
                "name": "Archived reference copy",
                "source_revision_id": version["uuid"],
                "expected_revision": version["revision"],
            },
        )
        assert (
            archived_copy["draft"]["fixed_costs"][0]["debt_account_name"]
            == "Example loan"
        )

        for month in ("2026-10-01", "2026-11-01"):
            await command(
                "POST", "/reviews", {"month": month, "version_id": version["uuid"]}
            )
        for goal_name, amount in (("Laptop", "150.00"), ("Emergency", "350.00")):
            await command(
                "POST",
                "/activity",
                {
                    "date": "2026-10-12",
                    "category": "saving",
                    "amount": amount,
                    "saving_goal_id": goals[goal_name],
                },
            )
        october = (await client.get(prefix + "/reviews/2026-10-01")).json()
        november = (await client.get(prefix + "/reviews/2026-11-01")).json()
        assert october["differences"]["saving"] == "0.00"
        october_goals = {
            line["goal_name"]: line
            for line in october["destination_comparisons"]["saving_goals"]
        }
        assert october_goals["Laptop"]["recorded"] == "150.00"
        assert october_goals["Laptop"]["difference"] == "-50.00"
        assert october_goals["Emergency"]["difference"] == "50.00"
        november_goals = {
            line["goal_name"]: line
            for line in november["destination_comparisons"]["saving_goals"]
        }
        assert november_goals["Laptop"]["planned"] == "200.00"
        assert november_goals["Laptop"]["recorded"] is None
        assert november_goals["Laptop"]["difference"] is None
        assert november["expected"]["saving"] == "500.00"

        laptop = next(goal for goal in account["goals"] if goal["name"] == "Laptop")
        await command(
            "PUT",
            f"/savings-accounts/{account['uuid']}/goals/{laptop['uuid']}",
            {
                "name": "Renamed laptop goal",
                "kind": "finite",
                "target": "500.00",
                "active": False,
                "expected_revision": laptop["revision"],
            },
        )
        archived_goal_copy = await command(
            "POST",
            f"/plans/{plan['plan_id']}/copies",
            {
                "name": "Archived goal copy",
                "source_revision_id": version["uuid"],
                "expected_revision": version["revision"],
            },
        )
        assert archived_goal_copy["draft"]["saving_goals"][0]["goal_name"] == "Laptop"
        next_draft = saved["draft"]
        edited = await command(
            "PUT",
            f"/plans/{plan['plan_id']}/draft",
            {
                "name": "Explicit revision with inactive references",
                "incomes": [
                    {
                        "source_id": line["source_id"],
                        "name": line["name"],
                        "amount": str(line["amount"]),
                    }
                    for line in next_draft["incomes"]
                ],
                "fixed_costs": [
                    {
                        "fixed_cost_id": line["fixed_cost_id"],
                        "debt_account_id": line["debt_account_id"],
                        "name": line["name"],
                        "amount": str(line["amount"]),
                        "frequency": line["frequency"],
                    }
                    for line in next_draft["fixed_costs"]
                ],
                "savings_funding": [
                    {"account_id": line["account_id"], "amount": str(line["amount"])}
                    for line in next_draft["savings_funding"]
                ],
                "saving_goals": [
                    {"goal_id": line["goal_id"], "amount": str(line["amount"])}
                    for line in next_draft["saving_goals"]
                ],
                "investments": [
                    {
                        "destination_id": line["destination_id"],
                        "amount": str(line["amount"]),
                    }
                    for line in next_draft["investments"]
                ],
                "giving": [
                    {
                        "destination_id": line["destination_id"],
                        "amount": str(line["amount"]),
                    }
                    for line in next_draft["giving"]
                ],
                "spending": "3300.00",
                "expected_revision": next_draft["revision"],
            },
        )
        assert edited["draft"]["saving_goals"][0]["goal_name"] == "Laptop"
        assert edited["draft"]["fixed_costs"][0]["debt_account_name"] == "Example loan"

        legacy = await command(
            "POST",
            "/plans",
            {
                "name": "Legacy-shaped scenario",
                "incomes": [{"name": "Legacy income", "amount": "100.00"}],
                "spending": "25.00",
            },
        )
        async with sessions() as session, session.begin():
            await session.execute(
                update(m.revisions)
                .where(m.revisions.c.uuid == UUID(legacy["draft"]["uuid"]))
                .values(
                    savings_funding_total=None,
                    funding_total=None,
                    saving_total=None,
                    investing_total=None,
                    giving_total=None,
                    allocation_total=None,
                    giving_difference=None,
                )
            )
        legacy_saved = await command(
            "POST", f"/plans/{legacy['plan_id']}/versions", {"expected_revision": 1}
        )
        await command(
            "POST",
            "/reviews",
            {"month": "2026-12-01", "version_id": legacy_saved["version"]["uuid"]},
        )
        legacy_review = (await client.get(prefix + "/reviews/2026-12-01")).json()
        assert all(value is None for value in legacy_review["expected"].values())
        assert all(value is None for value in legacy_review["differences"].values())
        assert legacy_review["destination_comparisons"] is None

        # An archived parent savings account makes even an active goal unavailable
        # for a new Plan line; historical draft/copy references remain revisable.
        async with sessions() as session, session.begin():
            from accanto.models import savings as s

            await session.execute(
                update(s.accounts)
                .where(s.accounts.c.uuid == UUID(account["uuid"]))
                .values(active=False)
            )
        fresh = await client.post(
            prefix + "/plans",
            json={
                "name": "Invalid archived account selection",
                "incomes": [{"name": "Income", "amount": "100.00"}],
                "saving_goals": [{"goal_id": goals["Emergency"], "amount": "10.00"}],
                "spending": "0.00",
            },
            headers={"Idempotency-Key": str(uuid4())},
        )
        assert fresh.status_code == 422
        assert fresh.json()["detail"]["code"] == "inactive_plan_reference"
        archived_account_copy = await command(
            "POST",
            f"/plans/{plan['plan_id']}/copies",
            {
                "name": "Archived account copy",
                "source_revision_id": version["uuid"],
                "expected_revision": version["revision"],
            },
        )
        assert (
            archived_account_copy["draft"]["saving_goals"][0]["goal_name"] == "Laptop"
        )

        legacy_debt = await command(
            "POST",
            "/debts",
            {
                "name": "Earlier loan",
                "opening": {"date": "2026-01-01", "amount": "0.00"},
            },
        )
        legacy_loan_plan = await command(
            "POST",
            "/plans",
            {
                "name": "Earlier loan Plan",
                "incomes": [{"name": "Income", "amount": "100.00"}],
                "fixed_costs": [
                    {
                        "name": "Loan payment",
                        "amount": "10.00",
                        "frequency": "monthly",
                        "debt_account_id": legacy_debt["uuid"],
                    }
                ],
                "spending": "0.00",
            },
        )
        async with sessions() as session, session.begin():
            old_revision_id = await session.scalar(
                select(m.revisions.c.id).where(
                    m.revisions.c.uuid == UUID(legacy_loan_plan["draft"]["uuid"])
                )
            )
            await session.execute(
                update(m.fixed_cost_lines)
                .where(m.fixed_cost_lines.c.plan_revision_id == old_revision_id)
                .values(debt_account_name=None)
            )
        old_loan_saved = await command(
            "POST",
            f"/plans/{legacy_loan_plan['plan_id']}/versions",
            {"expected_revision": 1},
        )
        await command(
            "PUT",
            f"/debts/{legacy_debt['uuid']}",
            {
                "name": "Later loan name",
                "active": False,
                "expected_revision": legacy_debt["revision"],
            },
        )
        copied_old_loan = await command(
            "POST",
            f"/plans/{legacy_loan_plan['plan_id']}/copies",
            {
                "name": "Copy of earlier loan Plan",
                "source_revision_id": old_loan_saved["version"]["uuid"],
                "expected_revision": old_loan_saved["version"]["revision"],
            },
        )
        assert (
            copied_old_loan["draft"]["fixed_costs"][0]["debt_account_id"]
            == legacy_debt["uuid"]
        )

        # Database protection covers every saved line table, including old types.
        async with sessions() as session:
            revision_id = await session.scalar(
                select(m.revisions.c.id).where(
                    m.revisions.c.uuid == UUID(version["uuid"])
                )
            )
        for name in (
            "plan_income_line",
            "plan_fixed_cost_line",
            "plan_savings_funding_line",
            "plan_saving_goal_line",
            "plan_investment_line",
            "plan_giving_line",
        ):
            async with sessions() as session:
                line_id = await session.scalar(
                    text(
                        f"SELECT id FROM {name} "
                        "WHERE plan_revision_id = :revision_id LIMIT 1"
                    ),
                    {"revision_id": revision_id},
                )
                columns = (
                    (
                        await session.execute(
                            text(
                                "SELECT column_name FROM information_schema.columns "
                                "WHERE table_name = :name "
                                "AND column_name NOT IN ('id', 'uuid') "
                                "ORDER BY ordinal_position"
                            ),
                            {"name": name},
                        )
                    )
                    .scalars()
                    .all()
                )
            assert line_id is not None
            names = ", ".join(columns)
            for statement in (
                f"INSERT INTO {name} (uuid, {names}) "
                f"SELECT gen_random_uuid(), {names} FROM {name} WHERE id = :id",
                f"UPDATE {name} SET amount = amount WHERE id = :id",
                f"DELETE FROM {name} WHERE id = :id",
            ):
                async with sessions() as session:
                    with pytest.raises(DBAPIError):
                        async with session.begin():
                            await session.execute(text(statement), {"id": line_id})
    await engine.dispose()
