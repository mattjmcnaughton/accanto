"""Spending alert rules (TDD 23), with independently worked examples."""

from decimal import Decimal

import pytest

from accanto.domains import spending_alerts as rules


@pytest.mark.parametrize(
    ("recorded", "amount", "percent"),
    [
        # $104.99 of a $150 estimate is 69.993%: still below a 70% threshold.
        ("104.99", "150.00", 69),
        ("105.00", "150.00", 70),
        ("112.50", "150.00", 75),
        # $1,500 of $1,200 is 125%: a quarter over.
        ("1500.00", "1200.00", 125),
        # A refund larger than the month's purchases: −$10 of $150 is −6.67%.
        ("-10.00", "150.00", -7),
    ],
)
def test_percent_used_rounds_down(recorded, amount, percent):
    assert rules.percent_used(Decimal(recorded), Decimal(amount)) == percent


def test_percent_used_is_unknown_without_an_amount():
    assert rules.percent_used(Decimal("40.00"), None) is None
    assert rules.percent_used(Decimal("40.00"), Decimal("0.00")) is None


def test_thresholds_are_whole_percentages_once_each():
    assert rules.thresholds([90, 70, 70, 125]) == [70, 90, 125]
    assert rules.thresholds([1, 999]) == [1, 999]
    for bad in ([], [0], [1000], list(range(1, 12))):
        with pytest.raises(rules.AlertRejectionError):
            rules.thresholds(bad)


def test_reached_is_the_highest_threshold_met():
    assert rules.reached([70, 90, 125], 69) is None
    assert rules.reached([70, 90, 125], 90) == 90
    assert rules.reached([70, 90, 125], 130) == 125
    assert rules.reached([70], None) is None


def test_each_threshold_is_pushed_once_a_month():
    chosen = [70, 90, 125]
    # Jumping from nothing to 95% claims 70 and 90 together.
    assert rules.to_push(chosen, 95, set()) == [70, 90]
    # Falling back under and reaching 72% again pushes nothing.
    assert rules.to_push(chosen, 72, {70, 90}) == []
    assert rules.to_push(chosen, 130, {70, 90}) == [125]
    assert rules.to_push(chosen, 50, set()) == []


def test_push_names_targets_and_thresholds_never_amounts():
    one = rules.spending_alerts([("Eating out", 70, "estimate")], "t", "e")
    assert one.body == "Eating out passed 70% of its estimate."
    assert one.path == "/#/"
    many = rules.spending_alerts(
        [
            ("Guilt-free spending", 90, "planned"),
            ("Eating out", 125, "estimate"),
            ("Groceries", 70, "estimate"),
            ("Rent", 100, "planned"),
        ],
        "t",
        "e",
    )
    assert many.body == (
        "Guilt-free spending passed 90% of its plan; Eating out passed 125% of "
        "its estimate; and 2 more spending alerts."
    )
    assert "$" not in many.body
