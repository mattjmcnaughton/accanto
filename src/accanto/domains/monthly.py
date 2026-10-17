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


def plan_results(incomes: list[Decimal], spending: Decimal) -> dict[str, str]:
    """Overallocation is a result to display, not a rejection."""
    incomes = [money(str(value)) for value in incomes]
    spending = money(str(spending))
    with localcontext() as ctx:
        ctx.prec = 28
        income = sum(incomes, Decimal("0.00"))
        return {
            "income": str(income),
            "spending": str(spending),
            "tithe_target": str((income / 10).quantize(CENT, rounding=ROUND_HALF_EVEN)),
            "unassigned": str(income - spending),
        }


def monthly_actuals(
    expected_sources: list[str],
    income_entries: list[tuple[str | None, Decimal]],
    spending_entries: list[Decimal],
) -> dict:
    """Unmatched income counts once; expected sources without entries are unknown."""
    recorded = {source for source, _ in income_entries}
    missing = [source for source in expected_sources if source not in recorded]
    income = sum((amount for _, amount in income_entries), Decimal("0.00"))
    spending = sum(spending_entries, Decimal("0.00"))
    return {
        "income_recorded": str(income) if income_entries else None,
        "income_incomplete": bool(missing) or not income_entries,
        "missing_sources": missing,
        "spending_recorded": str(spending) if spending_entries else None,
    }
