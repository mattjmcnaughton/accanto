"""Spending alerts (TDD 23): rules, this month's progress, dismissals and pushes.

A rule's percentage reads the Plan version Home compares against: the month's
Review version, or without a Review the latest saved version. Recorded amounts
sum the month's entries as the Review does (refunds included, deleted excluded),
in the Entity time zone's current month. Writes run inside services.monthly.write
under the Entity lock, with retry identity and audit, like Routines.
"""

from datetime import UTC, date, datetime
from decimal import Decimal

from sqlalchemy import delete, func, insert, select, update
from sqlalchemy.dialects.postgresql import insert as upsert

from accanto.db import read_snapshot
from accanto.domains import spending_alerts as rules
from accanto.domains.entity import entity_today
from accanto.models import monthly as m
from accanto.models import spending_alerts as sa
from accanto.services.access import RejectionError
from accanto.services.monthly import authorize, check_revision, json_values, scoped

CATEGORY_ORDER = {"spending": 0, "fixed_cost": 1}


def clock() -> datetime:
    """Now; tests replace it to read a chosen month."""
    return datetime.now(UTC)


def month_of(today: date) -> date:
    return today.replace(day=1)


def _rejection(error: rules.AlertRejectionError) -> RejectionError:
    return RejectionError(error.code, str(error), 422)


async def _targets(session, entity_id) -> tuple[dict, dict]:
    """Every subcategory and fixed cost of the Entity by id: (uuid, name)."""
    subcategories = {
        row.id: (row.uuid, row.name)
        for row in await session.execute(
            select(
                m.spending_subcategories.c.id,
                m.spending_subcategories.c.uuid,
                m.spending_subcategories.c.name,
            ).where(m.spending_subcategories.c.entity_id == entity_id)
        )
    }
    fixed = {
        row.id: (row.uuid, row.name)
        for row in await session.execute(
            select(
                m.fixed_costs.c.id, m.fixed_costs.c.uuid, m.fixed_costs.c.name
            ).where(m.fixed_costs.c.entity_id == entity_id)
        )
    }
    return subcategories, fixed


def _rule_view(row, subcategories, fixed) -> dict:
    subcategory = subcategories.get(row["spending_subcategory_id"])
    cost = fixed.get(row["fixed_cost_id"])
    named = subcategory or cost
    return {
        "uuid": str(row["uuid"]),
        "category": row["category"],
        "spending_subcategory_id": str(subcategory[0]) if subcategory else None,
        "fixed_cost_id": str(cost[0]) if cost else None,
        "name": named[1] if named else rules.TYPE_NAMES[row["category"]],
        "thresholds": list(row["thresholds"]),
        "revision": row["revision"],
    }


async def plan_version(session, entity_id, month: date):
    """The month's Review version, else the latest saved version; None without."""
    linked = select(m.reviews.c.plan_revision_id).where(
        m.reviews.c.entity_id == entity_id, m.reviews.c.month == month
    )
    query = select(m.revisions).where(m.revisions.c.entity_id == entity_id)
    row = (
        (
            await session.execute(
                query.where(m.revisions.c.id == linked.scalar_subquery())
            )
        )
        .mappings()
        .first()
    )
    if row is None:
        row = (
            (
                await session.execute(
                    query.where(m.revisions.c.saved)
                    .order_by(
                        m.revisions.c.saved_at.desc().nulls_last(),
                        m.revisions.c.id.desc(),
                    )
                    .limit(1)
                )
            )
            .mappings()
            .first()
        )
    return row


