"""Loan account and dated balance observation API contracts."""

from datetime import date
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from accanto.domains.monthly import money


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class Opening(Input):
    date: date
    amount: str

    @field_validator("amount")
    @classmethod
    def valid_amount(cls, value: str) -> str:
        return str(money(value))


class CreateDebt(Input):
    name: str = Field(min_length=1, max_length=120)
    opening: Opening


class EditDebt(Input):
    name: str = Field(min_length=1, max_length=120)
    active: bool
    expected_revision: int = Field(ge=1)


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


class DebtResult(BaseModel):
    uuid: UUID
    name: str
    active: bool
    revision: int
    opening: Opening
    latest: ObservationResult
    draft_fixed_cost_lines: list[UUID] = []
