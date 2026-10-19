"""Savings commands under the shared authorized Entity transaction."""

from datetime import UTC, date, datetime
from decimal import Decimal

from sqlalchemy import insert, select, update

from accanto.domains.savings import (
    SavingEvent,
    SavingsShortfallError,
    archive_allowed,
    completion_amount,
    funded_status,
    goal_target,
    movement_events,
    opening_change_allowed,
    opening_designations,
    reconciliation_delta,
    replay_savings,
    restored_goal_active,
)
from accanto.models import monthly as m
from accanto.models import savings as s
from accanto.services.access import RejectionError
from accanto.services.monthly import authorize, check_revision, scoped


def invalid(error: ValueError):
    raise RejectionError("invalid_savings", str(error), 422) from None


async def current_link(session, entry_id):
    return (
        (
            await session.execute(
                select(s.linked_activity).where(
                    s.linked_activity.c.actual_entry_id == entry_id,
                    s.linked_activity.c.deleted_at.is_(None),
                )
            )
        )
        .mappings()
        .first()
    )


async def saving_facts(session, entity_id, *, as_of=None, excluded_adjustment_id=None):
    goals = (
        (
            await session.execute(
                select(
                    s.goals,
                    s.accounts.c.opening_date,
                    s.accounts.c.active.label("account_active"),
                )
                .join(s.accounts, s.accounts.c.id == s.goals.c.account_id)
                .where(s.goals.c.entity_id == entity_id)
            )
        )
        .mappings()
        .all()
    )
    links = (
        (
            await session.execute(
                select(
                    s.linked_activity,
                    m.entries.c.category,
                    m.entries.c.amount,
                    m.entries.c.deleted_at.label("entry_deleted_at"),
                )
                .join(m.entries, m.entries.c.id == s.linked_activity.c.actual_entry_id)
                .where(
                    s.linked_activity.c.entity_id == entity_id,
                    s.linked_activity.c.deleted_at.is_(None),
                    m.entries.c.deleted_at.is_(None),
                )
            )
        )
        .mappings()
        .all()
    )
    openings = {str(goal["uuid"]): goal["opening_amount"] for goal in goals}
    goal_ids = {goal["id"]: str(goal["uuid"]) for goal in goals}
    events = [
        SavingEvent(
            link["financial_date"],
            link["recording_order"],
            goal_ids[link["goal_id"]],
            link["amount"] if link["category"] == "saving" else -link["amount"],
            link["category"] == "saving",
        )
        for link in links
    ]
    for table in (s.reassignments, s.transfers):
        rows = (
            (
                await session.execute(
                    select(table).where(
                        table.c.entity_id == entity_id, table.c.deleted_at.is_(None)
                    )
                )
            )
            .mappings()
            .all()
        )
        for row in rows:
            events.extend(
                movement_events(
                    row["financial_date"],
                    row["recording_order"],
                    goal_ids[row["from_goal_id"]],
                    goal_ids[row["to_goal_id"]],
                    row["amount"],
                )
            )
    adjustments = (
        (
            await session.execute(
                select(s.adjustments).where(
                    s.adjustments.c.entity_id == entity_id,
                    s.adjustments.c.deleted_at.is_(None),
                )
            )
        )
        .mappings()
        .all()
    )
    events.extend(
        SavingEvent(
            row["financial_date"],
            row["recording_order"],
            goal_ids[row["goal_id"]],
            row["amount"],
            False,
        )
        for row in adjustments
        if row["id"] != excluded_adjustment_id
    )
    if as_of is not None:
        events = [
            event
            for event in events
            if (event.financial_date, event.recording_order) < as_of
        ]
    try:
        balances, contributions = replay_savings(openings, events)
    except SavingsShortfallError as error:
        raise RejectionError("savings_shortfall", str(error), 422) from None
    return goals, balances, contributions


