"""Validate in request order, then persist accepted records together."""

from collections import defaultdict
from dataclasses import dataclass, field
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import BigInteger, column, func, insert, select, tuple_, update, values
from sqlalchemy.dialects.postgresql import JSONB

from accanto.domains import destinations, refunds, savings, tags
from accanto.domains import spending_subcategories as subcategories
from accanto.dtos.inbox import BulkRecordItem
from accanto.models import debts as b
from accanto.models import destinations as d
from accanto.models import inbox as st
from accanto.models import monthly as m
from accanto.models import refunds as r
from accanto.models import savings as s
from accanto.services import inbox, monthly
from accanto.services import refunds as refund_service
from accanto.services import savings as saving_service
from accanto.services import spending_subcategories as subcategory_service
from accanto.services import tags as tag_service
from accanto.services.access import RejectionError


def identity(item):
    return f"inbox_record:{item.item_id}", f"revision:{item.expected_revision}"


def failure(item, error):
    return {
        "item_id": str(item.item_id),
        "ok": False,
        "error": {"code": error.code, "message": error.message},
    }


@dataclass
class AcceptedEntry:
    item: BulkRecordItem
    digest: str
    action: str
    values: dict
    links: list
    goal: dict | None
    refund: tuple | None
    operation: UUID = field(default_factory=uuid4)


async def record_many(session, token, entity_uuid, items):
    async with session.begin():
        try:
            actor, entity = await monthly.authorize(
                session, token, entity_uuid, lock=True
            )
        except RejectionError as error:
            if error.status == 401:
                raise
            return [failure(item, error) for item in items]
        # Repeated IDs observe preceding writes (including retry and key reuse).
        # Distinct rows share a read of their source facts and retry identities.
        results = []
        group = {}
        for item in items:
            if item.item_id in group:
                results.extend(await distinct_items(session, actor, entity, group))
                group.clear()
            group[item.item_id] = item
        results.extend(await distinct_items(session, actor, entity, group))
        return results


async def distinct_items(session, actor, entity, group):
    entity_id = entity["id"]
    rows = (
        (
            await session.execute(
                inbox.item_view_query(
                    select(st.staged).where(
                        st.staged.c.entity_id == entity_id, st.staged.c.uuid.in_(group)
                    )
                )
            )
        )
        .mappings()
        .all()
    )
    splits = await inbox.item_splits(session, entity_id, rows)
    staged = {row["uuid"]: row for row in rows}
    previous = {
        (r.operation, r.request_key): r
        for r in await session.execute(
            select(m.outcomes).where(
                m.outcomes.c.entity_id == entity_id,
                m.outcomes.c.user_id == actor.user_id,
                tuple_(m.outcomes.c.operation, m.outcomes.c.request_key).in_(
                    [identity(i) for i in group.values()]
                ),
            )
        )
    }
    ready = []
    results = {}
    rejected = []
    for uuid, item in group.items():
        body = item.model_dump(mode="json", exclude={"item_id"})
        scope, key = identity(item)
        digest = monthly.request_digest(body)
        hook = inbox.RecordHook(
            uuid,
            item.expected_revision,
            inbox.completion_of(body["completion"]) if body["completion"] else None,
        )
        try:
            if cached := previous.get((scope, key)):
                if cached.request_hash != digest:
                    raise RejectionError(
                        "key_reuse",
                        "Request identity was already used with different input.",
                    )
                result = cached.response
            else:
                row = staged.get(uuid)
                if row is None:
                    raise RejectionError(
                        "record_not_found", "Record is unavailable in this Entity.", 404
                    )
                operation, payload, purchase = hook.prepare(row)
                if operation in {"create_giving_entry", "create_investment_entry"}:
                    payload["category"] = (
                        "giving" if operation == "create_giving_entry" else "investing"
                    )
                ready.append(
                    (
                        item,
                        {**payload, "purchase": purchase, "operation": operation},
                        digest,
                    )
                )
                continue
            results[uuid] = {"item_id": str(uuid), "ok": True, **result}
        except RejectionError as error:
            results[uuid] = failure(item, error)
            if hook.checked:
                rejected.append((staged[uuid]["id"], results[uuid]["error"]))
    if ready:
        await insert_entries(
            session, actor, entity_id, ready, staged, splits, results, rejected
        )
    if rejected:
        reasons = values(
            column("item_id", BigInteger), column("reason", JSONB), name="reasons"
        ).data(rejected)
        await session.execute(
            update(st.staged)
            .where(st.staged.c.id == reasons.c.item_id)
            .values(rejection=reasons.c.reason)
        )
    return [results[uuid] for uuid in group]


