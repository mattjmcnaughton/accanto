"""Spending alert contracts (TDD 23). A rule holds no amount; results do."""

from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

from accanto.dtos.monthly import Input

Threshold = Annotated[int, Field(ge=1, le=999)]
Thresholds = Annotated[
    list[Threshold],
    Field(
        min_length=1,
        max_length=10,
        description="Whole percentages of the Plan amount, 1 to 999; over 100 "
        "means overspent.",
    ),
]


class SpendingAlertInput(Input):
    """Guilt-free spending or fixed costs as a whole, or one subcategory or cost."""

    category: Literal["spending", "fixed_cost"]
    spending_subcategory_id: UUID | None = Field(
        default=None, description="One Spending subcategory, read against its estimate."
    )
    fixed_cost_id: UUID | None = Field(
        default=None, description="One Fixed cost, read against its planned line."
    )
    thresholds: Thresholds
    expected_revision: None = None

    @model_validator(mode="after")
    def one_target(self):
        if self.spending_subcategory_id and self.category != "spending":
            raise ValueError("A Spending subcategory is guilt-free spending.")
        if self.fixed_cost_id and self.category != "fixed_cost":
            raise ValueError("A Fixed cost belongs to fixed costs.")
        return self


class SpendingAlertEdit(Input):
    thresholds: Thresholds
    expected_revision: int = Field(ge=1)


class SpendingAlertVersion(BaseModel):
    uuid: UUID
    name: str
    number: int


class SpendingAlert(BaseModel):
    uuid: UUID
    category: Literal["spending", "fixed_cost"]
    spending_subcategory_id: UUID | None
    fixed_cost_id: UUID | None
    name: str
    thresholds: list[int]
    revision: int
    basis: Literal["planned", "estimate"]
    amount: str | None
    recorded: str | None
    percent: int | None
    reached: int | None
    waiting: Literal["no_plan_version", "no_estimate", "not_planned"] | None
    dismissed: bool


class SpendingAlerts(BaseModel):
    month: str
    version: SpendingAlertVersion | None
    spending_alerts: list[SpendingAlert]
