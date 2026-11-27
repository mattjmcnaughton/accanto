"""Browser login lifecycle and current account metadata."""

import hashlib
import hmac
import secrets
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from sqlalchemy import delete, insert, select, update
from sqlalchemy.dialects.postgresql import insert as upsert

from accanto.db import read_snapshot
from accanto.domains.entity import entity_settings, entity_today, valid_time_zone
from accanto.models import monthly as m
from accanto.services.access import (
    RejectionError,
    issue_session,
    lock_user,
    revalidate_actor,
)
from accanto.services.monthly import json_values

# The Entity a User gets when they own none: on their first sign-in, or when they
# were provisioned without one and so far only see Entities shared with them.
FIRST_ENTITY_NAME = "Personal"


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def csrf_token(token, config):
    return hmac.new(
        config.browser_csrf_secret.get_secret_value().encode(),
        token.encode(),
        hashlib.sha256,
    ).hexdigest()


async def begin_login(session):
    state, binding, nonce, verifier = (secrets.token_urlsafe(32) for _ in range(4))
    async with session.begin():
        await session.execute(
            delete(m.login_transactions).where(
                m.login_transactions.c.expires_at <= datetime.now(UTC)
            )
        )
        await session.execute(
            insert(m.login_transactions).values(
                state_digest=digest(state),
                binding_digest=digest(binding),
                nonce=nonce,
                verifier=verifier,
                expires_at=datetime.now(UTC) + timedelta(minutes=10),
            )
        )
    return state, binding, nonce, verifier


async def consume_login(session, state, binding):
    async with session.begin():
        row = (
            (
                await session.execute(
                    delete(m.login_transactions)
                    .where(
                        m.login_transactions.c.state_digest == digest(state),
                        m.login_transactions.c.binding_digest == digest(binding),
                    )
                    .returning(m.login_transactions)
                )
            )
            .mappings()
            .first()
        )
    # Consumption commits even if provider or admission subsequently rejects.
    if not row or row["expires_at"] <= datetime.now(UTC):
        raise RejectionError(
            "invalid_login", "Sign-in expired or is invalid. Start again.", 401
        )
    return row


def sign_in_time_zone(value):
    """The browser's zone for a first Entity, or UTC when it sent none or a bad one."""
    try:
        return valid_time_zone(value)
    except ValueError:
        return "UTC"


async def admit_identity(session, claims, config, time_zone="UTC"):
    """Admit an allowlisted, verified email and make sure its User owns an Entity.

    The first sign-in creates the User for this exact (issuer, subject); a
    matching email never links a new subject to an existing User.
    """
    if (
        claims.get("iss") != config.oidc_issuer
        or claims.get("email_verified") is not True
        or claims.get("email") not in config.oidc_allowed_emails
    ):
        raise RejectionError(
            "identity_not_admitted", "This identity is not admitted.", 403
        )
    async with session.begin():
        # Two first sign-ins at once create one User: the loser finds the winner's.
        await session.execute(
            upsert(m.users)
            .values(issuer=config.oidc_issuer, subject=claims["sub"])
            .on_conflict_do_nothing(index_elements=["issuer", "subject"])
        )
        user = await session.scalar(
            select(m.users.c.id).where(
                m.users.c.issuer == config.oidc_issuer,
                m.users.c.subject == claims["sub"],
            )
        )
        # Kept so an Entity owner can add this User by email (TDD 19). Only an
        # admitted, verified email is stored, and it never links identities.
        await session.execute(
            update(m.users).where(m.users.c.id == user).values(email=claims["email"])
        )
        issued = await issue_session(session, user)
        await ensure_own_entity(session, user, issued["id"], time_zone)
        return issued


async def ensure_own_entity(session, user_id, session_uuid, time_zone):
    """Create Entity "Personal" for a User who owns none, audited like Create Entity.

    Entities shared with the User do not count. The User row lock keeps two
    concurrent sign-ins from creating two. The caller owns the transaction.
    """
    await lock_user(session, user_id)
    if await session.scalar(
        select(m.entities.c.id).where(m.entities.c.owner_id == user_id).limit(1)
    ):
        return
    record = (
        (
            await session.execute(
                insert(m.entities)
                .values(
                    owner_id=user_id,
                    **entity_settings(FIRST_ENTITY_NAME, sign_in_time_zone(time_zone)),
                )
                .returning(m.entities)
            )
        )
        .mappings()
        .one()
    )
    await session.execute(
        insert(m.audit).values(
            entity_id=record["id"],
            actor_id=user_id,
            session_uuid=session_uuid,
            interface="browser",
            operation_uuid=uuid4(),
            record_type=m.entities.name,
            record_uuid=record["uuid"],
            action="create_entity",
            before=None,
            after=json_values(dict(record)),
        )
    )


async def account_metadata(session, actor):
    async with read_snapshot(session):
        current = await revalidate_actor(session, actor, lock=False)
        user = await session.scalar(
            select(m.users.c.uuid).where(m.users.c.id == current.user_id)
        )
        entities = (
            (
                await session.execute(
                    select(m.entities)
                    .where(
                        (m.entities.c.owner_id == current.user_id)
                        | m.entities.c.id.in_(
                            select(m.members.c.entity_id).where(
                                m.members.c.user_id == current.user_id
                            )
                        )
                    )
                    .order_by(m.entities.c.id)
                )
            )
            .mappings()
            .all()
        )
        now = datetime.now(UTC)
        return {
            "user": {"id": str(user)},
            "entities": [
                {
                    "id": str(entity["uuid"]),
                    "name": entity["name"],
                    "time_zone": entity["time_zone"],
                    "today": entity_today(now, entity["time_zone"]).isoformat(),
                    "role": "owner"
                    if entity["owner_id"] == current.user_id
                    else "member",
                }
                for entity in entities
            ],
        }
