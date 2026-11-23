"""Sidebar conversations: one per User and Entity, hard-deleted on clear/expiry."""

from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, func, insert, select, update

from accanto.models import agent as a


async def conversation(session, user_id, entity_id, *, now=None):
    """The live conversation row, deleting it first if it has expired."""
    now = now or datetime.now(UTC)
    row = (
        (
            await session.execute(
                select(a.conversations).where(
                    a.conversations.c.user_id == user_id,
                    a.conversations.c.entity_id == entity_id,
                )
            )
        )
        .mappings()
        .first()
    )
    if row is not None and row["expires_at"] <= now:
        await clear(session, user_id, entity_id)
        return None
    return row


async def clear(session, user_id, entity_id):
    await session.execute(
        delete(a.conversations).where(
            a.conversations.c.user_id == user_id,
            a.conversations.c.entity_id == entity_id,
        )
    )


async def messages(session, conversation_id, limit=None):
    query = (
        select(a.messages)
        .where(a.messages.c.conversation_id == conversation_id)
        .order_by(a.messages.c.position.desc())
    )
    if limit:
        query = query.limit(limit)
    rows = (await session.execute(query)).mappings().all()
    return list(reversed(rows))


async def owner_messages_since(session, entity_id, since):
    return await session.scalar(
        select(func.count())
        .select_from(a.messages)
        .join(a.conversations, a.conversations.c.id == a.messages.c.conversation_id)
        .where(
            a.conversations.c.entity_id == entity_id,
            a.messages.c.role == "owner",
            a.messages.c.created_at >= since,
        )
    )


async def insert_turn(
    session, user_id, entity_id, owner, agent, *, retention_days, now=None
):
    """Both messages of a turn in the caller's transaction; extends the expiry."""
    now = now or datetime.now(UTC)
    expires = now + timedelta(days=retention_days)
    row = await conversation(session, user_id, entity_id, now=now)
    if row is None:
        conversation_id = await session.scalar(
            insert(a.conversations)
            .values(user_id=user_id, entity_id=entity_id, expires_at=expires)
            .returning(a.conversations.c.id)
        )
    else:
        conversation_id = row["id"]
        await session.execute(
            update(a.conversations)
            .where(a.conversations.c.id == conversation_id)
            .values(expires_at=expires)
        )
    position = await session.scalar(
        select(func.coalesce(func.max(a.messages.c.position), 0)).where(
            a.messages.c.conversation_id == conversation_id
        )
    )
    ids = []
    for offset, values in enumerate((owner, agent), start=1):
        ids.append(
            await session.scalar(
                insert(a.messages)
                .values(
                    conversation_id=conversation_id,
                    position=position + offset,
                    **values,
                )
                .returning(a.messages.c.uuid)
            )
        )
    return ids
