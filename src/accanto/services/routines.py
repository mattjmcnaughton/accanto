"""Routine commands and reads (TDD 13).

Routines are not financial records: nothing here reads or writes a financial
table, and only a person's command ticks a step. Commands run inside
services.monthly.write() for the Entity lock, retries, revisions and audit.
"""

from datetime import UTC, date, datetime
from uuid import UUID, uuid4

from sqlalchemy import delete, func, insert, select, update

from accanto.db import read_snapshot
from accanto.domains import routines as rules
from accanto.domains.entity import entity_today
from accanto.models import routines as m
from accanto.services.access import RejectionError
from accanto.services.monthly import authorize, check_revision, json_values

DAYS = rules.WEEKDAYS


def occurrence_target(routine_id, scheduled_on, step_id=None) -> str:
    """The write() target, and so the retry scope, of an occurrence command."""
    parts = [str(routine_id), str(scheduled_on)] + ([str(step_id)] if step_id else [])
    return "/".join(parts)


def today_of(entity) -> date:
    return entity_today(datetime.now(UTC), entity["time_zone"])


def cadence_of(payload: dict) -> rules.Cadence:
    try:
        return rules.Cadence(
            frequency=payload["frequency"],
            interval=payload["interval"],
            weekdays=tuple(
                sorted({DAYS.index(d) for d in payload.get("weekdays") or []})
            ),
            month_day=payload.get("month_day"),
            week=payload.get("week"),
            weekday=DAYS.index(payload["weekday"]) if payload.get("weekday") else None,
            month=payload.get("month"),
        )
    except ValueError as error:
        raise RejectionError("invalid_cadence", str(error), 422) from None


def stored_cadence(row) -> rules.Cadence:
    mask = row["weekdays"] or 0
    return rules.Cadence(
        row["frequency"],
        row["interval"],
        tuple(d for d in range(7) if mask >> d & 1),
        row["month_day"],
        row["week"],
        row["weekday"],
        row["month"],
    )


def cadence_json(c: rules.Cadence) -> dict:
    return {
        "frequency": c.frequency,
        "interval": c.interval,
        "weekdays": [DAYS[d] for d in c.weekdays],
        "month_day": c.month_day,
        "week": c.week,
        "weekday": DAYS[c.weekday] if c.weekday is not None else None,
        "month": c.month,
    }


async def routine_row(session, entity_id, routine_uuid):
    row = (
        (
            await session.execute(
                select(m.routines).where(
                    m.routines.c.entity_id == entity_id,
                    m.routines.c.uuid == routine_uuid,
                )
            )
        )
        .mappings()
        .first()
    )
    if row is None:
        raise RejectionError("routine_not_found", "Routine is unavailable.", 404)
    return row


def _step(row) -> dict:
    return {
        "uuid": row["uuid"],
        "title": row["title"],
        "link_screen": row["link_screen"],
        "link_month_offset": row["link_month_offset"],
        "link_url": row["link_url"],
    }


