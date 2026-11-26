"""Entity creation and settings input; no persistence types."""

from pydantic import Field, field_validator

from accanto.domains.entity import valid_time_zone
from accanto.domains.monthly import money
from accanto.domains.projections import expected_return, withdrawal_rate
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
