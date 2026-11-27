"""Loan account and dated balance observation API contracts."""

from datetime import date
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from pydantic.json_schema import SkipJsonSchema

from accanto.domains.monthly import money
from accanto.domains.projections import debt_rate


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class Opening(Input):
    date: date
    amount: str

    @field_validator("amount")
    @classmethod
    def valid_amount(cls, value: str) -> str:
        return str(money(value))


TERMS = ("interest_rate_percent", "monthly_payment")


class Terms(Input):
    """Fixed-rate loan terms (TDD 15). Optional; not activity or an observation."""

    interest_rate_percent: str | None = Field(
        default=None,
        description="Fixed annual interest rate, a percent from 0 to 40 with up "
        "to two decimals.",
    )
    monthly_payment: str | None = Field(
        default=None, description="Level monthly payment in USD, above zero."
    )

    @field_validator("interest_rate_percent")
    @classmethod
    def valid_rate(cls, value: str | None) -> str | None:
        return None if value is None else str(debt_rate(value))

    @field_validator("monthly_payment")
    @classmethod
    def valid_payment(cls, value: str | None) -> str | None:
        if value is None:
            return None
        result = money(value)
        if result <= 0:
            raise ValueError("The monthly payment must be above zero.")
        return str(result)


class CreateDebt(Terms):
    name: str = Field(min_length=1, max_length=120)
    opening: Opening


class EditDebt(Terms):
    name: str = Field(min_length=1, max_length=120)
    active: bool
    expected_revision: int = Field(ge=1)
    # Set from the request: terms it left out stay as they are, so a client
    # that only renames or archives a loan does not clear them.
    unchanged: SkipJsonSchema[list[str]] = []

    @model_validator(mode="after")
    def omitted_terms(self):
        self.unchanged = [f for f in TERMS if f not in self.model_fields_set]
        return self


class ObservationInput(Input):
    date: date
    amount: str
    account_id: UUID | None = None
    expected_revision: int | None = Field(default=None, ge=1)

    @field_validator("amount")
    @classmethod
    def valid_amount(cls, value: str) -> str:
        return str(money(value))


class ObservationResult(BaseModel):
    uuid: UUID
    financial_date: date
    amount: str
    account_id: UUID | None
    is_opening: bool
    revision: int
    deleted: bool


PayoffStatus = Literal[
    "scheduled", "paid_off", "no_terms", "interest_not_covered", "beyond_limit"
]


class PayoffSummary(BaseModel):
    """A payoff schedule's figures from the latest recorded balance (TDD 15)."""

    status: PayoffStatus
    as_of: date
    balance: str
    interest_rate_percent: str | None
    monthly_payment: str | None
    monthly_interest: str | None
    months: int | None
    payoff_date: date | None
    total_interest: str | None
    total_paid: str | None


class PayoffRow(BaseModel):
    month: int
    date: date
    payment: str
    interest: str
    principal: str
    balance: str


class PayoffSchedule(PayoffSummary):
    rows: list[PayoffRow]


class DebtResult(BaseModel):
    uuid: UUID
    name: str
    active: bool
    revision: int
    opening: Opening
    latest: ObservationResult
    interest_rate_percent: str | None = None
    monthly_payment: str | None = None
    payoff: PayoffSummary
    draft_fixed_cost_lines: list[UUID] = []
