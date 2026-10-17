"""HTTP contracts; independent of database records."""

from datetime import date
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from accanto.domains.monthly import money

Name = Annotated[str, Field(min_length=1, max_length=120)]


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class IncomeLine(Input):
    source_id: UUID | None = None
    name: Name
    amount: str

    @field_validator("amount")
    @classmethod
    def valid_amount(cls, value: str) -> str:
        return str(money(value))


class PlanInput(Input):
    name: Name
    incomes: list[IncomeLine] = Field(min_length=1, max_length=100)
    spending: str
    expected_revision: int | None = Field(default=None, ge=1)

    @field_validator("spending")
    @classmethod
    def valid_spending(cls, value: str) -> str:
        return str(money(value))


class PlanCopyInput(Input):
    name: Name
    source_revision_id: UUID
    expected_revision: int = Field(ge=1)


class ActivityInput(Input):
    date: date
    category: Literal["income", "spending"]
    amount: str
    source_id: UUID | None = None
    note: str = Field(default="", max_length=2000)
    expected_revision: int | None = Field(default=None, ge=1)

    @field_validator("amount")
    @classmethod
    def valid_amount(cls, value: str) -> str:
        return str(money(value))


class RevisionInput(Input):
    expected_revision: int = Field(ge=1)


class ReviewInput(Input):
    month: date
    version_id: UUID

    @field_validator("month")
    @classmethod
    def first_of_month(cls, value: date) -> date:
        if value.day != 1:
            raise ValueError("Use the first calendar day of the Review month.")
        return value


class ReviewEditInput(Input):
    expected_revision: int = Field(ge=1)
    version_id: UUID
    note: str = Field(max_length=4000)
    reviewed: bool
    checkpoint: bool = False
