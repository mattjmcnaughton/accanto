"""Scoped reads shared by the monthly application commands."""

from sqlalchemy import BigInteger, any_, bindparam, literal, select, union_all
from sqlalchemy.dialects.postgresql import ARRAY
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
    spending_estimate_lines,
    spending_subcategories,
)
from accanto.models.savings import accounts, goals


async def plan_details(session: AsyncSession, revision_ids: list[int]) -> dict:
    """Fetch ordered line collections without multiplying independent child rows."""
    details = {key: {} for key in revision_ids}
    if not details:
        return details
    ids = any_(bindparam("revision_ids", value=revision_ids, type_=ARRAY(BigInteger)))
    for key, table, query in (
        (
            "incomes",
            income_lines,
            select(
                income_lines.c.name,
                income_lines.c.amount,
                sources.c.uuid.label("source_id"),
            ).join(sources, sources.c.id == income_lines.c.income_source_id),
        ),
        (
            "fixed_costs",
            fixed_cost_lines,
            select(
                fixed_cost_lines.c.name,
                fixed_cost_lines.c.amount,
                fixed_cost_lines.c.frequency,
                fixed_cost_lines.c.monthly_amount,
                fixed_cost_lines.c.debt_account_name,
                fixed_costs.c.uuid.label("fixed_cost_id"),
                fixed_costs.c.name.label("canonical_name"),
                fixed_costs.c.rises_with_inflation,
                debts.c.uuid.label("debt_account_id"),
            )
            .join(fixed_costs, fixed_costs.c.id == fixed_cost_lines.c.fixed_cost_id)
            .outerjoin(debts, debts.c.id == fixed_cost_lines.c.debt_account_id),
        ),
        (
            # Named by the subcategory's current name, as its entries are.
            "spending_estimates",
            spending_estimate_lines,
            select(
                spending_subcategories.c.uuid.label("spending_subcategory_id"),
                spending_subcategories.c.name.label("spending_subcategory_name"),
                spending_estimate_lines.c.amount,
            ).join(
                spending_subcategories,
                spending_subcategories.c.id
                == spending_estimate_lines.c.spending_subcategory_id,
            ),
        ),
    ):
        for collections in details.values():
            collections[key] = []
        rows = await session.execute(
            query.add_columns(table.c.plan_revision_id)
            .where(table.c.plan_revision_id == ids)
            .order_by(table.c.id)
        )
        for row in rows.mappings():
            line = dict(row)
            details[line.pop("plan_revision_id")][key].append(line)
    queries = []
    labels = {}
    for key, line_table, target, target_column, label in (
        (
            "savings_funding",
            savings_funding_lines,
            accounts,
            "account_id",
            "account_name",
        ),
        ("saving_goals", saving_goal_lines, goals, "goal_id", "goal_name"),
        (
            "investments",
            investment_lines,
            investments,
            "destination_id",
            "destination_name",
        ),
        ("giving", giving_lines, recipients, "destination_id", "destination_name"),
    ):
        labels[key] = (target_column, label)
        for collections in details.values():
            collections[key] = []
        queries.append(
            select(
                line_table.c.plan_revision_id,
                literal(key).label("kind"),
                line_table.c.id,
                target.c.uuid,
                line_table.c.amount,
                line_table.c[label],
            )
            .join(target, target.c.id == line_table.c[target_column])
            .where(line_table.c.plan_revision_id == ids)
        )
    for revision_id, key, _, target_uuid, amount, name in await session.execute(
        union_all(*queries).order_by("id")
    ):
        public_key, label = labels[key]
        details[revision_id][key].append(
            {public_key: target_uuid, "amount": amount, label: name}
        )
    return details
