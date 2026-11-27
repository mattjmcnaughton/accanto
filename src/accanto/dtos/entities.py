"""Entity creation and settings input; no persistence types."""

from uuid import UUID

from pydantic import Field, field_validator

from accanto.domains.entity import valid_time_zone
from accanto.domains.monthly import money
from accanto.domains.projections import (
    expected_return,
    inflation_rate,
    withdrawal_rate,
)
from accanto.dtos.monthly import Input, Name


class EntityInput(Input):
    """Create Entity: a name and the Entity time zone; it starts empty."""

    name: Name
    time_zone: str

    @field_validator("time_zone")
    @classmethod
    def supported_zone(cls, value: str) -> str:
        return valid_time_zone(value)


class EntitySettingsInput(EntityInput):
    expected_revision: int = Field(ge=1)
    # Omit to leave it unchanged.
    default_return_percent: str | None = Field(
        default=None,
        description="Annual return for investments without their own, -10 to 30.",
    )

    @field_validator("default_return_percent")
    @classmethod
    def valid_return(cls, value: str | None) -> str | None:
        return None if value is None else str(expected_return(value))

    def model_dump(self, **kwargs):
        # Omitted stays out of the command payload, so a request without it
        # keeps the retry digest it had before the field existed.
        data = super().model_dump(**kwargs)
        if data.get("default_return_percent") is None:
            data.pop("default_return_percent", None)
        return data


class FireAssumptionsInput(Input):
    """FIRE inputs for Projections (TDD 14): not activity or a Plan."""

    annual_spending: str | None = None
    withdrawal_percent: str = "4.00"
    expected_revision: int = Field(ge=1)
    # TDD 17. Omit either to leave it unchanged.
    inflation_percent: str | None = Field(
        default=None, description="Average annual inflation, a percent from 0 to 15."
    )
    fixed_costs_not_rising_with_inflation: list[UUID] | None = Field(
        default=None,
        max_length=500,
        description="The full list of Fixed cost ids that will not rise with "
        "inflation; every other Fixed cost rises with it.",
    )

    @field_validator("inflation_percent")
    @classmethod
    def valid_inflation(cls, value: str | None) -> str | None:
        return None if value is None else str(inflation_rate(value))

    @field_validator("fixed_costs_not_rising_with_inflation")
    @classmethod
    def distinct_costs(cls, value: list[UUID] | None) -> list[UUID] | None:
        return None if value is None else list(dict.fromkeys(value))

    def model_dump(self, **kwargs):
        # Omitted stays out of the command payload, so a request without them
        # keeps the retry digest it had before the fields existed.
        data = super().model_dump(**kwargs)
        for key in ("inflation_percent", "fixed_costs_not_rising_with_inflation"):
            if data.get(key) is None:
                data.pop(key, None)
        return data

    @field_validator("annual_spending")
    @classmethod
    def valid_spending(cls, value: str | None) -> str | None:
        if value is None:
            return None
        result = money(value)
        if result <= 0:
            raise ValueError("Annual spending must be positive.")
        return str(result)

    @field_validator("withdrawal_percent")
    @classmethod
    def valid_withdrawal(cls, value: str) -> str:
        return str(withdrawal_rate(value))