async def results(session, routine_rows, today: date) -> list[dict]:
    """Routines with their current occurrence and last 12, in three queries."""
    if not routine_rows:
        return []
    ids = [r["id"] for r in routine_rows]
    steps = (
        (
            await session.execute(
                select(m.steps)
                .where(m.steps.c.routine_id.in_(ids), m.steps.c.active)
                .order_by(m.steps.c.routine_id, m.steps.c.position)
            )
        )
        .mappings()
        .all()
    )
    schedules = {}
    for r in routine_rows:
        cadence = stored_cadence(r)
        history = rules.before(cadence, r["starts_on"], today, rules.HISTORY)
        schedules[r["id"]] = (cadence, history)
    earliest = min((h[0] for _, h in schedules.values() if h), default=None)
    stored = {}
    if earliest is not None:
        done = (
            select(func.count())
            .select_from(m.ticks.join(m.steps, m.steps.c.id == m.ticks.c.step_id))
            .where(m.ticks.c.occurrence_id == m.occurrences.c.id, m.steps.c.active)
            .scalar_subquery()
        )
        rows = await session.execute(
            select(
                m.occurrences.c.routine_id,
                m.occurrences.c.scheduled_on,
                m.occurrences.c.skipped,
                m.occurrences.c.completed_on,
                done.label("done"),
            ).where(
                m.occurrences.c.routine_id.in_(ids),
                m.occurrences.c.scheduled_on >= earliest,
            )
        )
        stored = {(o.routine_id, o.scheduled_on): o for o in rows}
    out = []
    for r in routine_rows:
        cadence, history = schedules[r["id"]]
        own = [_step(s) for s in steps if s["routine_id"] == r["id"]]

        summaries = [
            _summary(stored.get((r["id"], on)), r, cadence, on, today, len(own))
            for on in history
        ]
        out.append(
            {
                "uuid": r["uuid"],
                "name": r["name"],
                "cadence": cadence_json(cadence),
                "starts_on": r["starts_on"],
                "active": r["active"],
                "revision": r["revision"],
                "steps": own,
                "current": summaries[-1] if summaries else None,
                "next_on": rules.after(cadence, r["starts_on"], today)
                if r["active"]
                else None,
                "history": summaries,
            }
        )
    return out


def _summary(stored, routine, cadence, on, today, total) -> dict:
    return {
        "scheduled_on": on,
        "state": rules.occurrence_state(
            on,
            rules.after(cadence, routine["starts_on"], on),
            today,
            completed=bool(stored and stored.completed_on),
            skipped=bool(stored and stored.skipped),
        ),
        "done": stored.done if stored else 0,
        "total": total,
    }


async def occurrence_result(session, routine, on: date, today: date) -> dict:
    """One occurrence's checklist. Ticked steps keep the title they had then."""
    cadence = stored_cadence(routine)
    occ = await _occurrence(session, routine["id"], on)
    steps = (
        (
            await session.execute(
                select(m.steps)
                .where(m.steps.c.routine_id == routine["id"], m.steps.c.active)
                .order_by(m.steps.c.position)
            )
        )
        .mappings()
        .all()
    )
    ticks = {}
    if occ:
        rows = await session.execute(
            select(m.ticks, m.steps.c.uuid.label("step_uuid"), m.steps.c.active)
            .join(m.steps, m.steps.c.id == m.ticks.c.step_id)
            .where(m.ticks.c.occurrence_id == occ["id"])
            .order_by(m.ticks.c.id)
        )
        ticks = {t.step_id: t for t in rows}
    lines = []
    for s in steps:
        t = ticks.pop(s["id"], None)
        lines.append(
            {
                "step_id": s["uuid"],
                "title": t.title if t else s["title"],
                "link_screen": s["link_screen"],
                "link_month_offset": s["link_month_offset"],
                "link_url": s["link_url"],
                "status": t.status if t else None,
                "note": t.note if t else "",
            }
        )
    # Steps removed since they were ticked stay in this occurrence's history.
    lines += [
        {
            "step_id": t.step_uuid,
            "title": t.title,
            "link_screen": None,
            "link_month_offset": None,
            "link_url": None,
            "status": t.status,
            "note": t.note,
        }
        for t in ticks.values()
    ]
    next_on = rules.after(cadence, routine["starts_on"], on)
    return {
        "routine_id": routine["uuid"],
        "scheduled_on": on,
        "next_on": next_on,
        "state": rules.occurrence_state(
            on,
            next_on,
            today,
            completed=bool(occ and occ["completed_on"]),
            skipped=bool(occ and occ["skipped"]),
        ),
        "skipped": bool(occ and occ["skipped"]),
        "completed_on": occ["completed_on"] if occ else None,
        "note": occ["note"] if occ else "",
        "revision": occ["revision"] if occ else 0,
        "steps": lines,
    }


async def _occurrence(session, routine_id, on):
    return (
        (
            await session.execute(
                select(m.occurrences).where(
                    m.occurrences.c.routine_id == routine_id,
                    m.occurrences.c.scheduled_on == on,
                )
            )
        )
        .mappings()
        .first()
    )


