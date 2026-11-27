"""Pure dated observation and debt lifecycle rules."""

from collections.abc import Iterable
from datetime import date
from decimal import Decimal
from typing import NamedTuple


class ObservedBalance(NamedTuple):
    financial_date: date
    amount: Decimal
    is_opening: bool


def latest_observation(rows: Iterable[ObservedBalance]) -> ObservedBalance | None:
    records = list(rows)
    if not records:
        return None
    return max(records, key=lambda row: (row.financial_date, not row.is_opening))


def require_archive_allowed(latest: ObservedBalance | None) -> None:
    if latest is None or latest.amount != Decimal("0.00"):
        raise ValueError(
            "Record a zero amount owed observation before archiving this debt account."
        )


def observation_date_allowed(opening_date: date | None, activity_date: date) -> None:
    if opening_date is not None and activity_date < opening_date:
        raise ValueError("Observation cannot predate its account opening.")


def opening_move_allowed(new_date: date, earliest_activity: date | None) -> None:
    """A debt opening may move to any date on or before its earliest activity."""
    if earliest_activity is not None and earliest_activity < new_date:
        raise ValueError(
            "Payments or observations for this loan predate the new opening date; "
            "correct or delete them first."
        )
