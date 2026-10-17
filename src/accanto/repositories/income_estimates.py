"""Entity-scoped persistence reads for independent income estimates."""

from sqlalchemy import select

from accanto.models import income_estimates as m


async def get_estimate(session, entity_id, estimate_uuid):
    return (
        (
            await session.execute(
                select(m.estimates).where(
                    m.estimates.c.entity_id == entity_id,
                    m.estimates.c.uuid == estimate_uuid,
                )
            )
        )
        .mappings()
        .first()
    )


async def snapshot(session, estimate):
    lines = (
        (
            await session.execute(
                select(m.lines)
                .where(m.lines.c.estimate_id == estimate["id"])
                .order_by(m.lines.c.position)
            )
        )
        .mappings()
        .all()
    )
    return {
        "uuid": estimate["uuid"],
        "name": estimate["name"],
        "revision": estimate["revision"],
        "monthly_total": str(estimate["monthly_total"]),
        "lines": [
            {
                "uuid": line["uuid"],
                "name": line["name"],
                "gross": str(line["gross"]),
                "withholding": str(line["withholding"]),
                "payroll": str(line["payroll"]),
                "frequency": line["frequency"],
                "paid_days": str(line["paid_days"])
                if line["paid_days"] is not None
                else None,
                "monthly_net": str(line["monthly_net"]),
            }
            for line in lines
        ],
    }
