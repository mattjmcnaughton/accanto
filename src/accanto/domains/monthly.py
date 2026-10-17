"""Pure rules for the first monthly Plan/activity/Review slice."""

import re
from decimal import ROUND_HALF_EVEN, Decimal, localcontext

CENT = Decimal("0.01")
LIMIT = Decimal("999999999.99")


def money(value: str, *, signed: bool = False) -> Decimal:
    """Accept entered cents without rounding or binary-float conversion."""
    if not re.fullmatch(r"-?\d{1,9}(?:\.\d{1,2})?", value):
        raise ValueError("Enter a USD decimal string with at most two decimal places.")
    amount = Decimal(value)
    if abs(amount) > LIMIT or (amount < 0 and not signed):
        raise ValueError("Amount is outside the supported range.")
    return amount.quantize(CENT)


def known_total_delta(desired: str, amounts: list[Decimal]) -> Decimal:
    """A known total adds a dated correction; it never replaces existing entries."""
    total = money(desired)
    delta = total - sum(amounts, Decimal("0.00"))
    return money(str(delta), signed=True)


def fixed_cost_monthly(amount: str, frequency: str) -> Decimal:
    """Smooth each named annual line separately, then sum cent results."""
    entered = money(amount)
    if frequency == "monthly":
        return entered
    if frequency != "annual":
        raise ValueError("Fixed-cost frequency must be monthly or annual.")
    return (entered / 12).quantize(CENT, rounding=ROUND_HALF_EVEN)


def plan_results(
    incomes: list[Decimal], spending: Decimal, fixed_costs: list[Decimal] | None = None
) -> dict[str, str]:
    """Overallocation is a result to display, not a rejection."""
    incomes = [money(str(value)) for value in incomes]
    spending = money(str(spending))
    fixed_cost_total = sum((fixed_costs or []), Decimal("0.00"))
    with localcontext() as ctx:
        ctx.prec = 28
        income = sum(incomes, Decimal("0.00"))
        return {
            "income": str(income),
            "spending": str(spending),
            "fixed_cost_total": str(fixed_cost_total),
            "tithe_target": str((income / 10).quantize(CENT, rounding=ROUND_HALF_EVEN)),
            "unassigned": str(income - spending - fixed_cost_total),
        }


def monthly_actuals(
    expected_sources: list[str],
    income_entries: list[tuple[str | None, Decimal]],
    spending_entries: list[Decimal],
    expected_fixed_costs: list[str] | None = None,
    fixed_cost_entries: list[tuple[str | None, Decimal]] | None = None,
) -> dict:
    """Unmatched income counts once; expected sources without entries are unknown."""
    recorded = {source for source, _ in income_entries}
    missing = [source for source in expected_sources if source not in recorded]
    income = sum((amount for _, amount in income_entries), Decimal("0.00"))
    spending = sum(spending_entries, Decimal("0.00"))
    fixed_cost_entries = fixed_cost_entries or []
    fixed_recorded = {cost for cost, _ in fixed_cost_entries}
    missing_fixed = [
        cost for cost in (expected_fixed_costs or []) if cost not in fixed_recorded
    ]
    return {
        "income_recorded": str(income) if income_entries else None,
        "income_incomplete": bool(missing) or not income_entries,
        "missing_sources": missing,
        "spending_recorded": str(spending) if spending_entries else None,
        "fixed_cost_recorded": str(
            sum((amount for _, amount in fixed_cost_entries), Decimal("0.00"))
        )
        if fixed_cost_entries
        else None,
        "fixed_cost_incomplete": bool(missing_fixed) or not fixed_cost_entries,
        "missing_fixed_costs": missing_fixed,
    }