# For a new actual entry there are no prior assignments, tags or linked refunds
# to replace. Resolve only the references named in this group, under the lock.
ASSIGNMENTS = (
    ("investment_id", d.investments, d.investment_entries, "investment_id"),
    ("giving_recipient_id", d.recipients, d.giving_entries, "giving_recipient_id"),
    ("source_id", m.sources, m.assignments, "income_source_id"),
    ("fixed_cost_id", m.fixed_costs, m.fixed_cost_assignments, "fixed_cost_id"),
    (
        "spending_subcategory_id",
        m.spending_subcategories,
        m.spending_subcategory_assignments,
        "spending_subcategory_id",
    ),
)


async def insert_entries(
    session, actor, entity_id, ready, staged, splits, results, rejected
):
    async def references(table, uuids):
        if not uuids:
            return {}
        return {
            r.uuid: r
            for r in await session.execute(
                select(table).where(
                    table.c.entity_id == entity_id, table.c.uuid.in_(uuids)
                )
            )
        }

    assignments = {
        field: await references(table, {p[field] for _, p, _ in ready if p.get(field)})
        for field, table, _, _ in ASSIGNMENTS
    }
    tag_rows = await references(
        m.tags, {t for _, p, _ in ready for t in p.get("tag_ids") or []}
    )
    states = {
        uuid: tags.TagState(row.active, row.deleted_at is not None)
        for uuid, row in tag_rows.items()
    }
    investment_ids = [row.id for row in assignments["investment_id"].values()]
    opening_dates = (
        dict(
            (
                await session.execute(
                    select(
                        d.observations.c.investment_id, d.observations.c.financial_date
                    ).where(
                        d.observations.c.is_opening,
                        d.observations.c.investment_id.in_(investment_ids),
                    )
                )
            ).all()
        )
        if investment_ids
        else {}
    )
    purchases = await references(
        m.entries, {p["purchase"] for _, p, _ in ready if p["purchase"]}
    )
    purchase_ids = [row.id for row in purchases.values()]
    existing_refunds = defaultdict(list)
    purchase_goals = {}
    purchase_tags = defaultdict(list)
    if purchase_ids:
        for entry_id, tag, active, deleted in await session.execute(
            select(
                m.entry_tags.c.actual_entry_id,
                m.tags.c.uuid,
                m.tags.c.active,
                m.tags.c.deleted_at,
            )
            .join(m.tags, m.tags.c.id == m.entry_tags.c.tag_id)
            .where(m.entry_tags.c.actual_entry_id.in_(purchase_ids))
            .order_by(m.entry_tags.c.id)
        ):
            purchase_tags[entry_id].append(tag)
            states[tag] = tags.TagState(active, deleted is not None)
        for purchase_id, amount, day in await session.execute(
            select(
                r.refunds.c.original_entry_id,
                m.entries.c.amount,
                m.entries.c.financial_date,
            )
            .join(m.entries, m.entries.c.id == r.refunds.c.refund_entry_id)
            .where(
                r.refunds.c.original_entry_id.in_(purchase_ids),
                m.entries.c.deleted_at.is_(None),
            )
        ):
            existing_refunds[purchase_id].append(refunds.Refund(-amount, day))
        purchase_goals = dict(
            (
                await session.execute(
                    select(s.linked_activity.c.actual_entry_id, s.goals.c.uuid)
                    .join(s.goals, s.goals.c.id == s.linked_activity.c.goal_id)
                    .where(
                        s.linked_activity.c.actual_entry_id.in_(purchase_ids),
                        s.linked_activity.c.deleted_at.is_(None),
                    )
                )
            ).all()
        )
    goals = {}
    goals_needed = purchase_goals or any(
        p.get("saving_goal_id") or p.get("funding_goal_id") for _, p, _ in ready
    )
    if goals_needed:
        goal_rows, openings, events = await saving_service.saving_history(
            session, entity_id
        )
        goals = {row["uuid"]: row for row in goal_rows}
        # All new commands follow retained events on the same financial date.
        last_order = max((e.recording_order for e in events), default=0)
    accepted = {}
    for position, (item, p, digest) in enumerate(ready, 1):
        uuid = uuid4()
        try:
            amount = Decimal(p["amount"])
            goal_uuid = p.get("saving_goal_id") or p.get("funding_goal_id")
            purchase = purchases.get(p["purchase"])
            if p["purchase"]:
                if not purchase:
                    raise RejectionError(
                        "record_not_found", "Record is unavailable in this Entity.", 404
                    )
                if (
                    purchase.deleted_at
                    or purchase.category not in {"spending", "fixed_cost", "giving"}
                    or purchase.is_adjustment
                    or purchase.amount <= 0
                    or purchase.is_refund
                ):
                    raise RejectionError(
                        "not_purchase",
                        "Choose a current positive purchase or payment.",
                        422,
                    )
                earlier = existing_refunds[purchase.id]
                refund = refunds.Refund(amount, p["date"])
                try:
                    remaining = refunds.validate_refunds(
                        purchase.amount, purchase.financial_date, [*earlier, refund]
                    )
                except ValueError as error:
                    refund_service.reject(
                        error,
                        remaining_refundable=purchase.amount
                        - sum(x.amount for x in earlier),
                    )
                category = purchase.category
                amount = -amount
                goal_uuid = purchase_goals.get(purchase.id)
                tags.entry_tags(purchase_tags[purchase.id], [], states)
            else:
                category = p["category"]
            entry = dict(
                uuid=uuid,
                entity_id=entity_id,
                financial_date=p["date"],
                category=category,
                amount=amount,
                note=p["note"],
                is_refund=bool(purchase),
            )
            chosen = tags.entry_tags(p.get("tag_ids") or [], [], states)
            assignment = None
            for field, _, link, fk in ASSIGNMENTS:
                if not p.get(field):
                    continue
                ref = assignments[field].get(p[field])
                if field == "spending_subcategory_id":
                    if not ref:
                        raise RejectionError(
                            "spending_subcategory_not_found",
                            "Subcategory is unavailable.",
                            404,
                        )
                    subcategories.check_assignment(
                        p["category"], active=ref.active, kept=False
                    )
                if not ref:
                    raise RejectionError(
                        "record_not_found", "Record is unavailable in this Entity.", 404
                    )
                if field in {"investment_id", "giving_recipient_id"}:
                    try:
                        destinations.require_new_destination(ref.active)
                    except ValueError as error:
                        raise RejectionError(
                            "inactive_destination", str(error), 422
                        ) from None
                    if field == "investment_id":
                        try:
                            destinations.opening_date_allowed(
                                opening_dates.get(ref.id), p["date"]
                            )
                        except ValueError as error:
                            raise RejectionError(
                                "before_opening", str(error), 422
                            ) from None
                assignment = (
                    link,
                    {
                        fk: ref.id,
                        **({"name": ref.name} if field == "fixed_cost_id" else {}),
                    },
                )
            if goal_uuid:
                goal = goals.get(goal_uuid)
                if not goal:
                    raise RejectionError(
                        "record_not_found", "Record is unavailable in this Entity.", 404
                    )
                saving_service.check_goal_link(
                    goal, goal["account_active"], goal["opening_date"], entry
                )
                event = savings.SavingEvent(
                    p["date"],
                    last_order + position,
                    str(goal_uuid),
                    amount if category == "saving" else -amount,
                    category == "saving",
                )
                try:
                    savings.replay_savings(openings, [*events, event])
                except savings.SavingsShortfallError as error:
                    raise RejectionError("savings_shortfall", str(error), 422) from None
                events.append(event)
        except (
            RejectionError,
            tags.TagRejectionError,
            subcategories.SubcategoryRejectionError,
        ) as exc:
            error = (
                tag_service.rejection(exc)
                if isinstance(exc, tags.TagRejectionError)
                else subcategory_service.rejection(exc)
                if isinstance(exc, subcategories.SubcategoryRejectionError)
                else exc
            )
            results[item.item_id] = failure(item, error)
            rejected.append(
                (staged[item.item_id]["id"], results[item.item_id]["error"])
            )
            continue
        links = []
        if assignment:
            table, fields = assignment
            links.append((table, fields))
        if purchase:
            existing_refunds[purchase.id].append(refund)
        for tag in chosen:
            links.append((m.entry_tags, {"tag_id": tag_rows[tag].id}))
        accepted[uuid] = AcceptedEntry(
            item,
            digest,
            p["operation"],
            entry,
            links,
            goals.get(goal_uuid),
            (purchase.id, remaining) if purchase else None,
        )
    if accepted:
        await persist_entries(
            session, actor, entity_id, accepted, staged, splits, results
        )


