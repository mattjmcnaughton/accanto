"""Pure rules for savings openings and goal definitions."""

from decimal import Decimal

from accanto.domains.monthly import money


def goal_target(kind: str, target: str | None) -> Decimal | None:
    if kind not in {"finite", "ongoing"}:
        raise ValueError("Choose a finite or ongoing goal.")
    amount = money(target) if target is not None else None
    if kind == "finite" and amount is None:
        raise ValueError("Finite goals require a positive target.")
    if amount is not None and amount <= 0:
        raise ValueError("Goal targets must be positive.")
    return amount


def opening_designations(opening: str, portions: list[str]) -> Decimal:
    """Return the remainder assigned to Unallocated, without creating activity."""
    total = money(opening)
    designated = sum((money(value) for value in portions), Decimal("0.00"))
    if designated > total:
        raise ValueError("Opening designations exceed the account opening amount.")
    return total - designated


def opening_change_allowed(has_retained_activity: bool, changed: bool) -> None:
    if has_retained_activity and changed:
        raise ValueError(
            "Opening is fixed after linked activity exists, including deleted activity."
        )


def funded_status(remaining_saved: Decimal, target: Decimal | None) -> str | None:
    """Opening money can fund a target without counting as contributions."""
    if target is None:
        return None
    return "Funded" if remaining_saved >= target else "Not yet funded"
