"""Spending alerts (TDD 23): how much of a Plan amount a month has used.

Pure rules, independent of HTTP, persistence and transport. A Spending alert
watches guilt-free spending or fixed costs as a whole, one Spending subcategory
(against its Spending estimate) or one Fixed cost (against its planned line),
and reaches each of its thresholds at most once per month. It stores no amount:
the amount it reads is the Plan version's, so it never becomes a second budget.
A push names targets and thresholds only, never an amount or payee.
"""

from decimal import ROUND_FLOOR, Decimal

from accanto.domains.notifications import Notice, plain_name

MIN_THRESHOLD = 1
MAX_THRESHOLD = 999
MAX_THRESHOLDS = 10
TYPE_NAMES = {"spending": "Guilt-free spending", "fixed_cost": "Fixed costs"}


class AlertRejectionError(ValueError):
    def __init__(self, code: str, message: str):
        self.code = code
        super().__init__(message)


def thresholds(values: list[int]) -> list[int]:
    """Whole percentages from 1 to 999, each once, lowest first.

    Over 100 means overspent: 125 is a quarter more than the Plan amount.
    """
    chosen = sorted(set(values))
    if not chosen:
        raise AlertRejectionError(
            "invalid_spending_alert", "Choose at least one threshold."
        )
    if len(chosen) > MAX_THRESHOLDS:
        raise AlertRejectionError(
            "invalid_spending_alert",
            f"Use at most {MAX_THRESHOLDS} thresholds for one alert.",
        )
    if chosen[0] < MIN_THRESHOLD or chosen[-1] > MAX_THRESHOLD:
        raise AlertRejectionError(
            "invalid_spending_alert",
            f"Use whole percentages from {MIN_THRESHOLD} to {MAX_THRESHOLD}.",
        )
    return chosen


def percent_used(recorded: Decimal, amount: Decimal | None) -> int | None:
    """Recorded as a whole percentage of the Plan amount, rounded down.

    Rounding down keeps $104.99 of $150 (69.99%) below a 70% threshold. With
    no amount, or a zero one, no percentage exists: unknown, never zero.
    """
    if amount is None or amount <= 0:
        return None
    return int((recorded * 100 / amount).to_integral_value(rounding=ROUND_FLOOR))


def reached(chosen: list[int], percent: int | None) -> int | None:
    """The highest threshold the month has reached, if any."""
    if percent is None:
        return None
    met = [t for t in chosen if percent >= t]
    return max(met) if met else None


def to_push(chosen: list[int], percent: int | None, pushed: set[int]) -> list[int]:
    """Thresholds reached and not yet pushed this month.

    Every reached threshold is claimed at once, so jumping from 60% to 95% pushes
    90% and never 70% afterwards; dropping back and reaching 70% again pushes
    nothing.
    """
    top = reached(chosen, percent)
    if top is None:
        return []
    return [t for t in chosen if t <= top and t not in pushed]


def basis(category: str, spending_subcategory: bool) -> str:
    """What the percentage reads: a Spending estimate or a planned amount."""
    return "estimate" if category == "spending" and spending_subcategory else "planned"


def headline(name: str, threshold: int, kind: str) -> str:
    """'Eating out passed 70% of its estimate': the same words in-app and pushed."""
    word = "estimate" if kind == "estimate" else "plan"
    return f"{plain_name(name)} passed {threshold}% of its {word}"


def spending_alerts(items: list[tuple[str, int, str]], at: str, entity: str) -> Notice:
    """One push for every alert a tick found, as (name, threshold, basis)."""
    lines = [headline(*item) for item in items]
    if len(lines) == 1:
        body = f"{lines[0]}."
    elif len(lines) <= 3:
        body = f"{'; '.join(lines)}."
    else:
        body = f"{'; '.join(lines[:2])}; and {len(lines) - 2} more spending alerts."
    return Notice("spending_alerts", body, "/#/", f"spend-{entity}-{at}", 43200)
