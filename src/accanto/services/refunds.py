"""Linked refund commands inside the shared Entity transaction."""

from datetime import UTC, date, datetime
from decimal import Decimal

from sqlalchemy import insert, select, update

from accanto.domains.monthly import money
from accanto.domains.refunds import (
    Refund,
    RefundCapError,
    require_purchase_change_allowed,
    validate_refunds,
)
from accanto.models import debts as b
from accanto.models import destinations as d
from accanto.models import monthly as m
from accanto.models import refunds as r
from accanto.models import savings as s
from accanto.services.access import RejectionError
from accanto.services.monthly import check_revision, entry_snapshot, scoped
from accanto.services.savings import attach_entry, current_link


async def linked_refunds(session, purchase_id):
    rows = (
        (
            await session.execute(
                select(m.entries)
                .join(r.refunds, r.refunds.c.refund_entry_id == m.entries.c.id)
                .where(
                    r.refunds.c.original_entry_id == purchase_id,
                    m.entries.c.deleted_at.is_(None),
                )
            )
        )
        .mappings()
        .all()
    )
    return rows


def reject(error: ValueError, *, remaining_refundable: Decimal | None = None):
    message = str(error)
    if remaining_refundable is not None and isinstance(error, RefundCapError):
        message += f" Remaining refundable: ${remaining_refundable:.2f}."
    raise RejectionError("invalid_refund", message, 422) from None


async def validate_purchase_edit(session, old, before, payload, *, deleting=False):
    """Guard original changes while current refunds retain its associations."""
    current = await linked_refunds(session, old["id"])
    if not current:
        return

    def public_id(value):
        return str(value) if value is not None else None

    new_origin = (
        payload.get("funding_origin", "income"),
        public_id(payload.get("saving_goal_id")),
    )
    old_origin = (before["funding_origin"], before["saving_goal_id"])
    try:
        require_purchase_change_allowed(
            has_refunds=True,
            deleting=deleting,
            origin_changed=not deleting and new_origin != old_origin,
        )
        if not deleting:
            if payload.get("category", old["category"]) != old["category"]:
                raise ValueError(
                    "Delete linked refunds before changing purchase category."
                )
            if payload.get("is_adjustment", False):
                raise ValueError(
                    "Delete linked refunds before changing purchase into an adjustment."
                )
            for key in ("fixed_cost_id", "debt_account_id", "destination_id"):
                if public_id(payload.get(key)) != public_id(before.get(key)):
                    raise ValueError(
                        "Delete linked refunds before changing destination or debt."
                    )
            validate_refunds(
                money(payload["amount"], signed=True),
                date.fromisoformat(payload["date"])
                if isinstance(payload["date"], str)
                else payload["date"],
                [Refund(-row["amount"], row["financial_date"]) for row in current],
            )
    except ValueError as error:
        reject(
            error,
            remaining_refundable=old["amount"]
            - sum((-row["amount"] for row in current), Decimal("0.00")),
        )


