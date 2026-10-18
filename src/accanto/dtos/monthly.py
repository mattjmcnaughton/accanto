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


class FixedCostLine(Input):
    fixed_cost_id: UUID | None = None
    debt_account_id: UUID | None = None
    name: Name
    amount: str
    frequency: Literal["monthly", "annual"]

    @field_validator("amount")
    @classmethod
    def valid_amount(cls, value: str) -> str:
        return str(money(value))


class SavingsFundingLine(Input):
    account_id: UUID
    amount: str

    @field_validator("amount")
    @classmethod
    def valid_amount(cls, value: str) -> str:
        return str(money(value))


class SavingGoalLine(Input):
    goal_id: UUID
    amount: str

    @field_validator("amount")
    @classmethod
    def valid_amount(cls, value: str) -> str:
        return str(money(value))


class DestinationLine(Input):
    destination_id: UUID
    amount: str

    @field_validator("amount")
    @classmethod
    def valid_amount(cls, value: str) -> str:
        return str(money(value))


class PlanInput(Input):
    name: Name
    incomes: list[IncomeLine] = Field(min_length=1, max_length=100)
    fixed_costs: list[FixedCostLine] = Field(default_factory=list, max_length=100)
    savings_funding: list[SavingsFundingLine] = Field(
        default_factory=list, max_length=100
    )
    saving_goals: list[SavingGoalLine] = Field(default_factory=list, max_length=100)
    investments: list[DestinationLine] = Field(default_factory=list, max_length=100)
    giving: list[DestinationLine] = Field(default_factory=list, max_length=100)
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
    category: Literal["income", "spending", "saving", "fixed_cost"]
    amount: str
    source_id: UUID | None = None
    fixed_cost_id: UUID | None = None
    debt_account_id: UUID | None = None
    note: str = Field(default="", max_length=2000)
    expected_revision: int | None = Field(default=None, ge=1)
    is_adjustment: bool = False
    funding_origin: Literal["income", "savings"] = "income"
    saving_goal_id: UUID | None = None

    @field_validator("amount")
    @classmethod
    def valid_amount(cls, value: str) -> str:
        return str(money(value, signed=True))

    @model_validator(mode="after")
    def ordinary_amount(self):
        if not self.is_adjustment:
            money(self.amount)
        if self.category == "saving":
            if self.saving_goal_id is None:
                raise ValueError(
                    "Choose a saving goal, including for zero adjustments."
                )
            if self.funding_origin != "income":
                raise ValueError("New saving must come from current income.")
        elif self.category in {"spending", "fixed_cost"}:
            if self.category == "fixed_cost" and self.funding_origin != "income":
                raise ValueError("Fixed costs must be funded from current income.")
            if (self.funding_origin == "savings") != (self.saving_goal_id is not None):
                raise ValueError("Savings funding requires exactly one saving goal.")
            if self.funding_origin == "savings" and self.amount.startswith("-"):
                raise ValueError("Savings-funded spending cannot be negative.")
        elif self.saving_goal_id is not None or self.funding_origin != "income":
            raise ValueError(
                "Income receipts cannot use a saving goal or funding origin."
            )
        if self.debt_account_id is not None and self.category != "fixed_cost":
            raise ValueError("Only fixed-cost payments can select a Debt account.")
        if self.fixed_cost_id is not None and self.category != "fixed_cost":
            raise ValueError("Only fixed-cost payments select a Fixed cost.")
        return self


class EntryFingerprint(Input):
    uuid: UUID
    revision: int = Field(ge=1)


class KnownTotalInput(Input):
    date: date
    month: date
    category: Literal["income", "spending", "saving", "fixed_cost"]
    desired_total: str
    source_id: UUID | None = None
    saving_goal_id: UUID | None = None
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
        if self.category in {"spending", "fixed_cost"} and self.source_id is not None:
            raise ValueError("Outflow totals cannot select an Income source.")
        if self.category == "saving" and self.saving_goal_id is None:
            raise ValueError("Saving totals require a saving goal, including for zero.")
        if self.category != "saving" and self.saving_goal_id is not None:
            raise ValueError("Only saving totals select a saving goal.")
        if self.category == "saving" and self.source_id is not None:
            raise ValueError("Saving totals cannot select an Income source.")
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
