"""HTTP contracts for Transaction sources and the Transactions inbox."""

from datetime import date
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

Category = Literal["income", "fixed_cost", "spending", "saving", "investing", "giving"]
# A record UUID, or "unassigned" for Unassigned activity.
Assignment = Annotated[str, Field(min_length=1, max_length=40)]


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class CompletionInput(Input):
    """A proposal or a record override: any subset of the inbox choices."""

    category: Category | None = None
    assignment: Assignment | None = None
    funding: Assignment | None = None
    refund_of: UUID | None = None
    skip: bool = False
    tag_ids: list[UUID] = Field(default_factory=list, max_length=20)

    @field_validator("assignment", "funding")
    @classmethod
    def reference(cls, value: str | None, info) -> str | None:
        if value is None:
            return None
        allowed = {"unassigned"} if info.field_name == "assignment" else {"income"}
        if value in allowed:
            return value
        try:
            return str(UUID(value))
        except ValueError:
            raise ValueError(
                f"Use a record id or {' / '.join(sorted(allowed))}."
            ) from None


class ProposalInput(CompletionInput):
    rationale: str = Field(default="", max_length=2000)
    expected_revision: int = Field(ge=1)


class BulkProposal(ProposalInput):
    item_id: UUID


class BulkProposalInput(Input):
    proposals: list[BulkProposal] = Field(min_length=1, max_length=200)


class RecordInput(Input):
    expected_revision: int = Field(ge=1)
    # Omit to record from the stored proposal.
    completion: CompletionInput | None = None


class BulkRecordItem(RecordInput):
    item_id: UUID


class BulkRecordInput(Input):
    items: list[BulkRecordItem] = Field(min_length=1, max_length=200)


class RevisionInput(Input):
    expected_revision: int = Field(ge=1)


class ResolveInput(Input):
    expected_revision: int = Field(ge=1)
    resolution: Literal["keep", "delete"]


class ConnectYnabInput(Input):
    plan_id: str = Field(min_length=1, max_length=120)
    start_date: date


class ProviderInput(Input):
    """The Settings-level Transaction provider credential."""

    kind: Literal["ynab"]
    access_token: str = Field(min_length=10, max_length=400, repr=False)
    # 0 before a provider was first saved.
    expected_revision: int = Field(ge=0)


class SourceAccount(Input):
    id: str = Field(min_length=1, max_length=120)
    name: str = Field(min_length=1, max_length=200)


class SelectAccountsInput(Input):
    expected_revision: int = Field(ge=1)
    account_ids: list[str] = Field(max_length=100)
