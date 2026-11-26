"""Read current settings and create Entities under the shared access rules."""

from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import insert, select

from accanto.db import read_snapshot
from accanto.domains.entity import entity_settings, entity_today
from accanto.models import monthly as m
from accanto.services.access import RejectionError, lock_user, revalidate_actor
from accanto.services.monthly import authorize, json_values, request_digest


async def read_settings(session, actor, entity_uuid, *, instant=None):
    async with read_snapshot(session):
        _, entity = await authorize(session, actor, entity_uuid, lock=False)
        return {
            "id": str(entity["uuid"]),
            "name": entity["name"],
            "time_zone": entity["time_zone"],
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
