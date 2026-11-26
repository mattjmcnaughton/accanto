"""Destination commands under the shared authorized Entity transaction."""

from datetime import UTC, date, datetime
from decimal import Decimal

import logfire
from sqlalchemy import delete, func, insert, select, update

from accanto.db import read_snapshot
from accanto.domains.destinations import (
    contribution_amount,
    contribution_target,
    opening_date_allowed,
    require_new_destination,
)
from accanto.models import destinations as d
from accanto.models import monthly as m
from accanto.services.access import RejectionError
from accanto.services.monthly import authorize, check_revision, scoped


def assignment_field(kind):
    """The entry field naming a contribution's assignment."""
    return "investment_id" if kind == "investment" else "giving_recipient_id"


def resources(kind):
    if kind == "investment":
        return d.investments, d.investment_entries, "investment_id", "investing"
    if kind == "giving":
        return d.recipients, d.giving_entries, "giving_recipient_id", "giving"
    raise ValueError("Unsupported destination type")


async def snapshot(session, kind, row):
    table, assignments, foreign_key, category = resources(kind)
    progress = await session.scalar(
        select(func.coalesce(func.sum(m.entries.c.amount), 0))
        .select_from(
            m.entries.join(assignments, assignments.c.actual_entry_id == m.entries.c.id)
        )
        .where(
            assignments.c[foreign_key] == row["id"],
            m.entries.c.deleted_at.is_(None),
            m.entries.c.category == category,
        )
    )
    opening = None
    latest = None
    if kind == "investment":
        observation = (
            (
                await session.execute(
                    select(d.observations).where(
                        d.observations.c.investment_id == row["id"],
                        d.observations.c.is_opening,
                    )
                )
            )
            .mappings()
            .first()
        )
        if observation:
            opening = {
                "date": observation["financial_date"].isoformat(),
                "amount": str(observation["amount"]),
            }
        latest_row = (
            (
                await session.execute(
                    select(d.observations)
                    .where(
                        d.observations.c.investment_id == row["id"],
                        d.observations.c.deleted_at.is_(None),
                    )
                    .order_by(
                        d.observations.c.financial_date.desc(),
                        d.observations.c.is_opening.asc(),
                    )
                    .limit(1)
                )
            )
            .mappings()
            .first()
        )
        if latest_row:
            latest = {
                "date": latest_row["financial_date"].isoformat(),
                "amount": str(latest_row["amount"]),
            }
    return {
        "uuid": str(row["uuid"]),
        "name": row["name"],
        "target": str(row["target"]) if row["target"] is not None else None,
        "active": row["active"],
        "revision": row["revision"],
        "contribution_progress": str(Decimal(progress).quantize(Decimal("0.01"))),
        "opening": opening,
        "latest": latest,
    }


async def read_destinations(session, token, entity_uuid, kind):
    async with read_snapshot(session):
        _, entity = await authorize(session, token, entity_uuid, lock=False)
        table, _, _, _ = resources(kind)
        rows = (
            (
                await session.execute(
                    select(table)
                    .where(table.c.entity_id == entity["id"])
                    .order_by(table.c.id)
                )
            )
            .mappings()
            .all()
        )
        return [await snapshot(session, kind, row) for row in rows]


