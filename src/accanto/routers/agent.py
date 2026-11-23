"""Agent settings and Pending changes: browser session only (PRD AG-05, AG-06).

API keys are refused here, so no agent (MCP or built-in) can change its own
mode, AGENT.md or enablement, or apply the changes it drafted.
"""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Header, Request

from accanto.db import async_session
from accanto.dtos.agent import AgentSettingsInput, ApplyInput, DismissInput
from accanto.routers.authentication import BrowserToken, Session
from accanto.services import agent_settings, agent_writes, tools

router = APIRouter(prefix="/api/entities/{entity_id}/agent", tags=["agent"])
RequestKey = Annotated[
    str, Header(alias="Idempotency-Key", min_length=1, max_length=120)
]


def sessions_of(request: Request):
    return getattr(request.app.state, "sessions", None) or async_session


@router.get("/settings")
async def get_settings(entity_id: UUID, session: Session, actor: BrowserToken):
    return await agent_settings.read_settings(session, actor, entity_id)


@router.put("/settings")
async def put_settings(
    entity_id: UUID,
    body: AgentSettingsInput,
    session: Session,
    actor: BrowserToken,
    request_key: RequestKey,
):
    return await agent_settings.update_settings(
        session, actor, entity_id, request_key, body.model_dump()
    )


@router.get("/pending-changes")
async def list_pending(
    entity_id: UUID,
    session: Session,
    actor: BrowserToken,
    status: str | None = "pending",
):
    return await agent_writes.read_pending(session, actor, entity_id, status=status)


@router.post("/pending-changes/{pending_id}/apply")
async def apply_pending(
    entity_id: UUID,
    pending_id: UUID,
    body: ApplyInput,
    request: Request,
    actor: BrowserToken,
):
    """Apply once (server key agent:{pending_id}); a retry returns the outcome."""
    context = tools.ToolContext(sessions_of(request), actor)
    result = await tools.apply_pending(context, entity_id, pending_id, body.input)
    return result.model_dump(mode="json")


@router.post("/pending-changes/{pending_id}/dismiss")
async def dismiss_pending(
    entity_id: UUID,
    pending_id: UUID,
    body: DismissInput,
    session: Session,
    actor: BrowserToken,
):
    return await agent_writes.dismiss(
        session, actor, entity_id, pending_id, body.expected_revision
    )
