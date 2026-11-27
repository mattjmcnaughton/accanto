"""User-owned API credentials, separate from financial activity."""

import hashlib
import secrets
from datetime import UTC, datetime

from sqlalchemy import insert, select, update

from accanto.db import read_snapshot
from accanto.models.monthly import keys
from accanto.services.access import (
    AuthenticatedActor,
    RejectionError,
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


def browser_only(actor) -> AuthenticatedActor:
    """Managing credentials needs a browser session; API keys are refused."""
    if not isinstance(actor, AuthenticatedActor) or actor.credential_kind not in {
        "api_key",
        "session",
    }:
        raise RejectionError("invalid_credential", "Credential is invalid.", 401)
    if actor.credential_kind != "session":
        raise RejectionError(
            "browser_session_required",
            "Sign in to Accanto in the browser for this action.",
            403,
        )
    return actor


async def manage_key(
    session, actor: AuthenticatedActor, *, name: str | None = None, revoke=None
):
    async with session.begin():
        actor = browser_only(actor)
        # Session first, then keys in ID order.
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
        if name is not None:
            return await issue_key(session, actor.user_id, name)
        target = next((row for row in records if row["uuid"] == revoke), None)
        if not target:
            raise RejectionError("key_not_found", "API key is unavailable.", 404)
        if target["revoked_at"] is not None:
            return {"id": str(revoke), "revoked": True}
        await session.execute(
            update(keys)
            .where(keys.c.id == target["id"])
            .values(revoked_at=datetime.now(UTC))
        )
        return {"id": str(revoke), "revoked": True}


async def list_keys(session, actor):
    async with read_snapshot(session):
        current = await revalidate_actor(session, browser_only(actor), lock=False)
        rows = (
            (
                await session.execute(
                    select(
                        keys.c.uuid, keys.c.name, keys.c.created_at, keys.c.revoked_at
                    )
                    .where(keys.c.user_id == current.user_id)
                    .order_by(keys.c.id)
                )
            )
            .mappings()
            .all()
        )
        return [
            {
                "id": str(row["uuid"]),
                "name": row["name"],
                "created_at": row["created_at"],
                "revoked_at": row["revoked_at"],
            }
            for row in rows
        ]