async def write_refund(session, entity, operation, payload, target, audit):
    action = operation.split("_", 1)[0]
    old = None
    if action == "create":
        purchase = await scoped(session, m.entries, entity["id"], target)
    else:
        old = await scoped(session, m.entries, entity["id"], target)
        purchase_id = await session.scalar(
            select(r.refunds.c.original_entry_id).where(
                r.refunds.c.refund_entry_id == old["id"]
            )
        )
        if purchase_id is None:
            raise RejectionError("not_refund", "Entry is not a linked refund.", 422)
        purchase = (
            (
                await session.execute(
                    select(m.entries).where(m.entries.c.id == purchase_id)
                )
            )
            .mappings()
            .one()
        )
        check_revision(old, payload["expected_revision"])
        if old["deleted_at"]:
            raise RejectionError("deleted_entry", "Refund has already been deleted.")
    if (
        purchase["deleted_at"]
        or purchase["category"] not in {"spending", "fixed_cost", "giving"}
        or purchase["is_adjustment"]
        or purchase["amount"] <= 0
    ):
        raise RejectionError(
            "not_purchase", "Choose a current positive purchase or payment.", 422
        )
    if await session.scalar(
        select(r.refunds.c.id).where(r.refunds.c.refund_entry_id == purchase["id"])
    ):
        raise RejectionError("not_purchase", "A refund cannot itself be refunded.", 422)
    current = [
        row
        for row in await linked_refunds(session, purchase["id"])
        if old is None or row["id"] != old["id"]
    ]
    try:
        remaining = validate_refunds(
            purchase["amount"],
            purchase["financial_date"],
            [Refund(-row["amount"], row["financial_date"]) for row in current]
            + (
                []
                if action == "delete"
                else [Refund(money(payload["amount"]), payload["date"])]
            ),
        )
    except ValueError as error:
        reject(
            error,
            remaining_refundable=purchase["amount"]
            - sum((-row["amount"] for row in current), Decimal("0.00")),
        )
    before = await entry_snapshot(session, old) if old else None
    if action == "delete":
        assert old is not None
        record = (
            (
                await session.execute(
                    update(m.entries)
                    .where(m.entries.c.id == old["id"])
                    .values(deleted_at=datetime.now(UTC), revision=old["revision"] + 1)
                    .returning(m.entries)
                )
            )
            .mappings()
            .one()
        )
        # Retained link keeps its origin; deletion removes its financial effect.
        previous_link = await current_link(session, old["id"])
        await attach_entry(
            session, entity, record, previous_link, None, audit, old["category"]
        )
    else:
        values = dict(
            entity_id=entity["id"],
            financial_date=payload["date"],
            category=purchase["category"],
            amount=-money(payload["amount"]),
            note=payload["note"],
            is_adjustment=False,
            is_refund=True,
            revision=old["revision"] + 1 if old else 1,
        )
        statement = (
            update(m.entries).where(m.entries.c.id == old["id"])
            if old
            else insert(m.entries)
        )
        record = (
            (await session.execute(statement.values(**values).returning(m.entries)))
            .mappings()
            .one()
        )
        if old is None:
            link = (
                (
                    await session.execute(
                        insert(r.refunds)
                        .values(
                            entity_id=entity["id"],
                            original_entry_id=purchase["id"],
                            refund_entry_id=record["id"],
                        )
                        .returning(r.refunds)
                    )
                )
                .mappings()
                .one()
            )
            await audit(r.refunds, link["uuid"], None, dict(link))
            # Copy original associations once; they cannot be edited via refund DTO.
            for table, column in (
                (m.fixed_cost_assignments, "fixed_cost_id"),
                (b.entry_debts, "debt_account_id"),
                (d.giving_entries, "giving_recipient_id"),
            ):
                assignment = (
                    (
                        await session.execute(
                            select(table).where(
                                table.c.actual_entry_id == purchase["id"]
                            )
                        )
                    )
                    .mappings()
                    .first()
                )
                if assignment:
                    values = {
                        "entity_id": entity["id"],
                        "actual_entry_id": record["id"],
                        column: assignment[column],
                    }
                    if table is m.fixed_cost_assignments:
                        values["name"] = assignment["name"]
                    await session.execute(insert(table).values(**values))
        purchase_link = await current_link(session, purchase["id"])
        previous_link = await current_link(session, old["id"]) if old else None
        await attach_entry(
            session,
            entity,
            record,
            previous_link,
            (
                await session.scalar(
                    select(s.goals.c.uuid).where(
                        s.goals.c.id == purchase_link["goal_id"]
                    )
                )
            )
            if purchase_link
            else None,
            audit,
            old["category"] if old else None,
        )
    response = await entry_snapshot(session, record)
    response["refund_of"] = str(purchase["uuid"])
    response["remaining_refundable"] = str(remaining)
    await audit(m.entries, record["uuid"], before, response)
    return response