async def attach_entry(
    session, entity, entry, previous_link, goal_uuid, audit, previous_category=None
):
    """Retain prior associations and preserve order while changing an entry."""
    goal = None
    account = None
    if goal_uuid is not None:
        goal = await scoped(session, s.goals, entity["id"], goal_uuid)
        account = (
            (
                await session.execute(
                    select(s.accounts).where(s.accounts.c.id == goal["account_id"])
                )
            )
            .mappings()
            .one()
        )
        if not account["active"]:
            raise RejectionError(
                "archived_account", "Reopen the savings account first."
            )
        if entry["financial_date"] < account["opening_date"]:
            raise RejectionError(
                "before_opening",
                "Savings activity cannot precede the account opening date.",
                422,
            )
        if (
            goal["completed"]
            and not entry["is_refund"]
            and (previous_link is None or previous_link["goal_id"] != goal["id"])
        ):
            raise RejectionError(
                "completed_goal", "Completed goals accept linked refunds only.", 422
            )
        # Corrections may retain an inactive goal, but new contributions may not.
        if (
            entry["category"] == "saving"
            and not goal["active"]
            and (
                previous_link is None
                or previous_link["goal_id"] != goal["id"]
                or previous_category != "saving"
            )
        ):
            raise RejectionError("inactive_goal", "Choose an active saving goal.")
    if previous_link:
        previous_account = (
            await session.execute(
                select(s.accounts.c.active).where(
                    s.accounts.c.id == previous_link["account_id"]
                )
            )
        ).scalar_one()
        if not previous_account:
            raise RejectionError(
                "archived_account", "Reopen the original savings account first."
            )
    if previous_link and goal and previous_link["goal_id"] == goal["id"]:
        if previous_link["financial_date"] != entry["financial_date"]:
            changed = (
                (
                    await session.execute(
                        update(s.linked_activity)
                        .where(s.linked_activity.c.id == previous_link["id"])
                        .values(financial_date=entry["financial_date"])
                        .returning(s.linked_activity)
                    )
                )
                .mappings()
                .one()
            )
            await audit(
                s.linked_activity, changed["uuid"], dict(previous_link), dict(changed)
            )
    else:
        if previous_link:
            changed = (
                (
                    await session.execute(
                        update(s.linked_activity)
                        .where(s.linked_activity.c.id == previous_link["id"])
                        .values(deleted_at=datetime.now(UTC))
                        .returning(s.linked_activity)
                    )
                )
                .mappings()
                .one()
            )
            await audit(
                s.linked_activity, changed["uuid"], dict(previous_link), dict(changed)
            )
        if goal:
            assert account is not None
            values = dict(
                entity_id=entity["id"],
                account_id=account["id"],
                goal_id=goal["id"],
                actual_entry_id=entry["id"],
                financial_date=entry["financial_date"],
                recording_order=entry["recording_order"],
            )
            link = (
                (
                    await session.execute(
                        insert(s.linked_activity)
                        .values(**values)
                        .returning(s.linked_activity)
                    )
                )
                .mappings()
                .one()
            )
            await audit(s.linked_activity, link["uuid"], None, dict(link))
    await saving_facts(session, entity["id"])


async def snapshot(session, account):
    rows = (
        (
            await session.execute(
                select(s.goals)
                .where(s.goals.c.account_id == account["id"])
                .order_by(s.goals.c.id)
            )
        )
        .mappings()
        .all()
    )
    _, balances, contributions = await saving_facts(session, account["entity_id"])
    goals = [
        {
            "uuid": str(row["uuid"]),
            "name": row["name"],
            "role": row["role"],
            "kind": row["kind"],
            "target": str(row["target"]) if row["target"] is not None else None,
            "opening_amount": str(row["opening_amount"]),
            "remaining_saved": str(balances[str(row["uuid"])]),
            "contribution_progress": str(contributions[str(row["uuid"])]),
            "funded_status": funded_status(balances[str(row["uuid"])], row["target"]),
            "revision": row["revision"],
            "active": row["active"],
            "completed": row["completed"],
            "archived_by_account": row["archived_by_account"],
        }
        for row in rows
    ]
    return {
        "uuid": str(account["uuid"]),
        "name": account["name"],
        "opening_date": account["opening_date"].isoformat(),
        "opening_amount": str(account["opening_amount"]),
        "balance": str(
            sum((balances[str(row["uuid"])] for row in rows), Decimal("0.00"))
        ),
        "revision": account["revision"],
        "active": account["active"],
        "goals": goals,
    }


