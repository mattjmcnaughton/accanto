"""Atomic savings lifecycle orchestration within the shared Entity transaction."""

from datetime import date
from decimal import Decimal

from sqlalchemy import insert, update

from accanto.domains.savings import (
    archive_allowed,
    completion_amount,
    restored_goal_active,
)
from accanto.models import savings as s
from accanto.services.access import RejectionError
from accanto.services.monthly import check_revision
from accanto.services.savings import invalid, saving_facts, snapshot


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
