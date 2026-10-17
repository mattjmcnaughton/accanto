"""Strict HTTP contracts for independent income estimates."""

import re
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from accanto.domains.monthly import money

Name = Annotated[str, Field(min_length=1, max_length=120)]
Frequency = Literal["annual", "monthly", "twice_monthly", "weekly", "daily"]


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class EstimateLineInput(Input):
    line_id: UUID | None = None
    name: Name
    gross: str
    withholding: str
    payroll: str
    frequency: Frequency
    paid_days: Annotated[int, Field(strict=True, ge=0)] | None = None

    @field_validator("paid_days", mode="before")
    @classmethod
    def exact_paid_days(cls, value):
        if isinstance(value, str):
            if not re.fullmatch(r"\d+", value):
                raise ValueError("Paid days must be a nonnegative integer.")
            return int(value)
        return value

    @field_validator("gross", "withholding", "payroll")
    @classmethod
    def valid_amount(cls, value: str) -> str:
        return str(money(value))

    @model_validator(mode="after")
    def valid_frequency(self):
        if (self.frequency == "daily") != (self.paid_days is not None):
            raise ValueError("Paid days are required for daily income only.")
        return self


class EstimateInput(Input):
    name: Name
    lines: list[EstimateLineInput] = Field(min_length=1, max_length=100)
    expected_revision: int | None = Field(default=None, ge=1)


class DuplicateInput(Input):
    name: Name
    expected_revision: int = Field(ge=1)


class EstimateLineResult(BaseModel):
    uuid: UUID
    name: str
    gross: str
    withholding: str
    payroll: str
    frequency: Frequency
    paid_days: str | None
    monthly_net: str


class EstimateResult(BaseModel):
    uuid: UUID
    name: str
    revision: int
    monthly_total: str
    lines: list[EstimateLineResult]
