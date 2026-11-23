"""HTTP contracts for the built-in agent, its settings and Pending changes."""

from typing import Literal

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


class DismissInput(Input):
    expected_revision: int = Field(ge=1)
