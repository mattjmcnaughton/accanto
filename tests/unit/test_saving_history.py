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


def test_transfer_is_one_equal_effect_movement_without_contributions():
    from accanto.domains.savings import movement_events

    before = {"source": Decimal("100.00"), "destination": Decimal("0.00")}
    events = movement_events(
        date(2026, 9, 15), 1, "source", "destination", Decimal("100.00")
    )
    balances, contributions = replay_savings(before, events)
    assert balances == {"source": Decimal("0.00"), "destination": Decimal("100.00")}
    assert sum(balances.values()) == sum(before.values())
    assert contributions == {"source": Decimal("0.00"), "destination": Decimal("0.00")}
    with pytest.raises(SavingsShortfallError):
        replay_savings(
            before,
            movement_events(
                date(2026, 9, 15), 1, "source", "destination", Decimal("200.00")
            )
            + [SavingEvent(date(2026, 10, 1), 2, "source", Decimal("400.00"), True)],
        )


def test_reconciliation_changes_one_goal_without_contribution():
    from accanto.domains.savings import reconciliation_delta

    delta = reconciliation_delta("5000.00", Decimal("5200.00"))
    assert delta == Decimal("-200.00")
    balances, contributions = replay_savings(
        {"goal": Decimal("1000.00"), "unallocated": Decimal("4200.00")},
        [SavingEvent(DAY, 1, "unallocated", delta, False)],
    )
    assert balances == {"goal": Decimal("1000.00"), "unallocated": Decimal("4000.00")}
    assert sum(balances.values()) == Decimal("5000.00")
    assert contributions == {"goal": Decimal("0.00"), "unallocated": Decimal("0.00")}
