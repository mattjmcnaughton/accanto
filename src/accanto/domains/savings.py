"""Pure rules for savings openings and goal definitions."""

from dataclasses import dataclass
from datetime import date
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


@dataclass(frozen=True)
class SavingEvent:
    financial_date: date
    recording_order: int
    goal_id: str
    amount: Decimal
    contribution: bool


class SavingsShortfallError(ValueError):
    def __init__(self, goal_id: str, financial_date: date, shortfall: Decimal):
        self.goal_id = goal_id
        self.financial_date = financial_date
        self.shortfall = shortfall
        super().__init__(
            f"Goal {goal_id} is short by ${shortfall:.2f} "
            f"on {financial_date.isoformat()}."
        )


def replay_savings(
    openings: dict[str, Decimal], events: list[SavingEvent]
) -> tuple[dict[str, Decimal], dict[str, Decimal]]:
    """Replay selected-date activity in stable recording order; openings come first."""
    balances = openings.copy()
    contributions = {goal_id: Decimal("0.00") for goal_id in openings}
    for event in sorted(events, key=lambda e: (e.financial_date, e.recording_order)):
        balance = balances[event.goal_id] + event.amount
        if balance < 0:
            raise SavingsShortfallError(event.goal_id, event.financial_date, -balance)
        balances[event.goal_id] = balance
        if event.contribution:
            contributions[event.goal_id] += event.amount
    return balances, contributions


def movement_events(
    financial_date: date,
    recording_order: int,
    source: str,
    destination: str,
    amount: Decimal,
) -> list[SavingEvent]:
    """One movement contributes equal and opposite effects at one position."""
    if source == destination or amount <= 0:
        raise ValueError("Choose distinct goals and a positive amount.")
    return [
        SavingEvent(financial_date, recording_order, source, -amount, False),
        SavingEvent(financial_date, recording_order, destination, amount, False),
    ]


def reconciliation_delta(known: str, remaining: Decimal) -> Decimal:
    """Correct one recorded pot without changing its opening or contribution total."""
    return money(str(money(known) - remaining), signed=True)


def completion_amount(
    role: str, kind: str, active: bool, completed: bool, remaining: Decimal
) -> Decimal:
    """Explicit completion returns saved money, independently of target funding."""
    if role != "ordinary" or kind != "finite" or not active or completed:
        raise ValueError("Only an active finite goal can be completed.")
    if remaining < 0:
        raise ValueError("Remaining saved cannot be negative.")
    return remaining


def archive_allowed(active: bool, balance: Decimal) -> None:
    if not active:
        raise ValueError("The savings account is already archived.")
    if balance != 0:
        raise ValueError(
            "Recorded savings must be zero before archival. "
            "Transfer or use the money first."
        )


def restored_goal_active(
    active: bool, archived_by_account: bool, completed: bool
) -> bool:
    """Only the account's own archival is reversed; completion stays explicit."""
    return (active or archived_by_account) and not completed
