"""Destination and investment opening API contracts."""

from datetime import date
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from pydantic.json_schema import SkipJsonSchema

from accanto.domains.monthly import money
from accanto.domains.projections import expected_return
from accanto.dtos.monthly import LegacyOrigin, funding_goal

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


Frequency = Literal["monthly", "annual"]
EXPECTATIONS = (
    "expected_return_percent",
    "expected_contribution",
    "expected_contribution_frequency",
)


class Expectations(Input):
    """Projection assumptions (TDD 14), investments only. Never activity."""

    expected_return_percent: str | None = Field(
        default=None,
        description="Expected annual return, a percent from -10 to 30; blank "
        "uses the Entity's default return.",
    )
    expected_contribution: str | None = Field(
        default=None, description="Expected contribution in USD, per frequency."
    )
    expected_contribution_frequency: Frequency = "monthly"

    @field_validator("expected_return_percent")
    @classmethod
    def valid_return(cls, value: str | None) -> str | None:
        return None if value is None else str(expected_return(value))

    @field_validator("expected_contribution")
    @classmethod
    def valid_contribution(cls, value: str | None) -> str | None:
        return None if value is None else str(money(value))


TaxTreatment = Literal["taxable", "tax_advantaged"]
Liquidity = Literal["liquid", "illiquid"]
TRAITS = ("tax_treatment", "liquidity")


class Traits(Expectations):
    """How an investment is held, investments only. Classification, not math."""

    tax_treatment: TaxTreatment | None = Field(
        default=None,
        description="Investments only: taxable (a brokerage account) or "
        "tax_advantaged (a 401(k), IRA or HSA). Omit to keep the current value; "
        "a new investment defaults to taxable.",
    )
    liquidity: Liquidity | None = Field(
        default=None,
        description="Investments only: liquid (a stock fund you can sell) or "
        "illiquid (a house). Omit to keep the current value; a new investment "
        "defaults to liquid.",
    )


class CreateDestination(Traits):
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


class EditDestination(Traits):
    name: Name
    target: str | None = None
    active: bool
    expected_revision: int = Field(ge=1)
    # Investments only: moves the opening observation's date; omit to keep it.
    opening_date: date | None = None
    # Set from the request: the assumptions it left out stay as they are, so a
    # client that only renames an investment does not clear them.
    unchanged: SkipJsonSchema[list[str]] = []

    @field_validator("target")
    @classmethod
    def valid_target(cls, value: str | None) -> str | None:
        return CreateDestination.valid_target(value)

    @model_validator(mode="after")
    def omitted_expectations(self):
        self.unchanged = [f for f in EXPECTATIONS if f not in self.model_fields_set]
        return self


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
    expected_return_percent: str | None = None
    expected_contribution: str | None = None
    expected_contribution_frequency: Frequency | None = None
    tax_treatment: TaxTreatment | None = None
    liquidity: Liquidity | None = None


class ContributionInput(Input):
    """investment_id on investment routes, giving_recipient_id on giving routes."""

    date: date
    amount: str
    investment_id: UUID | None = None
    giving_recipient_id: UUID | None = None
    funding_goal_id: UUID | None = None
    note: str = Field(default="", max_length=2000)
    is_adjustment: bool = False
    expected_revision: int | None = Field(default=None, ge=1)
    # Replaces the entry's tags; omit to leave them unchanged.
    tag_ids: list[UUID] | None = Field(default=None, max_length=20)
    # Transition only (see dtos.monthly.LegacyOrigin); the service resolves
    # destination_id by the route's kind.
    destination_id: SkipJsonSchema[UUID | None] = None
    funding_origin: LegacyOrigin = Field(default=None, exclude=True)
    saving_goal_id: SkipJsonSchema[UUID | None] = Field(default=None, exclude=True)

    @field_validator("amount")
    @classmethod
    def valid_amount(cls, value: str) -> str:
        return str(money(value, signed=True))

    @model_validator(mode="after")
    def ordinary_amount(self):
        if not self.is_adjustment:
            money(self.amount)
        self.funding_goal_id = funding_goal(
            self.funding_origin, self.saving_goal_id, self.funding_goal_id
        )
        self.funding_origin = self.saving_goal_id = None
        if self.investment_id is not None and self.giving_recipient_id is not None:
            raise ValueError("Name an investment or a giving recipient, not both.")
        if self.destination_id is not None and (
            self.investment_id is not None or self.giving_recipient_id is not None
        ):
            raise ValueError("destination_id is replaced; send only the new field.")
        if self.funding_goal_id is not None and self.amount.startswith("-"):
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
    is_refund: bool = False
    revision: int
    investment_id: UUID | None = None
    giving_recipient_id: UUID | None = None
    funding_origin: str = "income"
    funding_goal_id: UUID | None = None
    tag_ids: list[UUID] = []
