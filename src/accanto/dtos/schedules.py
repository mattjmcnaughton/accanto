"""Strict HTTP contracts for Entry schedules (TDD 18)."""

from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from accanto.domains.monthly import money
from accanto.dtos.inbox import Assignment, Category, CompletionInput, Input
from accanto.dtos.routines import Cadence, CadenceInput


class ScheduleCadenceInput(CadenceInput):
    """A Routine cadence. weekend moves a day of the month that falls on a
    Saturday or Sunday to the weekday before or after it, within its month:
    month_day -1 with weekend "before" is the last weekday of the month."""

    weekend: Literal["before", "after"] | None = None


class ScheduleLineInput(Input):
    """One entry of each date: an inbox completion with its amount and note."""

    category: Category
    # Positive dollars and cents, such as "1200.00".
    amount: str
    note: str = Field(default="", max_length=2000)
    # A record id, or "unassigned"; saving always names a goal.
    assignment: Assignment | None = None
    # Outflows to spend, invest or give: "income" (the default) or a goal id.
    funding: Assignment | None = None
    tag_ids: list[UUID] = Field(default_factory=list, max_length=20)

    @field_validator("amount")
    @classmethod
    def positive_amount(cls, value: str) -> str:
        amount = money(value)
        if amount <= 0:
            raise ValueError("Enter an amount above zero.")
        return str(amount)

    @field_validator("assignment", "funding")
    @classmethod
    def reference(cls, value, info):
        return CompletionInput.reference(value, info)


class ScheduleInput(Input):
    name: str = Field(min_length=1, max_length=120)
    cadence: ScheduleCadenceInput
    starts_on: date
    ends_on: date | None = None
    paused: bool = False
    lines: list[ScheduleLineInput] = Field(min_length=1, max_length=10)
    expected_revision: int | None = Field(default=None, ge=1)


class SkipInput(Input):
    # True skips the date once; false puts a skipped upcoming date back.
    skipped: bool


class ScheduleCadence(Cadence):
    weekend: Literal["before", "after"] | None


class ScheduleLine(BaseModel):
    category: Category
    amount: str
    note: str
    assignment: str | None
    funding: str | None
    tag_ids: list[UUID]
    # Read-time names of the referenced records; null for Unassigned.
    assignment_name: str | None
    funding_name: str | None


class Rejection(BaseModel):
    code: str
    message: str


class StagedItem(BaseModel):
    """One of a staged date's Transactions inbox items and where it is now."""

    id: UUID
    status: Literal["waiting", "skipped", "recorded", "conflict", "removed"]


class ScheduleOccurrence(BaseModel):
    scheduled_on: date
    status: Literal["staged", "skipped", "failed"]
    rejection: Rejection | None
    items: list[StagedItem]
    staged_at: datetime | None


class UpcomingDate(BaseModel):
    scheduled_on: date
    skipped: bool


class ScheduleResult(BaseModel):
    uuid: UUID
    name: str
    cadence: ScheduleCadence
    starts_on: date
    ends_on: date | None
    paused: bool
    revision: int
    lines: list[ScheduleLine]
    state: Literal["active", "paused", "ended"]
    # The next date the tick stages, after skipped ones; null unless active.
    next_on: date | None
    upcoming: list[UpcomingDate]
    # Up to the latest six stored dates, newest first.
    recent: list[ScheduleOccurrence]
