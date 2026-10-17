"""User-owned API credentials, separate from financial activity."""

import hashlib
import secrets
from datetime import UTC, datetime

from sqlalchemy import insert, select, update

from accanto.models.monthly import keys
from accanto.services.monthly import RejectionError


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


async def manage_key(session, token: str, *, name: str | None = None, revoke=None):
    async with session.begin():
        # Lock keys in ID order for revocation to avoid cross-key deadlocks.
        digest = hashlib.sha256(token.encode()).hexdigest()
        identity = (
            (await session.execute(select(keys).where(keys.c.digest == digest)))
            .mappings()
            .first()
        )
        if not identity:
            raise RejectionError(
                "invalid_credential", "API key is invalid or revoked.", 401
            )
        records = (
            (
                await session.execute(
                    select(keys)
                    .where(keys.c.user_id == identity["user_id"])
                    .order_by(keys.c.id)
                    .with_for_update()
                )
            )
            .mappings()
            .all()
        )
        current = next(row for row in records if row["id"] == identity["id"])
        if current["revoked_at"]:
            raise RejectionError(
                "invalid_credential", "API key is invalid or revoked.", 401
            )
        if name is not None:
            return await issue_key(session, current["user_id"], name)
        target = next((row for row in records if row["uuid"] == revoke), None)
        if not target:
            raise RejectionError("key_not_found", "API key is unavailable.", 404)
        await session.execute(
            update(keys)
            .where(keys.c.id == target["id"])
            .values(revoked_at=datetime.now(UTC))
        )
        return {"id": str(revoke), "revoked": True}