async def read_accounts(session, token, entity_uuid):
    async with session.begin():
        _, entity = await authorize(session, token, entity_uuid, lock=True)
        rows = (
            (
                await session.execute(
                    select(s.accounts)
                    .where(s.accounts.c.entity_id == entity["id"])
                    .order_by(s.accounts.c.id)
                )
            )
            .mappings()
            .all()
        )
        return [await snapshot(session, row) for row in rows]


async def read_account(session, token, entity_uuid, account_uuid):
    async with session.begin():
        _, entity = await authorize(session, token, entity_uuid, lock=True)
        return await snapshot(
            session, await scoped(session, s.accounts, entity["id"], account_uuid)
        )


def movement_result(row, kind, goal_ids):
    result = {
        "uuid": str(row["uuid"]),
        "kind": kind,
        "date": row["financial_date"].isoformat(),
        "amount": str(row["amount"]),
        "note": row["note"],
        "revision": row["revision"],
    }
    if kind == "reconciliation":
        result["goal_id"] = goal_ids[row["goal_id"]]
    else:
        result["from_goal_id"] = goal_ids[row["from_goal_id"]]
        result["to_goal_id"] = goal_ids[row["to_goal_id"]]
    return result


async def read_movements(session, token, entity_uuid):
    async with session.begin():
        _, entity = await authorize(session, token, entity_uuid, lock=True)
        goals = (
            await session.execute(
                select(s.goals.c.id, s.goals.c.uuid).where(
                    s.goals.c.entity_id == entity["id"]
                )
            )
        ).all()
        goal_ids = {id_: str(uuid) for id_, uuid in goals}
        records = []
        for kind, table in (
            ("reassignment", s.reassignments),
            ("transfer", s.transfers),
            ("reconciliation", s.adjustments),
        ):
            rows = (
                (
                    await session.execute(
                        select(table).where(
                            table.c.entity_id == entity["id"],
                            table.c.deleted_at.is_(None),
                        )
                    )
                )
                .mappings()
                .all()
            )
            records.extend(
                (
                    row["financial_date"],
                    row["recording_order"],
                    movement_result(row, kind, goal_ids),
                )
                for row in rows
            )
        return [result for _, _, result in sorted(records)]


async def goal_for_movement(session, entity_id, goal_uuid, financial_date):
    goal = await scoped(session, s.goals, entity_id, goal_uuid)
    account = (
        (
            await session.execute(
                select(s.accounts).where(s.accounts.c.id == goal["account_id"])
            )
        )
        .mappings()
        .one()
    )
    if not account["active"]:
        raise RejectionError(
            "archived_account", "Reopen the savings account first.", 422
        )
    if financial_date < account["opening_date"]:
        raise RejectionError(
            "before_opening",
            "Savings activity cannot precede the account opening date.",
            422,
        )
    return goal, account