async def _amounts(session, version) -> dict:
    """The Plan amount each target reads, keyed (category, subcategory, cost)."""
    if version is None:
        return {}
    amounts: dict = {
        ("spending", None, None): version["spending"],
        ("fixed_cost", None, None): version["fixed_cost_total"],
    }
    for subcategory, amount in await session.execute(
        select(
            m.spending_estimate_lines.c.spending_subcategory_id,
            m.spending_estimate_lines.c.amount,
        ).where(m.spending_estimate_lines.c.plan_revision_id == version["id"])
    ):
        amounts[("spending", subcategory, None)] = amount
    for cost, amount in await session.execute(
        select(
            m.fixed_cost_lines.c.fixed_cost_id,
            func.sum(m.fixed_cost_lines.c.monthly_amount),
        )
        .where(m.fixed_cost_lines.c.plan_revision_id == version["id"])
        .group_by(m.fixed_cost_lines.c.fixed_cost_id)
    ):
        amounts[("fixed_cost", None, cost)] = amount
    return amounts


async def _recorded(session, entity_id, month: date) -> dict:
    """The month's recorded amounts per target; a target with no entry is absent."""
    end = date(month.year + (month.month == 12), month.month % 12 + 1, 1)
    rows = await session.execute(
        select(
            m.entries.c.category,
            m.spending_subcategory_assignments.c.spending_subcategory_id,
            m.fixed_cost_assignments.c.fixed_cost_id,
            func.sum(m.entries.c.amount),
        )
        .outerjoin(
            m.spending_subcategory_assignments,
            m.spending_subcategory_assignments.c.actual_entry_id == m.entries.c.id,
        )
        .outerjoin(
            m.fixed_cost_assignments,
            m.fixed_cost_assignments.c.actual_entry_id == m.entries.c.id,
        )
        .where(
            m.entries.c.entity_id == entity_id,
            m.entries.c.deleted_at.is_(None),
            m.entries.c.category.in_(("spending", "fixed_cost")),
            m.entries.c.financial_date >= month,
            m.entries.c.financial_date < end,
        )
        .group_by(
            m.entries.c.category,
            m.spending_subcategory_assignments.c.spending_subcategory_id,
            m.fixed_cost_assignments.c.fixed_cost_id,
        )
    )
    totals: dict = {}
    for category, subcategory, cost, amount in rows:
        keys = [(category, None, None)]
        if subcategory is not None:
            keys.append((category, subcategory, None))
        if cost is not None:
            keys.append((category, None, cost))
        for key in keys:
            totals[key] = totals.get(key, Decimal("0.00")) + amount
    return totals


async def _rows(session, entity_id):
    return (
        (
            await session.execute(
                select(sa.alerts)
                .where(sa.alerts.c.entity_id == entity_id)
                .order_by(sa.alerts.c.id)
            )
        )
        .mappings()
        .all()
    )


async def progress(session, entity_id, today: date) -> dict:
    """Every rule with this month's amount, recorded, percentage and threshold."""
    month = month_of(today)
    version = await plan_version(session, entity_id, month)
    amounts = await _amounts(session, version)
    recorded = await _recorded(session, entity_id, month)
    subcategories, fixed = await _targets(session, entity_id)
    alerts: list[dict] = []
    for row in await _rows(session, entity_id):
        key = (row["category"], row["spending_subcategory_id"], row["fixed_cost_id"])
        kind = rules.basis(row["category"], row["spending_subcategory_id"] is not None)
        amount = amounts.get(key)
        spent = recorded.get(key)
        percent = rules.percent_used(spent, amount) if spent is not None else None
        waiting = (
            "no_plan_version"
            if version is None
            else "no_estimate"
            if kind == "estimate" and not amount
            else "not_planned"
            if not amount
            else None
        )
        alerts.append(
            {
                **_rule_view(row, subcategories, fixed),
                "id": row["id"],
                "basis": kind,
                "amount": amount,
                "recorded": spent,
                "percent": percent,
                "reached": rules.reached(list(row["thresholds"]), percent),
                "waiting": waiting,
            }
        )
    alerts.sort(
        key=lambda a: (
            CATEGORY_ORDER[a["category"]],
            a["spending_subcategory_id"] is not None or a["fixed_cost_id"] is not None,
            a["name"].lower(),
        )
    )
    return {
        "month": month.isoformat()[:7],
        "version": None
        if version is None
        else {
            "uuid": str(version["uuid"]),
            "name": version["name"],
            "number": version["number"],
        },
        "spending_alerts": alerts,
    }


