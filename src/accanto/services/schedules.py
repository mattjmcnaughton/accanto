"""Entry schedule commands, reads and the hourly staging step (TDD 18).

A schedule is not financial activity. On each scheduled date the tick stages
its entries in the Transactions inbox as waiting items, each with the planned
completion as its proposal, inside one write() under the Entity lock, as the
owner with interface "schedule". Accepting an item in the inbox is what records
it. The occurrence row (unique per schedule and date) and the unique line per
occurrence make each date staged once.
"""

import contextlib
import dataclasses
from datetime import UTC, date, datetime, timedelta
from uuid import UUID, uuid4

import structlog
from sqlalchemy import delete, func, insert, or_, select, update

from accanto.db import read_snapshot
from accanto.domains import routines
from accanto.domains import schedules as rules
from accanto.domains.entity import entity_today
from accanto.models import destinations as d
from accanto.models import inbox as st
from accanto.models import monthly as m
from accanto.models import savings as s
from accanto.models import schedules as sc
from accanto.services import routines as routine_service
from accanto.services.access import RejectionError, schedule_actor
from accanto.services.monthly import (
    audit_values,
    authorize,
    check_revision,
    json_values,
    scoped,
    write,
)

log = structlog.get_logger(__name__)
INTERFACE = "schedule"
RECENT = 6


def rejection(error: rules.ScheduleRejectionError) -> RejectionError:
    return RejectionError(error.code, str(error), 422)


def clock() -> datetime:
    """Now, in UTC; tests replace it to let days pass."""
    return datetime.now(UTC)


def today_of(entity) -> date:
    return entity_today(clock(), entity["time_zone"])


def cadence_of(payload: dict) -> routines.Cadence:
    base = routine_service.cadence_of(payload)
    try:
        return dataclasses.replace(base, weekend=payload.get("weekend"))
    except ValueError as error:
        raise RejectionError("invalid_cadence", str(error), 422) from None


def stored_cadence(row) -> routines.Cadence:
    return dataclasses.replace(
        routine_service.stored_cadence(row), weekend=row["weekend"]
    )


def cadence_json(c: routines.Cadence) -> dict:
    return {**routine_service.cadence_json(c), "weekend": c.weekend}


def lines_of(row) -> list[rules.Line]:
    return [rules.Line.of(line) for line in row["lines"]]


def occurrence_target(schedule_id, on) -> str:
    """The write() target, and so the retry scope, of a skip command."""
    return f"{schedule_id}/{on}"


async def schedule_row(session, entity_id, schedule_uuid):
    row = (
        (
            await session.execute(
                select(sc.schedules).where(
                    sc.schedules.c.entity_id == entity_id,
                    sc.schedules.c.uuid == schedule_uuid,
                )
            )
        )
        .mappings()
        .first()
    )
    if row is None:
        raise RejectionError("schedule_not_found", "Schedule is unavailable.", 404)
    return row


# Reads ----------------------------------------------------------------------


