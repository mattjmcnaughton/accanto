"""Credential resolution and transactional revalidation shared by adapters."""

import hashlib
import secrets
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field, replace
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
    # "schedule": the Entity owner acting through an Entry schedule (TDD 18).
    credential_kind: Literal["api_key", "session", "oauth", "schedule"]
    credential_uuid: UUID | None
    credential_digest: str = field(repr=False)
    verify_identity: Callable[[], Awaitable[tuple[str, str]]] | None = field(
        default=None, repr=False, compare=False
    )
    # Agent adapters (TDD 03): "mcp" for MCP over an API key, "agent" for the
    # built-in agent and applied Pending changes. Not part of credential identity.
    interface_override: str | None = field(default=None, compare=False)

    @property
    def interface(self):
        return (
            self.interface_override
            or {
                "session": "browser",
                "api_key": "direct_api",
                "oauth": "mcp",
                "schedule": "schedule",
            }[self.credential_kind]
        )

    def acting_as(self, interface: str) -> "AuthenticatedActor":
        return replace(self, interface_override=interface)


def schedule_actor(user_id: int) -> AuthenticatedActor:
    """The owner acting through one of their Entry schedules (TDD 18).

    Only the hourly tick builds it, for the Entity owner it read under the
    Entity lock; no request can present it, and it reaches no other Entity.
    """
    return AuthenticatedActor(user_id, "schedule", None, "")


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


async def resolve_stored_credential(session, kind: str, credential_uuid: UUID):
    """The actor for a credential a job run stored by UUID, if it is still valid.

    A background step re-checks the session or API key that started its run
    (TDD 12), so signing out or revoking the key stops the run at its next step.
    """
    if kind not in {"api_key", "session"}:
        raise invalid_credential()
    table = m.keys if kind == "api_key" else m.sessions
    digest = await session.scalar(
        select(table.c.digest).where(table.c.uuid == credential_uuid)
    )
    if digest is None:
        raise invalid_credential()
    return await _resolve(session, digest, kind, lock=False)


async def resolve_actor(session, token: str, kind="api_key", *, lock=False):
    """Resolve an opaque secret; callers retain transaction ownership."""
    return await _resolve(
        session, hashlib.sha256(token.encode()).hexdigest(), kind, lock=lock
    )


async def revalidate_actor(session, actor: str | AuthenticatedActor, *, lock):
    # Raw API keys remain supported for existing direct-API service callers.
    if isinstance(actor, str):
        return await resolve_actor(session, actor, lock=lock)
    if actor.credential_kind == "schedule":
        return actor
    if actor.credential_kind == "oauth":
        if actor.verify_identity is None:
            raise invalid_credential()
        current = await resolve_oauth_actor(session, actor.verify_identity)
        if current.user_id != actor.user_id:
            raise invalid_credential()
        return current
    current = await _resolve(
        session, actor.credential_digest, actor.credential_kind, lock=lock
    )
    if current != actor:
        raise invalid_credential()
    return replace(current, interface_override=actor.interface_override)


async def lock_user(session, user_id: int) -> None:
    """Serialize one User's cross-Entity commands (Create Entity, connect a source).

    FOR NO KEY UPDATE leaves the foreign-key share locks that other writes take on
    the User row unblocked. Lock order: credential, then any Entity, then the User.
    The caller owns the transaction.
    """
    await session.execute(
        select(m.users.c.id)
        .where(m.users.c.id == user_id)
        .with_for_update(key_share=True)
    )


async def resolve_oauth_actor(session, verify_identity):
    """Revalidate the external token and resolve only a provisioned exact identity.

    Caller owns the transaction. Never create a User or infer identity from email.
    This callback is intentionally narrow and independent of MCP/HTTP libraries.
    """
    issuer, subject = await verify_identity()
    user_id = await session.scalar(
        select(m.users.c.id).where(
            m.users.c.issuer == issuer, m.users.c.subject == subject
        )
    )
    if user_id is None:
        raise RejectionError(
            "identity_setup_required", "An operator must provision this identity.", 403
        )
    return AuthenticatedActor(user_id, "oauth", None, "", verify_identity)


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
