"""User-owned API credentials, separate from financial activity."""

import hashlib
import secrets
from datetime import UTC, datetime

from sqlalchemy import insert, select, update

from accanto.models.monthly import keys
from accanto.services.access import (
    AuthenticatedActor,
    RejectionError,
    resolve_actor,
    revalidate_actor,
)


async def issue_key(session, user_id: int, name: str):
    token = secrets.token_urlsafe(32)
    record = (
        await session.execute(
            insert(keys)
            .values(
                user_id=user_id,
                name=name,
                digest=hashlib.sha256(token.encode()).hexdigest(),
            )
            .returning(keys.c.uuid)
        )
    ).scalar_one()
    return {"id": str(record), "key": token, "name": name}


async def manage_key(
    session, token: str | AuthenticatedActor, *, name: str | None = None, revoke=None
):
    async with session.begin():
        # Session first, then keys in ID order; key callers never lock out of order.
        actor = (
            token
            if isinstance(token, AuthenticatedActor)
            else await resolve_actor(session, token)
        )
        if actor.credential_kind not in {"api_key", "session"}:
            raise RejectionError("invalid_credential", "Credential is invalid.", 401)
        if actor.credential_kind == "session":
            await revalidate_actor(session, actor, lock=True)
        records = (
            (
                await session.execute(
                    select(keys)
                    .where(keys.c.user_id == actor.user_id)
                    .order_by(keys.c.id)
                    .with_for_update()
                )
            )
            .mappings()
            .all()
        )
        if actor.credential_kind == "api_key":
            await revalidate_actor(session, actor, lock=False)
        if name is not None:
            return await issue_key(session, actor.user_id, name)
        target = next((row for row in records if row["uuid"] == revoke), None)
        if not target:
            raise RejectionError("key_not_found", "API key is unavailable.", 404)
        await session.execute(
            update(keys)
            .where(keys.c.id == target["id"])
            .values(revoked_at=datetime.now(UTC))
        )
        return {"id": str(revoke), "revoked": True}
