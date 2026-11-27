"""Authorized loan and observation commands inside the shared write transaction."""

from datetime import UTC, date, datetime
from uuid import UUID

from sqlalchemy import insert, select, update

from accanto.db import read_snapshot
from accanto.domains.balances import (
    ObservedBalance,
    latest_observation,
    observation_date_allowed,
    require_archive_allowed,
)
from accanto.domains.projections import payoff_schedule, payoff_summary
from accanto.dtos.balances import TERMS
from accanto.models import debts as b
from accanto.models import destinations as d
from accanto.models import monthly as m
from accanto.services.access import RejectionError
from accanto.services.monthly import authorize, check_revision, scoped


def resources(kind):
    if kind == "debt":
        return b.observations, b.debts, "debt_account_id"
    if kind == "investment":
        return d.observations, d.investments, "investment_id"
    raise ValueError("Unsupported balance type")


async def observations_for(session, kind, entity_id, account_id=None):
    table, accounts, foreign_key = resources(kind)
    query = (
        select(table, accounts.c.uuid.label("account_uuid"))
        .outerjoin(accounts, accounts.c.id == table.c[foreign_key])
        .where(table.c.entity_id == entity_id, table.c.deleted_at.is_(None))
    )
    if account_id is not None:
        query = query.where(table.c[foreign_key] == account_id)
    return (
        (
            await session.execute(
                query.order_by(
                    table.c.financial_date, table.c.is_opening.desc(), table.c.id
                )
            )
        )
        .mappings()
        .all()
    )


def observation_result(row):
    return {
        "uuid": str(row["uuid"]),
        "financial_date": row["financial_date"].isoformat(),
        "amount": str(row["amount"]),
        "account_id": str(row["account_uuid"]) if row["account_uuid"] else None,
        "is_opening": row["is_opening"],
        "revision": row["revision"],
        "deleted": row["deleted_at"] is not None,
    }


async def read_observations(session, token, entity_uuid, kind):
    async with read_snapshot(session):
        _, entity = await authorize(session, token, entity_uuid, lock=False)
        return [
            observation_result(row)
            for row in await observations_for(session, kind, entity["id"])
        ]


async def debt_snapshot(session, row):
    rows = await observations_for(session, "debt", row["entity_id"], row["id"])
    opening = next(item for item in rows if item["is_opening"])
    latest = max(
        rows, key=lambda item: (item["financial_date"], not item["is_opening"])
    )
    draft_lines = (
        (
            await session.execute(
                select(m.fixed_cost_lines.c.uuid)
                .join(
                    m.revisions,
                    m.revisions.c.id == m.fixed_cost_lines.c.plan_revision_id,
                )
                .where(
                    m.fixed_cost_lines.c.entity_id == row["entity_id"],
                    m.fixed_cost_lines.c.debt_account_id == row["id"],
                    m.revisions.c.saved.is_(False),
                )
            )
        )
        .scalars()
        .all()
        if not row["active"]
        else []
    )
    return {
        "uuid": str(row["uuid"]),
        "name": row["name"],
        "active": row["active"],
        "revision": row["revision"],
        **terms(row),
        "payoff": payoff_summary(schedule(row, latest)),
        "opening": {
            "date": opening["financial_date"].isoformat(),
            "amount": str(opening["amount"]),
        },
        "latest": observation_result(latest),
        "draft_fixed_cost_lines": [str(item) for item in draft_lines],
    }


def terms(row) -> dict:
    """A Debt account's loan terms as the API reports them."""
    return {f: None if row[f] is None else str(row[f]) for f in TERMS}


def schedule(row, latest) -> dict:
    return payoff_schedule(
        latest["amount"],
        latest["financial_date"],
        row["interest_rate_percent"],
        row["monthly_payment"],
    )


async def read_payoff_schedule(session, token, entity_uuid, debt_uuid):
    async with read_snapshot(session):
        _, entity = await authorize(session, token, entity_uuid, lock=False)
        row = await scoped(session, b.debts, entity["id"], debt_uuid)
        rows = await observations_for(session, "debt", entity["id"], row["id"])
    latest = max(
        rows, key=lambda item: (item["financial_date"], not item["is_opening"])
    )
    return schedule(row, latest)


async def read_debts(session, token, entity_uuid):
    async with read_snapshot(session):
        _, entity = await authorize(session, token, entity_uuid, lock=False)
        rows = (
            (
                await session.execute(
                    select(b.debts)
                    .where(b.debts.c.entity_id == entity["id"])
                    .order_by(b.debts.c.id)
                )
            )
            .mappings()
            .all()
        )
        return [await debt_snapshot(session, row) for row in rows]


