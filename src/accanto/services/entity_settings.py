"""Read current settings, create Entities and delete them under the shared rules."""

from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import delete, insert, select, update

from accanto.db import read_snapshot
from accanto.domains.entity import entity_settings, entity_today
from accanto.models import agent as ag
from accanto.models import inbox as st
from accanto.models import jobs as j
from accanto.models import monthly as m
from accanto.services.access import RejectionError, lock_user, revalidate_actor
from accanto.services.api_keys import browser_only
from accanto.services.entity_members import owner_only
from accanto.services.inbox import provider_row, provider_view
from accanto.services.monthly import (
    audit_values,
    authorize,
    json_values,
    request_digest,
)


async def read_settings(session, actor, entity_uuid, *, instant=None):
    async with read_snapshot(session):
        _, entity = await authorize(session, actor, entity_uuid, lock=False)
        return {
            "id": str(entity["uuid"]),
            "name": entity["name"],
            "time_zone": entity["time_zone"],
            "default_return_percent": str(entity["default_return_percent"]),
            "revision": entity["revision"],
            "today": entity_today(
                instant or datetime.now(UTC), entity["time_zone"]
            ).isoformat(),
        }


async def create_entity(session, actor, request_key: str, payload: dict):
    """Create Entity: an empty Entity owned by the caller, audited, with retry outcome.

    The retry identity is per User (there is no Entity yet); the User row lock makes
    a concurrent retry with the same key find the first outcome instead of a second
    Entity.
    """
    async with session.begin():
        current = await revalidate_actor(session, actor, lock=True)
        await lock_user(session, current.user_id)
        digest = request_digest(payload)
        previous = (
            (
                await session.execute(
                    select(m.outcomes).where(
                        m.outcomes.c.user_id == current.user_id,
                        m.outcomes.c.operation == "create_entity",
                        m.outcomes.c.request_key == request_key,
                    )
                )
            )
            .mappings()
            .first()
        )
        if previous:
            if previous["request_hash"] != digest:
                raise RejectionError(
                    "key_reuse",
                    "Request identity was already used with different input.",
                )
            return previous["response"]
        try:
            values = entity_settings(payload["name"], payload["time_zone"])
        except ValueError as error:
            raise RejectionError("invalid_settings", str(error), 422) from None
        record = (
            (
                await session.execute(
                    insert(m.entities)
                    .values(owner_id=current.user_id, **values)
                    .returning(m.entities)
                )
            )
            .mappings()
            .one()
        )
        await session.execute(
            insert(m.audit).values(
                entity_id=record["id"],
                actor_id=current.user_id,
                api_key_uuid=current.credential_uuid
                if current.credential_kind == "api_key"
                else None,
                session_uuid=current.credential_uuid
                if current.credential_kind == "session"
                else None,
                interface=current.interface,
                operation_uuid=uuid4(),
                record_type=m.entities.name,
                record_uuid=record["uuid"],
                action="create_entity",
                before=None,
                after=json_values(dict(record)),
            )
        )
        response = {
            "id": str(record["uuid"]),
            "name": record["name"],
            "time_zone": record["time_zone"],
            "revision": record["revision"],
        }
        await session.execute(
            insert(m.outcomes).values(
                entity_id=record["id"],
                user_id=current.user_id,
                operation="create_entity",
                request_key=request_key,
                request_hash=digest,
                response=response,
            )
        )
        return response


async def delete_entity(session, actor, entity_uuid, confirm_name: str):
    """Delete Entity (TDD 22): its owner, from a browser, typing its exact name.

    Under the Entity row lock, so a write waiting behind it reads the deletion
    after the lock and changes nothing (`authorize`). The Entity row, its
    financial records and the append-only audit history stay stored, unreachable
    through every interface. What grants access or holds a secret or a person's
    words goes now: members, the Transaction provider token, connected sources,
    active job runs and every person's assistant conversations here. One
    `delete_entity` audit row, with a row per member removed and per credential
    or source change, records it under one operation.
    """
    async with session.begin():
        actor, entity = await authorize(
            session, browser_only(actor), entity_uuid, lock=True
        )
        owner_only(actor, entity, "deletes it")
        if confirm_name.strip() != entity["name"]:
            raise RejectionError(
                "name_mismatch", "Type the Entity's name exactly to delete it.", 422
            )
        operation = uuid4()

        async def audit(table, record_uuid, action, before, after):
            await session.execute(
                insert(m.audit).values(
                    audit_values(
                        entity["id"],
                        actor,
                        None,
                        operation,
                        table,
                        record_uuid,
                        action,
                        before,
                        after,
                    )
                )
            )

        removed = (
            (
                await session.execute(
                    delete(m.members)
                    .where(m.members.c.entity_id == entity["id"])
                    .returning(m.members)
                )
            )
            .mappings()
            .all()
        )
        for row in removed:
            await audit(m.members, row["uuid"], "remove_member", dict(row), {})
        provider = await provider_row(session, entity["id"])
        if provider is not None and provider["secret_ciphertext"] is not None:
            record = (
                (
                    await session.execute(
                        update(st.providers)
                        .where(st.providers.c.id == provider["id"])
                        .values(
                            kind=None,
                            secret_ciphertext=None,
                            revision=provider["revision"] + 1,
                        )
                        .returning(st.providers)
                    )
                )
                .mappings()
                .one()
            )
            await audit(
                st.providers,
                record["uuid"],
                "edit_transaction_provider",
                provider_view(provider),
                provider_view(record),
            )
        now = datetime.now(UTC)
        sources = (
            (
                await session.execute(
                    select(st.sources)
                    .where(
                        st.sources.c.entity_id == entity["id"],
                        st.sources.c.disconnected_at.is_(None),
                    )
                    .with_for_update()
                )
            )
            .mappings()
            .all()
        )
        for row in sources:
            record = (
                (
                    await session.execute(
                        update(st.sources)
                        .where(st.sources.c.id == row["id"])
                        .values(disconnected_at=now, revision=row["revision"] + 1)
                        .returning(st.sources)
                    )
                )
                .mappings()
                .one()
            )
            await audit(
                st.sources, row["uuid"], "disconnect_source", dict(row), dict(record)
            )
        # A step in flight finishes but cannot settle; its next check is 404.
        await session.execute(
            update(j.runs)
            .where(j.runs.c.entity_id == entity["id"], j.runs.c.state.in_(j.ACTIVE))
            .values(state="cancelled", claimed_at=None, updated_at=now, finished_at=now)
        )
        # Messages cascade. Not audited, like retention's deletion (TDD 08).
        await session.execute(
            delete(ag.conversations).where(ag.conversations.c.entity_id == entity["id"])
        )
        record = (
            (
                await session.execute(
                    update(m.entities)
                    .where(m.entities.c.id == entity["id"])
                    .values(deleted_at=now, revision=entity["revision"] + 1)
                    .returning(m.entities)
                )
            )
            .mappings()
            .one()
        )
        await audit(
            m.entities, entity["uuid"], "delete_entity", dict(entity), dict(record)
        )
        return {"deleted": True, "id": str(entity["uuid"])}
