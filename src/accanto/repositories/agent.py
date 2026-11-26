"""Assistant conversations: several per User and Entity (TDD 08).

Archive hides a conversation; retention hard-deletes any conversation, archived
or not, once it expires 30 days after its latest turn.
"""

from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, func, insert, select, update

from accanto.models import agent as a

TITLE_LENGTH = 80


def _owned(user_id, entity_id):
    return (
        a.conversations.c.user_id == user_id,
        a.conversations.c.entity_id == entity_id,
    )


async def purge(session, user_id, entity_id, *, now=None):
    """Deletes the User's expired conversations for this Entity."""
    await session.execute(
        delete(a.conversations).where(
            *_owned(user_id, entity_id),
            a.conversations.c.expires_at <= (now or datetime.now(UTC)),
        )
    )


async def purge_expired(session) -> int:
    """Deletes every expired conversation, for every User and Entity.

    The scheduled counterpart of purge(), which runs only when its owner reads.
    Returns the number deleted; messages go with them (ON DELETE CASCADE).
    """
    deleted = await session.scalars(
        delete(a.conversations)
        .where(a.conversations.c.expires_at <= func.now())
        .returning(a.conversations.c.id)
    )
    return len(deleted.all())


async def active(session, user_id, entity_id, *, now=None):
    """Active conversations, latest turn first, titled by their first question."""
    await purge(session, user_id, entity_id, now=now)
    m = a.messages
    first = (
        select(m.c.content)
        .where(m.c.conversation_id == a.conversations.c.id, m.c.role == "owner")
        .order_by(m.c.position)
        .limit(1)
        .scalar_subquery()
    )
    stats = (
        select(
            m.c.conversation_id,
            func.max(m.c.created_at).label("updated_at"),
            func.count().label("message_count"),
        )
        .group_by(m.c.conversation_id)
        .subquery()
    )
    query = (
        select(
            a.conversations.c.uuid,
            a.conversations.c.created_at,
            first.label("first_question"),
            stats.c.updated_at,
            stats.c.message_count,
        )
        .join(stats, stats.c.conversation_id == a.conversations.c.id)
        .where(*_owned(user_id, entity_id), a.conversations.c.archived_at.is_(None))
        .order_by(stats.c.updated_at.desc(), a.conversations.c.id.desc())
    )
    return (await session.execute(query)).mappings().all()


async def find(session, user_id, entity_id, conversation_uuid=None, *, now=None):
    """One active conversation, or the latest one when no UUID is given."""
    await purge(session, user_id, entity_id, now=now)
    query = select(a.conversations).where(
        *_owned(user_id, entity_id), a.conversations.c.archived_at.is_(None)
    )
    if conversation_uuid is None:
        query = query.order_by(
            a.conversations.c.expires_at.desc(), a.conversations.c.id.desc()
        ).limit(1)
    else:
        query = query.where(a.conversations.c.uuid == conversation_uuid)
    return (await session.execute(query)).mappings().first()


async def archive(session, conversation_id, *, now=None):
    await session.execute(
        update(a.conversations)
        .where(a.conversations.c.id == conversation_id)
        .values(archived_at=now or datetime.now(UTC))
    )


def title(first_question: str | None) -> str:
    text = " ".join((first_question or "").split())
    if not text:
        return "Image message"
    return text if len(text) <= TITLE_LENGTH else text[: TITLE_LENGTH - 1] + "…"


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


async def owner_messages_since(session, user_id, since):
    """The owner's messages across all their Entities: the daily cap is per User."""
    return await session.scalar(
        select(func.count())
        .select_from(a.messages)
        .join(a.conversations, a.conversations.c.id == a.messages.c.conversation_id)
        .where(
            a.conversations.c.user_id == user_id,
            a.messages.c.role == "owner",
            a.messages.c.created_at >= since,
        )
    )


async def insert_turn(
    session,
    user_id,
    entity_id,
    conversation_id,
    owner,
    agent,
    *,
    retention_days,
    now=None,
):
    """Both messages of a turn in the caller's transaction; extends the expiry.

    conversation_id None starts a conversation. Returns its UUID and the two
    message UUIDs.
    """
    now = now or datetime.now(UTC)
    expires = now + timedelta(days=retention_days)
    if conversation_id is None:
        conversation_id = await session.scalar(
            insert(a.conversations)
            .values(user_id=user_id, entity_id=entity_id, expires_at=expires)
            .returning(a.conversations.c.id)
        )
    else:
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
    uuid = await session.scalar(
        select(a.conversations.c.uuid).where(a.conversations.c.id == conversation_id)
    )
    return [uuid, *ids]
