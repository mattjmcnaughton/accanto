"""An Entity's Projection (TDD 14): the one read Projections and Home share.

Reads the investments with their assumptions and latest observations, savings
remaining saved, loans' latest observations with their terms (TDD 15) and the
active month's planned fixed costs (TDD 17) in one snapshot, with a fixed number
of statements however many accounts there are (Constitution §9), then hands them
to the pure domains.projections.project_entity.
"""

from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import select

from accanto.db import read_snapshot
from accanto.domains.entity import entity_today
from accanto.domains.projections import project_entity
from accanto.models import debts as b
from accanto.models import destinations as d
from accanto.models import monthly as m
from accanto.services.balances import terms
from accanto.services.destinations import snapshots
from accanto.services.monthly import authorize
from accanto.services.savings import saving_facts


def fire_assumptions(entity) -> dict:
    spending = entity["fire_annual_spending"]
    return {
        "annual_spending": None if spending is None else str(spending),
        "withdrawal_percent": str(entity["fire_withdrawal_percent"]),
        "inflation_percent": str(entity["inflation_percent"]),
        "revision": entity["revision"],
    }


PER_YEAR = {"weekly": 52, "biweekly": 26, "monthly": 12, "quarterly": 4, "annual": 1}


async def planned_fixed_costs(session, entity, month) -> dict | None:
    """The active month's planned fixed costs, or None when no Plan has a saved version.

    The Plan is the one the month's Review compares with or, without a Review,
    the Plan whose saved version was saved last; its latest saved version is
    used, as Home's Plan split does. Each line carries its Fixed cost's current
    rises_with_inflation; saved versions are never rewritten.
    """
    rev = m.revisions.c
    plan_id = (
        await session.execute(
            select(rev.plan_id)
            .join(m.reviews, m.reviews.c.plan_revision_id == rev.id)
            .where(m.reviews.c.entity_id == entity["id"], m.reviews.c.month == month)
        )
    ).scalar()
    query = select(rev).where(rev.entity_id == entity["id"], rev.saved)
    if plan_id is not None:
        query = query.where(rev.plan_id == plan_id).order_by(rev.number.desc())
    else:
        query = query.order_by(rev.saved_at.desc().nulls_last(), rev.id.desc())
    version = (await session.execute(query.limit(1))).mappings().first()
    if version is None:
        return None
    line, cost = m.fixed_cost_lines.c, m.fixed_costs.c
    rows = (
        await session.execute(
            select(
                cost.uuid,
                line.name,
                line.amount,
                line.frequency,
                line.monthly_amount,
                cost.rises_with_inflation,
            )
            .join(m.fixed_costs, cost.id == line.fixed_cost_id)
            .where(line.plan_revision_id == version["id"])
            .order_by(line.id)
        )
    ).mappings()
    lines = [
        {
            "fixed_cost_id": str(row["uuid"]),
            "name": row["name"],
            "monthly_amount": str(row["monthly_amount"]),
            "annual_amount": str(row["amount"] * PER_YEAR[row["frequency"]]),
            "rises_with_inflation": row["rises_with_inflation"],
        }
        for row in rows
    ]

    def total(key, keep=lambda _: True):
        return str(sum((Decimal(x[key]) for x in lines if keep(x)), Decimal("0.00")))

    return {
        "plan_name": version["name"],
        "version_number": version["number"],
        "month": month.isoformat()[:7],
        "monthly_total": total("monthly_amount"),
        "annual_total": total("annual_amount"),
        "steady_annual": total(
            "annual_amount", lambda x: not x["rises_with_inflation"]
        ),
        "lines": lines,
    }


async def read_fire_assumptions(session, actor, entity_uuid):
    async with read_snapshot(session):
        _, entity = await authorize(session, actor, entity_uuid, lock=False)
        return fire_assumptions(entity)


async def read_projection(
    session, actor, entity_uuid, years: int, dollars: str = "today", *, instant=None
):
    async with read_snapshot(session):
        _, entity = await authorize(session, actor, entity_uuid, lock=False)
        today = entity_today(instant or datetime.now(UTC), entity["time_zone"])
        planned = await planned_fixed_costs(session, entity, today.replace(day=1))
        rows = (
            (
                await session.execute(
                    select(d.investments)
                    .where(d.investments.c.entity_id == entity["id"])
                    .order_by(d.investments.c.id)
                )
            )
            .mappings()
            .all()
        )
        investments = await snapshots(session, "investment", rows)
        _, balances, _ = await saving_facts(session, entity["id"])
        obs, debt = b.observations.c, b.debts.c
        loans = (
            (
                await session.execute(
                    select(
                        obs.amount,
                        obs.financial_date,
                        debt.uuid,
                        debt.name,
                        debt.active,
                        debt.interest_rate_percent,
                        debt.monthly_payment,
                    )
                    .join(b.debts, debt.id == obs.debt_account_id)
                    .where(obs.entity_id == entity["id"], obs.deleted_at.is_(None))
                    .distinct(obs.debt_account_id)
                    .order_by(
                        obs.debt_account_id,
                        obs.financial_date.desc(),
                        obs.is_opening.asc(),
                    )
                )
            )
            .mappings()
            .all()
        )
    spending = entity["fire_annual_spending"]
    result = project_entity(
        [
            {
                "id": row["uuid"],
                "name": row["name"],
                "active": row["active"],
                "latest": row["latest"],
                "expected_return_percent": row["expected_return_percent"],
                "expected_contribution": row["expected_contribution"],
                "expected_contribution_frequency": row[
                    "expected_contribution_frequency"
                ],
            }
            for row in investments
        ],
        savings=sum(balances.values(), Decimal("0.00")),
        loans=[
            {
                "id": row["uuid"],
                "name": row["name"],
                "active": row["active"],
                "latest": {
                    "date": row["financial_date"].isoformat(),
                    "amount": str(row["amount"]),
                },
                **terms(row),
            }
            for row in loans
        ],
        today=today,
        years=years,
        default_return=entity["default_return_percent"],
        annual_spending=spending,
        withdrawal_percent=entity["fire_withdrawal_percent"],
        inflation_percent=entity["inflation_percent"],
        steady_spending=Decimal(planned["steady_annual"]) if planned else Decimal(0),
        dollars=dollars,
    )
    return {**result, "planned_fixed_costs": planned}
