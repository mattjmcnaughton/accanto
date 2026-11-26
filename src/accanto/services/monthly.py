"""Authorized transactional monthly workflows; no HTTP dependencies."""

import hashlib
import json
from datetime import UTC, date, datetime
from decimal import Decimal
from uuid import UUID, uuid4

import logfire
from sqlalchemy import BigInteger, any_, bindparam, delete, func, insert, select, update
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.ext.asyncio import AsyncSession

from accanto.db import read_snapshot
from accanto.domains.entity import entity_settings
from accanto.domains.monthly import (
    fixed_cost_monthly,
    known_total_delta,
    money,
    plan_results,
)
from accanto.models import monthly as m
from accanto.repositories.monthly import plan_allocations, plan_fixed_costs, plan_lines
from accanto.services.access import AuthenticatedActor, RejectionError, revalidate_actor


class DryRun(Exception):  # noqa: N818 - control flow, not an error
    """Raised inside write() to roll back a command whose checks all passed."""

    def __init__(self, response):
        self.response = response
        super().__init__("dry run")


def json_values(value):
    return json.loads(json.dumps(value, default=str))


def request_digest(payload) -> str:
    """The retry identity's input hash: the same key with other input is rejected."""
    return hashlib.sha256(
        json.dumps(json_values(payload), sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


async def authorize(
    session: AsyncSession,
    token: str | AuthenticatedActor,
    entity_uuid: UUID,
    *,
    lock: bool,
):
    # Its duration includes waiting for the credential and Entity row locks.
    with logfire.span("access.authorize", lock=lock):
        actor = await revalidate_actor(session, token, lock=lock)
        query = select(m.entities).where(m.entities.c.uuid == entity_uuid)
        if lock:
            query = query.with_for_update()
        entity = (await session.execute(query)).mappings().first()
        if actor.credential_kind == "oauth" and lock:
            # A provider may revoke while this request waits for Entity serialization.
            actor = await revalidate_actor(session, actor, lock=lock)
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
    from accanto.domains.monthly_comparison import planned_metrics

    # Line triggers may have advanced metadata since the parent RETURNING row.
    updated_at = await session.scalar(
        select(m.revisions.c.updated_at).where(m.revisions.c.id == record["id"])
    )
    snapshot = json_values(
        {
            **dict(record),
            "updated_at": updated_at,
            "incomes": await plan_lines(session, record["id"]),
            "fixed_costs": await plan_fixed_costs(session, record["id"]),
            **(await plan_allocations(session, record["id"])),
        }
    )
    # Presentation only: saved monetary inputs/results are never recalculated.
    snapshot["planned_metrics"] = planned_metrics(snapshot)
    return snapshot


async def write(
    session: AsyncSession,
    token: str | AuthenticatedActor,
    entity_uuid: UUID,
    operation: str,
    request_key: str,
    payload: dict,
    target: UUID | date | None = None,
    *,
    hook=None,
    scope: str | None = None,
    dry_run: bool = False,
    guard=None,
    finish=None,
):
    """One commit includes financial records, snapshots and recorded retry response.

    hook (Transactions inbox): before(session, entity, actor) runs under the Entity
    lock after the retry lookup and returns the (operation, payload, target) to
    dispatch; after(session, entity, actor, response, audit) runs in the same
    transaction and returns the response to record. dry_run performs every check
    and write, then rolls back by raising DryRun.

    Agent writes (TDD 03): guard(session, entity) runs under the Entity lock after
    the retry lookup and may reject (the Agent mode check); finish(session, entity,
    response) runs in the same transaction before the outcome is recorded (a
    Pending change marks itself applied).
    """
    async with session.begin():
        actor, entity = await authorize(session, token, entity_uuid, lock=True)
        scope = scope or f"{operation}:{target or ''}"
        digest = request_digest(payload)
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
        if guard:
            await guard(session, entity)
        operation_uuid = uuid4()
        if hook:
            operation, payload, target = await hook.before(session, entity, actor)

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
                    # An agent's interface wins over the inbox's own label, so
                    # inbox records drafted by agents audit as mcp or agent.
                    interface=actor.interface_override
                    or getattr(hook, "interface", None)
                    or actor.interface,
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
            allocations = await plan_allocations(session, source_revision["id"])
            # Derive new inputs only after recording the original request identity.
            # The creation path assigns fresh Plan and Income source identities.
            payload = {
                "name": payload["name"],
                "spending": str(source_revision["spending"]),
                "incomes": [
                    {"name": line["name"], "amount": str(line["amount"])}
                    for line in await plan_lines(session, source_revision["id"])
                ],
                "fixed_costs": [
                    {
                        "fixed_cost_id": line["fixed_cost_id"],
                        "debt_account_id": line["debt_account_id"],
                        "_debt_account_name": line["debt_account_name"],
                        "name": line["name"],
                        "amount": str(line["amount"]),
                        "frequency": line["frequency"],
                    }
                    for line in await plan_fixed_costs(session, source_revision["id"])
                ],
                **{
                    key: [
                        {
                            id_key: line[id_key],
                            "amount": str(line["amount"]),
                            "_snapshot_name": line[label_key],
                        }
                        for line in lines
                    ]
                    for key, id_key, label_key, lines in (
                        (
                            "savings_funding",
                            "account_id",
                            "account_name",
                            allocations["savings_funding"],
                        ),
                        (
                            "saving_goals",
                            "goal_id",
                            "goal_name",
                            allocations["saving_goals"],
                        ),
                        (
                            "investments",
                            "destination_id",
                            "destination_name",
                            allocations["investments"],
                        ),
                        (
                            "giving",
                            "destination_id",
                            "destination_name",
                            allocations["giving"],
                        ),
                    )
                },
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
            old_allocations = None
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
                old_allocations = await plan_allocations(session, old["id"])
                number, revision = old["number"], old["revision"] + 1
            results = plan_results(
                [Decimal(line["amount"]) for line in payload["incomes"]],
                Decimal(payload["spending"]),
                [
                    fixed_cost_monthly(line["amount"], line["frequency"])
                    for line in payload.get("fixed_costs", [])
                ],
                *(
                    [Decimal(line["amount"]) for line in payload.get(key, [])]
                    for key in (
                        "savings_funding",
                        "saving_goals",
                        "investments",
                        "giving",
                    )
                ),
            )
            values = {
                **{k: Decimal(v) for k, v in results.items()},
                "name": payload["name"],
                "plan_id": plan["id"],
                "entity_id": entity["id"],
                "number": number,
                "revision": revision,
                "rule_version": "monthly-allocation-2",
            }
            if before:
                await session.execute(
                    delete(m.income_lines).where(
                        m.income_lines.c.plan_revision_id == old["id"]
                    )
                )
                await session.execute(
                    delete(m.fixed_cost_lines).where(
                        m.fixed_cost_lines.c.plan_revision_id == old["id"]
                    )
                )
                for table in (
                    m.savings_funding_lines,
                    m.saving_goal_lines,
                    m.investment_lines,
                    m.giving_lines,
                ):
                    await session.execute(
                        delete(table).where(table.c.plan_revision_id == old["id"])
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
            seen_fixed = set()
            for line in payload.get("fixed_costs", []):
                if line.get("fixed_cost_id"):
                    fixed = await scoped(
                        session, m.fixed_costs, entity["id"], line["fixed_cost_id"]
                    )
                else:
                    fixed = (
                        (
                            await session.execute(
                                insert(m.fixed_costs)
                                .values(entity_id=entity["id"], name=line["name"])
                                .returning(m.fixed_costs)
                            )
                        )
                        .mappings()
                        .one()
                    )
                    await audit(m.fixed_costs, fixed["uuid"], None, dict(fixed))
                if fixed["id"] in seen_fixed:
                    raise RejectionError(
                        "duplicate_fixed_cost", "Include each Fixed cost once."
                    )
                seen_fixed.add(fixed["id"])
                debt_line = None
                if line.get("debt_account_id"):
                    from accanto.models import debts as b

                    debt_line = await scoped(
                        session, b.debts, entity["id"], line["debt_account_id"]
                    )
                    if not debt_line["active"]:
                        retained = (
                            operation == "copy_plan"
                            or bool(line.get("_debt_account_name"))
                            or bool(
                                before
                                and any(
                                    prior["fixed_cost_id"] == str(fixed["uuid"])
                                    and prior["debt_account_id"]
                                    == str(debt_line["uuid"])
                                    for prior in before["fixed_costs"]
                                )
                            )
                        )
                        if not retained:
                            raise RejectionError(
                                "archived_debt",
                                "Reopen the Debt account or remove the draft line.",
                                422,
                            )
                await session.execute(
                    insert(m.fixed_cost_lines).values(
                        plan_revision_id=record["id"],
                        plan_id=plan["id"],
                        entity_id=entity["id"],
                        fixed_cost_id=fixed["id"],
                        debt_account_id=debt_line["id"] if debt_line else None,
                        debt_account_name=(
                            line.get("_debt_account_name")
                            or (
                                next(
                                    (
                                        prior["debt_account_name"]
                                        for prior in before["fixed_costs"]
                                        if prior["fixed_cost_id"] == str(fixed["uuid"])
                                        and prior["debt_account_id"]
                                        == (
                                            str(line["debt_account_id"])
                                            if line.get("debt_account_id")
                                            else None
                                        )
                                    ),
                                    None,
                                )
                                if before
                                else None
                            )
                            or (debt_line["name"] if debt_line else None)
                        ),
                        name=line["name"],
                        amount=money(line["amount"]),
                        frequency=line["frequency"],
                        monthly_amount=fixed_cost_monthly(
                            line["amount"], line["frequency"]
                        ),
                    )
                )
            from accanto.models import destinations as d
            from accanto.models import savings as s

            for key, table, target_table, id_key, name_key in (
                (
                    "savings_funding",
                    m.savings_funding_lines,
                    s.accounts,
                    "account_id",
                    "account_name",
                ),
                ("saving_goals", m.saving_goal_lines, s.goals, "goal_id", "goal_name"),
                (
                    "investments",
                    m.investment_lines,
                    d.investments,
                    "destination_id",
                    "destination_name",
                ),
                (
                    "giving",
                    m.giving_lines,
                    d.recipients,
                    "destination_id",
                    "destination_name",
                ),
            ):
                seen_targets = set()
                for line in payload.get(key, []):
                    target_row = await scoped(
                        session, target_table, entity["id"], line[id_key]
                    )
                    if target_row["id"] in seen_targets:
                        raise RejectionError(
                            "duplicate_allocation",
                            f"Include each {key} reference once.",
                            422,
                        )
                    seen_targets.add(target_row["id"])
                    prior_label = next(
                        (
                            prior[name_key]
                            for prior in (old_allocations or {}).get(key, [])
                            if prior[id_key] == line[id_key]
                        ),
                        None,
                    )
                    reference_available = target_row["active"]
                    if key == "saving_goals":
                        parent_active = await session.scalar(
                            select(s.accounts.c.active).where(
                                s.accounts.c.id == target_row["account_id"],
                                s.accounts.c.entity_id == entity["id"],
                            )
                        )
                        reference_available = reference_available and bool(
                            parent_active
                        )
                    if not reference_available and not (
                        prior_label or line.get("_snapshot_name")
                    ):
                        raise RejectionError(
                            "inactive_plan_reference",
                            "Reactivate the reference or remove its draft allocation.",
                            422,
                        )
                    # Inactive references are retained for deliberate draft revision.
                    await session.execute(
                        insert(table).values(
                            plan_revision_id=record["id"],
                            entity_id=entity["id"],
                            **{
                                id_key: target_row["id"],
                                name_key: line.get("_snapshot_name")
                                or prior_label
                                or target_row["name"],
                            },
                            amount=money(line["amount"]),
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
            fixed_rows = (
                (
                    await session.execute(
                        select(m.fixed_cost_lines).where(
                            m.fixed_cost_lines.c.plan_revision_id == old["id"]
                        )
                    )
                )
                .mappings()
                .all()
            )
            for line in fixed_rows:
                await session.execute(
                    insert(m.fixed_cost_lines).values(
                        **{
                            k: v
                            for k, v in dict(line).items()
                            if k not in {"id", "uuid", "plan_revision_id"}
                        },
                        plan_revision_id=draft["id"],
                    )
                )
            for table in (
                m.savings_funding_lines,
                m.saving_goal_lines,
                m.investment_lines,
                m.giving_lines,
            ):
                allocation_rows = (
                    (
                        await session.execute(
                            select(table).where(table.c.plan_revision_id == old["id"])
                        )
                    )
                    .mappings()
                    .all()
                )
                for line in allocation_rows:
                    await session.execute(
                        insert(table).values(
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
        elif operation in {"create_entry", "edit_entry", "delete_entry", "known_total"}:
            old = None
            before = None
            if operation in {"edit_entry", "delete_entry"}:
                old = await scoped(session, m.entries, entity["id"], target)
                if old["category"] in {"investing", "giving"}:
                    raise RejectionError(
                        "entry_category",
                        "Use the matching contribution workflow.",
                        422,
                    )
                check_revision(old, payload.get("expected_revision"))
                if old["deleted_at"]:
                    raise RejectionError(
                        "deleted_entry", "Entry has already been deleted."
                    )
                before = await entry_snapshot(session, old)
            from accanto.services.savings import attach_entry, current_link

            previous_link = await current_link(session, old["id"]) if old else None
            if old:
                from accanto.models import refunds as r
                from accanto.services.refunds import validate_purchase_edit

                if await session.scalar(
                    select(r.refunds.c.id).where(
                        r.refunds.c.refund_entry_id == old["id"]
                    )
                ):
                    raise RejectionError(
                        "linked_refund", "Use the linked refund workflow.", 422
                    )
                await validate_purchase_edit(
                    session, old, before, payload, deleting=operation == "delete_entry"
                )
            source = None
            fixed_cost = None
            debt_account = None
            if payload.get("debt_account_id") and operation != "delete_entry":
                from accanto.models import debts as b

                debt_account = await scoped(
                    session, b.debts, entity["id"], payload["debt_account_id"]
                )
                if payload["category"] != "fixed_cost":
                    raise RejectionError(
                        "debt_payment_category", "Debt payments are fixed costs.", 422
                    )
                previous_debt_id = (
                    await session.scalar(
                        select(b.entry_debts.c.debt_account_id).where(
                            b.entry_debts.c.actual_entry_id == old["id"]
                        )
                    )
                    if old
                    else None
                )
                if (
                    not debt_account["active"]
                    and previous_debt_id != debt_account["id"]
                ):
                    raise RejectionError(
                        "archived_debt",
                        "Reopen the debt account before recording payments.",
                        422,
                    )
                opening_date = await session.scalar(
                    select(b.observations.c.financial_date).where(
                        b.observations.c.debt_account_id == debt_account["id"],
                        b.observations.c.is_opening,
                    )
                )
                if payload["date"] < opening_date:
                    raise RejectionError(
                        "before_opening",
                        "Payment cannot predate the debt opening.",
                        422,
                    )
            if payload.get("source_id"):
                if payload["category"] != "income":
                    raise RejectionError(
                        "source_category",
                        "Only income receipts can select an Income source.",
                    )
                source = await scoped(
                    session, m.sources, entity["id"], payload["source_id"]
                )
            if payload.get("fixed_cost_id"):
                if payload["category"] != "fixed_cost":
                    raise RejectionError(
                        "fixed_cost_category",
                        "Only fixed-cost payments can select a Fixed cost.",
                    )
                fixed_cost = await scoped(
                    session, m.fixed_costs, entity["id"], payload["fixed_cost_id"]
                )
            if payload.get("spending_subcategory_id") and payload["category"] != (
                "spending"
            ):
                raise RejectionError(
                    "spending_subcategory_category",
                    "Only guilt-free spending selects a subcategory.",
                )
            if operation == "known_total":
                from accanto.models import savings as s

                next_month = date(
                    payload["month"].year + (payload["month"].month == 12),
                    payload["month"].month % 12 + 1,
                    1,
                )
                contributing = (
                    (
                        await session.execute(
                            select(
                                m.entries,
                                m.sources.c.uuid.label("source_uuid"),
                                s.goals.c.uuid.label("goal_uuid"),
                            )
                            .outerjoin(
                                m.assignments,
                                m.assignments.c.actual_entry_id == m.entries.c.id,
                            )
                            .outerjoin(
                                m.sources,
                                m.sources.c.id == m.assignments.c.income_source_id,
                            )
                            .outerjoin(
                                s.linked_activity,
                                (s.linked_activity.c.actual_entry_id == m.entries.c.id)
                                & s.linked_activity.c.deleted_at.is_(None),
                            )
                            .outerjoin(
                                s.goals,
                                s.goals.c.id == s.linked_activity.c.goal_id,
                            )
                            .where(
                                m.entries.c.entity_id == entity["id"],
                                m.entries.c.deleted_at.is_(None),
                                m.entries.c.financial_date >= payload["month"],
                                m.entries.c.financial_date < next_month,
                                m.entries.c.category == payload["category"],
                            )
                        )
                    )
                    .mappings()
                    .all()
                )
                if payload["category"] == "income":
                    contributing = [
                        row
                        for row in contributing
                        if row["source_uuid"] == payload.get("source_id")
                    ]
                if payload["category"] == "saving":
                    contributing = [
                        row
                        for row in contributing
                        if row["goal_uuid"] == payload["saving_goal_id"]
                    ]
                actual_fingerprint = sorted(
                    (str(row["uuid"]), row["revision"]) for row in contributing
                )
                expected_fingerprint = sorted(
                    (str(row["uuid"]), row["revision"])
                    for row in payload["contributing_entries"]
                )
                if actual_fingerprint != expected_fingerprint:
                    raise RejectionError(
                        "stale_total",
                        "Activity changed. Review entries before saving this total.",
                    )
                payload = {
                    **payload,
                    "amount": str(
                        known_total_delta(
                            payload["desired_total"],
                            [row["amount"] for row in contributing],
                        )
                    ),
                    "is_adjustment": True,
                }
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
                    "amount": money(payload["amount"], signed=payload["is_adjustment"]),
                    "note": payload["note"],
                    "is_adjustment": payload["is_adjustment"],
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
            if operation == "delete_entry":
                await attach_entry(
                    session,
                    entity,
                    record,
                    previous_link,
                    None,
                    audit,
                    old["category"] if old else None,
                )
            elif operation != "known_total" or payload["category"] == "saving":
                await attach_entry(
                    session,
                    entity,
                    record,
                    previous_link,
                    payload.get("saving_goal_id")
                    if payload["category"] == "saving"
                    else payload.get("funding_goal_id"),
                    audit,
                    old["category"] if old else None,
                )
            if operation != "delete_entry":
                from accanto.models import debts as b

                await session.execute(
                    delete(b.entry_debts).where(
                        b.entry_debts.c.actual_entry_id == record["id"]
                    )
                )
                await session.execute(
                    delete(m.assignments).where(
                        m.assignments.c.actual_entry_id == record["id"]
                    )
                )
                await session.execute(
                    delete(m.fixed_cost_assignments).where(
                        m.fixed_cost_assignments.c.actual_entry_id == record["id"]
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
                if debt_account:
                    await session.execute(
                        insert(b.entry_debts).values(
                            actual_entry_id=record["id"],
                            debt_account_id=debt_account["id"],
                            entity_id=entity["id"],
                        )
                    )
                if fixed_cost:
                    await session.execute(
                        insert(m.fixed_cost_assignments).values(
                            actual_entry_id=record["id"],
                            fixed_cost_id=fixed_cost["id"],
                            entity_id=entity["id"],
                            name=fixed_cost["name"],
                        )
                    )
                from accanto.services.spending_subcategories import assign_entry
                from accanto.services.tags import tag_entry

                await assign_entry(
                    session,
                    entity,
                    record,
                    payload.get("spending_subcategory_id"),
                    audit,
                )
                await tag_entry(session, entity, record, payload.get("tag_ids"), audit)
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
        elif operation == "edit_review":
            old = (
                (
                    await session.execute(
                        select(m.reviews).where(
                            m.reviews.c.entity_id == entity["id"],
                            m.reviews.c.month == target,
                        )
                    )
                )
                .mappings()
                .first()
            )
            if old is None:
                raise RejectionError(
                    "review_not_found", "Create a Review for this month first.", 404
                )
            check_revision(old, payload["expected_revision"])
            version = await scoped(
                session, m.revisions, entity["id"], payload["version_id"]
            )
            if not version["saved"]:
                raise RejectionError("unsaved_version", "Choose a saved Plan version.")
            current_version = await session.scalar(
                select(m.revisions.c.plan_id).where(
                    m.revisions.c.id == old["plan_revision_id"]
                )
            )
            if version["plan_id"] != current_version:
                raise RejectionError(
                    "cross_plan_retarget_unavailable",
                    "Choose a saved version of this Review's Plan.",
                )
            if payload["checkpoint"] and not payload["reviewed"]:
                raise RejectionError(
                    "invalid_checkpoint", "Mark the month reviewed first."
                )
            new_checkpoint = payload["reviewed"] and (
                not old["reviewed_at"] or payload["checkpoint"]
            )
            reviewed_at = (
                (datetime.now(UTC) if new_checkpoint else old["reviewed_at"])
                if payload["reviewed"]
                else None
            )
            fingerprint = old["checkpoint_fingerprint"] if payload["reviewed"] else None
            if new_checkpoint:
                fingerprint = await review_fingerprint(
                    session,
                    entity["id"],
                    old["month"],
                    version["uuid"],
                    payload["note"],
                )
            record = (
                (
                    await session.execute(
                        update(m.reviews)
                        .where(m.reviews.c.id == old["id"])
                        .values(
                            plan_revision_id=version["id"],
                            note=payload["note"],
                            reviewed_at=reviewed_at,
                            checkpoint_fingerprint=fingerprint,
                            revision=old["revision"] + 1,
                        )
                        .returning(m.reviews)
                    )
                )
                .mappings()
                .one()
            )
            response = json_values(dict(record))
            await audit(m.reviews, record["uuid"], dict(old), response)
        elif operation in {"create_estimate", "edit_estimate", "duplicate_estimate"}:
            from accanto.services.income_estimates import write_estimate

            response = await write_estimate(
                session, entity, operation, payload, target, audit
            )
        elif operation in {
            "create_refund",
            "edit_refund",
            "delete_refund",
        }:
            from accanto.services.refunds import write_refund

            response = await write_refund(
                session, entity, operation, payload, target, audit
            )
        elif operation in {
            "create_saving_account",
            "edit_saving_account",
            "create_saving_goal",
            "edit_saving_goal",
            "complete_saving_goal",
            "archive_saving_account",
            "reopen_saving_account",
        }:
            from accanto.services.savings import write_savings

            response = await write_savings(
                session, entity, operation, payload, target, audit
            )
        elif operation in {
            "create_savings_movement",
            "edit_savings_movement",
            "delete_savings_movement",
        }:
            from accanto.services.savings import write_movement

            response = await write_movement(
                session, entity, operation, payload, target, audit
            )
        elif operation in {"create_debt", "edit_debt"}:
            from accanto.services.balances import write_debt

            response = await write_debt(
                session, entity, operation, payload, target, audit
            )
        elif operation in {
            "create_debt_observation",
            "edit_debt_observation",
            "delete_debt_observation",
            "create_investment_observation",
            "edit_investment_observation",
            "delete_investment_observation",
        }:
            from accanto.services.balances import write_observation

            response = await write_observation(
                session, entity, operation, payload, target, audit
            )
        elif operation in {
            "create_investment",
            "edit_investment",
            "create_giving",
            "edit_giving",
        }:
            from accanto.services.destinations import write_destination

            response = await write_destination(
                session, entity, operation, payload, target, audit
            )
        elif operation in {
            "create_investment_entry",
            "edit_investment_entry",
            "delete_investment_entry",
            "create_giving_entry",
            "edit_giving_entry",
            "delete_giving_entry",
        }:
            from accanto.services.destinations import write_contribution

            response = await write_contribution(
                session, entity, operation, payload, target, audit
            )
        elif operation.startswith("inbox_") or operation.endswith("_source"):
            from accanto.services.inbox import write_inbox

            response = await write_inbox(
                session, entity, actor, operation, payload, target, audit
            )
        elif operation in {
            "create_spending_subcategory",
            "edit_spending_subcategory",
        }:
            from accanto.services.spending_subcategories import (
                write_spending_subcategory,
            )

            response = await write_spending_subcategory(
                session, entity, operation, payload, target, audit
            )
        elif operation in {"create_tag", "edit_tag", "delete_tag", "set_entry_tags"}:
            from accanto.services.tags import write_tag

            response = await write_tag(
                session, entity, operation, payload, target, audit
            )
        elif operation == "edit_transaction_provider":
            from accanto.services.inbox import write_provider

            response = await write_provider(session, entity, payload, audit)
        elif operation == "edit_agent_settings":
            from accanto.services.agent_settings import write_agent_settings

            response = await write_agent_settings(session, entity, payload, audit)
        elif operation == "draft_pending_change":
            # Not financial activity: no audit row, only the retry outcome.
            from accanto.services.agent_writes import store_pending

            response = await store_pending(session, entity, actor, payload)
        else:
            raise RejectionError(
                "unsupported_command", "Command is not implemented.", 404
            )
        if hook:
            response = await hook.after(session, entity, actor, response, audit)
        if dry_run:
            raise DryRun(response)
        if finish:
            await finish(session, entity, response)
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
    return (await entry_snapshots(session, [record]))[0]


async def entry_snapshots(session, records):
    if not records:
        return []
    from accanto.models import debts as b
    from accanto.models import destinations as d
    from accanto.models import refunds as r
    from accanto.models import savings as s

    # One array bind even for an all-history Activity list. Only requested
    # entries participate in the two one-to-many reads (tags and refunds).
    ids = any_(
        bindparam("ids", [row["id"] for row in records], type_=ARRAY(BigInteger))
    )
    query = select(m.entries.c.id).where(m.entries.c.id == ids)
    for links, targets, foreign_key, field in (
        (m.assignments, m.sources, "income_source_id", "source_id"),
        (m.fixed_cost_assignments, m.fixed_costs, "fixed_cost_id", "fixed_cost_id"),
        (b.entry_debts, b.debts, "debt_account_id", "debt_account_id"),
        (
            m.spending_subcategory_assignments,
            m.spending_subcategories,
            "spending_subcategory_id",
            "spending_subcategory_id",
        ),
        (d.investment_entries, d.investments, "investment_id", "investment_id"),
        (d.giving_entries, d.recipients, "giving_recipient_id", "giving_recipient_id"),
    ):
        query = (
            query.outerjoin(links, links.c.actual_entry_id == m.entries.c.id)
            .outerjoin(targets, targets.c.id == links.c[foreign_key])
            .add_columns(targets.c.uuid.label(field))
        )
    original = m.entries.alias("purchase")
    refunds = (
        select(
            r.refunds.c.original_entry_id, func.sum(m.entries.c.amount).label("total")
        )
        .join(m.entries, m.entries.c.id == r.refunds.c.refund_entry_id)
        .where(r.refunds.c.original_entry_id == ids, m.entries.c.deleted_at.is_(None))
        .group_by(r.refunds.c.original_entry_id)
        .subquery()
    )
    link = s.linked_activity
    goal = (
        select(s.goals.c.uuid)
        .join(link, link.c.goal_id == s.goals.c.id)
        .where(link.c.actual_entry_id == m.entries.c.id, link.c.deleted_at.is_(None))
    )
    if any(row["deleted_at"] is not None for row in records):
        # Deletion audit snapshots retain the last funding link.
        goal = (
            select(s.goals.c.uuid)
            .join(link, link.c.goal_id == s.goals.c.id)
            .where(
                link.c.actual_entry_id == m.entries.c.id,
                link.c.deleted_at.is_(None) | m.entries.c.deleted_at.is_not(None),
            )
            .order_by(link.c.deleted_at.is_not(None), link.c.id.desc())
            .limit(1)
        )
    query = (
        query.outerjoin(r.refunds, r.refunds.c.refund_entry_id == m.entries.c.id)
        .outerjoin(original, original.c.id == r.refunds.c.original_entry_id)
        .outerjoin(refunds, refunds.c.original_entry_id == m.entries.c.id)
        .add_columns(
            m.fixed_cost_assignments.c.name.label("fixed_cost_name"),
            m.spending_subcategories.c.name.label("spending_subcategory_name"),
            original.c.uuid.label("refund_of"),
            refunds.c.total,
            goal.scalar_subquery().label("goal"),
        )
    )
    details = {
        row["id"]: dict(row) for row in (await session.execute(query)).mappings()
    }
    tags: dict[int, list] = {}
    for entry_id, uuid in await session.execute(
        select(m.entry_tags.c.actual_entry_id, m.tags.c.uuid)
        .join(m.tags, m.tags.c.id == m.entry_tags.c.tag_id)
        .where(m.entry_tags.c.actual_entry_id == ids)
        .order_by(m.entry_tags.c.id)
    ):
        tags.setdefault(entry_id, []).append(uuid)
    result = []
    for record in records:
        row = details[record["id"]]
        goal_uuid, refund_total = row.pop("goal"), row.pop("total")
        category = record["category"]
        outflow = category in {"spending", "fixed_cost", "giving", "investing"}
        refundable = (
            category in {"spending", "fixed_cost", "giving"}
            and record["amount"] > 0
            and not record["is_adjustment"]
        )
        result.append(
            {
                **record,
                **row,
                "saving_goal_id": goal_uuid if category == "saving" else None,
                "funding_goal_id": goal_uuid if outflow else None,
                "funding_origin": "savings" if outflow and goal_uuid else "income",
                "remaining_refundable": record["amount"] + (refund_total or 0)
                if refundable
                else None,
                "tag_ids": tags.get(record["id"], []),
            }
        )
    return json_values(result)


async def review_fingerprint(session, entity_id, month, version_uuid, note):
    next_month = date(month.year + (month.month == 12), month.month % 12 + 1, 1)
    rows = (
        await session.execute(
            select(m.entries.c.uuid, m.entries.c.revision)
            .where(
                m.entries.c.entity_id == entity_id,
                m.entries.c.deleted_at.is_(None),
                m.entries.c.financial_date >= month,
                m.entries.c.financial_date < next_month,
            )
            .order_by(m.entries.c.uuid)
        )
    ).all()
    canonical = json.dumps(
        [str(version_uuid), note, [(str(uuid), revision) for uuid, revision in rows]],
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode()).hexdigest()


async def read_review(session, token, entity_uuid, month: date):
    async with read_snapshot(session):
        _, entity = await authorize(session, token, entity_uuid, lock=False)
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
        next_month = date(month.year + (month.month == 12), month.month % 12 + 1, 1)
        entries = (
            (
                await session.execute(
                    select(
                        m.entries,
                        m.sources.c.uuid.label("source_uuid"),
                        m.fixed_costs.c.uuid.label("fixed_cost_uuid"),
                        m.fixed_cost_assignments.c.name.label("fixed_cost_name"),
                    )
                    .outerjoin(
                        m.assignments, m.assignments.c.actual_entry_id == m.entries.c.id
                    )
                    .outerjoin(
                        m.sources, m.sources.c.id == m.assignments.c.income_source_id
                    )
                    .outerjoin(
                        m.fixed_cost_assignments,
                        m.fixed_cost_assignments.c.actual_entry_id == m.entries.c.id,
                    )
                    .outerjoin(
                        m.fixed_costs,
                        m.fixed_costs.c.id == m.fixed_cost_assignments.c.fixed_cost_id,
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
        from accanto.models import savings as s

        savings_used = await session.scalar(
            select(func.coalesce(func.sum(m.entries.c.amount), 0))
            .join(
                s.linked_activity,
                s.linked_activity.c.actual_entry_id == m.entries.c.id,
            )
            .where(
                m.entries.c.entity_id == entity["id"],
                m.entries.c.category.in_(
                    ("spending", "fixed_cost", "giving", "investing")
                ),
                m.entries.c.deleted_at.is_(None),
                m.entries.c.financial_date >= month,
                m.entries.c.financial_date < next_month,
                s.linked_activity.c.deleted_at.is_(None),
            )
        )
        from accanto.services.monthly_comparison import explain_review

        version_view = await plan_snapshot(session, version)
        with logfire.span("monthly.entry_snapshots", entry_count=len(entries)):
            entry_views = await entry_snapshots(session, entries)
        explanation = explain_review(version_view, entry_views)
        actual: dict = {"savings_used": str(savings_used)}
        for category, comparison in explanation["comparison"].items():
            actual[f"{category}_recorded"] = comparison["recorded"]
            actual[f"{category}_incomplete"] = comparison["incomplete"]
        for category, missing_key in (
            ("income", "missing_sources"),
            ("fixed_cost", "missing_fixed_costs"),
        ):
            actual[missing_key] = [
                item["id"]
                for item in explanation["comparison"][category]["items"]
                if item["recorded"] is None
            ]
        return json_values(
            {
                "review": dict(review),
                "checkpoint_changed": bool(
                    review["reviewed_at"]
                    and review["checkpoint_fingerprint"]
                    != await review_fingerprint(
                        session, entity["id"], month, version["uuid"], review["note"]
                    )
                ),
                "version": version_view,
                **explanation,
                "expected": {
                    "saving": version["saving_total"],
                    "investing": version["investing_total"],
                    "giving": version["giving_total"],
                    "savings_funding": version["savings_funding_total"],
                    "funding": version["funding_total"],
                    "allocation": version["allocation_total"],
                },
                "differences": {
                    category: (
                        None
                        if actual[f"{category}_incomplete"] or version[column] is None
                        else str(
                            Decimal(actual[f"{category}_recorded"]) - version[column]
                        )
                    )
                    for category, column in (
                        ("saving", "saving_total"),
                        ("investing", "investing_total"),
                        ("giving", "giving_total"),
                    )
                },
                "actual": actual,
                # Staged transactions never enter totals; the count keeps a short
                # total from being mistaken for a complete one.
                "inbox_waiting": await inbox_waiting(session, entity["id"], month),
                "entries": entry_views,
                "income_difference": None
                if actual["income_incomplete"]
                else str(Decimal(actual["income_recorded"]) - version["income"]),
                "spending_difference": None
                if actual["spending_recorded"] is None
                else str(Decimal(actual["spending_recorded"]) - version["spending"]),
                "fixed_cost_difference": None
                if actual["fixed_cost_incomplete"]
                else str(
                    Decimal(actual["fixed_cost_recorded"]) - version["fixed_cost_total"]
                ),
            }
        )


async def inbox_waiting(session, entity_id, month):
    from accanto.services.inbox import waiting_count

    return await waiting_count(session, entity_id, month)


async def read_plans(session, token, entity_uuid):
    async with read_snapshot(session):
        _, entity = await authorize(session, token, entity_uuid, lock=False)
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


async def read_activity(session, token, entity_uuid, tag_id: UUID | None = None):
    async with read_snapshot(session):
        _, entity = await authorize(session, token, entity_uuid, lock=False)
        query = select(m.entries)
        if tag_id is not None:
            query = query.join(
                m.entry_tags, m.entry_tags.c.actual_entry_id == m.entries.c.id
            ).join(
                m.tags,
                (m.tags.c.id == m.entry_tags.c.tag_id) & (m.tags.c.uuid == tag_id),
            )
        entries = (
            (
                await session.execute(
                    query.where(
                        m.entries.c.entity_id == entity["id"],
                        m.entries.c.deleted_at.is_(None),
                    ).order_by(m.entries.c.financial_date, m.entries.c.id)
                )
            )
            .mappings()
            .all()
        )
        with logfire.span("monthly.entry_snapshots", entry_count=len(entries)):
            return await entry_snapshots(session, entries)
