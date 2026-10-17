"""Credential resolution and transactional revalidation shared by adapters."""

import hashlib
import secrets
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Literal
from uuid import UUID

from sqlalchemy import insert, select, update

from accanto.models import monthly as m


class RejectionError(Exception):
    def __init__(self, code: str, message: str, status: int = 409):
        self.code, self.message, self.status = code, message, status
        super().__init__(message)


@dataclass(frozen=True)
class AuthenticatedActor:
    user_id: int
    credential_kind: Literal["api_key", "session"]
    credential_uuid: UUID
    credential_digest: str = field(repr=False)

    @property
    def interface(self):
        return "browser" if self.credential_kind == "session" else "direct_api"


def invalid_credential():
    return RejectionError(
        "invalid_credential", "Credential is invalid or expired.", 401
    )


async def _resolve(session, digest, kind, *, lock):
    if kind not in {"api_key", "session"}:
        raise invalid_credential()
    table = m.keys if kind == "api_key" else m.sessions
    query = select(table).where(table.c.digest == digest)
    if lock:
        query = query.with_for_update()
    record = (await session.execute(query)).mappings().first()
    # Evaluate expiry after waiting for the lock, not before a concurrent logout.
    if not record or record["revoked_at"] is not None:
        raise invalid_credential()
    if kind == "session" and record["expires_at"] <= datetime.now(UTC):
        raise invalid_credential()
    return AuthenticatedActor(record["user_id"], kind, record["uuid"], digest)


async def resolve_actor(session, token: str, kind="api_key", *, lock=False):
    """Resolve an opaque secret; callers retain transaction ownership."""
    return await _resolve(
        session, hashlib.sha256(token.encode()).hexdigest(), kind, lock=lock
    )


async def revalidate_actor(session, actor: str | AuthenticatedActor, *, lock):
    # Raw API keys remain supported for existing direct-API service callers.
    if isinstance(actor, str):
        return await resolve_actor(session, actor, lock=lock)
    current = await _resolve(
        session, actor.credential_digest, actor.credential_kind, lock=lock
    )
    if current != actor:
        raise invalid_credential()
    return current


async def issue_session(session, user_id: int):
    """Issue only after verified identity admission; caller owns the transaction."""
    token = secrets.token_urlsafe(32)
    expires_at = datetime.now(UTC) + timedelta(hours=12)
    reference = await session.scalar(
        insert(m.sessions)
        .values(
            user_id=user_id,
            digest=hashlib.sha256(token.encode()).hexdigest(),
            expires_at=expires_at,
        )
        .returning(m.sessions.c.uuid)
    )
    return {"id": str(reference), "token": token, "expires_at": expires_at}


async def revoke_session(session, actor: AuthenticatedActor):
    async with session.begin():
        current = await revalidate_actor(session, actor, lock=True)
        if current.credential_kind != "session":
            raise invalid_credential()
        await session.execute(
            update(m.sessions)
            .where(m.sessions.c.uuid == current.credential_uuid)
            .values(revoked_at=datetime.now(UTC))
        )