async def line_names(session, entity_id, rows) -> dict[str, str]:
    """Names of every record the schedules' lines reference, one query per kind."""
    wanted: dict[str, set[str]] = {}
    for row in rows:
        for line in row["lines"]:
            assignment = line.get("assignment")
            if assignment not in (None, "unassigned"):
                wanted.setdefault(line["category"], set()).add(assignment)
            if line.get("funding") not in (None, "income"):
                wanted.setdefault("saving", set()).add(line["funding"])
    names: dict[str, str] = {}

    def uuids(category):
        result = []
        for value in wanted.get(category, ()):
            with contextlib.suppress(ValueError):
                result.append(UUID(value))
        return result

    if ids := uuids("income"):
        # An Income source is named by its latest Plan line.
        latest = (
            select(
                m.sources.c.uuid,
                m.income_lines.c.name,
                func.row_number()
                .over(
                    partition_by=m.sources.c.id,
                    order_by=m.income_lines.c.plan_revision_id.desc(),
                )
                .label("n"),
            )
            .join(m.income_lines, m.income_lines.c.income_source_id == m.sources.c.id)
            .where(m.sources.c.entity_id == entity_id, m.sources.c.uuid.in_(ids))
            .subquery()
        )
        names |= {
            str(u): n
            for u, n in await session.execute(
                select(latest.c.uuid, latest.c.name).where(latest.c.n == 1)
            )
        }
    for category, table in (
        ("fixed_cost", m.fixed_costs),
        ("spending", m.spending_subcategories),
        ("investing", d.investments),
        ("giving", d.recipients),
    ):
        if ids := uuids(category):
            names |= {
                str(u): n
                for u, n in await session.execute(
                    select(table.c.uuid, table.c.name).where(
                        table.c.entity_id == entity_id, table.c.uuid.in_(ids)
                    )
                )
            }
    if ids := uuids("saving"):
        names |= {
            str(u): f"{account} · {goal}"
            for u, goal, account in await session.execute(
                select(s.goals.c.uuid, s.goals.c.name, s.accounts.c.name)
                .join(s.accounts, s.accounts.c.id == s.goals.c.account_id)
                .where(s.goals.c.entity_id == entity_id, s.goals.c.uuid.in_(ids))
            )
        }
    return names


def occurrence_view(row, items) -> dict:
    return {
        "scheduled_on": row["scheduled_on"],
        "status": row["status"],
        "rejection": row["rejection"],
        # The date's inbox items and where each one is now.
        "items": items,
        "staged_at": row["updated_at"] if row["status"] == "staged" else None,
    }


async def results(session, entity_id, rows) -> list[dict]:
    """Schedules with names, upcoming dates and recent occurrences, in four
    queries (lines' names by kind aside) whatever the number of schedules."""
    if not rows:
        return []
    ids = [r["id"] for r in rows]
    names = await line_names(session, entity_id, rows)
    occ = sc.occurrences
    ranked = (
        select(
            occ,
            func.row_number()
            .over(partition_by=occ.c.schedule_id, order_by=occ.c.scheduled_on.desc())
            .label("n"),
        )
        .join(sc.schedules, sc.schedules.c.id == occ.c.schedule_id)
        .where(
            occ.c.schedule_id.in_(ids),
            # Past dates; skipped upcoming dates are read separately.
            or_(
                sc.schedules.c.next_on.is_(None),
                occ.c.scheduled_on < sc.schedules.c.next_on,
                occ.c.status != "skipped",
            ),
        )
        .subquery()
    )
    recent = (
        (
            await session.execute(
                select(ranked).where(ranked.c.n <= RECENT).order_by(ranked.c.id)
            )
        )
        .mappings()
        .all()
    )
    skipped = {
        (row.schedule_id, row.scheduled_on)
        for row in await session.execute(
            select(occ.c.schedule_id, occ.c.scheduled_on)
            .join(sc.schedules, sc.schedules.c.id == occ.c.schedule_id)
            .where(
                occ.c.schedule_id.in_(ids),
                occ.c.status == "skipped",
                occ.c.scheduled_on >= sc.schedules.c.next_on,
            )
        )
    }
    items: dict[int, list] = {}
    if recent:
        for occurrence_id, item_uuid, status in await session.execute(
            select(
                st.staged.c.schedule_occurrence_id, st.staged.c.uuid, st.staged.c.status
            )
            .where(st.staged.c.schedule_occurrence_id.in_([o["id"] for o in recent]))
            .order_by(func.length(st.staged.c.source_ref), st.staged.c.source_ref)
        ):
            items.setdefault(occurrence_id, []).append(
                {"id": item_uuid, "status": status}
            )
    out = []
    for row in rows:
        cadence = stored_cadence(row)
        dates = rules.upcoming(
            cadence, row["starts_on"], row["ends_on"], row["next_on"]
        )
        upcoming = [
            {"scheduled_on": on, "skipped": (row["id"], on) in skipped} for on in dates
        ]
        state = rules.state(row["paused"], row["next_on"])
        next_on = None
        if state == "active":
            day = row["next_on"]
            while day is not None and (row["id"], day) in skipped:
                day = rules.first_on_or_after(
                    cadence, row["starts_on"], row["ends_on"], day + timedelta(days=1)
                )
            next_on = day
        own = sorted(
            (o for o in recent if o["schedule_id"] == row["id"]),
            key=lambda o: o["scheduled_on"],
            reverse=True,
        )
        out.append(
            {
                "uuid": row["uuid"],
                "name": row["name"],
                "cadence": cadence_json(cadence),
                "starts_on": row["starts_on"],
                "ends_on": row["ends_on"],
                "paused": row["paused"],
                "revision": row["revision"],
                "lines": [
                    {
                        **line,
                        "tag_ids": line.get("tag_ids") or [],
                        "assignment_name": names.get(line.get("assignment") or ""),
                        "funding_name": names.get(line.get("funding") or ""),
                    }
                    for line in row["lines"]
                ],
                "state": state,
                "next_on": next_on,
                "upcoming": upcoming if state == "active" else [],
                "recent": [occurrence_view(o, items.get(o["id"], [])) for o in own],
            }
        )
    return json_values(out)