async def write_destination(session, entity, operation, payload, target, audit):
    action, kind = operation.split("_", 1)
    table, _, _, _ = resources(kind)
    if action == "create":
        if kind == "giving" and payload.get("opening"):
            raise RejectionError(
                "invalid_opening",
                "Giving recipients do not have opening balances.",
                422,
            )
        row = (
            (
                await session.execute(
                    insert(table)
                    .values(
                        entity_id=entity["id"],
                        name=payload["name"],
                        target=contribution_target(payload["target"]),
                    )
                    .returning(table)
                )
            )
            .mappings()
            .one()
        )
        await audit(table, row["uuid"], None, dict(row))
        if kind == "investment" and payload.get("opening"):
            observation = (
                (
                    await session.execute(
                        insert(d.observations)
                        .values(
                            entity_id=entity["id"],
                            investment_id=row["id"],
                            financial_date=date.fromisoformat(
                                payload["opening"]["date"]
                            ),
                            amount=payload["opening"]["amount"],
                            is_opening=True,
                        )
                        .returning(d.observations)
                    )
                )
                .mappings()
                .one()
            )
            await audit(d.observations, observation["uuid"], None, dict(observation))
        return await snapshot(session, kind, row)
    row = await scoped(session, table, entity["id"], target)
    check_revision(row, payload["expected_revision"])
    updated = (
        (
            await session.execute(
                update(table)
                .where(table.c.id == row["id"])
                .values(
                    name=payload["name"],
                    target=contribution_target(payload["target"]),
                    active=payload["active"],
                    revision=row["revision"] + 1,
                )
                .returning(table)
            )
        )
        .mappings()
        .one()
    )
    await audit(table, row["uuid"], dict(row), dict(updated))
    return await snapshot(session, kind, updated)


async def entry_snapshot(session, kind, entry):
    _, assignment, foreign_key, _ = resources(kind)
    destination_id = await session.scalar(
        select(assignment.c[foreign_key]).where(
            assignment.c.actual_entry_id == entry["id"]
        )
    )
    table, _, _, _ = resources(kind)
    destination_uuid = (
        await session.scalar(select(table.c.uuid).where(table.c.id == destination_id))
        if destination_id is not None
        else None
    )
    from accanto.models import savings as s
    from accanto.services.savings import current_link
    from accanto.services.tags import entry_tag_uuids

    link = await current_link(session, entry["id"])
    if link is None and entry["deleted_at"] is not None:
        link = (
            (
                await session.execute(
                    select(s.linked_activity)
                    .where(s.linked_activity.c.actual_entry_id == entry["id"])
                    .order_by(s.linked_activity.c.id.desc())
                    .limit(1)
                )
            )
            .mappings()
            .first()
        )
    goal_uuid = (
        await session.scalar(
            select(s.goals.c.uuid).where(s.goals.c.id == link["goal_id"])
        )
        if link
        else None
    )
    return {
        "uuid": str(entry["uuid"]),
        "financial_date": entry["financial_date"].isoformat(),
        "category": entry["category"],
        "amount": str(entry["amount"]),
        "note": entry["note"],
        "is_adjustment": entry["is_adjustment"],
        "is_refund": entry["is_refund"],
        "revision": entry["revision"],
        assignment_field(kind): str(destination_uuid) if destination_uuid else None,
        "funding_origin": "savings" if link else "income",
        "funding_goal_id": str(goal_uuid) if goal_uuid else None,
        "tag_ids": await entry_tag_uuids(session, entry["id"]),
    }


async def read_contributions(session, token, entity_uuid, kind):
    async with read_snapshot(session):
        _, entity = await authorize(session, token, entity_uuid, lock=False)
        _, _, _, category = resources(kind)
        rows = (
            (
                await session.execute(
                    select(m.entries)
                    .where(
                        m.entries.c.entity_id == entity["id"],
                        m.entries.c.category == category,
                        m.entries.c.deleted_at.is_(None),
                    )
                    .order_by(m.entries.c.financial_date, m.entries.c.recording_order)
                )
            )
            .mappings()
            .all()
        )
        with logfire.span("destinations.entry_snapshots", entry_count=len(rows)):
            return [await entry_snapshot(session, kind, row) for row in rows]