async def _dismissed(session, user_id, month: date) -> set:
    rows = await session.execute(
        select(sa.notices.c.spending_alert_id, sa.notices.c.threshold).where(
            sa.notices.c.user_id == user_id,
            sa.notices.c.month == month,
            sa.notices.c.dismissed_at.is_not(None),
        )
    )
    return {tuple(row) for row in rows}


def _public(view: dict, dismissed: set) -> dict:
    alert = {k: v for k, v in view.items() if k != "id"}
    alert["dismissed"] = (view["id"], view["reached"]) in dismissed
    return alert


async def read_alerts(session, token, entity_uuid) -> dict:
    async with read_snapshot(session):
        actor, entity = await authorize(session, token, entity_uuid, lock=False)
        today = entity_today(clock(), entity["time_zone"])
        result = await progress(session, entity["id"], today)
        dismissed = await _dismissed(session, actor.user_id, month_of(today))
        result["spending_alerts"] = [
            _public(a, dismissed) for a in result["spending_alerts"]
        ]
        return json_values(result)


async def dismiss(session, token, entity_uuid, alert_uuid) -> dict:
    """Hide an alert on Home for this User until its next threshold or month."""
    async with session.begin():
        actor, entity = await authorize(session, token, entity_uuid, lock=False)
        row = await scoped(session, sa.alerts, entity["id"], alert_uuid)
        today = entity_today(clock(), entity["time_zone"])
        result = await progress(session, entity["id"], today)
        view = next(a for a in result["spending_alerts"] if a["id"] == row["id"])
        if view["reached"] is None:
            raise RejectionError(
                "spending_alert_not_reached",
                "This alert has not reached a threshold this month.",
                409,
            )
        await session.execute(
            upsert(sa.notices)
            .values(
                user_id=actor.user_id,
                spending_alert_id=row["id"],
                month=month_of(today),
                threshold=view["reached"],
                dismissed_at=func.now(),
            )
            .on_conflict_do_update(
                index_elements=["user_id", "spending_alert_id", "month", "threshold"],
                set_={"dismissed_at": func.now()},
            )
        )
        dismissed = await _dismissed(session, actor.user_id, month_of(today))
        return json_values(_public(view, dismissed))


async def _stored(session, entity_id, row) -> dict:
    subcategories, fixed = await _targets(session, entity_id)
    return _rule_view(row, subcategories, fixed)


