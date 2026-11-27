"""An Entity's Projection (TDD 14): the one read Projections and Home share.

Reads the investments with their assumptions and latest observations, savings
remaining saved and loans' latest observations with their terms (TDD 15) in one
snapshot, with a fixed number of statements however many accounts there are
(Constitution §9), then hands them to the pure domains.projections.project_entity.
"""

from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import select

from accanto.db import read_snapshot
from accanto.domains.entity import entity_today
from accanto.domains.projections import project_entity
from accanto.models import debts as b
from accanto.models import destinations as d
from accanto.services.balances import terms
from accanto.services.destinations import snapshots
from accanto.services.monthly import authorize
from accanto.services.savings import saving_facts


def fire_assumptions(entity) -> dict:
    spending = entity["fire_annual_spending"]
    return {
        "annual_spending": None if spending is None else str(spending),
        "withdrawal_percent": str(entity["fire_withdrawal_percent"]),
        "revision": entity["revision"],
    }


async def read_fire_assumptions(session, actor, entity_uuid):
    async with read_snapshot(session):
        _, entity = await authorize(session, actor, entity_uuid, lock=False)
        return fire_assumptions(entity)


async def read_projection(session, actor, entity_uuid, years: int, *, instant=None):
    async with read_snapshot(session):
        _, entity = await authorize(session, actor, entity_uuid, lock=False)
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
    return project_entity(
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
        today=entity_today(instant or datetime.now(UTC), entity["time_zone"]),
        years=years,
        default_return=entity["default_return_percent"],
        annual_spending=spending,
        withdrawal_percent=entity["fire_withdrawal_percent"],
    )
