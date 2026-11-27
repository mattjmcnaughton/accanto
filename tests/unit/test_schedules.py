"""Pure Entry schedule rules (TDD 18): weekend moves, due dates and inbox pairs.

Expected dates are read off a calendar for 2026–2027, not from the code.
"""

from datetime import date
from decimal import Decimal

import pytest

from accanto.domains.routines import Cadence, after
from accanto.domains.schedules import (
    Line,
    Pairable,
    ScheduleRejectionError,
    commands,
    first_on_or_after,
    likely_pair,
    state,
    upcoming,
)

START = date(2026, 9, 1)


def dates(cadence, count, start=START):
    found, day = [], start
    for _ in range(count):
        found_on = first_on_or_after(cadence, start, None, day)
        assert found_on is not None
        found.append(found_on)
        day = date.fromordinal(found_on.toordinal() + 1)
    return found


def test_last_weekday_of_the_month():
    # Oct 31 2026 is a Saturday and Jan 31 2027 a Sunday; Feb 28 2027 a Sunday.
    cadence = Cadence("monthly", month_day=-1, weekend="before")
    assert dates(cadence, 6) == [
        date(2026, 9, 30),
        date(2026, 10, 30),
        date(2026, 11, 30),
        date(2026, 12, 31),
        date(2027, 1, 29),
        date(2027, 2, 26),
    ]


def test_weekend_moves_stay_in_the_month():
    # Nov 1 2026 is a Sunday: "before" would leave the month, so it moves after.
    first = Cadence("monthly", month_day=1, weekend="before")
    assert after(first, date(2026, 11, 1), date(2026, 10, 31)) == date(2026, 11, 2)
    # Oct 31 2026 is a Saturday: "after" would leave the month, so it moves before.
    last = Cadence("monthly", month_day=-1, weekend="after")
    assert after(last, date(2026, 10, 1), date(2026, 10, 1)) == date(2026, 10, 30)
    # Nov 15 2026 is a Sunday; Dec 15 a Tuesday stays.
    mid = Cadence("monthly", month_day=15, weekend="after")
    assert dates(mid, 2, date(2026, 11, 1)) == [date(2026, 11, 16), date(2026, 12, 15)]


def test_weekend_needs_a_day_of_the_month():
    with pytest.raises(ValueError):
        Cadence("weekly", weekdays=(4,), weekend="before")
    with pytest.raises(ValueError):
        Cadence("monthly", week=1, weekday=4, weekend="before")


def test_end_date_and_state():
    weekly = Cadence("weekly", weekdays=(4,))  # Fridays
    ends = date(2026, 11, 20)
    assert upcoming(weekly, START, ends, date(2026, 11, 13)) == [
        date(2026, 11, 13),
        date(2026, 11, 20),
    ]
    assert first_on_or_after(weekly, START, ends, date(2026, 11, 21)) is None
    assert state(False, None) == "ended"
    assert state(True, date(2026, 11, 13)) == "paused"


def test_lines_become_the_inbox_commands():
    pay = Line(category="income", amount=Decimal("1200.00"), assignment="unassigned")
    fund = Line(
        category="investing", amount=Decimal("1200.00"), assignment="unassigned"
    )
    income, investing = commands([pay, fund], date(2026, 11, 30))
    assert (income.kind, income.fields["category"], income.fields["amount"]) == (
        "entry",
        "income",
        "1200.00",
    )
    assert (investing.kind, investing.fields["amount"]) == ("investment", "1200.00")
    for bad in (
        Line(category="saving", amount=Decimal("10.00")),  # saving names a goal
        Line(category="income", amount=Decimal("0.00"), assignment="unassigned"),
        Line(category="spending", amount=Decimal("1.005")),
    ):
        with pytest.raises(ScheduleRejectionError):
            commands([bad], date(2026, 11, 30))


def test_a_line_waits_in_the_inbox_as_its_planned_proposal():
    fund = Line(
        category="investing",
        amount=Decimal("1200.00"),
        note="401(k) contribution",
        assignment="fund-id",
        funding="income",
    )
    staged = fund.staged(date(2026, 11, 30), "Payroll", 2)
    # An outflow, named after the schedule, with the line's note as its memo;
    # schedule items are cleared by nature and never wait for clearing.
    assert (staged.amount, staged.payee, staged.memo) == (
        Decimal("-1200.00"),
        "Payroll",
        "401(k) contribution",
    )
    assert (staged.source_ref, staged.cleared) == ("line-2", True)
    assert fund.proposal()["category"] == "investing"
    assert fund.proposal()["assignment"] == "fund-id"
    assert fund.proposal()["skip"] is False
    pay = Line(category="income", amount=Decimal("1200.00"), assignment="unassigned")
    assert pay.staged(date(2026, 11, 30), "Payroll", 1).amount == Decimal("1200.00")


def test_likely_pair_needs_the_other_origin_signed_amount_and_nearby_date():
    pay = Pairable("pay", True, Decimal("1200.00"), date(2026, 11, 30))
    fund = Pairable("fund", True, Decimal("-1200.00"), date(2026, 11, 30))
    early = Pairable("early", True, Decimal("1200.00"), date(2026, 11, 27))
    scheduled = [pay, fund, early]
    deposit = Pairable("deposit", False, Decimal("1200.00"), date(2026, 12, 2))
    # A deposit two days later pairs with the nearer income, never the outflow.
    assert likely_pair(deposit, scheduled) == pay
    withdrawal = Pairable("w", False, Decimal("-1200.00"), date(2026, 12, 2))
    assert likely_pair(withdrawal, scheduled) == fund
    # And the other way round: the schedule's item finds the deposit.
    assert likely_pair(pay, [*scheduled, deposit]) == deposit
    # Never two items of the same origin, even with the same amount and date.
    other_ynab = Pairable("y2", False, Decimal("1200.00"), date(2026, 12, 2))
    assert likely_pair(deposit, [other_ynab]) is None
    # Four days is the edge; five is too far. A cent off never pairs.
    on = Pairable("d4", False, Decimal("1200.00"), date(2026, 12, 4))
    assert likely_pair(on, [pay]) == pay
    late = Pairable("d5", False, Decimal("1200.00"), date(2026, 12, 5))
    assert likely_pair(late, [pay]) is None
    cent = Pairable("c", False, Decimal("1200.01"), date(2026, 11, 30))
    assert likely_pair(cent, scheduled) is None
