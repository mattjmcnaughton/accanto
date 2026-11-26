"""Cumulative contribution and opening rules use entered cents."""

from datetime import date
from decimal import Decimal

import pytest

from accanto.domains.destinations import (
    contribution_amount,
    contribution_progress,
    contribution_target,
    opening_date_allowed,
    opening_move_allowed,
    require_new_destination,
)


def test_optional_positive_target_and_progress_are_distinct_from_opening():
    assert contribution_target(None) is None
    assert contribution_target("1200.00") == Decimal("1200.00")
    assert contribution_progress([Decimal("1000.00"), Decimal("-75.00")]) == Decimal(
        "925.00"
    )
    with pytest.raises(ValueError, match="positive"):
        contribution_target("0.00")


def test_ordinary_investment_contribution_and_signed_adjustment():
    assert contribution_amount("100.00", adjustment=False) == Decimal("100.00")
    assert contribution_amount("-20.00", adjustment=True) == Decimal("-20.00")
    with pytest.raises(ValueError):
        contribution_amount("-20.00", adjustment=False)


def test_inactive_and_opening_boundary():
    with pytest.raises(ValueError, match="Reactivate"):
        require_new_destination(False)
    require_new_destination(True)
    opening_date_allowed(date(2026, 1, 1), date(2026, 1, 1))
    with pytest.raises(ValueError, match="predate"):
        opening_date_allowed(date(2026, 1, 1), date(2025, 12, 31))


def test_opening_moves_up_to_its_earliest_current_activity():
    opening_move_allowed(date(2026, 3, 10), None)
    opening_move_allowed(date(2026, 3, 10), date(2026, 3, 10))
    with pytest.raises(ValueError, match="predate the new opening"):
        opening_move_allowed(date(2026, 3, 11), date(2026, 3, 10))
