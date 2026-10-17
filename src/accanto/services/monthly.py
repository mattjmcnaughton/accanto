"""Authorized transactional monthly workflows; no HTTP dependencies."""

import hashlib
import json
from datetime import UTC, date, datetime
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import delete, insert, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from accanto.domains.entity import entity_settings
from accanto.domains.monthly import money, monthly_actuals, plan_results
from accanto.models import monthly as m
from accanto.repositories.monthly import plan_lines
from accanto.services.access import AuthenticatedActor, RejectionError, revalidate_actor


def json_values(value):
    return json.loads(json.dumps(value, default=str))


async def authorize(
    session: AsyncSession,
    token: str | AuthenticatedActor,
    entity_uuid: UUID,
    *,
    lock: bool,
):
    actor = await revalidate_actor(session, token, lock=lock)
    query = select(m.entities).where(m.entities.c.uuid == entity_uuid)
    if lock:
        query = query.with_for_update()
    entity = (await session.execute(query)).mappings().first()
    if not entity or entity["owner_id"] != actor.user_id:
        raise RejectionError("entity_not_found", "Entity is unavailable.", 404)
    return actor, entity


async def scoped(session, table, entity_id, record_uuid):
    row = (
        (
            await session.execute(
                select(table).where(
                    table.c.uuid == record_uuid, table.c.entity_id == entity_id
                )
            )
        )
        .mappings()
        .first()
    )
    if not row:
        raise RejectionError(
            "record_not_found", "Record is unavailable in this Entity.", 404
        )
    return row


def check_revision(record, expected):
    if expected != record["revision"]:
        raise RejectionError(
            "stale_revision", "Reload the current record and reconcile your changes."
        )


async def plan_snapshot(session, record):
    return json_values(
        {**dict(record), "incomes": await plan_lines(session, record["id"])}
    )