async def write_alert(session, entity, operation, payload, target, audit):
    """Create, edit or delete a rule; the caller owns lock, retry and commit."""
    if operation != "delete_spending_alert":
        try:
            chosen = rules.thresholds(payload["thresholds"])
        except rules.AlertRejectionError as error:
            raise _rejection(error) from None
    if operation == "create_spending_alert":
        if payload.get("expected_revision") is not None:
            raise RejectionError(
                "unexpected_revision", "A new alert has no prior revision."
            )
        values = {"category": payload["category"]}
        if payload.get("spending_subcategory_id"):
            subcategory = await scoped(
                session,
                m.spending_subcategories,
                entity["id"],
                payload["spending_subcategory_id"],
            )
            if not subcategory["active"]:
                raise RejectionError(
                    "invalid_spending_alert",
                    "This subcategory is archived; restore it first.",
                    422,
                )
            values["spending_subcategory_id"] = subcategory["id"]
        if payload.get("fixed_cost_id"):
            cost = await scoped(
                session, m.fixed_costs, entity["id"], payload["fixed_cost_id"]
            )
            values["fixed_cost_id"] = cost["id"]
        existing = await session.scalar(
            select(sa.alerts.c.id).where(
                sa.alerts.c.entity_id == entity["id"],
                sa.alerts.c.category == values["category"],
                sa.alerts.c.spending_subcategory_id.is_not_distinct_from(
                    values.get("spending_subcategory_id")
                ),
                sa.alerts.c.fixed_cost_id.is_not_distinct_from(
                    values.get("fixed_cost_id")
                ),
            )
        )
        if existing is not None:
            raise RejectionError(
                "spending_alert_exists",
                "This already has a spending alert; edit its thresholds instead.",
                409,
            )
        row = (
            (
                await session.execute(
                    insert(sa.alerts)
                    .values(entity_id=entity["id"], thresholds=chosen, **values)
                    .returning(sa.alerts)
                )
            )
            .mappings()
            .one()
        )
        after = await _stored(session, entity["id"], row)
        await audit(sa.alerts, row["uuid"], None, after)
        return after
    row = await scoped(session, sa.alerts, entity["id"], target)
    check_revision(row, payload["expected_revision"])
    before = await _stored(session, entity["id"], row)
    if operation == "delete_spending_alert":
        await session.execute(delete(sa.alerts).where(sa.alerts.c.id == row["id"]))
        after = {**before, "deleted": True}
        await audit(sa.alerts, row["uuid"], before, after)
        return after
    row = (
        (
            await session.execute(
                update(sa.alerts)
                .where(sa.alerts.c.id == row["id"])
                .values(thresholds=chosen, revision=row["revision"] + 1)
                .returning(sa.alerts)
            )
        )
        .mappings()
        .one()
    )
    after = await _stored(session, entity["id"], row)
    await audit(sa.alerts, row["uuid"], before, after)
    return after


async def claim_pushes(session, entity_id, user_id, today: date):
    """Claim this month's newly reached thresholds for one User before delivery.

    Returns the (name, threshold, basis) to push, highest reached per rule, and
    the claimed keys for recording the outcome. A threshold already pushed this
    month, by this or an overlapping tick, is never claimed again.
    """
    month = month_of(today)
    result = await progress(session, entity_id, today)
    pushed: dict = {}
    for alert_id, threshold in await session.execute(
        select(sa.notices.c.spending_alert_id, sa.notices.c.threshold).where(
            sa.notices.c.user_id == user_id,
            sa.notices.c.month == month,
            sa.notices.c.pushed_at.is_not(None),
        )
    ):
        pushed.setdefault(alert_id, set()).add(threshold)
    items, keys = [], []
    for alert in result["spending_alerts"]:
        due = rules.to_push(
            alert["thresholds"], alert["percent"], pushed.get(alert["id"], set())
        )
        claimed = []
        for threshold in due:
            stmt = upsert(sa.notices).values(
                user_id=user_id,
                spending_alert_id=alert["id"],
                month=month,
                threshold=threshold,
                pushed_at=func.now(),
                outcome="pending",
            )
            won = await session.scalar(
                stmt.on_conflict_do_update(
                    index_elements=[
                        "user_id",
                        "spending_alert_id",
                        "month",
                        "threshold",
                    ],
                    set_={"pushed_at": func.now(), "outcome": "pending"},
                    where=sa.notices.c.pushed_at.is_(None),
                ).returning(sa.notices.c.threshold)
            )
            if won is not None:
                claimed.append(won)
        if claimed:
            items.append((alert["name"], alert["reached"], alert["basis"]))
            keys += [(alert["id"], t) for t in claimed]
    return items, keys


async def record_outcome(session, user_id, today: date, keys, outcome: str) -> None:
    for alert_id, threshold in keys:
        await session.execute(
            update(sa.notices)
            .where(
                sa.notices.c.user_id == user_id,
                sa.notices.c.spending_alert_id == alert_id,
                sa.notices.c.month == month_of(today),
                sa.notices.c.threshold == threshold,
            )
            .values(outcome=outcome)
        )