async def write_movement(session, entity, operation, payload, target, audit):
    kind = payload["kind"]
    tables = {
        "reassignment": s.reassignments,
        "transfer": s.transfers,
        "reconciliation": s.adjustments,
    }
    table = tables[kind]
    old = None
    if operation != "create_savings_movement":
        old = await scoped(session, table, entity["id"], target)
        if old["deleted_at"] is not None:
            raise RejectionError("record_not_found", "Movement is deleted.", 404)
        check_revision(old, payload["expected_revision"])
        if kind == "reassignment" and old["completion_goal_id"] is not None:
            raise RejectionError(
                "completion_movement",
                "Completion returns are retained with the completed goal "
                "and cannot be changed independently.",
                422,
            )
        old_goal_ids = (
            [old["goal_id"]]
            if kind == "reconciliation"
            else [old["from_goal_id"], old["to_goal_id"]]
        )
        old_accounts = (
            (
                await session.execute(
                    select(s.accounts.c.active)
                    .join(s.goals, s.goals.c.account_id == s.accounts.c.id)
                    .where(s.goals.c.id.in_(old_goal_ids))
                )
            )
            .scalars()
            .all()
        )
        if not all(old_accounts):
            raise RejectionError(
                "archived_account", "Reopen the original savings account first.", 422
            )
    if operation == "delete_savings_movement":
        # Deletion can expose a later shortfall at either former endpoint.
        assert old is not None
        changed = (
            (
                await session.execute(
                    update(table)
                    .where(table.c.id == old["id"])
                    .values(deleted_at=datetime.now(UTC), revision=old["revision"] + 1)
                    .returning(table)
                )
            )
            .mappings()
            .one()
        )
    else:
        when = date.fromisoformat(payload["date"])
        values = {"financial_date": when, "note": payload["note"]}
        if kind == "reconciliation":
            goal, _ = await goal_for_movement(
                session, entity["id"], payload["goal_id"], when
            )
            if not goal["active"] and (old is None or old["goal_id"] != goal["id"]):
                raise RejectionError(
                    "inactive_goal", "Choose an active saving goal.", 422
                )
            # Compare with the position immediately before this ordered correction.
            cutoff = (when, old["recording_order"] if old else 2**63 - 1)
            _, balances, _ = await saving_facts(
                session,
                entity["id"],
                as_of=cutoff,
                excluded_adjustment_id=old["id"] if old else None,
            )
            remaining = balances[str(goal["uuid"])]
            amount = reconciliation_delta(payload["known_amount"], remaining)
            if amount == 0:
                raise RejectionError(
                    "no_correction",
                    "Known amount already matches recorded savings.",
                    422,
                )
            values.update(goal_id=goal["id"], amount=amount)
        else:
            source, source_account = await goal_for_movement(
                session, entity["id"], payload["from_goal_id"], when
            )
            destination, destination_account = await goal_for_movement(
                session, entity["id"], payload["to_goal_id"], when
            )
            if source["id"] == destination["id"]:
                raise RejectionError(
                    "same_goal", "Choose different source and destination goals.", 422
                )
            if (
                kind == "reassignment"
                and source_account["id"] != destination_account["id"]
            ):
                raise RejectionError(
                    "different_account",
                    "Reassignment requires goals in one account.",
                    422,
                )
            if kind == "transfer" and source_account["id"] == destination_account["id"]:
                raise RejectionError(
                    "same_account",
                    "Transfer requires goals in different accounts.",
                    422,
                )
            if not destination["active"] and (
                old is None or old["to_goal_id"] != destination["id"]
            ):
                raise RejectionError(
                    "inactive_goal", "Choose an active destination goal.", 422
                )
            completed_return = (
                source["completed"]
                and kind == "reassignment"
                and destination["role"] == "unallocated"
                and source_account["id"] == destination_account["id"]
            )
            if (
                not source["active"]
                and not completed_return
                and (old is None or old["from_goal_id"] != source["id"])
            ):
                raise RejectionError(
                    "inactive_goal", "Choose an active source goal.", 422
                )
            values.update(
                from_goal_id=source["id"],
                to_goal_id=destination["id"],
                amount=Decimal(payload["amount"]),
            )
        if old:
            changed = (
                (
                    await session.execute(
                        update(table)
                        .where(table.c.id == old["id"])
                        .values(**values, revision=old["revision"] + 1)
                        .returning(table)
                    )
                )
                .mappings()
                .one()
            )
        else:
            changed = (
                (
                    await session.execute(
                        insert(table)
                        .values(entity_id=entity["id"], **values)
                        .returning(table)
                    )
                )
                .mappings()
                .one()
            )
    await saving_facts(session, entity["id"])
    await audit(table, changed["uuid"], dict(old) if old else None, dict(changed))
    goals = (
        await session.execute(
            select(s.goals.c.id, s.goals.c.uuid).where(
                s.goals.c.entity_id == entity["id"]
            )
        )
    ).all()
    return movement_result(changed, kind, {id_: str(uuid) for id_, uuid in goals})


