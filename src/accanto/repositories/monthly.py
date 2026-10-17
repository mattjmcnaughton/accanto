"""Scoped reads shared by the monthly application commands."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from accanto.models.monthly import (
    fixed_cost_lines,
    fixed_costs,
    income_lines,
    sources,
)


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
                fixed_costs.c.uuid.label("fixed_cost_id"),
            )
            .join(fixed_costs, fixed_costs.c.id == fixed_cost_lines.c.fixed_cost_id)
            .where(fixed_cost_lines.c.plan_revision_id == revision_id)
            .order_by(fixed_cost_lines.c.id)
        )
    ).mappings()
    return [dict(row) for row in rows]
