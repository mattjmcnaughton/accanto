"""Savings commands under the shared authorized Entity transaction."""

from decimal import Decimal

from sqlalchemy import insert, select, update

from accanto.domains.savings import (
    goal_target,
    opening_change_allowed,
    opening_designations,
)
from accanto.models import savings as s
from accanto.services.access import RejectionError
from accanto.services.monthly import authorize, check_revision, scoped


def invalid(error: ValueError):
    raise RejectionError("invalid_savings", str(error), 422) from None


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
    goals = [
        {
            "uuid": str(row["uuid"]),
            "name": row["name"],
            "role": row["role"],
            "kind": row["kind"],
            "target": str(row["target"]) if row["target"] is not None else None,
            "opening_amount": str(row["opening_amount"]),
            "remaining_saved": str(row["opening_amount"]),
            "contribution_progress": "0.00",
            "revision": row["revision"],
            "active": row["active"],
        }
        for row in rows
    ]
    return {
        "uuid": str(account["uuid"]),
        "name": account["name"],
        "opening_date": account["opening_date"].isoformat(),
        "opening_amount": str(account["opening_amount"]),
        "balance": str(sum((row["opening_amount"] for row in rows), Decimal("0.00"))),
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
                        opening_date=payload["opening_date"],
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
                account["opening_date"] != payload["opening_date"]
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
                        opening_date=payload["opening_date"],
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
