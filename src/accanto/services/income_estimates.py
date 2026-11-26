"""Independent estimate commands inside the shared authorized write transaction."""

from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import delete, insert, select, update

from accanto.db import read_snapshot
from accanto.domains.income_estimates import estimate as calculate
from accanto.models import income_estimates as m
from accanto.repositories.income_estimates import get_estimate, snapshot
from accanto.services.access import RejectionError
from accanto.services.monthly import authorize, check_revision, json_values


async def write_estimate(session, entity, operation, payload, target, audit):
    """Write estimate and full snapshot; caller owns Entity lock, retry, and commit."""
    before = None
    record = None
    if operation != "create_estimate":
        record = await get_estimate(session, entity["id"], target)
        if record is None:
            raise RejectionError("estimate_not_found", "Estimate is unavailable.", 404)
        check_revision(record, payload["expected_revision"])
        before = json_values(await snapshot(session, record))
    elif payload.get("expected_revision") is not None:
        raise RejectionError(
            "unexpected_revision", "A new estimate has no prior revision."
        )

    audit_before = None if operation == "duplicate_estimate" else before
    if operation == "duplicate_estimate":
        assert before is not None
        source = before["lines"]
        inputs = [
            {
                "name": line["name"],
                "gross": line["gross"],
                "withholding": line["withholding"],
                "payroll": line["payroll"],
                "frequency": line["frequency"],
                "paid_days": int(line["paid_days"])
                if line["paid_days"] is not None
                else None,
            }
            for line in source
        ]
    else:
        inputs = payload["lines"]

    existing_ids = {line["uuid"] for line in before["lines"]} if before else set()
    incoming_ids = [str(line["line_id"]) for line in inputs if line.get("line_id")]
    if operation == "create_estimate" and incoming_ids:
        raise RejectionError(
            "invalid_line", "A new estimate cannot reuse an income line."
        )
    if len(incoming_ids) != len(set(incoming_ids)) or any(
        line_id not in existing_ids for line_id in incoming_ids
    ):
        raise RejectionError(
            "invalid_line", "Income line is unavailable in this estimate."
        )
    try:
        result = calculate(inputs)
    except ValueError as error:
        raise RejectionError("invalid_estimate", str(error), 422) from None

    if operation == "edit_estimate":
        assert record is not None
        record = (
            (
                await session.execute(
                    update(m.estimates)
                    .where(m.estimates.c.id == record["id"])
                    .values(
                        name=payload["name"],
                        revision=record["revision"] + 1,
                        monthly_total=Decimal(result["monthly_total"]),
                    )
                    .returning(m.estimates)
                )
            )
            .mappings()
            .one()
        )
        await session.execute(
            delete(m.lines).where(m.lines.c.estimate_id == record["id"])
        )
    else:
        record = (
            (
                await session.execute(
                    insert(m.estimates)
                    .values(
                        entity_id=entity["id"],
                        name=payload["name"],
                        monthly_total=Decimal(result["monthly_total"]),
                    )
                    .returning(m.estimates)
                )
            )
            .mappings()
            .one()
        )
    for position, line in enumerate(result["lines"]):
        await session.execute(
            insert(m.lines).values(
                uuid=UUID(line["line_id"]) if line.get("line_id") else uuid4(),
                estimate_id=record["id"],
                entity_id=entity["id"],
                position=position,
                name=line["name"],
                gross=Decimal(line["gross"]),
                withholding=Decimal(line["withholding"]),
                payroll=Decimal(line["payroll"]),
                frequency=line["frequency"],
                paid_days=line.get("paid_days"),
                monthly_net=Decimal(line["monthly_net"]),
            )
        )
    after = json_values(await snapshot(session, record))
    await audit(m.estimates, record["uuid"], audit_before, after)
    return after


async def read_estimates(session, token, entity_uuid, target=None):
    """Read a consistent Entity-scoped estimate collection or one estimate."""
    async with read_snapshot(session):
        _, entity = await authorize(session, token, entity_uuid, lock=False)
        if target is not None:
            record = await get_estimate(session, entity["id"], target)
            if record is None:
                raise RejectionError(
                    "estimate_not_found", "Estimate is unavailable.", 404
                )
            return json_values(await snapshot(session, record))
        records = (
            (
                await session.execute(
                    select(m.estimates)
                    .where(m.estimates.c.entity_id == entity["id"])
                    .order_by(m.estimates.c.id)
                )
            )
            .mappings()
            .all()
        )
        return json_values([await snapshot(session, record) for record in records])
