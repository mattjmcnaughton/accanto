"""Independently worked known-total examples."""

from decimal import Decimal

import pytest

from accanto.domains.monthly import known_total_delta, money, monthly_actuals
from accanto.dtos.monthly import ActivityInput


def test_known_total_is_a_signed_delta_not_a_replacement():
    recorded = [Decimal("210.00")]
    delta = known_total_delta("250", recorded)
    assert delta == Decimal("40.00")
    assert sum(recorded + [delta]) == Decimal("250.00")
    assert sum(recorded) == Decimal("210.00")  # deletion
    assert sum(recorded + [delta, Decimal("40.00")]) == Decimal("290.00")
    assert known_total_delta("0", []) == Decimal("0.00")
    assert known_total_delta("200", [Decimal("250.00")]) == Decimal("-50.00")


def test_category_adjustment_does_not_resolve_unknown_income_source():
    actual = monthly_actuals(["expected"], [(None, Decimal("40.00"))], [])
    assert actual["income_recorded"] == "40.00"
    assert actual["missing_sources"] == ["expected"]
    assert actual["income_incomplete"] is True


def test_only_explicit_adjustments_allow_signed_amounts():
    base = {"date": "2026-10-16", "category": "spending", "amount": "-10"}
    with pytest.raises(ValueError):
        ActivityInput(**base)
    assert ActivityInput(**base, is_adjustment=True).amount == "-10.00"
    with pytest.raises(ValueError):
        money("-10")