async def write_savings(session, entity, operation, payload, target, audit):
    if operation == "create_saving_account":
        try:
            remainder = opening_designations(
                payload["opening_amount"],
                [g["opening_amount"] for g in payload["goals"]],
            )
            targets = [goal_target(g["kind"], g["target"]) for g in payload["goals"]]
        except ValueError as error:
            invalid(error)
        account = (
            (
                await session.execute(
                    insert(s.accounts)
                    .values(
                        entity_id=entity["id"],
                        name=payload["name"],
                        opening_date=date.fromisoformat(payload["opening_date"]),
                        opening_amount=payload["opening_amount"],
                    )
                    .returning(s.accounts)
                )
            )
            .mappings()
            .one()
        )
        unallocated = (
            (
                await session.execute(
                    insert(s.goals)
                    .values(
                        entity_id=entity["id"],
                        account_id=account["id"],
                        name="Unallocated",
                        role="unallocated",
                        kind="ongoing",
                        opening_amount=remainder,
                    )
                    .returning(s.goals)
                )
            )
            .mappings()
            .one()
        )
        await audit(s.accounts, account["uuid"], None, dict(account))
        await audit(s.goals, unallocated["uuid"], None, dict(unallocated))
        for goal, goal_target_value in zip(payload["goals"], targets, strict=True):
            row = (
                (
                    await session.execute(
                        insert(s.goals)
                        .values(
                            entity_id=entity["id"],
                            account_id=account["id"],
                            name=goal["name"],
                            role="ordinary",
                            kind=goal["kind"],
                            target=goal_target_value,
                            opening_amount=goal["opening_amount"],
                        )
                        .returning(s.goals)
                    )
                )
                .mappings()
                .one()
            )
            await audit(s.goals, row["uuid"], None, dict(row))
        return await snapshot(session, account)

    account = await scoped(session, s.accounts, entity["id"], target)
    if operation in {
        "archive_saving_account",
        "reopen_saving_account",
        "complete_saving_goal",
    }:
        return await write_lifecycle(
            session, entity, account, operation, payload, audit
        )
    if not account["active"]:
        raise RejectionError(
            "archived_account", "Reopen the savings account before corrections.", 422
        )
    if operation == "edit_saving_account":
        check_revision(account, payload["expected_revision"])
        rows = (
            (
                await session.execute(
                    select(s.goals).where(s.goals.c.account_id == account["id"])
                )
            )
            .mappings()
            .all()
        )
        by_uuid = {str(row["uuid"]): row for row in rows if row["role"] == "ordinary"}
        supplied = payload["designations"]
        if {str(item["goal_id"]) for item in supplied} != set(by_uuid) or len(
            supplied
        ) != len(by_uuid):
            raise RejectionError(
                "invalid_designations", "Include each ordinary goal exactly once.", 422
            )
        try:
            remainder = opening_designations(
                payload["opening_amount"], [item["opening_amount"] for item in supplied]
            )
            old_amounts = {str(row["uuid"]): row["opening_amount"] for row in rows}
            changed = (
                account["opening_date"] != date.fromisoformat(payload["opening_date"])
                or account["opening_amount"] != Decimal(payload["opening_amount"])
                or any(
                    old_amounts[str(item["goal_id"])] != Decimal(item["opening_amount"])
                    for item in supplied
                )
                or next(row for row in rows if row["role"] == "unallocated")[
                    "opening_amount"
                ]
                != remainder
            )
            has_activity = (
                await session.scalar(
                    select(s.linked_activity.c.id)
                    .where(s.linked_activity.c.account_id == account["id"])
                    .limit(1)
                )
            ) is not None
            if not has_activity:
                goal_ids = [row["id"] for row in rows]
                for movement_table in (s.reassignments, s.transfers):
                    has_activity = (
                        await session.scalar(
                            select(movement_table.c.id)
                            .where(
                                movement_table.c.from_goal_id.in_(goal_ids)
                                | movement_table.c.to_goal_id.in_(goal_ids)
                            )
                            .limit(1)
                        )
                    ) is not None
                    if has_activity:
                        break
                if not has_activity:
                    has_activity = (
                        await session.scalar(
                            select(s.adjustments.c.id)
                            .where(s.adjustments.c.goal_id.in_(goal_ids))
                            .limit(1)
                        )
                    ) is not None
            opening_change_allowed(has_activity, changed)
        except ValueError as error:
            invalid(error)
        before = dict(account)
        account = (
            (
                await session.execute(
                    update(s.accounts)
                    .where(s.accounts.c.id == account["id"])
                    .values(
                        name=payload["name"],
                        opening_date=date.fromisoformat(payload["opening_date"]),
                        opening_amount=payload["opening_amount"],
                        revision=account["revision"] + 1,
                    )
                    .returning(s.accounts)
                )
            )
            .mappings()
            .one()
        )
        await audit(s.accounts, account["uuid"], before, dict(account))
        amounts = {
            str(item["goal_id"]): Decimal(item["opening_amount"]) for item in supplied
        }
        for row in rows:
            amount = (
                remainder if row["role"] == "unallocated" else amounts[str(row["uuid"])]
            )
            if amount != row["opening_amount"]:
                updated = (
                    (
                        await session.execute(
                            update(s.goals)
                            .where(s.goals.c.id == row["id"])
                            .values(
                                opening_amount=amount,
                                revision=row["revision"] + 1,
                            )
                            .returning(s.goals)
                        )
                    )
                    .mappings()
                    .one()
                )
                await audit(s.goals, row["uuid"], dict(row), dict(updated))
        return await snapshot(session, account)

    if operation == "create_saving_goal":
        check_revision(account, payload["expected_account_revision"])
        if not account["active"]:
            raise RejectionError(
                "inactive_account", "Reopen the account before adding a goal."
            )
        try:
            target_value = goal_target(payload["kind"], payload["target"])
        except ValueError as error:
            invalid(error)
        row = (
            (
                await session.execute(
                    insert(s.goals)
                    .values(
                        entity_id=entity["id"],
                        account_id=account["id"],
                        name=payload["name"],
                        role="ordinary",
                        kind=payload["kind"],
                        target=target_value,
                        opening_amount=Decimal("0.00"),
                    )
                    .returning(s.goals)
                )
            )
            .mappings()
            .one()
        )
        await audit(s.goals, row["uuid"], None, dict(row))
        account = (
            (
                await session.execute(
                    update(s.accounts)
                    .where(s.accounts.c.id == account["id"])
                    .values(
                        revision=account["revision"] + 1,
                    )
                    .returning(s.accounts)
                )
            )
            .mappings()
            .one()
        )
        return await snapshot(session, account)

    if operation == "edit_saving_goal":
        row = await scoped(session, s.goals, entity["id"], payload["goal_id"])
        if row["account_id"] != account["id"]:
            raise RejectionError(
                "record_not_found", "Goal is unavailable in this account.", 404
            )
        if row["role"] == "unallocated":
            raise RejectionError(
                "protected_goal",
                "Unallocated belongs to the account and cannot be edited "
                "independently.",
            )
        check_revision(row, payload["expected_revision"])
        if row["completed"] and (payload["active"] or payload["kind"] != row["kind"]):
            raise RejectionError(
                "completed_goal",
                "A completed goal cannot be reactivated or changed to ongoing.",
                422,
            )
        try:
            target_value = goal_target(payload["kind"], payload["target"])
        except ValueError as error:
            invalid(error)
        updated = (
            (
                await session.execute(
                    update(s.goals)
                    .where(s.goals.c.id == row["id"])
                    .values(
                        name=payload["name"],
                        kind=payload["kind"],
                        target=target_value,
                        active=payload["active"],
                        revision=row["revision"] + 1,
                    )
                    .returning(s.goals)
                )
            )
            .mappings()
            .one()
        )
        await audit(s.goals, row["uuid"], dict(row), dict(updated))
        return await snapshot(session, account)

    raise RejectionError("unsupported_command", "Command is not implemented.", 404)


