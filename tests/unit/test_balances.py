"""Observation order and debt archival are independent of payments."""

from datetime import date
from decimal import Decimal

import pytest

from accanto.domains.balances import (
    ObservedBalance,
    latest_observation,
    observation_date_allowed,
    opening_move_allowed,
    require_archive_allowed,
)


def test_same_day_ordinary_observation_precedes_archival() -> None:
    opening = ObservedBalance(date(2026, 10, 1), Decimal("300.00"), True)
    paid_off = ObservedBalance(date(2026, 10, 1), Decimal("0.00"), False)
    with pytest.raises(ValueError):
        require_archive_allowed(latest_observation([opening]))
    assert latest_observation([opening, paid_off]) == paid_off
    require_archive_allowed(latest_observation([opening, paid_off]))
    with pytest.raises(ValueError):
        observation_date_allowed(opening.financial_date, date(2026, 9, 30))
    observation_date_allowed(opening.financial_date, opening.financial_date)


def test_a_debt_opening_moves_no_later_than_its_earliest_activity() -> None:
    opening_move_allowed(date(2023, 11, 1), None)
    opening_move_allowed(date(2026, 3, 10), date(2026, 3, 10))
    with pytest.raises(ValueError):
        opening_move_allowed(date(2026, 3, 11), date(2026, 3, 10))
