"""Scoped reads shared by the monthly application commands."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from accanto.models.debts import debts
from accanto.models.destinations import investments, recipients
from accanto.models.monthly import (
    fixed_cost_lines,
    fixed_costs,
    giving_lines,
    income_lines,
    investment_lines,
    saving_goal_lines,
    savings_funding_lines,
    sources,
)
from accanto.models.savings import accounts, goals


async def plan_lines(session: AsyncSession, revision_id: int) -> list[dict]:
    rows = (
        await session.execute(
            select(
                income_lines.c.name,
                income_lines.c.amount,
                sources.c.uuid.label("source_id"),
            )
            .join(sources, sources.c.id == income_lines.c.income_source_id)
            .where(income_lines.c.plan_revision_id == revision_id)
            .order_by(income_lines.c.id)
        )
    ).mappings()
    return [dict(row) for row in rows]


async def plan_fixed_costs(session: AsyncSession, revision_id: int) -> list[dict]:
    rows = (
        await session.execute(
            select(
                fixed_cost_lines.c.name,
                fixed_cost_lines.c.amount,
                fixed_cost_lines.c.frequency,
                fixed_cost_lines.c.monthly_amount,
                fixed_cost_lines.c.debt_account_name,
                fixed_costs.c.uuid.label("fixed_cost_id"),
                fixed_costs.c.name.label("canonical_name"),
                debts.c.uuid.label("debt_account_id"),
            )
            .join(fixed_costs, fixed_costs.c.id == fixed_cost_lines.c.fixed_cost_id)
            .outerjoin(debts, debts.c.id == fixed_cost_lines.c.debt_account_id)
            .where(fixed_cost_lines.c.plan_revision_id == revision_id)
            .order_by(fixed_cost_lines.c.id)
        )
    ).mappings()
    return [dict(row) for row in rows]


async def plan_allocations(
    session: AsyncSession, revision_id: int
) -> dict[str, list[dict]]:
    result = {}
    for key, line_table, target, target_column, public_key in (
        (
            "savings_funding",
            savings_funding_lines,
            accounts,
            "account_id",
            "account_id",
        ),
        ("saving_goals", saving_goal_lines, goals, "goal_id", "goal_id"),
        (
            "investments",
            investment_lines,
            investments,
            "destination_id",
            "destination_id",
        ),
        ("giving", giving_lines, recipients, "destination_id", "destination_id"),
    ):
        label = {
            "savings_funding": "account_name",
            "saving_goals": "goal_name",
            "investments": "destination_name",
            "giving": "destination_name",
        }[key]
        rows = (
            await session.execute(
                select(
                    target.c.uuid.label(public_key),
                    line_table.c.amount,
                    line_table.c[label],
                )
                .join(target, target.c.id == line_table.c[target_column])
                .where(line_table.c.plan_revision_id == revision_id)
                .order_by(line_table.c.id)
            )
        ).mappings()
        result[key] = [dict(row) for row in rows]
    return result
