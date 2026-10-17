"""Entity settings input; no persistence types."""

from pydantic import Field, field_validator

from accanto.domains.entity import valid_time_zone
from accanto.dtos.monthly import Input, Name


class EntitySettingsInput(Input):
    name: Name
    time_zone: str
    expected_revision: int = Field(ge=1)

    @field_validator("time_zone")
    @classmethod
    def supported_zone(cls, value: str) -> str:
        return valid_time_zone(value)
