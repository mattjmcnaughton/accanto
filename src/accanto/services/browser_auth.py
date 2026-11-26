"""Browser login lifecycle and current account metadata."""

import hashlib
import hmac
import secrets
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, insert, select

from accanto.db import read_snapshot
from accanto.domains.entity import entity_today
from accanto.models import monthly as m
from accanto.services.access import RejectionError, issue_session, revalidate_actor


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


async def admit_identity(session, claims, config):
    if (
        claims.get("iss") != config.oidc_issuer
        or claims.get("email_verified") is not True
        or claims.get("email") not in config.oidc_allowed_emails
    ):
        raise RejectionError(
            "identity_not_admitted", "This identity is not admitted.", 403
        )
    async with session.begin():
        user = await session.scalar(
            select(m.users.c.id).where(
                m.users.c.issuer == config.oidc_issuer,
                m.users.c.subject == claims["sub"],
            )
        )
        if user is None:
            raise RejectionError(
                "identity_setup_required",
                "An operator must provision this identity before sign-in.",
                403,
            )
        return await issue_session(session, user)


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
                    .where(m.entities.c.owner_id == current.user_id)
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
                }
                for entity in entities
            ],
        }