async def write_debt(session, entity, operation, payload, target, audit):
    if operation == "create_debt":
        row = (
            (
                await session.execute(
                    insert(b.debts)
                    .values(
                        entity_id=entity["id"],
                        name=payload["name"],
                        **{f: payload.get(f) for f in TERMS},
                    )
                    .returning(b.debts)
                )
            )
            .mappings()
            .one()
        )
        await audit(b.debts, row["uuid"], None, dict(row))
        opening = (
            (
                await session.execute(
                    insert(b.observations)
                    .values(
                        entity_id=entity["id"],
                        debt_account_id=row["id"],
                        financial_date=date.fromisoformat(payload["opening"]["date"]),
                        amount=payload["opening"]["amount"],
                        is_opening=True,
                    )
                    .returning(b.observations)
                )
            )
            .mappings()
            .one()
        )
        await audit(b.observations, opening["uuid"], None, dict(opening))
        return await debt_snapshot(session, row)
    row = await scoped(session, b.debts, entity["id"], target)
    check_revision(row, payload["expected_revision"])
    if row["active"] and not payload["active"]:
        observations = await observations_for(session, "debt", entity["id"], row["id"])
        latest = latest_observation(
            ObservedBalance(item["financial_date"], item["amount"], item["is_opening"])
            for item in observations
        )
        try:
            require_archive_allowed(latest)
        except ValueError as error:
            raise RejectionError("debt_not_paid_off", str(error), 422) from None
    updated = (
        (
            await session.execute(
                update(b.debts)
                .where(b.debts.c.id == row["id"])
                .values(
                    name=payload["name"],
                    active=payload["active"],
                    revision=row["revision"] + 1,
                    **{
                        f: payload.get(f)
                        for f in TERMS
                        if f not in payload.get("unchanged", TERMS)
                    },
                )
                .returning(b.debts)
            )
        )
        .mappings()
        .one()
    )
    await audit(b.debts, row["uuid"], dict(row), dict(updated))
    return await debt_snapshot(session, updated)


async def write_observation(session, entity, operation, payload, target, audit):
    verb, kind, _ = operation.split("_", 2)
    table, accounts, foreign_key = resources(kind)
    old = None
    if verb != "create":
        old = await scoped(session, table, entity["id"], target)
        check_revision(old, payload["expected_revision"])
        if old["is_opening"]:
            raise RejectionError(
                "protected_opening",
                "Opening observations cannot be corrected or deleted.",
                422,
            )
        if old["deleted_at"] is not None:
            raise RejectionError(
                "deleted_observation", "Observation has already been deleted."
            )
    account = None
    if verb != "delete" and payload.get("account_id"):
        account = await scoped(
            session, accounts, entity["id"], UUID(payload["account_id"])
        )
    if kind == "debt" and verb != "delete" and account is None:
        raise RejectionError("debt_account_required", "Choose a debt account.", 422)
    if verb == "delete":
        assert old is not None
        values = {"deleted_at": datetime.now(UTC), "revision": old["revision"] + 1}
    else:
        observation_date = date.fromisoformat(payload["date"])
        if account:
            opening = await session.scalar(
                select(table.c.financial_date).where(
                    table.c[foreign_key] == account["id"], table.c.is_opening
                )
            )
            try:
                observation_date_allowed(opening, observation_date)
            except ValueError as error:
                raise RejectionError("before_opening", str(error), 422) from None
            duplicate = await session.scalar(
                select(table.c.id).where(
                    table.c[foreign_key] == account["id"],
                    table.c.financial_date == observation_date,
                    table.c.is_opening.is_(False),
                    table.c.deleted_at.is_(None),
                    table.c.id != (old["id"] if old else -1),
                )
            )
            if duplicate:
                raise RejectionError(
                    "observation_exists",
                    "Correct the existing observation for this date.",
                )
        values = {
            "entity_id": entity["id"],
            foreign_key: account["id"] if account else None,
            "financial_date": observation_date,
            "amount": payload["amount"],
            "is_opening": False,
            "revision": old["revision"] + 1 if old else 1,
        }
    stmt = update(table).where(table.c.id == old["id"]) if old else insert(table)
    record = (
        (await session.execute(stmt.values(**values).returning(table))).mappings().one()
    )
    await audit(table, record["uuid"], dict(old) if old else None, dict(record))
    account_uuid = (
        await session.scalar(
            select(accounts.c.uuid).where(accounts.c.id == record[foreign_key])
        )
        if record[foreign_key]
        else None
    )
    return observation_result({**record, "account_uuid": account_uuid})
