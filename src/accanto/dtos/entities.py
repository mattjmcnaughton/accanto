"""Entity creation and settings input; no persistence types."""

from pydantic import Field, field_validator

from accanto.domains.entity import valid_time_zone
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