async def read_schedules(session, token, entity_uuid, target=None):
    async with read_snapshot(session):
        _, entity = await authorize(session, token, entity_uuid, lock=False)
        if target is not None:
            row = await schedule_row(session, entity["id"], target)
            return (await results(session, entity["id"], [row]))[0]
        rows = (
            (
                await session.execute(
                    select(sc.schedules)
                    .where(sc.schedules.c.entity_id == entity["id"])
                    .order_by(sc.schedules.c.id)
                )
            )
            .mappings()
            .all()
        )
        return await results(session, entity["id"], rows)


# Commands -------------------------------------------------------------------

REFERENCES = {
    "income": (m.sources, "Income source"),
    "fixed_cost": (m.fixed_costs, "fixed cost"),
    "spending": (m.spending_subcategories, "spending subcategory"),
    "saving": (s.goals, "saving goal"),
    "investing": (d.investments, "investment"),
    "giving": (d.recipients, "giving recipient"),
}


async def check_lines(session, entity_id, lines: list[rules.Line], on: date):
    """Each line is a recordable completion whose records exist in this Entity.

    Whether a destination is active or saved money suffices is checked when an
    item is accepted in the inbox, as for any entry; the tick shows that verdict
    on each staged item's proposal.
    """
    try:
        rules.commands(lines, on)
    except rules.ScheduleRejectionError as error:
        raise rejection(error) from None
    for number, line in enumerate(lines, 1):
        checks = []
        if line.assignment not in (None, "unassigned"):
            checks.append((*REFERENCES[line.category], line.assignment))
        if line.funding not in (None, "income"):
            checks.append((s.goals, "funding goal", line.funding))
        checks += [(m.tags, "tag", tag) for tag in line.tag_ids]
        for table, label, value in checks:
            try:
                await scoped(session, table, entity_id, UUID(str(value)))
            except (RejectionError, ValueError):
                raise RejectionError(
                    "invalid_line", f"Entry {number}: the {label} is unavailable.", 422
                ) from None


