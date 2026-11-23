"""Agent settings and Pending changes: browser session only (PRD AG-05, AG-06).

API keys are refused here, so no agent (MCP or built-in) can change its own
mode, AGENT.md or enablement, or apply the changes it drafted.
"""

import asyncio
from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, File, Form, Header, Request, UploadFile
from fastapi.responses import StreamingResponse

from accanto.db import async_session
from accanto.dtos.agent import AgentSettingsInput, ApplyInput, DismissInput
from accanto.routers.authentication import BrowserToken, Session
from accanto.services import agent_images, agent_settings, agent_writes, tools
from accanto.services.agent import AgentTurns
from accanto.services.openrouter import provider_label
from accanto.services.sse import SSE_HEADERS, SSE_MEDIA_TYPE

router = APIRouter(prefix="/api/entities/{entity_id}/agent", tags=["agent"])
RequestKey = Annotated[
    str, Header(alias="Idempotency-Key", min_length=1, max_length=120)
]


def sessions_of(request: Request):
    return getattr(request.app.state, "sessions", None) or async_session


def turns(request: Request) -> AgentTurns:
    state = request.app.state
    if getattr(state, "agent_turns", None) is None:
        state.agent_turns = AgentTurns(state.auth_settings, sessions_of(request))
    return state.agent_turns


@router.get("/settings")
async def get_settings(
    entity_id: UUID, request: Request, session: Session, actor: BrowserToken
):
    """Settings plus what the opt-in screen must name: provider, data, retention."""
    config = request.app.state.auth_settings
    return {
        **await agent_settings.read_settings(session, actor, entity_id),
        "provider": provider_label(config),
        "retention_days": config.agent_retention_days,
        "daily_message_cap": config.agent_daily_message_cap,
    }


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


class ReleasingStream(StreamingResponse):
    """Releases the turn's claim even if the stream never starts (aleph)."""

    def __init__(self, content, release):
        super().__init__(content, media_type=SSE_MEDIA_TYPE, headers=SSE_HEADERS)
        self.release = release

    async def __call__(self, scope, receive, send):
        try:
            await super().__call__(scope, receive, send)
        finally:
            self.release()


@router.get("/conversation")
async def get_conversation(entity_id: UUID, request: Request, actor: BrowserToken):
    return await turns(request).read(actor, entity_id)


@router.delete("/conversation")
async def clear_conversation(entity_id: UUID, request: Request, actor: BrowserToken):
    """Hard-deletes the conversation; Pending changes it drafted stay listed."""
    await turns(request).clear(actor, entity_id)
    return {"cleared": True}


@router.post("/conversation/messages")
async def send_message(
    entity_id: UUID,
    request: Request,
    actor: BrowserToken,
    content: Annotated[str, Form(max_length=4000)] = "",
    screen: Annotated[str | None, Form(max_length=40)] = None,
    month: Annotated[date | None, Form()] = None,
    images: Annotated[list[UploadFile] | None, File()] = None,
):
    """Admit before the first byte, then stream SSE: delta, tool, pending_change,
    done or error, with a ': ping' heartbeat. Images are normalised in memory and
    passed to this turn only."""
    service = turns(request)
    # Read one byte past the limit so an oversized file is refused, not buffered whole.
    raw = [await f.read(agent_images.MAX_IMAGE_BYTES + 1) for f in images or []]
    normalised = await asyncio.to_thread(agent_images.normalise_all, raw)
    turn = await service.admit(
        actor, entity_id, content, images=normalised, screen=screen, month=month
    )
    return ReleasingStream(service.stream(turn), lambda: service.release(turn))
