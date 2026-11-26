"""Spending subcategory commands inside the shared Entity transaction (TDD 07).

Every command runs inside services.monthly.write(), under the Entity row lock, so
archiving a subcategory cannot race an entry that chooses it. Subcategories are
archived, never deleted, and entries read the current name, so a rename relabels
past entries. A linked refund names its purchase's subcategory: it is copied when
the refund is recorded and rewritten when the purchase's subcategory changes.
"""

from sqlalchemy import delete, func, insert, select, update

from accanto.domains.spending_subcategories import (
    SubcategoryRejectionError,
    check_assignment,
    subcategory_name,
)
from accanto.models import monthly as m
from accanto.models import refunds as r
from accanto.services.access import RejectionError
from accanto.services.monthly import authorize, check_revision

table = m.spending_subcategories
links = m.spending_subcategory_assignments


def rejection(error: SubcategoryRejectionError) -> RejectionError:
    return RejectionError(error.code, str(error), 422)


def view(row, entries: int) -> dict:
    return {
        "uuid": str(row["uuid"]),
        "name": row["name"],
        "active": row["active"],
        "revision": row["revision"],
        "entries": entries,
    }


async def subcategory(session, entity_id, uuid):
    row = (
        (
            await session.execute(
                select(table).where(
                    table.c.uuid == uuid, table.c.entity_id == entity_id
                )
            )
        )
        .mappings()
        .first()
    )
    if row is None:
        raise RejectionError(
            "spending_subcategory_not_found", "Subcategory is unavailable.", 404
        )
    return row


async def entry_counts(session, entity_id) -> dict[int, int]:
    """Current (not deleted) entries per subcategory; amounts live in the Review."""
    rows = await session.execute(
        select(links.c.spending_subcategory_id, func.count())
        .join(m.entries, m.entries.c.id == links.c.actual_entry_id)
        .where(links.c.entity_id == entity_id, m.entries.c.deleted_at.is_(None))
        .group_by(links.c.spending_subcategory_id)
    )
    return dict(rows.all())


async def read_spending_subcategories(session, token, entity_uuid):
    async with session.begin():
        _, entity = await authorize(session, token, entity_uuid, lock=True)
        rows = (
            (
                await session.execute(
                    select(table)
                    .where(table.c.entity_id == entity["id"])
                    .order_by(func.lower(table.c.name))
                )
            )
            .mappings()
            .all()
        )
        counts = await entry_counts(session, entity["id"])
        return [view(row, counts.get(row["id"], 0)) for row in rows]


async def replace_link(session, entity, entry_id, subcategory_id) -> bool:
    """Point an entry at a subcategory row id (None: Unassigned). Returns changed."""
    current = await session.scalar(
        select(links.c.spending_subcategory_id).where(
            links.c.actual_entry_id == entry_id
        )
    )
    if current == subcategory_id:
        return False
    await session.execute(delete(links).where(links.c.actual_entry_id == entry_id))
    if subcategory_id is not None:
        await session.execute(
            insert(links).values(
                actual_entry_id=entry_id,
                spending_subcategory_id=subcategory_id,
                entity_id=entity["id"],
            )
        )
    return True


async def assign_entry(session, entity, record, requested, audit):
    """Entry commands: set a just-written entry's subcategory, then its refunds'.

    requested is a subcategory UUID or None, which leaves the entry Unassigned,
    like an omitted fixed_cost_id.
    """
    chosen = None
    if requested is not None:
        row = await subcategory(session, entity["id"], requested)
        current = await session.scalar(
            select(links.c.spending_subcategory_id).where(
                links.c.actual_entry_id == record["id"]
            )
        )
        try:
            check_assignment(
                record["category"], active=row["active"], kept=current == row["id"]
            )
        except SubcategoryRejectionError as error:
            raise rejection(error) from None
        chosen = row["id"]
    if await replace_link(session, entity, record["id"], chosen):
        await follow_purchase(session, entity, record["id"], chosen, audit)


async def follow_purchase(session, entity, purchase_id, chosen, audit):
    """Give every current linked refund its purchase's subcategory, auditing each."""
    from accanto.services.monthly import entry_snapshot
    from accanto.services.tags import bump

    refunds = (
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
    for refund in refunds:
        before = await entry_snapshot(session, refund)
        if await replace_link(session, entity, refund["id"], chosen):
            record = await bump(session, refund["id"])
            await audit(
                m.entries,
                record["uuid"],
                before,
                await entry_snapshot(session, record),
                action="refund_spending_subcategory",
            )


async def write_spending_subcategory(
    session, entity, operation, payload, target, audit
):
    row = None
    if operation == "edit_spending_subcategory":
        row = await subcategory(session, entity["id"], target)
        check_revision(row, payload["expected_revision"])
    try:
        name = subcategory_name(payload["name"])
    except SubcategoryRejectionError as error:
        raise rejection(error) from None
    duplicate = await session.scalar(
        select(table.c.id).where(
            table.c.entity_id == entity["id"],
            func.lower(table.c.name) == name.lower(),
            table.c.id != (row["id"] if row else -1),
        )
    )
    if duplicate:
        raise RejectionError(
            "spending_subcategory_exists",
            "A subcategory with this name already exists.",
            409,
        )
    if row is None:
        record = (
            (
                await session.execute(
                    insert(table)
                    .values(entity_id=entity["id"], name=name)
                    .returning(table)
                )
            )
            .mappings()
            .one()
        )
        await audit(table, record["uuid"], None, dict(record))
        return view(record, 0)
    record = (
        (
            await session.execute(
                update(table)
                .where(table.c.id == row["id"])
                .values(
                    name=name, active=payload["active"], revision=row["revision"] + 1
                )
                .returning(table)
            )
        )
        .mappings()
        .one()
    )
    await audit(table, record["uuid"], dict(row), dict(record))
    counts = await entry_counts(session, entity["id"])
    return view(record, counts.get(record["id"], 0))
