"""Tag commands inside the shared authorized Entity transaction (TDD 05).

Every command here runs inside services.monthly.write(), under the Entity row
lock, so a tag archive or delete cannot race an entry that adds the same tag.
Changing an entry's tags bumps its revision and audits it like any edit, which
marks a reviewed month for another look. Linked refunds always carry their
purchase's tags; a purchase change rewrites them in the same transaction.
"""

from datetime import UTC, datetime

from sqlalchemy import delete, func, insert, select, update

from accanto.domains.tags import (
    TagRejectionError,
    TagState,
    entry_tags,
    require_refund_tags,
    tag_name,
)
from accanto.models import monthly as m
from accanto.models import refunds as r
from accanto.services.access import RejectionError
from accanto.services.monthly import authorize, check_revision, scoped


def rejection(error: TagRejectionError) -> RejectionError:
    status = 404 if error.code == "tag_not_found" else 422
    return RejectionError(error.code, str(error), status)


def tag_view(row, entries: int) -> dict:
    return {
        "uuid": str(row["uuid"]),
        "name": row["name"],
        "active": row["active"],
        "revision": row["revision"],
        "entries": entries,
    }


async def entry_counts(session, entity_id) -> dict[int, int]:
    """Current (not deleted) entries per tag; a count, never an amount."""
    rows = await session.execute(
        select(m.entry_tags.c.tag_id, func.count())
        .join(m.entries, m.entries.c.id == m.entry_tags.c.actual_entry_id)
        .where(m.entry_tags.c.entity_id == entity_id, m.entries.c.deleted_at.is_(None))
        .group_by(m.entry_tags.c.tag_id)
    )
    return dict(rows.all())


async def read_tags(session, token, entity_uuid):
    async with session.begin():
        _, entity = await authorize(session, token, entity_uuid, lock=True)
        rows = (
            (
                await session.execute(
                    select(m.tags)
                    .where(
                        m.tags.c.entity_id == entity["id"],
                        m.tags.c.deleted_at.is_(None),
                    )
                    .order_by(func.lower(m.tags.c.name))
                )
            )
            .mappings()
            .all()
        )
        counts = await entry_counts(session, entity["id"])
        return [tag_view(row, counts.get(row["id"], 0)) for row in rows]


async def entry_tag_uuids(session, entry_id) -> list[str]:
    rows = await session.scalars(
        select(m.tags.c.uuid)
        .join(m.entry_tags, m.entry_tags.c.tag_id == m.tags.c.id)
        .where(m.entry_tags.c.actual_entry_id == entry_id)
        .order_by(m.entry_tags.c.id)
    )
    return [str(uuid) for uuid in rows.all()]


async def replace_entry_tags(session, entity, entry_id, requested) -> bool:
    """Set an entry's tags from requested tag UUIDs; None leaves them unchanged.

    Returns whether the tags changed. The caller owns the revision bump and audit.
    """
    if requested is None:
        return False
    current = await entry_tag_uuids(session, entry_id)
    rows = (
        (
            await session.execute(
                select(
                    m.tags.c.id, m.tags.c.uuid, m.tags.c.active, m.tags.c.deleted_at
                ).where(m.tags.c.entity_id == entity["id"])
            )
        )
        .mappings()
        .all()
    )
    ids = {str(row["uuid"]): row["id"] for row in rows}
    states = {
        str(row["uuid"]): TagState(row["active"], row["deleted_at"] is not None)
        for row in rows
    }
    try:
        chosen = entry_tags([str(tag) for tag in requested], current, states)
    except TagRejectionError as error:
        raise rejection(error) from None
    if chosen == current:
        return False
    await session.execute(
        delete(m.entry_tags).where(m.entry_tags.c.actual_entry_id == entry_id)
    )
    for tag in chosen:
        await session.execute(
            insert(m.entry_tags).values(
                actual_entry_id=entry_id, tag_id=ids[tag], entity_id=entity["id"]
            )
        )
    return True


async def bump(session, entry_id):
    return (
        (
            await session.execute(
                update(m.entries)
                .where(m.entries.c.id == entry_id)
                .values(revision=m.entries.c.revision + 1)
                .returning(m.entries)
            )
        )
        .mappings()
        .one()
    )


async def is_refund(session, entry_id) -> bool:
    return bool(
        await session.scalar(
            select(r.refunds.c.id).where(r.refunds.c.refund_entry_id == entry_id)
        )
    )


async def follow_purchase(session, entity, purchase_id, audit):
    """Give every current linked refund its purchase's tags, auditing each change."""
    from accanto.services.monthly import entry_snapshot

    tags = await entry_tag_uuids(session, purchase_id)
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
        if await replace_entry_tags(session, entity, refund["id"], tags):
            record = await bump(session, refund["id"])
            await audit(
                m.entries,
                record["uuid"],
                before,
                await entry_snapshot(session, record),
                action="refund_tags",
            )


