"""HTTP contracts; independent of database records."""

from datetime import date
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

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
    is_adjustment: bool = False

    @field_validator("amount")
    @classmethod
    def valid_amount(cls, value: str) -> str:
        return str(money(value, signed=True))

    @model_validator(mode="after")
    def ordinary_amount(self):
        if not self.is_adjustment:
            money(self.amount)
        return self


class EntryFingerprint(Input):
    uuid: UUID
    revision: int = Field(ge=1)


class KnownTotalInput(Input):
    date: date
    month: date
    category: Literal["income", "spending"]
    desired_total: str
    source_id: UUID | None = None
    note: str = Field(default="", max_length=2000)
    contributing_entries: list[EntryFingerprint]

    @field_validator("desired_total")
    @classmethod
    def valid_total(cls, value: str) -> str:
        return str(money(value))

    @model_validator(mode="after")
    def matching_month(self):
        if self.month.day != 1 or self.date.strftime("%Y-%m") != self.month.strftime(
            "%Y-%m"
        ):
            raise ValueError("Financial date must be in the selected Review month.")
        if self.category == "spending" and self.source_id is not None:
            raise ValueError("Spending totals cannot select an Income source.")
        return self


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
