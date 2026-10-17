"""Strict savings API input and output contracts."""

from datetime import date
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

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


class MovementInput(Input):
    kind: Literal["reassignment", "transfer", "reconciliation"]
    date: date
    from_goal_id: UUID | None = None
    to_goal_id: UUID | None = None
    goal_id: UUID | None = None
    amount: str | None = None
    known_amount: str | None = None
    note: str = Field(default="", max_length=2000)

    @model_validator(mode="after")
    def fields_for_kind(self):
        if self.kind == "reconciliation":
            if (
                self.goal_id is None
                or self.known_amount is None
                or any(
                    value is not None
                    for value in (self.from_goal_id, self.to_goal_id, self.amount)
                )
            ):
                raise ValueError("Select one goal and its known amount.")
            self.known_amount = str(money(self.known_amount))
        else:
            if (
                self.from_goal_id is None
                or self.to_goal_id is None
                or self.amount is None
                or any(value is not None for value in (self.goal_id, self.known_amount))
            ):
                raise ValueError("Select source and destination goals and an amount.")
            self.amount = str(money(self.amount))
            if self.amount == "0.00":
                raise ValueError("Movement amount must be positive.")
        return self


class EditMovement(MovementInput):
    expected_revision: int = Field(ge=1)


class DeleteMovement(Input):
    kind: Literal["reassignment", "transfer", "reconciliation"]
    expected_revision: int = Field(ge=1)


class MovementResult(BaseModel):
    uuid: UUID
    kind: str
    date: date
    amount: str
    note: str
    revision: int
    from_goal_id: UUID | None = None
    to_goal_id: UUID | None = None
    goal_id: UUID | None = None