def _routine_values(payload, cadence: rules.Cadence) -> dict:
    return {
        "name": payload["name"],
        "frequency": cadence.frequency,
        "interval": cadence.interval,
        "weekdays": sum(1 << d for d in cadence.weekdays) or None,
        "month_day": cadence.month_day,
        "week": cadence.week,
        "weekday": cadence.weekday,
        "month": cadence.month,
        "starts_on": date.fromisoformat(payload["starts_on"]),
        "active": payload.get("active", True),
    }


async def write_routine(session, entity, operation, payload, target, audit):
    """Create or edit a routine and its steps; caller owns lock, retry and commit."""
    today = today_of(entity)
    values = _routine_values(payload, cadence_of(payload["cadence"]))
    incoming = [s.get("step_id") for s in payload["steps"] if s.get("step_id")]
    before = None
    existing: dict[str, dict] = {}
    if operation == "create_routine":
        if payload.get("expected_revision") is not None:
            raise RejectionError(
                "unexpected_revision", "A new routine has no prior revision."
            )
        if incoming:
            raise RejectionError(
                "invalid_step", "A new routine cannot reuse a step.", 422
            )
        record = (
            (
                await session.execute(
                    insert(m.routines)
                    .values(entity_id=entity["id"], **values)
                    .returning(m.routines)
                )
            )
            .mappings()
            .one()
        )
    else:
        record = await routine_row(session, entity["id"], target)
        check_revision(record, payload["expected_revision"])
        before = (await results(session, [record], today))[0]
        existing = {
            str(s["uuid"]): s
            for s in (
                await session.execute(
                    select(m.steps).where(
                        m.steps.c.routine_id == record["id"], m.steps.c.active
                    )
                )
            )
            .mappings()
            .all()
        }
        if len(incoming) != len(set(incoming)) or any(
            step_id not in existing for step_id in incoming
        ):
            raise RejectionError(
                "invalid_step", "Step is unavailable in this routine.", 422
            )
        record = (
            (
                await session.execute(
                    update(m.routines)
                    .where(m.routines.c.id == record["id"])
                    .values(revision=record["revision"] + 1, **values)
                    .returning(m.routines)
                )
            )
            .mappings()
            .one()
        )
        # Removed steps stay, inactive, for the occurrences that ticked them.
        await session.execute(
            update(m.steps)
            .where(m.steps.c.routine_id == record["id"])
            .values(active=False)
        )
    for position, step in enumerate(payload["steps"]):
        fields = {
            "position": position,
            "title": step["title"],
            "link_screen": step.get("link_screen"),
            "link_month_offset": step.get("link_month_offset"),
            "link_url": step.get("link_url"),
            "active": True,
        }
        if step.get("step_id"):
            await session.execute(
                update(m.steps)
                .where(m.steps.c.id == existing[step["step_id"]]["id"])
                .values(**fields)
            )
        else:
            await session.execute(
                insert(m.steps).values(
                    uuid=uuid4(),
                    routine_id=record["id"],
                    entity_id=entity["id"],
                    **fields,
                )
            )
    after = (await results(session, [record], today))[0]
    await audit(m.routines, record["uuid"], before, after)
    return after


