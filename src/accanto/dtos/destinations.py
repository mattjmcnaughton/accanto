"""Destination and investment opening API contracts."""

from datetime import date
from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from accanto.domains.monthly import money

Name = Annotated[str, Field(min_length=1, max_length=120)]


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class Opening(Input):
    date: date
    amount: str

    @field_validator("amount")
    @classmethod
    def valid_amount(cls, value: str) -> str:
        return str(money(value))


class CreateDestination(Input):
    name: Name
    target: str | None = None
    opening: Opening | None = None

    @field_validator("target")
    @classmethod
    def valid_target(cls, value: str | None) -> str | None:
        if value is None:
            return None
        result = money(value)
        if result <= 0:
            raise ValueError("Contribution targets must be positive.")
        return str(result)


class EditDestination(Input):
    name: Name
    target: str | None = None
    active: bool
    expected_revision: int = Field(ge=1)

    @field_validator("target")
    @classmethod
    def valid_target(cls, value: str | None) -> str | None:
        return CreateDestination.valid_target(value)


class LatestObservation(BaseModel):
    date: date
    amount: str


class DestinationResult(BaseModel):
    uuid: UUID
    name: str
    target: str | None
    active: bool
    revision: int
    contribution_progress: str
    opening: Opening | None = None
    latest: LatestObservation | None = None


class ContributionInput(Input):
    date: date
    amount: str
    destination_id: UUID | None = None
    note: str = Field(default="", max_length=2000)
    is_adjustment: bool = False
    expected_revision: int | None = Field(default=None, ge=1)
    funding_origin: str = "income"
    saving_goal_id: UUID | None = None

    @field_validator("amount")
    @classmethod
    def valid_amount(cls, value: str) -> str:
        return str(money(value, signed=True))

    @model_validator(mode="after")
    def ordinary_amount(self):
        if not self.is_adjustment:
            money(self.amount)
        if self.funding_origin not in {"income", "savings"}:
            raise ValueError("Choose current income or savings as funding origin.")
        if (self.funding_origin == "savings") != (self.saving_goal_id is not None):
            raise ValueError("Savings funding requires exactly one saving goal.")
        if self.funding_origin == "savings" and self.amount.startswith("-"):
            raise ValueError(
                "Use a linked refund for returned savings-funded payments."
            )
        return self


class ContributionResult(BaseModel):
    uuid: UUID
    financial_date: date
    category: str
    amount: str
    note: str
    is_adjustment: bool
    revision: int
    destination_id: UUID | None
    funding_origin: str = "income"
    saving_goal_id: UUID | None = None