def _values(payload, cadence: routines.Cadence) -> dict:
    return {
        "name": payload["name"],
        "frequency": cadence.frequency,
        "interval": cadence.interval,
        "weekdays": sum(1 << day for day in cadence.weekdays) or None,
        "month_day": cadence.month_day,
        "week": cadence.week,
        "weekday": cadence.weekday,
        "month": cadence.month,
        "weekend": cadence.weekend,
        "starts_on": date.fromisoformat(str(payload["starts_on"])),
        "ends_on": date.fromisoformat(str(payload["ends_on"]))
        if payload.get("ends_on")
        else None,
        "paused": bool(payload.get("paused")),
        "lines": [
            {
                "category": line["category"],
                "amount": str(line["amount"]),
                "note": (line.get("note") or "").strip(),
                "assignment": line.get("assignment"),
                "funding": line.get("funding"),
                "tag_ids": [str(t) for t in line.get("tag_ids") or []],
            }
            for line in payload["lines"]
        ],
    }


async def write_schedule(session, entity, operation, payload, target, audit):
    """Create or edit a schedule (pause, resume and end are edits); caller owns
    the lock, retry and commit. Nothing is staged for dates before today."""
    today = today_of(entity)
    cadence = cadence_of(payload["cadence"])
    values = _values(payload, cadence)
    if values["ends_on"] and values["ends_on"] < values["starts_on"]:
        raise RejectionError("invalid_schedule", "End on or after the start date.", 422)
    await check_lines(
        session,
        entity["id"],
        [rules.Line.of(line) for line in values["lines"]],
        max(today, values["starts_on"]),
    )
    before = None
    if operation == "create_schedule":
        if payload.get("expected_revision") is not None:
            raise RejectionError(
                "unexpected_revision", "A new schedule has no prior revision."
            )
        base = today
        record = None
    else:
        record = await schedule_row(session, entity["id"], target)
        check_revision(record, payload.get("expected_revision"))
        before = (await results(session, entity["id"], [record]))[0]
        resuming = record["paused"] and not values["paused"]
        # Keep the next date not yet staged; a resume (or extending an
        # ended schedule) starts from today, never from dates already passed.
        base = today if resuming or record["next_on"] is None else record["next_on"]
    values["next_on"] = rules.first_on_or_after(
        cadence, values["starts_on"], values["ends_on"], max(base, values["starts_on"])
    )
    if record is None:
        record = (
            (
                await session.execute(
                    insert(sc.schedules)
                    .values(uuid=uuid4(), entity_id=entity["id"], **values)
                    .returning(sc.schedules)
                )
            )
            .mappings()
            .one()
        )
    else:
        record = (
            (
                await session.execute(
                    update(sc.schedules)
                    .where(sc.schedules.c.id == record["id"])
                    .values(revision=record["revision"] + 1, **values)
                    .returning(sc.schedules)
                )
            )
            .mappings()
            .one()
        )
    after = (await results(session, entity["id"], [record]))[0]
    await audit(sc.schedules, record["uuid"], before, after)
    return after


async def _occurrence(session, schedule_id, on):
    return (
        (
            await session.execute(
                select(sc.occurrences).where(
                    sc.occurrences.c.schedule_id == schedule_id,
                    sc.occurrences.c.scheduled_on == on,
                )
            )
        )
        .mappings()
        .first()
    )


