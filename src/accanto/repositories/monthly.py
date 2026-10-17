"""Scoped reads shared by the monthly application commands."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from accanto.models.monthly import income_lines, sources


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
