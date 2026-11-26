"""Pure Transactions inbox rules: completion shape, the entry command it implies,
and staged-transaction status transitions.

A completion is a proposal or a record body: category, assignment, funding origin,
refund link, or skip. Nothing here writes anything; recording always goes through
the existing entry, contribution and refund commands and their own checks.
"""

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Literal

CATEGORIES = ("income", "fixed_cost", "spending", "saving", "investing", "giving")
CATEGORY_NAMES = {
    "income": "income",
    "fixed_cost": "fixed costs",
    "spending": "guilt-free spending",
    "saving": "saving",
    "investing": "investing",
    "giving": "giving",
}
# Categories whose entries name a line; spending has none.
ASSIGNED = {
    "income": "an Income source",
    "fixed_cost": "a fixed cost",
    "saving": "a saving goal",
    "investing": "an investment",
    "giving": "a giving recipient",
}
UNASSIGNED = "unassigned"
Status = Literal["waiting", "skipped", "recorded", "conflict", "removed"]


class InboxRejectionError(ValueError):
    def __init__(self, code: str, message: str):
        self.code = code
        super().__init__(message)


@dataclass(frozen=True)
class Completion:
    """assignment: a record UUID string, UNASSIGNED, or None when not chosen yet.

    funding: "income", a saving goal UUID string, or None for the default.
    """

    category: str | None = None
    assignment: str | None = None
    funding: str | None = None
    refund_of: str | None = None
    skip: bool = False
    tag_ids: tuple[str, ...] = ()  # Tag UUID strings; a refund takes its purchase's


@dataclass(frozen=True)
class StagedFacts:
    financial_date: date
    amount: Decimal  # signed, inflow positive
    payee: str
    memo: str | None = None


@dataclass(frozen=True)
class StagedTransactionInput:
    """The only thing the inbox knows about a source: one transaction or split line."""

    source_ref: str
    account_ref: str
    account_name: str
    financial_date: date
    amount: Decimal  # exact cents, signed, inflow positive
    payee: str
    kind: Literal["ordinary", "transfer_on_budget", "transfer_tracking", "card_payment"]
    parent_ref: str | None = None
    source_category: tuple[str, str] | None = None  # (id, name)
    memo: str | None = None
    cleared: bool = False
    approved: bool = False
    deleted: bool = False

    def latest(self) -> dict:
        """The JSON copy kept on the staged transaction."""
        return {
            "source_ref": self.source_ref,
            "parent_ref": self.parent_ref,
            "account_ref": self.account_ref,
            "account_name": self.account_name,
            "financial_date": self.financial_date.isoformat(),
            "amount": str(self.amount),
            "payee": self.payee,
            "source_category": (
                {"id": self.source_category[0], "name": self.source_category[1]}
                if self.source_category
                else None
            ),
            "memo": self.memo,
            "kind": self.kind,
            "cleared": self.cleared,
            "approved": self.approved,
            "deleted": self.deleted,
        }


@dataclass(frozen=True)
class EntryCommand:
    """One existing command. kind selects create_entry, a contribution or a refund."""

    kind: Literal["entry", "investment", "giving", "refund"]
    fields: dict


def validate_shape(c: Completion) -> None:
    """Combinations that can never be recorded, independent of the transaction."""
    if c.skip and (c.category or c.assignment or c.funding or c.refund_of or c.tag_ids):
        raise InboxRejectionError("invalid_proposal", "A skip proposes nothing else.")
    if c.category is not None and c.category not in CATEGORIES:
        raise InboxRejectionError(
            "invalid_proposal", "Choose one of the six categories."
        )
    if c.refund_of and (c.category or c.assignment or c.funding or c.tag_ids):
        raise InboxRejectionError(
            "invalid_proposal",
            "A refund keeps its purchase's category, funding origin and tags.",
        )
    if c.assignment and not c.category:
        raise InboxRejectionError(
            "invalid_proposal", "Choose a category before a line."
        )
    if c.category == "spending" and c.assignment:
        raise InboxRejectionError(
            "invalid_proposal", "Guilt-free spending has no assignment."
        )
    if c.category == "saving" and c.assignment == UNASSIGNED:
        raise InboxRejectionError(
            "invalid_proposal", "Saving always names a goal, such as Unallocated."
        )
    if c.funding is not None and c.category in {"income", "saving"}:
        raise InboxRejectionError(
            "invalid_proposal",
            "Only outflows to spend, invest or give take a funding origin.",
        )


