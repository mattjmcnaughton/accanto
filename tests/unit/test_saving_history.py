"""Independently worked ordered savings examples."""

from datetime import date
from decimal import Decimal

import pytest

from accanto.domains.savings import SavingEvent, SavingsShortfallError, replay_savings

DAY = date(2026, 10, 16)


def event(order: int, amount: str, *, day: date = DAY, contribution: bool = False):
    return SavingEvent(day, order, "laptop", Decimal(amount), contribution)


def test_funding_must_precede_purchase_on_same_day():
    with pytest.raises(SavingsShortfallError) as failure:
        replay_savings({"laptop": Decimal("800.00")}, [event(1, "-1000.00")])
    assert failure.value.shortfall == Decimal("200.00")
    assert replay_savings(
        {"laptop": Decimal("800.00")},
        [event(2, "-1000.00"), event(1, "200.00", contribution=True)],
    ) == ({"laptop": Decimal("0.00")}, {"laptop": Decimal("200.00")})


def test_backdated_edit_and_funding_deletion_expose_first_later_shortfall():
    history = [
        event(1, "200.00", contribution=True),
        event(2, "-1000.00"),
    ]
    with pytest.raises(SavingsShortfallError) as deleted:
        replay_savings({"laptop": Decimal("800.00")}, history[1:])
    assert deleted.value.financial_date == DAY
    assert deleted.value.goal_id == "laptop"
    with pytest.raises(SavingsShortfallError) as backdated:
        replay_savings(
            {"laptop": Decimal("800.00")},
            [event(1, "200.00", day=date(2026, 10, 17), contribution=True), history[1]],
        )
    assert backdated.value.financial_date == DAY


def test_adjustment_changes_contribution_and_remaining_without_second_account_entry():
    assert replay_savings(
        {"laptop": Decimal("400.00"), "unallocated": Decimal("0.00")},
        [event(1, "100.00", contribution=True), event(2, "0.00", contribution=True)],
    ) == (
        {"laptop": Decimal("500.00"), "unallocated": Decimal("0.00")},
        {"laptop": Decimal("100.00"), "unallocated": Decimal("0.00")},
    )
