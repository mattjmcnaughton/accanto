"""Pure Routine rules (TDD 13): cadence dates, occurrence states and step links.

A Routine is a checklist on a schedule. It is not a financial record: nothing
here reads or writes money, and only a person ticks a step. Dates are calendar
dates in the Entity time zone; callers pass `today` explicitly.
"""

import calendar
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Literal

WEEKDAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
Frequency = Literal["weekly", "monthly", "yearly"]
Weekend = Literal["before", "after"]
# The accanto screens a step can open; the monthly ones also take a month offset.
LINK_SCREENS = (
    "home",
    "activity",
    "inbox",
    "review",
    "plans",
    "routines",
    "savings",
    "investments",
    "giving",
    "loans",
    "settings",
)
MONTHLY_SCREENS = ("home", "activity", "review")
HISTORY = 12
State = Literal["upcoming", "due", "overdue", "missed", "done", "skipped"]


@dataclass(frozen=True)
class Cadence:
    """weekly: weekdays (0 = Monday). monthly: month_day (1–28, or −1 for the last
    day) or week (1–4, or −1 for the last) with weekday. yearly: month and
    month_day. Every `interval` weeks, months or years, counted from starts_on.

    weekend (Entry schedules, TDD 18): a month_day that falls on a Saturday or
    Sunday moves to the weekday before or after it, staying in its month: the
    last day moved before is the last weekday of the month."""

    frequency: Frequency
    interval: int = 1
    weekdays: tuple[int, ...] = ()
    month_day: int | None = None
    week: int | None = None
    weekday: int | None = None
    month: int | None = None
    weekend: Weekend | None = None

    def __post_init__(self):
        if not 1 <= self.interval <= 52:
            raise ValueError("Repeat every 1 to 52 weeks, months or years.")
        if self.frequency == "weekly":
            valid = (
                bool(self.weekdays)
                and all(0 <= d <= 6 for d in self.weekdays)
                and self.month_day is None
                and self.week is None
                and self.weekday is None
                and self.month is None
            )
        elif self.frequency == "monthly":
            by_day = _day(self.month_day) and self.week is None and self.weekday is None
            by_weekday = (
                self.month_day is None
                and self.week in (1, 2, 3, 4, -1)
                and self.weekday is not None
                and 0 <= self.weekday <= 6
            )
            valid = (by_day or by_weekday) and not self.weekdays and self.month is None
        else:
            valid = (
                self.month is not None
                and 1 <= self.month <= 12
                and _day(self.month_day)
                and not self.weekdays
                and self.week is None
                and self.weekday is None
            )
        if not valid:
            raise ValueError("Choose a weekly, monthly or yearly cadence.")
        if self.weekend is not None and (
            self.weekend not in ("before", "after") or self.month_day is None
        ):
            raise ValueError("Only a day of the month can move off a weekend.")


def _day(value):
    return value is not None and (value == -1 or 1 <= value <= 28)


def _last_day(year: int, month: int) -> int:
    return calendar.monthrange(year, month)[1]


def _weekday_near(day: date, weekend: Weekend | None) -> date:
    """day, or the nearest weekday in the weekend direction within day's month."""
    if weekend is None or day.weekday() < 5:
        return day
    friday = day - timedelta(days=day.weekday() - 4)
    monday = day + timedelta(days=7 - day.weekday())
    first, second = (friday, monday) if weekend == "before" else (monday, friday)
    return first if first.month == day.month else second


def _monday(day: date) -> date:
    return day - timedelta(days=day.weekday())


def _period(cadence: Cadence, starts_on: date, day: date) -> int:
    """Whole weeks, months or years from starts_on's period to day's."""
    if cadence.frequency == "weekly":
        return (_monday(day) - _monday(starts_on)).days // 7
    if cadence.frequency == "monthly":
        return (day.year - starts_on.year) * 12 + day.month - starts_on.month
    return day.year - starts_on.year


def _dates(cadence: Cadence, starts_on: date, period: int) -> list[date]:
    """The scheduled dates in one period, in order, before the starts_on filter."""
    if cadence.frequency == "weekly":
        monday = _monday(starts_on) + timedelta(weeks=period)
        return [monday + timedelta(days=d) for d in sorted(set(cadence.weekdays))]
    if cadence.frequency == "monthly":
        index = starts_on.year * 12 + starts_on.month - 1 + period
        year, month = divmod(index, 12)
        month += 1
        if cadence.month_day is not None:
            last = cadence.month_day == -1
            return [
                _weekday_near(
                    date(
                        year,
                        month,
                        _last_day(year, month) if last else cadence.month_day,
                    ),
                    cadence.weekend,
                )
            ]
        assert cadence.week is not None and cadence.weekday is not None
        if cadence.week == -1:
            last = date(year, month, _last_day(year, month))
            return [last - timedelta(days=(last.weekday() - cadence.weekday) % 7)]
        first = date(year, month, 1)
        offset = (cadence.weekday - first.weekday()) % 7
        return [first + timedelta(days=offset + 7 * (cadence.week - 1))]
    year = starts_on.year + period
    assert cadence.month is not None and cadence.month_day is not None
    day = (
        _last_day(year, cadence.month) if cadence.month_day == -1 else cadence.month_day
    )
    return [_weekday_near(date(year, cadence.month, day), cadence.weekend)]


def _scheduled(cadence: Cadence, starts_on: date, period: int) -> list[date]:
    if period < 0 or period % cadence.interval:
        return []
    return [d for d in _dates(cadence, starts_on, period) if d >= starts_on]


def before(cadence: Cadence, starts_on: date, day: date, count: int) -> list[date]:
    """Up to `count` scheduled dates on or before day, oldest first."""
    found: list[date] = []
    period = _period(cadence, starts_on, day)
    period -= period % cadence.interval
    while period >= 0 and len(found) < count:
        found[:0] = [d for d in _scheduled(cadence, starts_on, period) if d <= day]
        period -= cadence.interval
    return found[-count:] if count else []


def after(cadence: Cadence, starts_on: date, day: date) -> date:
    """The first scheduled date after day."""
    period = max(0, _period(cadence, starts_on, day))
    period += -period % cadence.interval
    while True:
        later = [d for d in _scheduled(cadence, starts_on, period) if d > day]
        if later:
            return later[0]
        period += cadence.interval


def is_scheduled(cadence: Cadence, starts_on: date, day: date) -> bool:
    return day in _scheduled(cadence, starts_on, _period(cadence, starts_on, day))


def occurrence_state(
    scheduled_on: date,
    next_on: date,
    today: date,
    *,
    completed: bool,
    skipped: bool,
) -> State:
    """Done and skipped are stored; the rest follow from today and the next date.
    An unfinished occurrence is missed once the next one is due."""
    if skipped:
        return "skipped"
    if completed:
        return "done"
    if today < scheduled_on:
        return "upcoming"
    if today == scheduled_on:
        return "due"
    return "missed" if next_on <= today else "overdue"


def writable(cadence: Cadence, starts_on: date, day: date, today: date) -> bool:
    """A person may act on any scheduled date up to the first one after today."""
    return is_scheduled(cadence, starts_on, day) and day <= after(
        cadence, starts_on, today
    )
