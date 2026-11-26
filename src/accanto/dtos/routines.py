"""Strict HTTP contracts for Routines (TDD 13). Not financial records."""

from datetime import date
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from accanto.domains.routines import LINK_SCREENS, MONTHLY_SCREENS

Weekday = Literal["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
LinkScreen = Literal[
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
]
assert set(LinkScreen.__args__) == set(LINK_SCREENS)  # type: ignore[attr-defined]
Note = Annotated[str, Field(max_length=4000)]


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class CadenceInput(Input):
    """weekly: weekdays. monthly: month_day (1–28, or -1 for the last day), or
    week (1–4, or -1 for the last) with weekday. yearly: month and month_day.
    Fields the frequency does not use are null or empty."""

    frequency: Literal["weekly", "monthly", "yearly"]
    interval: int = Field(default=1, ge=1, le=52)
    weekdays: list[Weekday] = Field(default_factory=list, max_length=7)
    month_day: int | None = None
    week: int | None = None
    weekday: Weekday | None = None
    month: int | None = Field(default=None, ge=1, le=12)


class StepInput(Input):
    step_id: UUID | None = None
    title: str = Field(min_length=1, max_length=200)
    link_screen: LinkScreen | None = None
    link_month_offset: int | None = Field(default=None, ge=-12, le=12)
    link_url: str | None = Field(
        default=None, max_length=2000, pattern=r"^https://[^\s/]+\.[^\s]+$"
    )

    @model_validator(mode="after")
    def one_link(self):
        if self.link_screen and self.link_url:
            raise ValueError("A step links to a screen or a website, not both.")
        if self.link_month_offset is not None and (
            self.link_screen not in MONTHLY_SCREENS
        ):
            raise ValueError("A month offset applies to Home, Activity and Review.")
        return self


class RoutineInput(Input):
    name: str = Field(min_length=1, max_length=120)
    cadence: CadenceInput
    starts_on: date
    steps: list[StepInput] = Field(min_length=1, max_length=50)
    active: bool = True
    expected_revision: int | None = Field(default=None, ge=1)


class StepTick(Input):
    status: Literal["done", "skipped"] | None
    note: Note | None = None


class OccurrenceInput(Input):
    skipped: bool
    note: Note = ""
    # 0 when the occurrence is not stored yet (nobody has acted on it).
    expected_revision: int = Field(ge=0)


State = Literal["upcoming", "due", "overdue", "missed", "done", "skipped"]


class Cadence(BaseModel):
    frequency: Literal["weekly", "monthly", "yearly"]
    interval: int
    weekdays: list[Weekday]
    month_day: int | None
    week: int | None
    weekday: Weekday | None
    month: int | None


class Step(BaseModel):
    uuid: UUID
    title: str
    link_screen: LinkScreen | None
    link_month_offset: int | None
    link_url: str | None


class OccurrenceSummary(BaseModel):
    scheduled_on: date
    state: State
    done: int
    total: int


class RoutineResult(BaseModel):
    uuid: UUID
    name: str
    cadence: Cadence
    starts_on: date
    active: bool
    revision: int
    steps: list[Step]
    current: OccurrenceSummary | None
    next_on: date | None
    history: list[OccurrenceSummary]


class OccurrenceStep(BaseModel):
    step_id: UUID
    title: str
    link_screen: LinkScreen | None
    link_month_offset: int | None
    link_url: str | None
    status: Literal["done", "skipped"] | None
    note: str


class OccurrenceResult(BaseModel):
    routine_id: UUID
    scheduled_on: date
    next_on: date | None
    state: State
    skipped: bool
    completed_on: date | None
    note: str
    revision: int
    steps: list[OccurrenceStep]