async def persist_entries(session, actor, entity_id, accepted, staged, splits, results):
    """Write only validated rows; correlate RETURNING by UUID, never row order."""
    entries = [e.values for e in accepted.values()]
    records = (
        (await session.execute(insert(m.entries).values(entries).returning(m.entries)))
        .mappings()
        .all()
    )
    ids = {r["uuid"]: r["id"] for r in records}
    links = defaultdict(list)
    for uuid, e in accepted.items():
        for table, fields in e.links:
            links[table].append(
                dict(actual_entry_id=ids[uuid], entity_id=entity_id, **fields)
            )
    for table, rows in links.items():
        await session.execute(insert(table).values(rows))
    written = values(
        column("item_id", BigInteger), column("entry_id", BigInteger), name="written"
    ).data([(staged[e.item.item_id]["id"], ids[uuid]) for uuid, e in accepted.items()])
    await session.execute(
        update(st.staged)
        .where(st.staged.c.id == written.c.item_id)
        .values(
            status="recorded",
            actual_entry_id=written.c.entry_id,
            rejection=None,
            revision=st.staged.c.revision + 1,
        )
    )
    audits = []
    outcomes = []
    by_id = {ids[uuid]: e for uuid, e in accepted.items()}

    async def audited_links(table, rows, entry_key):
        for row in (
            await session.execute(insert(table).values(rows).returning(table))
        ).mappings():
            e = by_id[row[entry_key]]
            audits.append(
                monthly.audit_values(
                    entity_id,
                    actor,
                    inbox.INTERFACE,
                    e.operation,
                    table,
                    row["uuid"],
                    e.action,
                    None,
                    dict(row),
                )
            )

    if any(e.goal for e in accepted.values()):
        await audited_links(
            s.linked_activity,
            [
                dict(
                    entity_id=entity_id,
                    account_id=goal["account_id"],
                    goal_id=goal["id"],
                    actual_entry_id=rec["id"],
                    financial_date=rec["financial_date"],
                    recording_order=rec["recording_order"],
                )
                for rec in records
                if (goal := accepted[rec["uuid"]].goal)
            ],
            "actual_entry_id",
        )
    refunded = {uuid: e.refund for uuid, e in accepted.items() if e.refund}
    if refunded:
        await audited_links(
            r.refunds,
            [
                dict(
                    entity_id=entity_id,
                    original_entry_id=orig,
                    refund_entry_id=ids[uuid],
                )
                for uuid, (orig, _) in refunded.items()
            ],
            "refund_entry_id",
        )
        # Copy retained associations, even if their targets are now archived.
        pairs = values(
            column("original", BigInteger), column("refund", BigInteger), name="pairs"
        ).data([(orig, ids[uuid]) for uuid, (orig, _) in refunded.items()])
        for table, fields in (
            (m.entry_tags, ["tag_id"]),
            (m.fixed_cost_assignments, ["fixed_cost_id", "name"]),
            (b.entry_debts, ["debt_account_id"]),
            (d.giving_entries, ["giving_recipient_id"]),
            (m.spending_subcategory_assignments, ["spending_subcategory_id"]),
        ):
            columns = [table.c[k] for k in fields]
            await session.execute(
                insert(table).from_select(
                    ["uuid", "entity_id", "actual_entry_id", *fields],
                    select(
                        func.gen_random_uuid(),
                        table.c.entity_id,
                        pairs.c.refund,
                        *columns,
                    )
                    .join_from(
                        table, pairs, table.c.actual_entry_id == pairs.c.original
                    )
                    .order_by(table.c.id),
                )
            )
    for record, entry in zip(
        records, await monthly.entry_snapshots(session, records), strict=True
    ):
        e = accepted[record["uuid"]]
        item, digest, action, operation = e.item, e.digest, e.action, e.operation
        if record["uuid"] in refunded:
            entry["remaining_refundable"] = str(refunded[record["uuid"]][1])
        if action in {"create_investment_entry", "create_giving_entry"}:
            field = (
                "investment_id"
                if action == "create_investment_entry"
                else "giving_recipient_id"
            )
            entry = {
                k: entry[k]
                for k in (
                    "uuid",
                    "financial_date",
                    "category",
                    "amount",
                    "note",
                    "is_adjustment",
                    "is_refund",
                    "revision",
                    field,
                    "funding_origin",
                    "funding_goal_id",
                    "tag_ids",
                )
            }
        row = staged[item.item_id]
        before = inbox.joined_item(row, splits)
        after = {
            **before,
            "status": "recorded",
            "revision": before["revision"] + 1,
            "actual_entry_id": entry["uuid"],
            "rejection": None,
        }
        audits.extend(
            [
                monthly.audit_values(
                    entity_id,
                    actor,
                    inbox.INTERFACE,
                    operation,
                    m.entries,
                    record["uuid"],
                    action,
                    None,
                    entry,
                ),
                monthly.audit_values(
                    entity_id,
                    actor,
                    inbox.INTERFACE,
                    operation,
                    st.staged,
                    item.item_id,
                    "inbox_record",
                    before,
                    after,
                ),
            ]
        )
        result = {
            "item": after,
            "entry": {
                **entry,
                "inbox_source": {
                    "source_id": after["source_id"],
                    "source_ref": after["source_ref"],
                },
            },
        }
        scope, key = identity(item)
        outcomes.append(
            dict(
                entity_id=entity_id,
                user_id=actor.user_id,
                operation=scope,
                request_key=key,
                request_hash=digest,
                response=result,
            )
        )
        results[item.item_id] = {"item_id": str(item.item_id), "ok": True, **result}
    await session.execute(insert(m.audit).values(audits))
    await session.execute(insert(m.outcomes).values(outcomes))