async def write_skip(session, entity, operation, payload, target, audit):
    """Skip one of the next dates (or a failed one) once, or put a skipped
    upcoming date back. A staged date's items are ignored in the inbox."""
    schedule_uuid, on_text = str(target).split("/")
    on = date.fromisoformat(on_text)
    schedule = await schedule_row(session, entity["id"], UUID(schedule_uuid))
    cadence = stored_cadence(schedule)
    before_view = (await results(session, entity["id"], [schedule]))[0]
    occurrence = await _occurrence(session, schedule["id"], on)
    upcoming = rules.upcoming(
        cadence, schedule["starts_on"], schedule["ends_on"], schedule["next_on"]
    )
    if occurrence and occurrence["status"] == "staged":
        raise RejectionError(
            "occurrence_staged",
            "This date is already in the Transactions inbox. Ignore its items there.",
        )
    if payload["skipped"]:
        failed = occurrence is not None and occurrence["status"] == "failed"
        if not failed and (on not in upcoming or schedule["paused"]):
            raise RejectionError(
                "not_scheduled",
                f"Choose one of this schedule's next {rules.UPCOMING} dates, "
                "or a date that was not staged.",
                422,
            )
        if occurrence is None:
            row = (
                (
                    await session.execute(
                        insert(sc.occurrences)
                        .values(
                            uuid=uuid4(),
                            schedule_id=schedule["id"],
                            entity_id=entity["id"],
                            scheduled_on=on,
                            status="skipped",
                        )
                        .returning(sc.occurrences)
                    )
                )
                .mappings()
                .one()
            )
        elif occurrence["status"] == "failed":
            row = (
                (
                    await session.execute(
                        update(sc.occurrences)
                        .where(sc.occurrences.c.id == occurrence["id"])
                        .values(
                            status="skipped",
                            rejection=None,
                            revision=occurrence["revision"] + 1,
                            updated_at=func.now(),
                        )
                        .returning(sc.occurrences)
                    )
                )
                .mappings()
                .one()
            )
        else:
            row = occurrence
        record_uuid = row["uuid"]
    else:
        if occurrence is None or occurrence["status"] != "skipped":
            raise RejectionError("not_skipped", "This date is not skipped.", 422)
        if schedule["next_on"] is None or on < schedule["next_on"]:
            raise RejectionError(
                "occurrence_passed",
                "This date has passed. Add it in Activity if you need it.",
                422,
            )
        await session.execute(
            delete(sc.occurrences).where(sc.occurrences.c.id == occurrence["id"])
        )
        record_uuid = occurrence["uuid"]
    after = (await results(session, entity["id"], [schedule]))[0]
    await audit(sc.occurrences, record_uuid, before_view, after)
    return after


# Staging a date ---------------------------------------------------------------


async def write_stage(session, entity, actor, operation, payload, target, audit):
    """Stage one scheduled date's entries as waiting inbox items; caller owns the
    Entity lock, retry and commit.

    A date is staged only if it is the schedule's next date (or a failed date
    being retried), the schedule is not paused and the date has come. A stored
    staged or skipped occurrence only moves next_on past it, so a repeated or
    concurrent tick changes nothing.
    """
    on = date.fromisoformat(payload["scheduled_on"])
    schedule = await schedule_row(session, entity["id"], target)
    occurrence = await _occurrence(session, schedule["id"], on)
    status = occurrence["status"] if occurrence else None
    if schedule["paused"] or on > today_of(entity):
        return {"staged": False, "items": []}
    if status in {"staged", "skipped"}:
        await advance(session, schedule, on)
        return {"staged": False, "items": []}
    if status is None and on != schedule["next_on"]:
        return {"staged": False, "items": []}  # dropped by a pause or an edit
    lines = lines_of(schedule)
    await check_lines(session, entity["id"], lines, on)
    if occurrence:
        row = (
            (
                await session.execute(
                    update(sc.occurrences)
                    .where(sc.occurrences.c.id == occurrence["id"])
                    .values(
                        status="staged",
                        rejection=None,
                        revision=occurrence["revision"] + 1,
                        updated_at=func.now(),
                    )
                    .returning(sc.occurrences)
                )
            )
            .mappings()
            .one()
        )
    else:
        row = (
            (
                await session.execute(
                    insert(sc.occurrences)
                    .values(
                        uuid=uuid4(),
                        schedule_id=schedule["id"],
                        entity_id=entity["id"],
                        scheduled_on=on,
                        status="staged",
                    )
                    .returning(sc.occurrences)
                )
            )
            .mappings()
            .one()
        )
    now = datetime.now(UTC)
    items = []
    for position, line in enumerate(lines, 1):
        fact = line.staged(on, schedule["name"], position)
        item_uuid = uuid4()
        await session.execute(
            insert(st.staged).values(
                uuid=item_uuid,
                entity_id=entity["id"],
                schedule_occurrence_id=row["id"],
                source_ref=fact.source_ref,
                financial_date=on,
                latest={
                    **fact.latest(),
                    "schedule": {"id": str(schedule["uuid"]), "scheduled_on": str(on)},
                },
                proposal=line.proposal(),
                proposed_by_user_id=actor.user_id,
                proposed_interface=INTERFACE,
                proposed_at=now,
            )
        )
        items.append(item_uuid)
    await audit(
        sc.occurrences,
        row["uuid"],
        dict(occurrence) if occurrence else None,
        {**dict(row), "schedule_id": schedule["uuid"], "item_ids": items},
        action="schedule_stage",
    )
    await advance(session, schedule, on)
    return {"staged": True, "items": items}


