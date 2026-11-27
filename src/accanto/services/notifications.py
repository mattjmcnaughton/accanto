"""Notifications (TDD 20): Devices, preferences and the hourly sends.

A User's preferences apply to every Entity they own or are a member of, and
every Device they registered. The hourly tick sends each enabled kind at most
once per User, Entity and local date, at or after the chosen hour in the Entity
time zone. A send is claimed in notification_send before delivery, so an
overlapping or retried tick sends nothing twice. Logs carry counts and outcomes
only; a Device's endpoint is a capability and never leaves this module.
"""

from dataclasses import replace
from datetime import UTC, datetime
from uuid import UUID
from zoneinfo import ZoneInfo

import structlog
from sqlalchemy import delete, func, select, update
from sqlalchemy.dialects.postgresql import insert

from accanto.config import settings
from accanto.domains import notifications as rules
from accanto.domains import routines as routine_rules
from accanto.domains.entity import entity_today
from accanto.models import inbox as st
from accanto.models import monthly as m
from accanto.models import notifications as n
from accanto.models import routines as r
from accanto.models import schedules as sc
from accanto.services.access import RejectionError, revalidate_actor
from accanto.services.api_keys import browser_only
from accanto.services.push import (
    PushResult,
    PushSender,
    configured_key,
    sender_for,
    subscription_keys,
)
from accanto.services.routines import stored_cadence

log = structlog.get_logger(__name__)
PREFERENCES = ("hour", *rules.KINDS)


def push_config(config=settings) -> dict:
    key = configured_key(config)
    if key is None:
        raise RejectionError("push_not_configured", "Notifications are off.", 404)
    return {"public_key": key}


async def _preferences(session, user_id: int) -> dict:
    row = (
        (
            await session.execute(
                select(n.preferences).where(n.preferences.c.user_id == user_id)
            )
        )
        .mappings()
        .first()
    )
    return {k: row[k] for k in PREFERENCES} if row else dict(rules.DEFAULTS)


async def read_preferences(session, token) -> dict:
    async with session.begin():
        actor = await revalidate_actor(session, token, lock=False)
        return await _preferences(session, actor.user_id)


async def write_preferences(session, token, values: dict) -> dict:
    async with session.begin():
        actor = await revalidate_actor(session, token, lock=True)
        await session.execute(
            insert(n.preferences)
            .values(user_id=actor.user_id, **values)
            .on_conflict_do_update(index_elements=["user_id"], set_=values)
        )
        return await _preferences(session, actor.user_id)


async def register_device(session, token, endpoint: str, p256dh: str, auth: str):
    """Upsert on the endpoint: a Device belongs to whoever registered it last."""
    if not rules.is_allowed_endpoint(endpoint):
        raise RejectionError(
            "push_endpoint_not_allowed", "This push service is not supported.", 422
        )
    try:
        subscription_keys(p256dh, auth)
    except ValueError:
        raise RejectionError(
            "push_keys_invalid", "The subscription keys are invalid.", 422
        ) from None
    async with session.begin():
        actor = browser_only(await revalidate_actor(session, token, lock=True))
        values = {"user_id": actor.user_id, "p256dh": p256dh, "auth": auth}
        device = await session.scalar(
            insert(n.devices)
            .values(endpoint=endpoint, **values)
            .on_conflict_do_update(
                index_elements=["endpoint"],
                set_={**values, "registered_at": func.now()},
            )
            .returning(n.devices.c.uuid)
        )
    return {"id": str(device)}


async def remove_device(session, token, device_id: UUID) -> None:
    async with session.begin():
        actor = browser_only(await revalidate_actor(session, token, lock=True))
        removed = await session.scalar(
            delete(n.devices)
            .where(n.devices.c.uuid == device_id, n.devices.c.user_id == actor.user_id)
            .returning(n.devices.c.id)
        )
    if removed is None:
        raise RejectionError("device_not_found", "Device is unavailable.", 404)


async def _deliver(session, sender: PushSender, devices, notice) -> str:
    """Send to each Device and forget the ones the push service reports gone.

    The session holds no transaction while waiting on the network.
    """
    results = [await sender.send(device, notice) for device in devices]
    gone = [d["id"] for d, res in zip(devices, results, strict=True) if res == "gone"]
    if gone:
        async with session.begin():
            await session.execute(delete(n.devices).where(n.devices.c.id.in_(gone)))
    for outcome in (PushResult.DELIVERED, PushResult.ERROR, PushResult.GONE):
        if outcome in results:
            return outcome.value
    return PushResult.DISABLED.value


async def _devices(session, user_id: int):
    return (
        (await session.execute(select(n.devices).where(n.devices.c.user_id == user_id)))
        .mappings()
        .all()
    )


async def send_test(session, token, device_id: UUID, sender=None):
    """'Send a test' to this browser's Device: proof the phone setup works."""
    async with session.begin():
        actor = browser_only(await revalidate_actor(session, token, lock=False))
        devices = [
            d for d in await _devices(session, actor.user_id) if d["uuid"] == device_id
        ]
    if not devices:
        raise RejectionError("device_not_found", "Device is unavailable.", 404)
    outcome = await _deliver(
        session, sender or sender_for(settings), devices, rules.confirmation()
    )
    log.info("notification_test", outcome=outcome)
    return {"outcome": outcome}


