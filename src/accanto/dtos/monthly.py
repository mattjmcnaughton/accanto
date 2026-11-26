"""HTTP contracts; independent of database records."""

from datetime import date
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from pydantic.json_schema import SkipJsonSchema

from accanto.domains.monthly import fixed_cost_monthly, money

Name = Annotated[str, Field(min_length=1, max_length=120)]


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


# Before 2026-11-25 an outflow named its funding as `funding_origin: "savings"` plus
# `saving_goal_id`. Inputs still accept that pair, outside the published schema, so
# older API callers and stored Pending changes keep working; it maps here.
LegacyOrigin = SkipJsonSchema[Literal["income", "savings"] | None]


def funding_goal(origin, legacy_goal, goal):
    """The goal funding an outflow (None means current income), from either form."""
    if legacy_goal is not None and goal is not None and legacy_goal != goal:
        raise ValueError("funding_goal_id and saving_goal_id name different goals.")
    if origin is None:
        if legacy_goal is not None:
            raise ValueError("Name the goal that funds an outflow as funding_goal_id.")
        return goal
    chosen = goal or legacy_goal
    if (origin == "savings") != (chosen is not None):
        raise ValueError("Savings funding requires exactly one saving goal.")
    return chosen


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
    frequency: Literal["weekly", "biweekly", "monthly", "quarterly", "annual"]

    @field_validator("amount")
    @classmethod
    def valid_amount(cls, value: str) -> str:
        return str(money(value))

    @model_validator(mode="after")
    def valid_monthly_amount(self):
        fixed_cost_monthly(self.amount, self.frequency)
        return self


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
    saving_goal_id: UUID | None = None
    funding_goal_id: UUID | None = None
    note: str = Field(default="", max_length=2000)
    expected_revision: int | None = Field(default=None, ge=1)
    is_adjustment: bool = False
    funding_origin: LegacyOrigin = Field(default=None, exclude=True)
    # Replaces the entry's tags; omit to leave them unchanged.
    tag_ids: list[UUID] | None = Field(default=None, max_length=20)

    @field_validator("amount")
    @classmethod
    def valid_amount(cls, value: str) -> str:
        return str(money(value, signed=True))

    @model_validator(mode="after")
    def ordinary_amount(self):
        if not self.is_adjustment:
            money(self.amount)
        if self.category in {"spending", "fixed_cost"}:
            self.funding_goal_id = funding_goal(
                self.funding_origin, self.saving_goal_id, self.funding_goal_id
            )
            self.saving_goal_id = None
            if self.funding_goal_id is not None and self.amount.startswith("-"):
                raise ValueError("Savings-funded spending cannot be negative.")
        elif self.funding_goal_id is not None or self.funding_origin == "savings":
            raise ValueError("New saving and income receipts come from current income.")
        self.funding_origin = None
        if self.category == "saving" and self.saving_goal_id is None:
            raise ValueError("Choose a saving goal, including for zero adjustments.")
        if self.category == "income" and self.saving_goal_id is not None:
            raise ValueError("Income receipts cannot use a saving goal.")
        if self.debt_account_id is not None and self.category != "fixed_cost":
            raise ValueError("Only fixed-cost payments can select a Debt account.")
        if self.fixed_cost_id is not None and self.category != "fixed_cost":
            raise ValueError("Only fixed-cost payments select a Fixed cost.")
        return self


class RefundInput(Input):
    date: date
    amount: str
    note: str = Field(default="", max_length=2000)
    expected_revision: int | None = Field(default=None, ge=1)

    @field_validator("amount")
    @classmethod
    def valid_amount(cls, value: str) -> str:
        amount = money(value)
        if amount <= 0:
            raise ValueError("Refund amount must be positive.")
        return str(amount)


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


class TagInput(Input):
    name: Name


class TagEditInput(Input):
    name: Name
    active: bool
    expected_revision: int = Field(ge=1)


class EntryTagsChange(Input):
    entry_id: UUID
    expected_revision: int = Field(ge=1)
    tag_ids: list[UUID] = Field(max_length=20)


class EntryTagsInput(Input):
    entries: list[EntryTagsChange] = Field(min_length=1, max_length=200)