async def advance(session, schedule, on: date):
    """Move next_on past `on` when the tick has handled it."""
    if schedule["next_on"] is not None and schedule["next_on"] <= on:
        await session.execute(
            update(sc.schedules)
            .where(sc.schedules.c.id == schedule["id"])
            .values(
                next_on=rules.first_on_or_after(
                    stored_cadence(schedule),
                    schedule["starts_on"],
                    schedule["ends_on"],
                    on + timedelta(days=1),
                )
            )
        )


async def keep_failure(session, actor, entity_uuid, schedule_uuid, on, error):
    """Store why a date was not staged, and move on to the next date.

    The tick retries a failed date every hour until it is staged or skipped.
    An unchanged reason is not stored or audited again.
    """
    async with session.begin():
        _, entity = await authorize(session, actor, entity_uuid, lock=True)
        schedule = await schedule_row(session, entity["id"], schedule_uuid)
        occurrence = await _occurrence(session, schedule["id"], on)
        reason = {"code": error.code, "message": error.message}
        if occurrence and occurrence["status"] != "failed":
            return  # staged or skipped meanwhile
        if occurrence is None:
            row = (
                (
                    await session.execute(
                        insert(sc.occurrences)
                        .values(
                            uuid=uuid4(),
                            schedule_id=schedule["id"],
                            entity_id=entity["id"],
                            scheduled_on=on,
                            status="failed",
                            rejection=reason,
                        )
                        .returning(sc.occurrences)
                    )
                )
                .mappings()
                .one()
            )
        elif occurrence["rejection"] != reason:
            row = (
                (
                    await session.execute(
                        update(sc.occurrences)
                        .where(sc.occurrences.c.id == occurrence["id"])
                        .values(
                            rejection=reason,
                            revision=occurrence["revision"] + 1,
                            updated_at=func.now(),
                        )
                        .returning(sc.occurrences)
                    )
                )
                .mappings()
                .one()
            )
        else:
            return
        await session.execute(
            insert(m.audit).values(
                audit_values(
                    entity["id"],
                    actor,
                    INTERFACE,
                    uuid4(),
                    sc.occurrences,
                    row["uuid"],
                    "schedule_failed",
                    dict(occurrence) if occurrence else None,
                    {**dict(row), "schedule_id": schedule["uuid"]},
                )
            )
        )
        await advance(session, schedule, on)


async def check_proposals(sessions, actor, entity_uuid, items):
    """Store the record checks' verdict on each newly staged item's proposal, so
    the inbox says before anyone accepts it if it would be rejected now."""
    from accanto.services import inbox

    for item_uuid in items:
        async with sessions() as session:
            outcome = await inbox.dry_run(session, actor, entity_uuid, item_uuid, None)
        if outcome is None:
            continue
        async with sessions() as session, session.begin():
            await session.execute(
                update(st.staged)
                .where(st.staged.c.uuid == item_uuid, st.staged.c.revision == 1)
                .values(proposal_rejection=outcome)
            )