async def routines_due(session, entity_id: int, today) -> list[str]:
    """Names of active Routines with an unfinished occurrence due today."""
    rows = (
        (
            await session.execute(
                select(r.routines)
                .where(r.routines.c.entity_id == entity_id, r.routines.c.active)
                .order_by(r.routines.c.name, r.routines.c.id)
            )
        )
        .mappings()
        .all()
    )
    due = [
        row
        for row in rows
        if row["starts_on"] <= today
        and routine_rules.is_scheduled(stored_cadence(row), row["starts_on"], today)
    ]
    if not due:
        return []
    finished = set(
        await session.scalars(
            select(r.occurrences.c.routine_id).where(
                r.occurrences.c.routine_id.in_([row["id"] for row in due]),
                r.occurrences.c.scheduled_on == today,
                r.occurrences.c.skipped | r.occurrences.c.completed_on.is_not(None),
            )
        )
    )
    return [row["name"] for row in due if row["id"] not in finished]


async def scheduled_waiting(session, entity_id: int, today) -> int:
    """Entry schedule items staged for today's date and still waiting."""
    return await session.scalar(
        select(func.count())
        .select_from(
            st.staged.join(
                sc.occurrences,
                sc.occurrences.c.id == st.staged.c.schedule_occurrence_id,
            )
        )
        .where(
            st.staged.c.entity_id == entity_id,
            st.staged.c.status == "waiting",
            sc.occurrences.c.scheduled_on == today,
        )
    )


async def transactions_waiting(session, entity_id: int) -> int:
    """Transaction source items not yet recorded or ignored."""
    return await session.scalar(
        select(func.count()).where(
            st.staged.c.entity_id == entity_id,
            st.staged.c.source_id.is_not(None),
            st.staged.c.status.in_(("waiting", "conflict")),
        )
    )


async def notice_for(session, kind: str, entity, today):
    on, ref = today.isoformat(), str(entity["uuid"])
    if kind == "routines_due":
        names = await routines_due(session, entity["id"], today)
        return rules.routines_due(names, on, ref) if names else None
    if kind == "scheduled_entries":
        count = await scheduled_waiting(session, entity["id"], today)
        return rules.scheduled_entries(count, on, ref) if count else None
    count = await transactions_waiting(session, entity["id"])
    return rules.transactions_waiting(count, on, ref) if count else None


def with_entity(notice, entity, several: bool):
    """A User with several Entities opens the one the Notification is about."""
    if not several:
        return notice
    return replace(notice, path=f"{notice.path}?e={entity['uuid']}")


async def send_due(session_factory, now: datetime | None = None, sender=None):
    """The tick step: each enabled kind with something to say, once a local day."""
    now = now or datetime.now(UTC)
    sender = sender or sender_for(settings)
    counts = {"notified": 0, "delivered": 0, "not_delivered": 0}
    async with session_factory() as session:
        users = list(await session.scalars(select(n.devices.c.user_id).distinct()))
    for user_id in users:
        async with session_factory() as session:
            prefs = await _preferences(session, user_id)
            entities = (
                (
                    await session.execute(
                        select(m.entities)
                        .where(
                            (m.entities.c.owner_id == user_id)
                            | m.entities.c.id.in_(
                                select(m.members.c.entity_id).where(
                                    m.members.c.user_id == user_id
                                )
                            )
                        )
                        .order_by(m.entities.c.id)
                    )
                )
                .mappings()
                .all()
            )
        for entity in entities:
            local = now.astimezone(ZoneInfo(entity["time_zone"]))
            if not rules.is_send_time(local, prefs["hour"]):
                continue
            today = entity_today(now, entity["time_zone"])
            for kind in rules.KINDS:
                if not prefs[kind]:
                    continue
                async with session_factory() as session, session.begin():
                    notice = await notice_for(session, kind, entity, today)
                    if notice is None:
                        continue
                    claimed = await session.scalar(
                        insert(n.sends)
                        .values(
                            user_id=user_id,
                            entity_id=entity["id"],
                            kind=kind,
                            local_date=today,
                        )
                        .on_conflict_do_nothing()
                        .returning(n.sends.c.kind)
                    )
                    devices = await _devices(session, user_id) if claimed else []
                if not claimed:
                    continue
                notice = with_entity(notice, entity, len(entities) > 1)
                async with session_factory() as session:
                    outcome = await _deliver(session, sender, devices, notice)
                async with session_factory() as session, session.begin():
                    await session.execute(
                        update(n.sends)
                        .where(
                            n.sends.c.user_id == user_id,
                            n.sends.c.entity_id == entity["id"],
                            n.sends.c.kind == kind,
                            n.sends.c.local_date == today,
                        )
                        .values(outcome=outcome)
                    )
                counts["notified"] += 1
                counts["delivered" if outcome == "delivered" else "not_delivered"] += 1
    # A refused push is reported, not a tick failure: the next day tries again.
    return counts
