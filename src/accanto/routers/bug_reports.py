"""Report bug (TDD 21): file, list and close notes about Accanto itself.

Browser session only, like API keys: no script or agent files or reads them.
"""

from uuid import UUID

from fastapi import APIRouter

from accanto.dtos.bug_reports import ReportInput, StatusInput
from accanto.routers.authentication import BrowserToken, Session
from accanto.services.bug_reports import create_report, list_reports, set_status

router = APIRouter(prefix="/api/bug-reports", tags=["Bug reports"])


@router.get("")
async def get_reports(session: Session, actor: BrowserToken):
    return await list_reports(session, actor)


@router.post("")
async def file_report(body: ReportInput, session: Session, actor: BrowserToken):
    return await create_report(
        session,
        actor,
        kind=body.kind,
        note=body.note,
        context=body.context.model_dump(mode="json"),
    )


@router.patch("/{report_id}")
async def change_status(
    report_id: UUID, body: StatusInput, session: Session, actor: BrowserToken
):
    return await set_status(session, actor, report_id, body.status)