async def write(
    session: AsyncSession,
    token: str | AuthenticatedActor,
    entity_uuid: UUID,
    operation: str,
    request_key: str,
    payload: dict,
    target: UUID | None = None,
):
    """One commit includes financial records, snapshots and recorded retry response."""
    async with session.begin():
        actor, entity = await authorize(session, token, entity_uuid, lock=True)
        scope = f"{operation}:{target or ''}"
        digest = hashlib.sha256(
            json.dumps(
                json_values(payload), sort_keys=True, separators=(",", ":")
            ).encode()
        ).hexdigest()
        previous = (
            (
                await session.execute(
                    select(m.outcomes).where(
                        m.outcomes.c.entity_id == entity["id"],
                        m.outcomes.c.user_id == actor.user_id,
                        m.outcomes.c.operation == scope,
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
        operation_uuid = uuid4()

        async def audit(table, record_uuid, before, after, action=operation):
            await session.execute(
                insert(m.audit).values(
                    entity_id=entity["id"],
                    actor_id=actor.user_id,
                    api_key_uuid=actor.credential_uuid
                    if actor.credential_kind == "api_key"
                    else None,
                    session_uuid=actor.credential_uuid
                    if actor.credential_kind == "session"
                    else None,
                    interface=actor.interface,
                    operation_uuid=operation_uuid,
                    record_type=table.name,
                    record_uuid=record_uuid,
                    action=action,
                    before=json_values(before),
                    after=json_values(after),
                )
            )

        if operation == "copy_plan":
            source_plan = await scoped(session, m.plans, entity["id"], target)
            source_revision = await scoped(
                session, m.revisions, entity["id"], payload["source_revision_id"]
            )
            if source_revision["plan_id"] != source_plan["id"]:
                raise RejectionError(
                    "record_not_found", "Revision is unavailable in this Plan.", 404
                )
            check_revision(source_revision, payload["expected_revision"])
            # Derive new inputs only after recording the original request identity.
            # The creation path assigns fresh Plan and Income source identities.
            payload = {
                "name": payload["name"],
                "spending": str(source_revision["spending"]),
                "incomes": [
                    {"name": line["name"], "amount": str(line["amount"])}
                    for line in await plan_lines(session, source_revision["id"])
                ],
            }

        if operation == "edit_entity":
            check_revision(entity, payload.get("expected_revision"))
            try:
                values = entity_settings(payload["name"], payload["time_zone"])
            except ValueError as error:
                raise RejectionError("invalid_settings", str(error), 422) from None
            record = (
                (
                    await session.execute(
                        update(m.entities)
                        .where(m.entities.c.id == entity["id"])
                        .values(**values, revision=entity["revision"] + 1)
                        .returning(m.entities)
                    )
                )
                .mappings()
                .one()
            )
            await audit(m.entities, entity["uuid"], dict(entity), dict(record))
            response = {
                "id": str(record["uuid"]),
                "name": record["name"],
                "time_zone": record["time_zone"],
                "revision": record["revision"],
            }
        elif operation in {"create_plan", "edit_plan", "copy_plan"}:
            before = None
            if operation in {"create_plan", "copy_plan"}:
                if payload.get("expected_revision") is not None:
                    raise RejectionError(
                        "unexpected_revision", "A new Plan has no prior revision."
                    )
                plan = (
                    (
                        await session.execute(
                            insert(m.plans)
                            .values(entity_id=entity["id"])
                            .returning(m.plans)
                        )
                    )
                    .mappings()
                    .one()
                )
                number, revision = 1, 1
            else:
                plan = await scoped(session, m.plans, entity["id"], target)
                old = (
                    (
                        await session.execute(
                            select(m.revisions).where(
                                m.revisions.c.plan_id == plan["id"],
                                ~m.revisions.c.saved,
                            )
                        )
                    )
                    .mappings()
                    .one()
                )
                check_revision(old, payload.get("expected_revision"))
                before = await plan_snapshot(session, old)
                number, revision = old["number"], old["revision"] + 1
            results = plan_results(
                [Decimal(line["amount"]) for line in payload["incomes"]],
                Decimal(payload["spending"]),
            )
            values = {
                **{k: Decimal(v) for k, v in results.items()},
                "name": payload["name"],
                "plan_id": plan["id"],
                "entity_id": entity["id"],
                "number": number,
                "revision": revision,
            }
            if before:
                await session.execute(
                    delete(m.income_lines).where(
                        m.income_lines.c.plan_revision_id == old["id"]
                    )
                )
                record = (
                    (
                        await session.execute(
                            update(m.revisions)
                            .where(m.revisions.c.id == old["id"])
                            .values(**values)
                            .returning(m.revisions)
                        )
                    )
                    .mappings()
                    .one()
                )
            else:
                record = (
                    (
                        await session.execute(
                            insert(m.revisions).values(**values).returning(m.revisions)
                        )
                    )
                    .mappings()
                    .one()
                )
            seen = set()
            for line in payload["incomes"]:
                if line.get("source_id"):
                    source = await scoped(
                        session, m.sources, entity["id"], line["source_id"]
                    )
                    if source["plan_id"] != plan["id"]:
                        raise RejectionError(
                            "source_plan", "Income source belongs to a different Plan."
                        )
                else:
                    source = (
                        (
                            await session.execute(
                                insert(m.sources)
                                .values(plan_id=plan["id"], entity_id=entity["id"])
                                .returning(m.sources)
                            )
                        )
                        .mappings()
                        .one()
                    )
                if not line.get("source_id"):
                    await audit(m.sources, source["uuid"], None, dict(source))
                if source["id"] in seen:
                    raise RejectionError(
                        "duplicate_source", "Include each Income source once."
                    )
                seen.add(source["id"])
                await session.execute(
                    insert(m.income_lines).values(
                        plan_revision_id=record["id"],
                        plan_id=plan["id"],
                        income_source_id=source["id"],
                        name=line["name"],
                        amount=Decimal(line["amount"]),
                    )
                )
            response = {
                "plan_id": str(plan["uuid"]),
                "draft": await plan_snapshot(session, record),
            }
            await audit(m.revisions, record["uuid"], before, response["draft"])
            if before is None:
                await audit(m.plans, plan["uuid"], None, dict(plan))
        elif operation == "save_version":
            plan = await scoped(session, m.plans, entity["id"], target)
            old = (
                (
                    await session.execute(
                        select(m.revisions).where(
                            m.revisions.c.plan_id == plan["id"], ~m.revisions.c.saved
                        )
                    )
                )
                .mappings()
                .one()
            )
            check_revision(old, payload["expected_revision"])
            before = await plan_snapshot(session, old)
            record = (
                (
                    await session.execute(
                        update(m.revisions)
                        .where(m.revisions.c.id == old["id"])
                        .values(
                            saved=True,
                            saved_at=datetime.now(UTC),
                            revision=old["revision"] + 1,
                        )
                        .returning(m.revisions)
                    )
                )
                .mappings()
                .one()
            )
            values = {
                k: v
                for k, v in dict(old).items()
                if k not in {"id", "uuid", "number", "revision"}
            }
            draft = (
                (
                    await session.execute(
                        insert(m.revisions)
                        .values(**values, number=old["number"] + 1, revision=1)
                        .returning(m.revisions)
                    )
                )
                .mappings()
                .one()
            )
            rows = (
                (
                    await session.execute(
                        select(m.income_lines).where(
                            m.income_lines.c.plan_revision_id == old["id"]
                        )
                    )
                )
                .mappings()
                .all()
            )
            for line in rows:
                await session.execute(
                    insert(m.income_lines).values(
                        **{
                            k: v
                            for k, v in dict(line).items()
                            if k not in {"id", "uuid", "plan_revision_id"}
                        },
                        plan_revision_id=draft["id"],
                    )
                )
            response = {
                "version": await plan_snapshot(session, record),
                "draft": await plan_snapshot(session, draft),
            }
            await audit(m.revisions, record["uuid"], before, response["version"])
            await audit(m.revisions, draft["uuid"], None, response["draft"])
        elif operation in {"create_entry", "edit_entry", "delete_entry"}:
            old = None
            before = None
            if operation != "create_entry":
                old = await scoped(session, m.entries, entity["id"], target)
                check_revision(old, payload.get("expected_revision"))
                if old["deleted_at"]:
                    raise RejectionError(
                        "deleted_entry", "Entry has already been deleted."
                    )
                before = await entry_snapshot(session, old)
            source = None
            if payload.get("source_id"):
                if payload["category"] != "income":
                    raise RejectionError(
                        "source_category",
                        "Only income receipts can select an Income source.",
                    )
                source = await scoped(
                    session, m.sources, entity["id"], payload["source_id"]
                )
            if operation == "delete_entry":
                assert old is not None
                values = {
                    "deleted_at": datetime.now(UTC),
                    "revision": old["revision"] + 1,
                }
            else:
                values = {
                    "entity_id": entity["id"],
                    "financial_date": payload["date"],
                    "category": payload["category"],
                    "amount": money(payload["amount"]),
                    "note": payload["note"],
                    "revision": old["revision"] + 1 if old else 1,
                }
            statement = (
                update(m.entries).where(m.entries.c.id == old["id"])
                if old
                else insert(m.entries)
            )
            record = (
                (await session.execute(statement.values(**values).returning(m.entries)))
                .mappings()
                .one()
            )
            if operation != "delete_entry":
                await session.execute(
                    delete(m.assignments).where(
                        m.assignments.c.actual_entry_id == record["id"]
                    )
                )
                if source:
                    await session.execute(
                        insert(m.assignments).values(
                            actual_entry_id=record["id"],
                            income_source_id=source["id"],
                            entity_id=entity["id"],
                        )
                    )
            response = await entry_snapshot(session, record)
            await audit(m.entries, record["uuid"], before, response)
        elif operation == "create_review":
            version = await scoped(
                session, m.revisions, entity["id"], payload["version_id"]
            )
            if not version["saved"]:
                raise RejectionError("unsaved_version", "Choose a saved Plan version.")
            existing = await session.scalar(
                select(m.reviews.c.id).where(
                    m.reviews.c.entity_id == entity["id"],
                    m.reviews.c.month == payload["month"],
                )
            )
            if existing:
                raise RejectionError(
                    "review_exists", "A Review already exists for this month."
                )
            record = (
                (
                    await session.execute(
                        insert(m.reviews)
                        .values(
                            entity_id=entity["id"],
                            month=payload["month"],
                            plan_revision_id=version["id"],
                        )
                        .returning(m.reviews)
                    )
                )
                .mappings()
                .one()
            )
            response = json_values(dict(record))
            await audit(m.reviews, record["uuid"], None, response)
        elif operation in {"create_estimate", "edit_estimate", "duplicate_estimate"}:
            from accanto.services.income_estimates import write_estimate

            response = await write_estimate(
                session, entity, operation, payload, target, audit
            )
        else:
            raise RejectionError(
                "unsupported_command", "Command is not implemented.", 404
            )
        response = json_values(response)
        await session.execute(
            insert(m.outcomes).values(
                entity_id=entity["id"],
                user_id=actor.user_id,
                operation=scope,
                request_key=request_key,
                request_hash=digest,
                response=response,
            )
        )
    return response


async def entry_snapshot(session, record):
    source_uuid = await session.scalar(
        select(m.sources.c.uuid)
        .join(m.assignments, m.assignments.c.income_source_id == m.sources.c.id)
        .where(m.assignments.c.actual_entry_id == record["id"])
    )
    return json_values({**dict(record), "source_id": source_uuid})


async def read_review(session, token, entity_uuid, month: date):
    async with session.begin():
        # Same Entity lock gives a consistent multi-query view of current records.
        _, entity = await authorize(session, token, entity_uuid, lock=True)
        review = (
            (
                await session.execute(
                    select(m.reviews).where(
                        m.reviews.c.entity_id == entity["id"],
                        m.reviews.c.month == month,
                    )
                )
            )
            .mappings()
            .first()
        )
        if not review:
            raise RejectionError(
                "review_not_found", "Create a Review for this month first.", 404
            )
        version = (
            (
                await session.execute(
                    select(m.revisions).where(
                        m.revisions.c.id == review["plan_revision_id"]
                    )
                )
            )
            .mappings()
            .one()
        )
        lines = await plan_lines(session, version["id"])
        next_month = date(month.year + (month.month == 12), month.month % 12 + 1, 1)
        entries = (
            (
                await session.execute(
                    select(m.entries, m.sources.c.uuid.label("source_uuid"))
                    .outerjoin(
                        m.assignments, m.assignments.c.actual_entry_id == m.entries.c.id
                    )
                    .outerjoin(
                        m.sources, m.sources.c.id == m.assignments.c.income_source_id
                    )
                    .where(
                        m.entries.c.entity_id == entity["id"],
                        m.entries.c.deleted_at.is_(None),
                        m.entries.c.financial_date >= month,
                        m.entries.c.financial_date < next_month,
                    )
                    .order_by(m.entries.c.financial_date, m.entries.c.id)
                )
            )
            .mappings()
            .all()
        )
        actual = monthly_actuals(
            [str(line["source_id"]) for line in lines],
            [
                (str(e["source_uuid"]) if e["source_uuid"] else None, e["amount"])
                for e in entries
                if e["category"] == "income"
            ],
            [e["amount"] for e in entries if e["category"] == "spending"],
        )
        return json_values(
            {
                "review": dict(review),
                "version": await plan_snapshot(session, version),
                "actual": actual,
                "entries": [dict(e) for e in entries],
                "income_difference": None
                if actual["income_incomplete"]
                else str(Decimal(actual["income_recorded"]) - version["income"]),
                "spending_difference": None
                if actual["spending_recorded"] is None
                else str(Decimal(actual["spending_recorded"]) - version["spending"]),
            }
        )


async def read_plans(session, token, entity_uuid):
    async with session.begin():
        _, entity = await authorize(session, token, entity_uuid, lock=True)
        plans = (
            (
                await session.execute(
                    select(m.plans).where(m.plans.c.entity_id == entity["id"])
                )
            )
            .mappings()
            .all()
        )
        result = []
        for plan in plans:
            revisions = (
                (
                    await session.execute(
                        select(m.revisions)
                        .where(m.revisions.c.plan_id == plan["id"])
                        .order_by(m.revisions.c.number)
                    )
                )
                .mappings()
                .all()
            )
            result.append(
                {
                    "plan_id": str(plan["uuid"]),
                    "revisions": [
                        await plan_snapshot(session, row) for row in revisions
                    ],
                }
            )
        return result


async def read_activity(session, token, entity_uuid):
    async with session.begin():
        _, entity = await authorize(session, token, entity_uuid, lock=True)
        entries = (
            (
                await session.execute(
                    select(m.entries)
                    .where(
                        m.entries.c.entity_id == entity["id"],
                        m.entries.c.deleted_at.is_(None),
                    )
                    .order_by(m.entries.c.financial_date, m.entries.c.id)
                )
            )
            .mappings()
            .all()
        )
        return [await entry_snapshot(session, row) for row in entries]