async def write_contribution(session, entity, operation, payload, target, audit):
    action, kind, _ = operation.split("_", 2)
    table, assignment, foreign_key, category = resources(kind)
    other = "giving_recipient_id" if kind == "investment" else "investment_id"
    if payload.get(other):
        raise RejectionError(
            "invalid_contribution",
            f"A {kind} contribution names its assignment as {assignment_field(kind)}.",
            422,
        )
    if payload.get("destination_id"):  # transition: the old shared field
        payload = {**payload, assignment_field(kind): payload["destination_id"]}
    old = None
    before = None
    previous_id = None
    if action in {"edit", "delete"}:
        old = await scoped(session, m.entries, entity["id"], target)
        if old["category"] != category:
            raise RejectionError(
                "entry_category", "Use the matching contribution workflow.", 422
            )
        check_revision(old, payload["expected_revision"])
        if old["deleted_at"] is not None:
            raise RejectionError("deleted_entry", "Entry has already been deleted.")
        before = await entry_snapshot(session, kind, old)
        from accanto.models import refunds as r
        from accanto.services.refunds import validate_purchase_edit

        if await session.scalar(
            select(r.refunds.c.id).where(r.refunds.c.refund_entry_id == old["id"])
        ):
            raise RejectionError(
                "linked_refund", "Use the linked refund workflow.", 422
            )
        if category == "giving":
            await validate_purchase_edit(
                session, old, before, payload, deleting=action == "delete"
            )
        previous_id = await session.scalar(
            select(assignment.c[foreign_key]).where(
                assignment.c.actual_entry_id == old["id"]
            )
        )
    if action == "delete":
        assert old is not None
        updated = (
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
        from accanto.services.savings import attach_entry, current_link

        previous_link = await current_link(session, old["id"])
        await attach_entry(
            session, entity, updated, previous_link, None, audit, category
        )
        response = await entry_snapshot(session, kind, updated)
        await audit(m.entries, updated["uuid"], before, response)
        return response
    assigned = payload.get(assignment_field(kind))
    destination = (
        await scoped(session, table, entity["id"], assigned) if assigned else None
    )
    if destination and (old is None or destination["id"] != previous_id):
        try:
            require_new_destination(destination["active"])
        except ValueError as error:
            raise RejectionError("inactive_destination", str(error), 422) from None
    entry_date = date.fromisoformat(payload["date"])
    if kind == "investment" and destination:
        opening = await session.scalar(
            select(d.observations.c.financial_date).where(
                d.observations.c.investment_id == destination["id"],
                d.observations.c.is_opening,
            )
        )
        try:
            opening_date_allowed(opening, entry_date)
        except ValueError as error:
            raise RejectionError("before_opening", str(error), 422) from None
    amount = contribution_amount(payload["amount"], adjustment=payload["is_adjustment"])
    values = {
        "entity_id": entity["id"],
        "financial_date": entry_date,
        "category": category,
        "amount": amount,
        "note": payload["note"],
        "is_adjustment": payload["is_adjustment"],
        "revision": old["revision"] + 1 if old else 1,
    }
    statement = (
        update(m.entries).where(m.entries.c.id == old["id"])
        if old
        else insert(m.entries)
    )
    updated = (
        (await session.execute(statement.values(**values).returning(m.entries)))
        .mappings()
        .one()
    )
    from accanto.services.savings import attach_entry, current_link

    previous_link = await current_link(session, old["id"]) if old else None
    await attach_entry(
        session,
        entity,
        updated,
        previous_link,
        payload.get("funding_goal_id"),
        audit,
        category if old else None,
    )
    if destination and destination["id"] != previous_id:
        if previous_id is not None:
            await session.execute(
                delete(assignment).where(assignment.c.actual_entry_id == updated["id"])
            )
        await session.execute(
            insert(assignment).values(
                entity_id=entity["id"],
                actual_entry_id=updated["id"],
                **{foreign_key: destination["id"]},
            )
        )
    elif destination is None and previous_id is not None:
        await session.execute(
            delete(assignment).where(assignment.c.actual_entry_id == updated["id"])
        )
    from accanto.services.tags import tag_entry

    await tag_entry(session, entity, updated, payload.get("tag_ids"), audit)
    response = await entry_snapshot(session, kind, updated)
    await audit(m.entries, updated["uuid"], before, response)
    return response
