"""HTTP contracts for the built-in agent, its settings and Pending changes."""

from typing import Literal
from uuid import UUID

from pydantic import Field

from accanto.dtos.monthly import Input


class AgentSettingsInput(Input):
    enabled: bool
    mode: Literal["propose", "record"]
    instructions: str = Field(default="", max_length=20_000)
    # 0 before the settings were first saved.
    expected_revision: int = Field(ge=0)


class ApplyInput(Input):
    # The owner may edit the drafted input before applying it.
    input: dict | None = None


class ApplyAllChange(Input):
    id: UUID
    input: dict | None = None


class ApplyAllInput(Input):
    # The changes the owner saw, with any edits; applied in drafted order.
    changes: list[ApplyAllChange] = Field(min_length=1, max_length=100)


class DismissInput(Input):
    expected_revision: int = Field(ge=1)