def entry_note(payee: str, memo: str | None) -> str:
    """F8 (open): the payee is kept in the entry's note, with any memo."""
    note = " · ".join(part for part in (payee.strip(), (memo or "").strip()) if part)
    return note[:2000]


def command_for(facts: StagedFacts, c: Completion) -> EntryCommand:
    """The existing command a completion records, or why it cannot be recorded yet."""
    validate_shape(c)
    if c.skip:
        raise InboxRejectionError(
            "skip_proposed", "Skip is proposed; skip the item instead."
        )
    inflow = facts.amount > 0
    amount = str(abs(facts.amount))
    note = entry_note(facts.payee, facts.memo)
    base = {"date": facts.financial_date.isoformat(), "amount": amount, "note": note}
    tags = {"tag_ids": list(c.tag_ids)} if c.tag_ids else {}
    if c.refund_of:
        if not inflow:
            raise InboxRejectionError(
                "outflow_refund", "Only an inflow can be linked as a refund."
            )
        return EntryCommand("refund", {**base, "purchase_id": c.refund_of})
    if not c.category:
        raise InboxRejectionError(
            "needs_choice",
            "Link the purchase this inflow refunds, or choose a category."
            if inflow
            else "Choose a category.",
        )
    if inflow and c.category != "income":
        raise InboxRejectionError(
            "needs_refund_link",
            f"An inflow to {CATEGORY_NAMES[c.category]} is a refund. "
            "Link its purchase first.",
        )
    if not inflow and c.category == "income":
        raise InboxRejectionError(
            "outflow_income", "Income is money received, and this item is an outflow."
        )
    if c.category in ASSIGNED and c.assignment is None:
        raise InboxRejectionError(
            "needs_choice", f"Choose {ASSIGNED[c.category]} first."
        )
    line = None if c.assignment in (None, UNASSIGNED) else c.assignment
    goal = None if c.funding in (None, "income") else c.funding
    funding = {"funding_goal_id": goal}
    if c.category == "investing":
        return EntryCommand(
            "investment", {**base, "investment_id": line, **funding, **tags}
        )
    if c.category == "giving":
        return EntryCommand(
            "giving", {**base, "giving_recipient_id": line, **funding, **tags}
        )
    fields = {**base, "category": c.category, **tags}
    if c.category == "income":
        fields["source_id"] = line
    elif c.category == "saving":
        fields["saving_goal_id"] = line
    else:
        fields.update(funding)
        if c.category == "fixed_cost":
            fields["fixed_cost_id"] = line
    return EntryCommand("entry", fields)


# Which statuses each inbox action accepts, and the status it leaves.
TRANSITIONS: dict[str, tuple[set[str], str | None]] = {
    "propose": ({"waiting"}, None),
    "record": ({"waiting"}, "recorded"),
    "skip": ({"waiting"}, "skipped"),
    "unskip": ({"skipped"}, "waiting"),
    "undo": ({"recorded"}, "waiting"),
    "keep": ({"conflict"}, "recorded"),
    "delete": ({"conflict"}, "removed"),
}
STATUS_HINTS = {
    "skipped": "This item is skipped. Return it to the inbox first.",
    "recorded": "This item is already recorded.",
    "conflict": "This item changed in its source after recording. Resolve it first.",
    "removed": "This item was removed from its source.",
    "waiting": "This item is waiting in the inbox.",
}


def transition(status: str, action: str) -> str:
    allowed, after = TRANSITIONS[action]
    if status not in allowed:
        raise InboxRejectionError("inbox_status", STATUS_HINTS[status])
    return after or status


def synced_status(status: str, *, deleted: bool, changed: bool) -> str:
    """F7 (open, default): source changes never edit a recorded entry; they flag it."""
    if status in {"recorded", "conflict"}:
        return "conflict" if deleted or changed else status
    if deleted:
        return "removed"
    return status