async def copy_purchase_tags(session, entity, purchase_id, refund_id):
    """A new refund starts with its purchase's tags (no audit of its own)."""
    await replace_entry_tags(
        session, entity, refund_id, await entry_tag_uuids(session, purchase_id)
    )


async def tag_entry(session, entity, record, requested, audit):
    """Entry commands: apply the chosen tags to a just-written entry."""
    if await replace_entry_tags(session, entity, record["id"], requested):
        await follow_purchase(session, entity, record["id"], audit)


async def write_tag(session, entity, operation, payload, target, audit):
    if operation == "set_entry_tags":
        return await set_entry_tags(session, entity, payload, audit)
    row = None
    if operation != "create_tag":
        row = await scoped(session, m.tags, entity["id"], target)
        if row["deleted_at"] is not None:
            raise RejectionError("tag_not_found", "Tag is unavailable.", 404)
        check_revision(row, payload["expected_revision"])
    if operation == "delete_tag":
        assert row is not None
        return await delete_tag(session, entity, row, audit)
    try:
        name = tag_name(payload["name"])
    except TagRejectionError as error:
        raise rejection(error) from None
    duplicate = await session.scalar(
        select(m.tags.c.id).where(
            m.tags.c.entity_id == entity["id"],
            m.tags.c.deleted_at.is_(None),
            func.lower(m.tags.c.name) == name.lower(),
            m.tags.c.id != (row["id"] if row else -1),
        )
    )
    if duplicate:
        raise RejectionError("tag_exists", "A tag with this name already exists.", 409)
    if row is None:
        record = (
            (
                await session.execute(
                    insert(m.tags)
                    .values(entity_id=entity["id"], name=name)
                    .returning(m.tags)
                )
            )
            .mappings()
            .one()
        )
        await audit(m.tags, record["uuid"], None, dict(record))
        return tag_view(record, 0)
    record = (
        (
            await session.execute(
                update(m.tags)
                .where(m.tags.c.id == row["id"])
                .values(
                    name=name, active=payload["active"], revision=row["revision"] + 1
                )
                .returning(m.tags)
            )
        )
        .mappings()
        .one()
    )
    await audit(m.tags, record["uuid"], dict(row), dict(record))
    counts = await entry_counts(session, entity["id"])
    return tag_view(record, counts.get(record["id"], 0))


async def delete_tag(session, entity, row, audit):
    """Remove the tag from every entry (each audited), then soft-delete it."""
    from accanto.services.monthly import entry_snapshot

    entries = (
        (
            await session.execute(
                select(m.entries)
                .join(m.entry_tags, m.entry_tags.c.actual_entry_id == m.entries.c.id)
                .where(m.entry_tags.c.tag_id == row["id"])
                .order_by(m.entries.c.id)
            )
        )
        .mappings()
        .all()
    )
    for entry in entries:
        before = await entry_snapshot(session, entry)
        await session.execute(
            delete(m.entry_tags).where(
                m.entry_tags.c.actual_entry_id == entry["id"],
                m.entry_tags.c.tag_id == row["id"],
            )
        )
        record = await bump(session, entry["id"])
        await audit(
            m.entries,
            record["uuid"],
            before,
            await entry_snapshot(session, record),
            action="delete_tag",
        )
    record = (
        (
            await session.execute(
                update(m.tags)
                .where(m.tags.c.id == row["id"])
                .values(deleted_at=datetime.now(UTC), revision=row["revision"] + 1)
                .returning(m.tags)
            )
        )
        .mappings()
        .one()
    )
    await audit(m.tags, record["uuid"], dict(row), dict(record))
    return {**tag_view(record, 0), "deleted": True, "entries_changed": len(entries)}


async def set_entry_tags(session, entity, payload, audit):
    """Label-only bulk edit: changes no amount, date, category or origin.

    All entries change together or none do. An unchanged set keeps its revision.
    """
    from accanto.services.monthly import entry_snapshot

    results = []
    seen = set()
    for change in payload["entries"]:
        old = await scoped(session, m.entries, entity["id"], change["entry_id"])
        if old["id"] in seen:
            raise RejectionError("duplicate_entry", "Include each entry once.", 422)
        seen.add(old["id"])
        if old["deleted_at"] is not None:
            raise RejectionError("deleted_entry", "Entry has already been deleted.")
        check_revision(old, change["expected_revision"])
        if await is_refund(session, old["id"]):
            try:
                require_refund_tags(change["tag_ids"])
            except TagRejectionError as error:
                raise rejection(error) from None
        before = await entry_snapshot(session, old)
        record = old
        if await replace_entry_tags(session, entity, old["id"], change["tag_ids"]):
            record = await bump(session, old["id"])
            after = await entry_snapshot(session, record)
            await audit(m.entries, record["uuid"], before, after)
            await follow_purchase(session, entity, old["id"], audit)
        results.append(await entry_snapshot(session, record))
    return {"entries": results}
