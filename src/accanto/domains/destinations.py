"""Pure contribution destination rules."""

from decimal import Decimal

from accanto.domains.monthly import money


def contribution_target(value: str | None) -> Decimal | None:
    if value is None:
        return None
    result = money(value)
    if result <= 0:
        raise ValueError("Contribution targets must be positive.")
    return result


def contribution_amount(value: str, *, adjustment: bool) -> Decimal:
    return money(value, signed=adjustment)


def contribution_progress(amounts: list[Decimal]) -> Decimal:
    return sum(amounts, Decimal("0.00"))


def require_new_destination(active: bool) -> None:
    if not active:
        raise ValueError(
            "Reactivate the destination before recording new contributions."
        )


def opening_date_allowed(opening_date, activity_date) -> None:
    if opening_date is not None and activity_date < opening_date:
        raise ValueError("Investment activity cannot predate its opening observation.")
