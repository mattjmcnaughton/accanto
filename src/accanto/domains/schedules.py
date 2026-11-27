"""Pure Entry schedule rules (TDD 18): lines, due dates, state and inbox pairs.

An Entry schedule stages the same entries in the Transactions inbox on every
date of a Routine cadence (domains/routines.py). Each line is an inbox
completion (domains/inbox.py) with its own amount and note: it is staged as a
transaction with that completion as its proposal, and accepting it there runs
exactly the command any inbox record would. Dates are calendar dates in the
Entity time zone; callers pass `today` explicitly. Nothing here reads or writes.
"""

from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation
from typing import Literal

from accanto.domains import routines
from accanto.domains.inbox import (
    Completion,
    EntryCommand,
    InboxRejectionError,
    StagedFacts,
    StagedTransactionInput,
    command_for,
)

MAX_LINES = 10
# Dates the tick stages for one schedule in one run; later ones wait an hour.
CATCH_UP = 24
UPCOMING = 3
# A scheduled inbox item and a source's transaction this many days apart, with
# the same signed amount, are likely the same money (a paycheck or debit landing
# a day or two off its scheduled date).
PAIR_DAYS = 4
State = Literal["active", "paused", "ended"]


class ScheduleRejectionError(ValueError):
    def __init__(self, code: str, message: str):
        self.code = code
        super().__init__(message)


@dataclass(frozen=True)
class Line:
    """One entry of a schedule. assignment and funding as in an inbox Completion."""

    category: str
    amount: Decimal  # positive, exact cents
    note: str = ""
    assignment: str | None = None
    funding: str | None = None
    tag_ids: tuple[str, ...] = ()

    @classmethod
    def of(cls, value: dict) -> "Line":
        try:
            amount = Decimal(str(value["amount"]))
        except (InvalidOperation, KeyError):
            raise ScheduleRejectionError(
                "invalid_line", "Enter each amount in dollars and cents."
            ) from None
        return cls(
            category=value.get("category") or "",
            amount=amount,
            note=(value.get("note") or "").strip(),
            assignment=value.get("assignment"),
            funding=value.get("funding"),
            tag_ids=tuple(value.get("tag_ids") or ()),
        )

    @property
    def signed(self) -> Decimal:
        """Income flows in; every other category flows out."""
        return self.amount if self.category == "income" else -self.amount

    def facts(self, on: date, name: str = "") -> StagedFacts:
        return StagedFacts(
            financial_date=on,
            amount=self.signed,
            payee=name or self.note,
            memo=(self.note or None) if name else None,
        )

    def staged(self, on: date, name: str, position: int) -> StagedTransactionInput:
        """The line as the inbox transaction it waits as: the schedule is its
        payee and the line's note its memo, as a source's memo would be."""
        return StagedTransactionInput(
            source_ref=f"line-{position}",
            account_ref="schedule",
            account_name=name,
            financial_date=on,
            amount=self.signed,
            payee=name,
            kind="ordinary",
            memo=self.note or None,
            cleared=True,
            approved=True,
        )

    def proposal(self) -> dict:
        """The planned completion, prefilled as the inbox item's proposal."""
        return {
            "category": self.category,
            "assignment": self.assignment,
            "funding": self.funding,
            "refund_of": None,
            "skip": False,
            "tag_ids": list(self.tag_ids),
            "rationale": "Planned by this schedule.",
        }

    def completion(self) -> Completion:
        return Completion(
            category=self.category,
            assignment=self.assignment,
            funding=self.funding,
            tag_ids=self.tag_ids,
        )


def commands(lines: list[Line], on: date) -> list[EntryCommand]:
    """The entry commands one date records, in line order, or why it cannot."""
    if not 1 <= len(lines) <= MAX_LINES:
        raise ScheduleRejectionError(
            "invalid_line", f"A schedule records 1 to {MAX_LINES} entries."
        )
    result = []
    for number, line in enumerate(lines, 1):
        if line.amount <= 0 or line.amount != line.amount.quantize(Decimal("0.01")):
            raise ScheduleRejectionError(
                "invalid_line", f"Entry {number}: enter an amount above zero, in cents."
            )
        if line.amount > Decimal("999999999.99"):
            raise ScheduleRejectionError(
                "invalid_line", f"Entry {number}: the amount is too large."
            )
        try:
            result.append(command_for(line.facts(on), line.completion()))
        except InboxRejectionError as error:
            raise ScheduleRejectionError(
                "invalid_line", f"Entry {number}: {error}"
            ) from None
    return result


def first_on_or_after(
    cadence: routines.Cadence, starts_on: date, ends_on: date | None, day: date
) -> date | None:
    """The first scheduled date on or after day, or None once the schedule ends."""
    found = routines.after(cadence, starts_on, day - timedelta(days=1))
    return None if ends_on is not None and found > ends_on else found


def upcoming(
    cadence: routines.Cadence,
    starts_on: date,
    ends_on: date | None,
    next_on: date | None,
    count: int = UPCOMING,
) -> list[date]:
    """The next `count` scheduled dates from next_on, stopping at the end date."""
    dates: list[date] = []
    day = next_on
    while day is not None and len(dates) < count:
        dates.append(day)
        day = first_on_or_after(cadence, starts_on, ends_on, day + timedelta(days=1))
    return dates


def state(paused: bool, next_on: date | None) -> State:
    """Ended once no date is left to record; otherwise paused or active."""
    if next_on is None:
        return "ended"
    return "paused" if paused else "active"


def is_due(next_on: date | None, paused: bool, today: date) -> bool:
    return not paused and next_on is not None and next_on <= today


@dataclass(frozen=True)
class Pairable:
    """A staged transaction that may pair: waiting, or recorded and still live."""

    id: str
    from_schedule: bool
    amount: Decimal  # signed, inflow positive
    financial_date: date


def likely_pair(item: Pairable, others: list[Pairable]) -> Pairable | None:
    """The item of the other origin that is most likely the same money.

    A scheduled item pairs only with a source's transaction and the other way
    round: the same exact signed amount (so the same direction) within PAIR_DAYS.
    The nearest date wins, then the earlier one, then the lower id. Payees,
    names and notes never decide a pair.
    """
    fits = [
        o
        for o in others
        if o.id != item.id
        and o.from_schedule != item.from_schedule
        and o.amount == item.amount
        and abs((o.financial_date - item.financial_date).days) <= PAIR_DAYS
    ]
    if not fits:
        return None
    return min(
        fits,
        key=lambda o: (
            abs((o.financial_date - item.financial_date).days),
            o.financial_date,
            o.id,
        ),
    )
