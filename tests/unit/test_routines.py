"""Routine cadence dates and occurrence states, with independently worked dates."""

from datetime import date

import pytest

from accanto.domains.routines import (
    Cadence,
    after,
    before,
    is_scheduled,
    occurrence_state,
    writable,
)

D = date.fromisoformat
SAT, MON, FRI = 5, 0, 4


def days(*values):
    return [D(v) for v in values]


def test_weekly_on_saturday_from_a_sunday():
    weekly = Cadence("weekly", weekdays=(SAT,))
    # 2026-11-01 is a Sunday; the Saturdays of November follow.
    assert before(weekly, D("2026-11-01"), D("2026-11-30"), 12) == days(
        "2026-11-07", "2026-11-14", "2026-11-21", "2026-11-28"
    )


def test_every_two_weeks_counts_from_the_start_week_and_skips_days_before_start():
    # Starts Wed Nov 4: Monday Nov 2 of that week is before the start.
    cadence = Cadence("weekly", interval=2, weekdays=(SAT, MON))
    assert before(cadence, D("2026-11-04"), D("2026-12-01"), 12) == days(
        "2026-11-07", "2026-11-16", "2026-11-21", "2026-11-30"
    )
    assert not is_scheduled(cadence, D("2026-11-04"), D("2026-11-14"))
    assert after(cadence, D("2026-11-04"), D("2026-11-07")) == D("2026-11-16")


def test_monthly_last_day_follows_short_months_and_leap_years():
    last = Cadence("monthly", month_day=-1)
    assert before(last, D("2027-01-01"), D("2027-03-31"), 12) == days(
        "2027-01-31", "2027-02-28", "2027-03-31"
    )
    assert after(last, D("2027-01-01"), D("2028-02-01")) == D("2028-02-29")


def test_monthly_nth_and_last_weekday():
    first_saturday = Cadence("monthly", week=1, weekday=SAT)
    # Dec 1, 2026 is a Tuesday; Jan 1, 2027 a Friday.
    assert after(first_saturday, D("2026-11-26"), D("2026-11-26")) == D("2026-12-05")
    assert after(first_saturday, D("2026-11-26"), D("2026-12-05")) == D("2027-01-02")
    last_friday = Cadence("monthly", week=-1, weekday=FRI)
    # Nov 30, 2026 is a Monday, so the last Friday is the 27th.
    assert after(last_friday, D("2026-11-01"), D("2026-11-01")) == D("2026-11-27")


def test_every_three_months_and_every_two_years():
    quarterly = Cadence("monthly", interval=3, month_day=15)
    assert before(quarterly, D("2026-11-15"), D("2027-06-30"), 12) == days(
        "2026-11-15", "2027-02-15", "2027-05-15"
    )
    biennial = Cadence("yearly", interval=2, month=1, month_day=15)
    assert before(biennial, D("2027-01-15"), D("2031-12-31"), 12) == days(
        "2027-01-15", "2029-01-15", "2031-01-15"
    )
    february_end = Cadence("yearly", month=2, month_day=-1)
    assert after(february_end, D("2027-01-01"), D("2027-02-28")) == D("2028-02-29")


def test_history_is_the_last_dates_on_or_before_today_and_never_before_start():
    weekly = Cadence("weekly", weekdays=(SAT,))
    # Tue Nov 10: the last three Saturdays, oldest first; today is not a Saturday.
    assert before(weekly, D("2026-08-01"), D("2026-11-10"), 3) == days(
        "2026-10-24", "2026-10-31", "2026-11-07"
    )
    assert before(weekly, D("2026-10-30"), D("2026-11-10"), 12) == days(
        "2026-10-31", "2026-11-07"
    )
    assert before(weekly, D("2026-12-01"), D("2026-11-10"), 12) == []
    # A start date in the future: the first scheduled date is after it.
    assert after(weekly, D("2026-12-01"), D("2026-11-10")) == D("2026-12-05")


def test_states_change_on_the_scheduled_and_the_next_dates():
    on, next_on = D("2026-11-07"), D("2026-11-14")

    def state(today, **stored):
        flags = {"completed": False, "skipped": False, **stored}
        return occurrence_state(on, next_on, D(today), **flags)

    assert state("2026-11-06") == "upcoming"
    assert state("2026-11-07") == "due"
    assert state("2026-11-13") == "overdue"
    assert state("2026-11-14") == "missed"
    assert state("2026-12-30", completed=True) == "done"
    assert state("2026-11-08", completed=True, skipped=True) == "skipped"


def test_a_person_may_act_up_to_the_first_date_after_today():
    weekly = Cadence("weekly", weekdays=(SAT,))
    start, today = D("2026-08-01"), D("2026-11-10")
    assert writable(weekly, start, D("2026-09-05"), today)
    assert writable(weekly, start, D("2026-11-14"), today)
    assert not writable(weekly, start, D("2026-11-21"), today)
    assert not writable(weekly, start, D("2026-11-10"), today)
    assert not writable(weekly, start, D("2026-07-25"), today)


@pytest.mark.parametrize(
    "fields",
    [
        {"frequency": "weekly"},
        {"frequency": "weekly", "weekdays": (SAT,), "month_day": 1},
        {"frequency": "monthly", "month_day": 29},
        {"frequency": "monthly", "month_day": 1, "week": 1, "weekday": SAT},
        {"frequency": "monthly", "week": 5, "weekday": SAT},
        {"frequency": "yearly", "month": 13, "month_day": 1},
        {"frequency": "yearly", "month": 2},
        {"frequency": "weekly", "interval": 0, "weekdays": (SAT,)},
    ],
)
def test_impossible_cadences_are_rejected(fields):
    with pytest.raises(ValueError):
        Cadence(**fields)
