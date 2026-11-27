"""Report bug (TDD 21): an opted-in User's notes about Accanto itself.

Not financial activity and outside every Entity. Only Users whose sign-in
matched REPORT_BUG_EMAILS see the feature; for anyone else it does not exist
(404), so its presence reveals nothing.
"""

from datetime import UTC, datetime

from sqlalchemy import insert, select, update

from accanto.db import read_snapshot
from accanto.models import monthly as m
from accanto.models.bug_reports import bug_reports
from accanto.services.access import RejectionError, revalidate_actor

COLUMNS = (
    bug_reports.c.uuid,
    bug_reports.c.kind,
    bug_reports.c.note,
    bug_reports.c.context,
    bug_reports.c.status,
    bug_reports.c.created_at,
    bug_reports.c.resolved_at,
)


def unavailable():
    return RejectionError("not_found", "Not found.", 404)


def present(row):
    return {
        "id": str(row["uuid"]),
        "kind": row["kind"],
        "note": row["note"],
        "context": row["context"],
        "status": row["status"],
        "created_at": row["created_at"],
        "resolved_at": row["resolved_at"],
    }


async def enabled_user(session, actor, *, lock):
    current = await revalidate_actor(session, actor, lock=lock)
    if not await session.scalar(
        select(m.users.c.report_bug_enabled).where(m.users.c.id == current.user_id)
    ):
        raise unavailable()
    return current.user_id


async def create_report(session, actor, *, kind, note, context):
    async with session.begin():
        user_id = await enabled_user(session, actor, lock=True)
        row = (
            (
                await session.execute(
                    insert(bug_reports)
                    .values(user_id=user_id, kind=kind, note=note, context=context)
                    .returning(*COLUMNS)
                )
            )
            .mappings()
            .one()
        )
        return present(row)


async def list_reports(session, actor):
    async with read_snapshot(session):
        user_id = await enabled_user(session, actor, lock=False)
        rows = (
            (
                await session.execute(
                    select(*COLUMNS)
                    .where(bug_reports.c.user_id == user_id)
                    .order_by(bug_reports.c.id.desc())
                    .limit(200)
                )
            )
            .mappings()
            .all()
        )
        return [present(row) for row in rows]


async def set_status(session, actor, report_id, status):
    async with session.begin():
        user_id = await enabled_user(session, actor, lock=True)
        row = (
            (
                await session.execute(
                    update(bug_reports)
                    .where(
                        bug_reports.c.uuid == report_id,
                        bug_reports.c.user_id == user_id,
                    )
                    .values(
                        status=status,
                        resolved_at=None if status == "open" else datetime.now(UTC),
                    )
                    .returning(*COLUMNS)
                )
            )
            .mappings()
            .first()
        )
        if row is None:
            raise unavailable()
        return present(row)
