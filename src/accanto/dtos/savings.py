"""Strict savings API input and output contracts."""

from datetime import date
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from accanto.domains.monthly import money

Name = Annotated[str, Field(min_length=1, max_length=120)]


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class OpeningGoal(Input):
    name: Name
    kind: Literal["finite", "ongoing"]
    target: str | None = None
    opening_amount: str

    @field_validator("opening_amount")
    @classmethod
    def amount(cls, value: str) -> str:
        return str(money(value))


class CreateAccount(Input):
    name: Name
    opening_date: date
    opening_amount: str
    goals: list[OpeningGoal] = Field(default_factory=list, max_length=100)

    @field_validator("opening_amount")
    @classmethod
    def amount(cls, value: str) -> str:
        return str(money(value))


class Designation(Input):
    goal_id: UUID
    opening_amount: str

    @field_validator("opening_amount")
    @classmethod
    def amount(cls, value: str) -> str:
        return str(money(value))


class EditAccount(Input):
    name: Name
    opening_date: date
    opening_amount: str
    designations: list[Designation]
    expected_revision: int = Field(ge=1)

    @field_validator("opening_amount")
    @classmethod
    def amount(cls, value: str) -> str:
        return str(money(value))


class CreateGoal(Input):
    name: Name
    kind: Literal["finite", "ongoing"]
    target: str | None = None
    expected_account_revision: int = Field(ge=1)


class EditGoal(Input):
    name: Name
    kind: Literal["finite", "ongoing"]
    target: str | None = None
    active: bool
    expected_revision: int = Field(ge=1)


class GoalResult(BaseModel):
    uuid: UUID
    name: str
    role: str
    kind: str
    target: str | None
    opening_amount: str
    remaining_saved: str
    contribution_progress: str
    funded_status: str | None
    revision: int
    active: bool


class AccountResult(BaseModel):
    uuid: UUID
    name: str
    opening_date: date
    opening_amount: str
    balance: str
    revision: int
    active: bool
    goals: list[GoalResult]
