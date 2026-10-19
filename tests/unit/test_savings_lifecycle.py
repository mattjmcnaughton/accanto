"""Synthetic lifecycle decisions and independently worked conservation history."""

from datetime import date
from decimal import Decimal

import pytest

from accanto.domains.savings import (
    SavingEvent,
    archive_allowed,
    completion_amount,
    movement_events,
    replay_savings,
    restored_goal_active,
)


def test_completion_returns_remainder_without_new_contributions():
    assert completion_amount(
        "ordinary", "finite", True, False, Decimal("100.00")
    ) == Decimal("100.00")
    events = [
        SavingEvent(date(2026, 10, 1), 1, "goal", Decimal("1000.00"), True),
        SavingEvent(date(2026, 10, 2), 2, "goal", Decimal("-900.00"), False),
    ]
    events += movement_events(
        date(2026, 10, 3), 3, "goal", "unallocated", Decimal("100.00")
    )
    events += [SavingEvent(date(2026, 11, 1), 4, "goal", Decimal("200.00"), False)]
    balances, contributions = replay_savings(
        {"goal": Decimal("0.00"), "unallocated": Decimal("0.00")}, events
    )
    assert balances == {"goal": Decimal("200.00"), "unallocated": Decimal("100.00")}
    assert contributions["goal"] == Decimal("1000.00")
    events += movement_events(
        date(2026, 11, 2), 5, "goal", "unallocated", Decimal("200.00")
    )
    assert replay_savings(
        {"goal": Decimal("0.00"), "unallocated": Decimal("0.00")}, events
    )[0] == {"goal": Decimal("0.00"), "unallocated": Decimal("300.00")}


def test_completion_and_account_archive_are_explicit():
    assert completion_amount(
        "ordinary", "finite", True, False, Decimal("0.00")
    ) == Decimal("0.00")
    for role, kind, active, completed in [
        ("unallocated", "ongoing", True, False),
        ("ordinary", "ongoing", True, False),
        ("ordinary", "finite", False, False),
        ("ordinary", "finite", False, True),
    ]:
        with pytest.raises(ValueError):
            completion_amount(role, kind, active, completed, Decimal("0.00"))
    archive_allowed(True, Decimal("0.00"))
    with pytest.raises(ValueError, match="zero"):
        archive_allowed(True, Decimal("0.01"))
    with pytest.raises(ValueError):
        archive_allowed(False, Decimal("0.00"))
    assert restored_goal_active(False, True, False)
    assert not restored_goal_active(False, False, False)
    assert not restored_goal_active(False, False, True)