async def write_lifecycle(session, entity, account, operation, payload, audit):
    """Shared Entity lock protects lifecycle, all effects, audit and retry outcome."""
    rows, balances, _ = await saving_facts(session, entity["id"])
    goals = [row for row in rows if row["account_id"] == account["id"]]
    if operation == "complete_saving_goal":
        if not account["active"]:
            raise RejectionError(
                "archived_account", "Reopen the savings account first.", 422
            )
        goal = next(
            (row for row in goals if str(row["uuid"]) == str(payload["goal_id"])), None
        )
        if goal is None:
            raise RejectionError(
                "record_not_found", "Goal is unavailable in this account.", 404
            )
        check_revision(goal, payload["expected_revision"])
        try:
            amount = completion_amount(
                goal["role"],
                goal["kind"],
                goal["active"],
                goal["completed"],
                balances[str(goal["uuid"])],
            )
        except ValueError as error:
            invalid(error)
        if amount != Decimal(payload["expected_return"]):
            raise RejectionError(
                "stale_completion",
                "Remaining saved changed. Review the amount to return and retry.",
                409,
            )
        when = date.fromisoformat(payload["date"])
        if when < account["opening_date"]:
            raise RejectionError(
                "before_opening",
                "Completion cannot precede the account opening date.",
                422,
            )
        if amount > 0:
            unallocated = next(row for row in goals if row["role"] == "unallocated")
            movement = (
                (
                    await session.execute(
                        insert(s.reassignments)
                        .values(
                            entity_id=entity["id"],
                            financial_date=when,
                            from_goal_id=goal["id"],
                            to_goal_id=unallocated["id"],
                            amount=amount,
                            note="Goal completion return",
                            completion_goal_id=goal["id"],
                        )
                        .returning(s.reassignments)
                    )
                )
                .mappings()
                .one()
            )
            await saving_facts(session, entity["id"])
            await audit(s.reassignments, movement["uuid"], None, dict(movement))
        changed = (
            (
                await session.execute(
                    update(s.goals)
                    .where(s.goals.c.id == goal["id"])
                    .values(
                        active=False,
                        completed=True,
                        revision=goal["revision"] + 1,
                    )
                    .returning(s.goals)
                )
            )
            .mappings()
            .one()
        )
        await audit(
            s.goals,
            goal["uuid"],
            dict(goal_without_account_fields(goal)),
            dict(changed),
        )
    else:
        check_revision(account, payload["expected_revision"])
        reopening = operation == "reopen_saving_account"
        if reopening:
            if account["active"]:
                raise RejectionError(
                    "active_account", "The account is already open.", 422
                )
        else:
            try:
                archive_allowed(
                    account["active"],
                    sum((balances[str(row["uuid"])] for row in goals), Decimal("0.00")),
                )
            except ValueError as error:
                invalid(error)
        for row in goals:
            active = (
                restored_goal_active(
                    row["active"], row["archived_by_account"], row["completed"]
                )
                if reopening
                else False
            )
            provenance = False if reopening else row["active"]
            if active == row["active"] and provenance == row["archived_by_account"]:
                continue
            changed = (
                (
                    await session.execute(
                        update(s.goals)
                        .where(s.goals.c.id == row["id"])
                        .values(
                            active=active,
                            archived_by_account=provenance,
                            revision=row["revision"] + 1,
                        )
                        .returning(s.goals)
                    )
                )
                .mappings()
                .one()
            )
            await audit(
                s.goals,
                row["uuid"],
                dict(goal_without_account_fields(row)),
                dict(changed),
            )
        changed_account = (
            (
                await session.execute(
                    update(s.accounts)
                    .where(s.accounts.c.id == account["id"])
                    .values(
                        active=reopening,
                        revision=account["revision"] + 1,
                    )
                    .returning(s.accounts)
                )
            )
            .mappings()
            .one()
        )
        await audit(s.accounts, account["uuid"], dict(account), dict(changed_account))
        account = changed_account
    return await snapshot(session, account)


def goal_without_account_fields(row):
    return {column.name: row[column.name] for column in s.goals.c}