async def write_occurrence(session, entity, operation, payload, target, audit):
    """Tick, skip or clear a step, or skip or reopen an occurrence. The first
    action stores the occurrence; caller owns lock, retry and commit."""
    routine_uuid, on_text, *rest = str(target).split("/")
    on = date.fromisoformat(on_text)
    routine = await routine_row(session, entity["id"], UUID(routine_uuid))
    today = today_of(entity)
    if not rules.writable(stored_cadence(routine), routine["starts_on"], on, today):
        raise RejectionError(
            "not_scheduled",
            "Choose a scheduled date of this routine, up to its next one.",
            422,
        )
    occ = await _occurrence(session, routine["id"], on)
    before = await occurrence_result(session, routine, on, today) if occ else None
    revision = occ["revision"] if occ else 0
    if occ is None:
        occ = (
            (
                await session.execute(
                    insert(m.occurrences)
                    .values(
                        uuid=uuid4(),
                        routine_id=routine["id"],
                        entity_id=entity["id"],
                        scheduled_on=on,
                    )
                    .returning(m.occurrences)
                )
            )
            .mappings()
            .one()
        )
    changes: dict = {"revision": revision + 1}
    if operation == "set_routine_occurrence":
        if payload["expected_revision"] != revision:
            raise RejectionError(
                "stale_revision",
                "Reload the current record and reconcile your changes.",
            )
        changes |= {"skipped": payload["skipped"], "note": payload["note"]}
    else:
        if occ["skipped"]:
            raise RejectionError(
                "occurrence_skipped", "Reopen the skipped occurrence first."
            )
        step = (
            (
                await session.execute(
                    select(m.steps).where(
                        m.steps.c.routine_id == routine["id"],
                        m.steps.c.uuid == UUID(rest[0]),
                        m.steps.c.active,
                    )
                )
            )
            .mappings()
            .first()
        )
        if step is None:
            raise RejectionError("step_not_found", "Step is unavailable.", 404)
        where = (m.ticks.c.occurrence_id == occ["id"], m.ticks.c.step_id == step["id"])
        tick = (await session.execute(select(m.ticks).where(*where))).mappings().first()
        if payload["status"] is None:
            await session.execute(delete(m.ticks).where(*where))
        elif tick:
            await session.execute(
                update(m.ticks)
                .where(m.ticks.c.id == tick["id"])
                .values(
                    status=payload["status"],
                    note=tick["note"]
                    if payload.get("note") is None
                    else payload["note"],
                    at=func.now(),
                )
            )
        else:
            await session.execute(
                insert(m.ticks).values(
                    uuid=uuid4(),
                    occurrence_id=occ["id"],
                    step_id=step["id"],
                    routine_id=routine["id"],
                    title=step["title"],
                    status=payload["status"],
                    note=payload.get("note") or "",
                )
            )
        # Done once every current step is ticked or skipped; the date is kept.
        open_steps = await session.scalar(
            select(func.count())
            .select_from(m.steps)
            .where(
                m.steps.c.routine_id == routine["id"],
                m.steps.c.active,
                ~select(m.ticks.c.id)
                .where(
                    m.ticks.c.occurrence_id == occ["id"],
                    m.ticks.c.step_id == m.steps.c.id,
                )
                .exists(),
            )
        )
        done_on = occ["completed_on"] or today
        changes["completed_on"] = None if open_steps else done_on
    await session.execute(
        update(m.occurrences).where(m.occurrences.c.id == occ["id"]).values(**changes)
    )
    after = await occurrence_result(session, routine, on, today)
    await audit(m.occurrences, occ["uuid"], before, after)
    return after


async def read_routines(session, token, entity_uuid, target=None):
    """Every routine of the Entity, or one, with its current state and history."""
    async with read_snapshot(session):
        _, entity = await authorize(session, token, entity_uuid, lock=False)
        today = today_of(entity)
        if target is not None:
            row = await routine_row(session, entity["id"], target)
            return json_values((await results(session, [row], today))[0])
        rows = (
            (
                await session.execute(
                    select(m.routines)
                    .where(m.routines.c.entity_id == entity["id"])
                    .order_by(m.routines.c.id)
                )
            )
            .mappings()
            .all()
        )
        return json_values(await results(session, rows, today))


async def read_occurrence(session, token, entity_uuid, routine_uuid, on: date):
    async with read_snapshot(session):
        _, entity = await authorize(session, token, entity_uuid, lock=False)
        routine = await routine_row(session, entity["id"], routine_uuid)
        if not rules.is_scheduled(stored_cadence(routine), routine["starts_on"], on):
            raise RejectionError(
                "occurrence_not_found", "This routine is not scheduled that day.", 404
            )
        return json_values(
            await occurrence_result(session, routine, on, today_of(entity))
        )
