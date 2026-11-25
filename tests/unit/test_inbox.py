"""Pure Transactions inbox rules and the YNAB mapping, on synthetic values."""

from datetime import date
from decimal import Decimal

import pytest

from accanto.domains.inbox import (
    Completion,
    InboxRejectionError,
    StagedFacts,
    command_for,
    synced_status,
    transition,
    validate_shape,
)
from accanto.integrations.ynab import SourceError, cents, staged_inputs
from tests.fakes import ynab_server as y

GOAL = "11111111-1111-4111-8111-111111111111"
LINE = "22222222-2222-4222-8222-222222222222"


@pytest.mark.parametrize(
    ("milliunits", "expected"),
    [(12340, "12.34"), (-12340, "-12.34"), (0, "0.00"), (-1240180, "-1240.18")],
)
def test_milliunits_become_exact_cents(milliunits, expected):
    assert cents(milliunits) == Decimal(expected)
    assert str(cents(milliunits)) == expected


@pytest.mark.parametrize("milliunits", [12345, -1, 999])
def test_partial_cents_are_rejected_not_rounded(milliunits):
    with pytest.raises(SourceError) as error:
        cents(milliunits)
    assert error.value.code == "partial_cents"


def test_ynab_mapping_splits_lines_and_derives_kind():
    fake = y.FakeYnab()
    accounts = {a["id"]: a for a in fake.accounts}
    inputs = {
        i.source_ref: i
        for i in staged_inputs([tx for _, tx in fake.transactions.values()], accounts)
    }
    lines = [i for i in inputs.values() if i.parent_ref == "tx-split-0001"]
    assert sorted(str(i.amount) for i in lines) == ["-150.40", "-30.00", "-32.00"]
    assert sum(i.amount for i in lines) == Decimal("-212.40")
    assert "tx-split-0001" not in inputs  # the parent itself is not staged
    charity = inputs["tx-split-0001:sub-0003"]
    assert charity.payee == "Sample Warehouse Club"
    assert charity.memo == "Register round-up"
    assert charity.source_category == (y.CATEGORY["Charity"], "Charity")
    assert inputs["tx-0007"].kind == "transfer_on_budget"
    assert inputs["tx-0008"].kind == "card_payment"
    assert inputs["tx-0009"].kind == "transfer_tracking"
    assert inputs["tx-0001"].kind == "ordinary"
    assert inputs["tx-0006"].amount == Decimal("3100.00")
    bistro = inputs["tx-0011"]
    assert (bistro.approved, bistro.cleared) == (False, False)


OUT = StagedFacts(date(2026, 11, 6), Decimal("-640.00"), "Sample Plumbing Co", None)
IN = StagedFacts(date(2026, 11, 9), Decimal("48.00"), "Example Outfitters", "Return")


def test_outflow_with_savings_funding_maps_to_entry_command():
    command = command_for(OUT, Completion(category="spending", funding=GOAL))
    assert command.kind == "entry"
    assert command.fields == {
        "date": "2026-11-06",
        "amount": "640.00",
        "note": "Sample Plumbing Co",
        "category": "spending",
        "funding_goal_id": GOAL,
    }


def test_each_category_maps_to_its_existing_command():
    assert (
        command_for(IN, Completion(category="income", assignment=LINE)).fields[
            "source_id"
        ]
        == LINE
    )
    giving = command_for(OUT, Completion(category="giving", assignment="unassigned"))
    assert (giving.kind, giving.fields["giving_recipient_id"]) == ("giving", None)
    invest = command_for(OUT, Completion(category="investing", assignment=LINE))
    assert (invest.kind, invest.fields["investment_id"]) == ("investment", LINE)
    assert invest.fields["funding_goal_id"] is None
    saving = command_for(OUT, Completion(category="saving", assignment=GOAL))
    assert saving.fields["saving_goal_id"] == GOAL
    assert "funding_goal_id" not in saving.fields
    refund = command_for(IN, Completion(refund_of=LINE))
    assert refund.kind == "refund"
    assert refund.fields == {
        "date": "2026-11-09",
        "amount": "48.00",
        "note": "Example Outfitters · Return",
        "purchase_id": LINE,
    }


@pytest.mark.parametrize(
    ("facts", "completion", "code"),
    [
        (IN, Completion(category="spending"), "needs_refund_link"),
        (OUT, Completion(category="income", assignment=LINE), "outflow_income"),
        (OUT, Completion(category="fixed_cost"), "needs_choice"),
        (OUT, Completion(), "needs_choice"),
        (OUT, Completion(refund_of=LINE), "outflow_refund"),
        (OUT, Completion(skip=True), "skip_proposed"),
    ],
)
def test_incomplete_or_contradictory_completions_are_rejected(facts, completion, code):
    with pytest.raises(InboxRejectionError) as error:
        command_for(facts, completion)
    assert error.value.code == code


@pytest.mark.parametrize(
    "completion",
    [
        Completion(skip=True, category="spending"),
        Completion(refund_of=LINE, category="spending"),
        Completion(assignment=LINE),
        Completion(category="spending", assignment=LINE),
        Completion(category="saving", assignment="unassigned"),
        Completion(category="income", funding=GOAL),
        Completion(category="other"),
    ],
)
def test_impossible_shapes_are_rejected(completion):
    with pytest.raises(InboxRejectionError):
        validate_shape(completion)


def test_status_transitions():
    assert transition("waiting", "record") == "recorded"
    assert transition("skipped", "unskip") == "waiting"
    assert transition("recorded", "undo") == "waiting"
    assert transition("conflict", "delete") == "removed"
    for status, action in [
        ("recorded", "record"),
        ("skipped", "record"),
        ("waiting", "undo"),
    ]:
        with pytest.raises(InboxRejectionError):
            transition(status, action)


def test_source_changes_flag_recorded_items_and_never_unrecord_them():
    assert synced_status("recorded", deleted=True, changed=False) == "conflict"
    assert synced_status("recorded", deleted=False, changed=True) == "conflict"
    assert synced_status("recorded", deleted=False, changed=False) == "recorded"
    assert synced_status("waiting", deleted=True, changed=False) == "removed"
    assert synced_status("skipped", deleted=False, changed=True) == "skipped"
