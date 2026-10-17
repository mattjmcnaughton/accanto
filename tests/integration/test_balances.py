"""Loan and observation commands on a unique migrated synthetic Postgres database."""

import asyncio
import os
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import func, insert, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from accanto.app import create_app
from accanto.db import get_session
from accanto.models import debts as b
from accanto.models import monthly as m
from accanto.services.api_keys import issue_key

URL = os.environ.get("ACCANTO_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not URL, reason="Use an isolated migrated test database"
)


def test_loan_payoff_and_observation_guards():
    asyncio.run(scenario())


async def scenario():
    assert URL and URL.rsplit("/", 1)[-1] == "accanto_mvp016_20261017_test"
    engine = create_async_engine(URL)
    sessions = async_sessionmaker(engine)
    async with sessions() as session, session.begin():
        user = await session.scalar(
            insert(m.users)
            .values(issuer="balance-test", subject=str(uuid4()))
            .returning(m.users.c.id)
        )
        outsider = await session.scalar(
            insert(m.users)
            .values(issuer="balance-test", subject=str(uuid4()))
            .returning(m.users.c.id)
        )
        entity = await session.scalar(
            insert(m.entities)
            .values(
                owner_id=user,
                name="Synthetic Household",
                time_zone="Pacific/Kiritimati",
            )
            .returning(m.entities.c.uuid)
        )
        key = await issue_key(session, user, "Balance test")
        outsider_key = await issue_key(session, outsider, "Other balance test")
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

        async def command(method, suffix, body, identity=None):
            return await client.request(
                method,
                path + suffix,
                json=body,
                headers={"Idempotency-Key": identity or str(uuid4())},
            )

        opening = {
            "name": "Example loan",
            "opening": {"date": "2026-10-01", "amount": "300.00"},
        }
        request_key = str(uuid4())
        created = await command("POST", "/debts", opening, request_key)
        assert created.status_code == 200, created.text
        loan = created.json()
        assert loan["latest"]["amount"] == "300.00"
        assert (await command("POST", "/debts", opening, request_key)).json() == loan
        assert (
            await command("POST", "/debts", {**opening, "name": "Other"}, request_key)
        ).status_code == 409
        assert (
            await client.get(
                path + "/debts",
                headers={"Authorization": f"Bearer {outsider_key['key']}"},
            )
        ).status_code == 404
        archive = {
            "name": "Example loan",
            "active": False,
            "expected_revision": loan["revision"],
        }
        assert (
            await command("PUT", f"/debts/{loan['uuid']}", archive)
        ).status_code == 422
        planned = await command(
            "POST",
            "/plans",
            {
                "name": "Synthetic payoff month",
                "incomes": [{"name": "Example source", "amount": "1000.00"}],
                "fixed_costs": [
                    {
                        "name": "Example loan payment",
                        "amount": "300.00",
                        "frequency": "monthly",
                        "debt_account_id": loan["uuid"],
                    }
                ],
                "spending": "0.00",
            },
        )
        assert planned.status_code == 200, planned.text
        plan = planned.json()
        fixed_line = plan["draft"]["fixed_costs"][0]
        assert fixed_line["debt_account_id"] == loan["uuid"]
        saved = await command(
            "POST", f"/plans/{plan['plan_id']}/versions", {"expected_revision": 1}
        )
        assert saved.status_code == 200, saved.text
        version = saved.json()["version"]
        assert version["fixed_costs"][0]["debt_account_id"] == loan["uuid"]
        review = await command(
            "POST", "/reviews", {"month": "2026-10-01", "version_id": version["uuid"]}
        )
        assert review.status_code == 200, review.text
        payment = await command(
            "POST",
            "/activity",
            {
                "date": "2026-10-01",
                "category": "fixed_cost",
                "amount": "300.00",
                "note": "",
                "debt_account_id": loan["uuid"],
                "fixed_cost_id": fixed_line["fixed_cost_id"],
            },
        )
        assert payment.status_code == 200, payment.text
        assert payment.json()["debt_account_id"] == loan["uuid"]
        assert payment.json()["fixed_cost_id"] == fixed_line["fixed_cost_id"]
        reviewed = (await client.get(path + "/reviews/2026-10-01")).json()
        assert reviewed["actual"]["fixed_cost_recorded"] == "300.00"
        assert len(reviewed["entries"]) == 1
        assert reviewed["entries"][0]["amount"] == "300.00"
        assert (await client.get(path + "/debts")).json()[0]["latest"][
            "amount"
        ] == "300.00"
        assert (
            await command("PUT", f"/debts/{loan['uuid']}", archive)
        ).status_code == 422
        observation = {
            "date": "2026-10-01",
            "amount": "0.00",
            "account_id": loan["uuid"],
        }
        observed = await command("POST", "/debt-observations", observation)
        assert observed.status_code == 200, observed.text
        observed = observed.json()
        assert observed["is_opening"] is False
        assert (await client.get(path + "/debts")).json()[0]["latest"][
            "amount"
        ] == "0.00"
        assert (
            await command("POST", "/debt-observations", observation)
        ).status_code == 409
        assert (
            await command(
                "PUT",
                f"/debt-observations/{observed['uuid']}",
                {**observation, "amount": "1.00", "expected_revision": 1},
            )
        ).status_code == 200
        assert (
            await command(
                "PUT",
                f"/debt-observations/{observed['uuid']}",
                {**observation, "expected_revision": 1},
            )
        ).status_code == 409
        corrected = await command(
            "PUT",
            f"/debt-observations/{observed['uuid']}",
            {**observation, "expected_revision": 2},
        )
        assert corrected.status_code == 200, corrected.text
        assert (
            await command("PUT", f"/debts/{loan['uuid']}", archive)
        ).status_code == 200
        assert (
            await command(
                "POST",
                "/activity",
                {
                    "date": "2026-10-02",
                    "category": "fixed_cost",
                    "amount": "10.00",
                    "note": "",
                    "debt_account_id": loan["uuid"],
                },
            )
        ).status_code == 422
        historical_edit = await command(
            "PUT",
            f"/activity/{payment.json()['uuid']}",
            {
                "date": "2026-10-02",
                "category": "fixed_cost",
                "amount": "299.00",
                "note": "Corrected synthetic payment",
                "debt_account_id": loan["uuid"],
                "fixed_cost_id": fixed_line["fixed_cost_id"],
                "expected_revision": payment.json()["revision"],
            },
        )
        assert historical_edit.status_code == 200, historical_edit.text
        assert historical_edit.json()["debt_account_id"] == loan["uuid"]
        assert historical_edit.json()["amount"] == "299.00"
        assert (await client.get(path + "/reviews/2026-10-01")).json()["actual"][
            "fixed_cost_recorded"
        ] == "299.00"
        unlinked = await command(
            "POST",
            "/activity",
            {
                "date": "2026-10-02",
                "category": "fixed_cost",
                "amount": "1.00",
                "note": "",
            },
        )
        assert unlinked.status_code == 200, unlinked.text
        new_association = await command(
            "PUT",
            f"/activity/{unlinked.json()['uuid']}",
            {
                "date": "2026-10-02",
                "category": "fixed_cost",
                "amount": "1.00",
                "note": "",
                "debt_account_id": loan["uuid"],
                "expected_revision": 1,
            },
        )
        assert new_association.status_code == 422
        assert (await client.get(path + "/activity")).json()[-1][
            "debt_account_id"
        ] is None
        archived = (await client.get(path + "/debts")).json()[0]
        assert len(archived["draft_fixed_cost_lines"]) == 1
        assert (await client.get(path + "/plans")).json()[0]["revisions"][0][
            "fixed_costs"
        ][0]["debt_account_id"] == loan["uuid"]
        reopened = await command(
            "PUT",
            f"/debts/{loan['uuid']}",
            {
                "name": "Example loan",
                "active": True,
                "expected_revision": archived["revision"],
            },
        )
        assert reopened.status_code == 200
        assert (await client.get(path + "/activity")).json()[0][
            "debt_account_id"
        ] == loan["uuid"]
        rows = (await client.get(path + "/debt-observations")).json()
        assert len(rows) == 2 and rows[0]["is_opening"] and not rows[1]["is_opening"]
        assert (
            await command(
                "DELETE",
                f"/debt-observations/{rows[0]['uuid']}",
                {"expected_revision": 1},
            )
        ).status_code == 422
        assert (
            await command(
                "DELETE",
                f"/debt-observations/{rows[1]['uuid']}",
                {"expected_revision": 3},
            )
        ).status_code == 200
        assert (await client.get(path + "/debts")).json()[0]["latest"][
            "amount"
        ] == "300.00"
        assert (
            await command(
                "POST", "/debt-observations", {**observation, "date": "2026-09-30"}
            )
        ).status_code == 422
        assert (
            await client.get(
                path + "/debt-observations",
                headers={"Authorization": f"Bearer {outsider_key['key']}"},
            )
        ).status_code == 404
        investment = await command(
            "POST",
            "/investments",
            {
                "name": "Example investment",
                "opening": {"date": "2026-10-01", "amount": "25000.00"},
            },
        )
        assert investment.status_code == 200, investment.text
        investment_id = investment.json()["uuid"]
        unassigned = await command(
            "POST",
            "/investment-observations",
            {"date": "2026-10-01", "amount": "17.00", "account_id": None},
        )
        assert unassigned.status_code == 200, unassigned.text
        ordinary = await command(
            "POST",
            "/investment-observations",
            {"date": "2026-10-01", "amount": "25100.00", "account_id": investment_id},
        )
        assert ordinary.status_code == 200, ordinary.text
        assert (
            await command(
                "POST",
                "/investment-observations",
                {
                    "date": "2026-10-01",
                    "amount": "25200.00",
                    "account_id": investment_id,
                },
            )
        ).status_code == 409
        assert len((await client.get(path + "/investment-observations")).json()) == 3
        race_body = {
            "date": "2026-10-02",
            "amount": "26000.00",
            "account_id": investment_id,
        }
        raced = await asyncio.gather(
            command("POST", "/investment-observations", race_body),
            command("POST", "/investment-observations", race_body),
        )
        assert sorted(response.status_code for response in raced) == [200, 409]
        assert (
            len(
                [
                    row
                    for row in (
                        await client.get(path + "/investment-observations")
                    ).json()
                    if row["account_id"] == investment_id
                    and row["financial_date"] == "2026-10-02"
                ]
            )
            == 1
        )
        same_day_zero = await command(
            "POST",
            "/debt-observations",
            {"date": "2026-10-01", "amount": "0.00", "account_id": loan["uuid"]},
        )
        assert same_day_zero.status_code == 200, same_day_zero.text
        loan_before_zone = (await client.get(path + "/debts")).json()[0]
        debt_rows_before_zone = (await client.get(path + "/debt-observations")).json()
        investment_before_zone = (await client.get(path + "/investments")).json()[0]
        investment_rows_before_zone = (
            await client.get(path + "/investment-observations")
        ).json()
        activity_before_zone = (await client.get(path + "/activity")).json()
        payment_before_zone = next(
            row for row in activity_before_zone if row["uuid"] == payment.json()["uuid"]
        )
        assert loan_before_zone["opening"]["date"] == "2026-10-01"
        assert loan_before_zone["latest"]["financial_date"] == "2026-10-01"
        assert loan_before_zone["latest"]["amount"] == "0.00"
        assert investment_before_zone["opening"]["date"] == "2026-10-01"
        assert investment_before_zone["latest"]["date"] == "2026-10-02"
        assert payment_before_zone["financial_date"] == "2026-10-02"
        settings_before = (await client.get(path + "/settings")).json()
        assert settings_before["time_zone"] == "Pacific/Kiritimati"
        changed_zone = await command(
            "PUT",
            "/settings",
            {
                "name": settings_before["name"],
                "time_zone": "America/Los_Angeles",
                "expected_revision": settings_before["revision"],
            },
        )
        assert changed_zone.status_code == 200, changed_zone.text
        assert (await client.get(path + "/settings")).json()[
            "time_zone"
        ] == "America/Los_Angeles"
        assert (await client.get(path + "/debts")).json()[0] == loan_before_zone
        assert (
            await client.get(path + "/debt-observations")
        ).json() == debt_rows_before_zone
        assert (await client.get(path + "/investments")).json()[
            0
        ] == investment_before_zone
        assert (
            await client.get(path + "/investment-observations")
        ).json() == investment_rows_before_zone
        assert (
            next(
                row
                for row in (await client.get(path + "/activity")).json()
                if row["uuid"] == payment.json()["uuid"]
            )
            == payment_before_zone
        )
        assert (
            await command(
                "POST",
                "/debt-observations",
                {"date": "2026-09-30", "amount": "1.00", "account_id": loan["uuid"]},
            )
        ).status_code == 422
        assert (
            await command(
                "POST",
                "/investment-observations",
                {"date": "2026-09-30", "amount": "1.00", "account_id": investment_id},
            )
        ).status_code == 422
        assert (
            await command(
                "POST",
                "/activity",
                {
                    "date": "2026-09-30",
                    "category": "fixed_cost",
                    "amount": "1.00",
                    "note": "",
                    "debt_account_id": loan["uuid"],
                },
            )
        ).status_code == 422
        async with sessions() as session:
            entity_id = await session.scalar(
                select(m.entities.c.id).where(m.entities.c.uuid == entity)
            )
            before_count = await session.scalar(
                select(func.count())
                .select_from(b.observations)
                .where(b.observations.c.entity_id == entity_id)
            )
        async with engine.begin() as connection:
            await connection.execute(
                text(
                    "CREATE FUNCTION fail_mvp016_audit() RETURNS trigger "
                    "LANGUAGE plpgsql AS $$ BEGIN IF NEW.entity_id = "
                    f"{entity_id} AND NEW.record_type = "
                    "'debt_balance_observation' THEN RAISE EXCEPTION "
                    "'injected audit failure'; END IF; RETURN NEW; END $$"
                )
            )
            await connection.execute(
                text(
                    "CREATE TRIGGER fail_mvp016_audit BEFORE INSERT ON audit_log "
                    "FOR EACH ROW EXECUTE FUNCTION fail_mvp016_audit()"
                )
            )
        failed_key = str(uuid4())
        try:
            failure = await command(
                "POST",
                "/debt-observations",
                {"date": "2026-10-03", "amount": "275.00", "account_id": loan["uuid"]},
                failed_key,
            )
            assert failure.status_code == 503
        finally:
            async with engine.begin() as connection:
                await connection.execute(
                    text("DROP TRIGGER fail_mvp016_audit ON audit_log")
                )
                await connection.execute(text("DROP FUNCTION fail_mvp016_audit()"))
        async with sessions() as session:
            assert (
                await session.scalar(
                    select(func.count())
                    .select_from(b.observations)
                    .where(b.observations.c.entity_id == entity_id)
                )
                == before_count
            )
        retried = await command(
            "POST",
            "/debt-observations",
            {"date": "2026-10-03", "amount": "275.00", "account_id": loan["uuid"]},
            failed_key,
        )
        assert retried.status_code == 200, retried.text
        async with sessions() as session, session.begin():
            await session.execute(
                m.keys.update()
                .where(m.keys.c.uuid == key["id"])
                .values(revoked_at=func.now())
            )
        assert (
            await command(
                "POST",
                "/debt-observations",
                {"date": "2026-10-03", "amount": "275.00", "account_id": loan["uuid"]},
                failed_key,
            )
        ).status_code == 401
    async with sessions() as session:
        debt_id = await session.scalar(
            select(b.debts.c.id).where(b.debts.c.uuid == loan["uuid"])
        )
        assert (
            await session.scalar(
                select(func.count())
                .select_from(b.observations)
                .where(
                    b.observations.c.debt_account_id == debt_id,
                    b.observations.c.is_opening,
                )
            )
            == 1
        )
        assert (
            await session.scalar(
                select(func.count())
                .select_from(m.audit)
                .where(
                    m.audit.c.record_type == "debt_balance_observation",
                    m.audit.c.entity_id
                    == (
                        select(m.entities.c.id).where(m.entities.c.uuid == entity)
                    ).scalar_subquery(),
                )
            )
            >= 4
        )
    await engine.dispose()