async def stage_date(sessions, owner_id, entity_uuid, schedule_uuid, on) -> str:
    """Stage one scheduled date as the owner: "staged", "noop" or "failed"."""
    actor = schedule_actor(owner_id)
    async with sessions() as session:
        try:
            # Each attempt has its own retry identity: the occurrence row, checked
            # under the Entity lock, is what makes a date happen once. A stored
            # outcome for a no-op attempt must never stand in for a later one.
            result = await write(
                session,
                actor,
                entity_uuid,
                "stage_schedule_date",
                str(uuid4()),
                {"scheduled_on": on.isoformat()},
                schedule_uuid,
                scope=f"stage_schedule_date:{schedule_uuid}:{on}",
            )
        except RejectionError as error:
            if error.status in {401, 403} or error.code in {
                "entity_not_found",
                "schedule_not_found",
            }:
                raise
            await keep_failure(session, actor, entity_uuid, schedule_uuid, on, error)
            return "failed"
    if not result.get("staged"):
        return "noop"
    await check_proposals(sessions, actor, entity_uuid, result["items"])
    return "staged"


async def due_work(session, now: datetime) -> list[tuple]:
    """(owner, Entity, schedule, date) to stage now, oldest date first.

    The next dates of schedules that are due in their Entity's time zone (up
    to CATCH_UP each), then failed dates to retry. Read without locks; each
    date is checked again under the Entity lock when it is staged.
    """  # No Entity's today is more than a day after UTC's.
    horizon = now.astimezone(UTC).date() + timedelta(days=1)
    rows = (
        await session.execute(
            select(
                sc.schedules,
                m.entities.c.uuid.label("entity_uuid"),
                m.entities.c.owner_id,
                m.entities.c.time_zone,
            )
            .join(m.entities, m.entities.c.id == sc.schedules.c.entity_id)
            .where(
                ~sc.schedules.c.paused,
                sc.schedules.c.next_on.is_not(None),
                m.entities.c.deleted_at.is_(None),
                sc.schedules.c.next_on <= horizon,
            )
            .order_by(sc.schedules.c.id)
        )
    ).mappings()
    work = []
    for row in rows:
        today = entity_today(now, row["time_zone"])
        cadence = stored_cadence(row)
        day = row["next_on"]
        for _ in range(rules.CATCH_UP):
            if day is None or day > today:
                break
            work.append((row["owner_id"], row["entity_uuid"], row["uuid"], day))
            day = rules.first_on_or_after(
                cadence, row["starts_on"], row["ends_on"], day + timedelta(days=1)
            )
    failed = await session.execute(
        select(
            m.entities.c.owner_id,
            m.entities.c.uuid,
            sc.schedules.c.uuid,
            sc.occurrences.c.scheduled_on,
        )
        .join(sc.schedules, sc.schedules.c.id == sc.occurrences.c.schedule_id)
        .join(m.entities, m.entities.c.id == sc.schedules.c.entity_id)
        .where(
            sc.occurrences.c.status == "failed",
            ~sc.schedules.c.paused,
            m.entities.c.deleted_at.is_(None),
        )
        .order_by(sc.occurrences.c.scheduled_on)
    )
    work += [tuple(row) for row in failed]
    return work


async def stage_due(sessions, now: datetime | None = None) -> dict[str, int]:
    """The tick step: stage every due date once. Counts only (Constitution §6)."""
    now = now or clock()
    async with sessions() as session, session.begin():
        work = await due_work(session, now)
    counts = {"staged": 0, "noop": 0, "failed": 0}
    for owner_id, entity_uuid, schedule_uuid, on in work:
        try:
            outcome = await stage_date(
                sessions, owner_id, entity_uuid, schedule_uuid, on
            )
        except RejectionError as error:
            log.warning("schedule_date_skipped", code=error.code)
            outcome = "noop"
        counts[outcome] += 1
    # A date that could not be staged is reported, not a tick failure: the
    # schedule shows it and the next tick retries it.
    return {
        "staged": counts["staged"],
        "unchanged": counts["noop"],
        "not_staged": counts["failed"],
    }
