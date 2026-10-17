"""Independently worked opening and target examples."""

from decimal import Decimal

import pytest

from accanto.domains.savings import (
    funded_status,
    goal_target,
    opening_change_allowed,
    opening_designations,
)


def test_opening_is_conserved_once():
    assert opening_designations("10000.00", ["5000.00", "1000.00"]) == Decimal(
        "4000.00"
    )
    with pytest.raises(ValueError, match="exceed"):
        opening_designations("10000.00", ["9000.00", "1001.00"])


def test_finite_target_and_ongoing_without_target():
    assert goal_target("finite", "100.00") == Decimal("100.00")
    assert goal_target("ongoing", None) is None
    with pytest.raises(ValueError, match="positive"):
        goal_target("finite", "0.00")
    with pytest.raises(ValueError, match="require"):
        goal_target("finite", None)


def test_retained_deleted_activity_still_freezes_opening():
    opening_change_allowed(False, True)
    opening_change_allowed(True, False)
    with pytest.raises(ValueError, match="including deleted"):
        opening_change_allowed(True, True)


def test_funded_status_uses_saved_amount_without_inventing_contributions():
    assert funded_status(Decimal("5000.00"), Decimal("5000.00")) == "Funded"
    assert funded_status(Decimal("4999.99"), Decimal("5000.00")) == "Not yet funded"
    assert funded_status(Decimal("4000.00"), None) is None
