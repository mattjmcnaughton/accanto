"""Who shares an Entity (TDD 19): its owner and the members the owner added.

Browser session only, like credentials: no API key or agent reads or changes
who can open an Entity. Any member can list and leave; only the owner adds
members or removes others.
"""

from uuid import UUID, uuid4

from sqlalchemy import delete, func, insert, select

from accanto.db import read_snapshot
from accanto.models import monthly as m
from accanto.services.access import RejectionError
from accanto.services.api_keys import browser_only
from accanto.services.monthly import audit_values, authorize


def owner_only(actor, entity, action="manages who shares it"):
    if entity["owner_id"] != actor.user_id:
        raise RejectionError(
            "owner_required", f"Only the Entity's owner {action}.", 403
        )


async def require_owner(session, actor, entity_uuid, action):
    """Refuse a member before an owner-only command; the owner never changes."""
    async with session.begin():
        actor, entity = await authorize(session, actor, entity_uuid, lock=False)
        owner_only(actor, entity, action)


async def _listing(session, actor, entity):
    owner = await session.scalar(
        select(m.users.c.email).where(m.users.c.id == entity["owner_id"])
    )
    rows = (
        (
            await session.execute(
                select(m.members, m.users.c.email)
                .join(m.users, m.users.c.id == m.members.c.user_id)
                .where(m.members.c.entity_id == entity["id"])
                .order_by(m.members.c.id)
            )
        )
        .mappings()
        .all()
    )
    return {
        "role": "owner" if entity["owner_id"] == actor.user_id else "member",
        "members": [
            {
                "id": None,
                "email": owner,
                "name": None,
                "role": "owner",
                "you": entity["owner_id"] == actor.user_id,
                "added_at": None,
            }
        ]
        + [
            {
                "id": str(row["uuid"]),
                "email": row["email"],
                "name": row["name"],
                "role": "member",
                "you": row["user_id"] == actor.user_id,
                "added_at": row["created_at"],
            }
            for row in rows
        ],
    }


async def list_members(session, actor, entity_uuid: UUID):
    async with read_snapshot(session):
        actor, entity = await authorize(
            session, browser_only(actor), entity_uuid, lock=False
        )
        return await _listing(session, actor, entity)


async def change_members(
    session,
    actor,
    entity_uuid: UUID,
    *,
    add: tuple[str, str] | None = None,
    remove: UUID | None = None,
):
    """Add one member by their sign-in email, or remove one, under the Entity lock.

    The email finds an existing User who signed in with it; it never creates or
    links an identity. A member may remove only themselves (leave).
    """
    async with session.begin():
        actor, entity = await authorize(
            session, browser_only(actor), entity_uuid, lock=True
        )
        if add is not None:
            owner_only(actor, entity)
            email, name = add
            matches = (
                await session.scalars(
                    select(m.users.c.id)
                    .where(func.lower(m.users.c.email) == email.lower())
                    .limit(2)
                )
            ).all()
            if not matches:
                raise RejectionError(
                    "user_not_found",
                    "No one has signed in to Accanto with that email. They need "
                    "access first, then to sign in once.",
                    404,
                )
            if len(matches) > 1:
                raise RejectionError(
                    "ambiguous_email",
                    "More than one account signed in with that email. Ask the "
                    "operator to resolve it.",
                )
            user_id = matches[0]
            existing = await session.scalar(
                select(m.members.c.id).where(
                    m.members.c.entity_id == entity["id"],
                    m.members.c.user_id == user_id,
                )
            )
            if user_id == entity["owner_id"] or existing is not None:
                raise RejectionError(
                    "already_member", "That person already shares this Entity."
                )
            row = (
                (
                    await session.execute(
                        insert(m.members)
                        .values(entity_id=entity["id"], user_id=user_id, name=name)
                        .returning(m.members)
                    )
                )
                .mappings()
                .one()
            )
            before, after, action = None, dict(row), "add_member"
        else:
            leaving = entity["owner_id"] != actor.user_id
            row = (
                (
                    await session.execute(
                        delete(m.members)
                        .where(
                            m.members.c.entity_id == entity["id"],
                            m.members.c.uuid == remove,
                            *(
                                [m.members.c.user_id == actor.user_id]
                                if leaving
                                else []
                            ),
                        )
                        .returning(m.members)
                    )
                )
                .mappings()
                .first()
            )
            if row is None and leaving:
                owner_only(actor, entity)
            if row is None:
                raise RejectionError(
                    "member_not_found", "That member is unavailable.", 404
                )
            before, after, action = dict(row), {}, "remove_member"
        await session.execute(
            insert(m.audit).values(
                audit_values(
                    entity["id"],
                    actor,
                    None,
                    uuid4(),
                    m.members,
                    row["uuid"],
                    action,
                    before,
                    after,
                )
            )
        )
        if remove is not None and entity["owner_id"] != actor.user_id:
            return {"left": True}
        return await _listing(session, actor, entity)
