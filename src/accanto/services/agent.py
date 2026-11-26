"""Built-in agent turns: admit, run, follow, settle (TDD 03), after aleph's tutor.py.

admit() checks everything before the first byte: browser session, enablement,
daily cap, one reply per conversation, the concurrency limit. start() runs the
agent with the model injected in its own task, which records SSE frames on the
turn's Run; tool calls open their own short sessions bound to this owner and
Entity, so no transaction spans a model call. follow() streams a Run's frames to
one connection. A turn outlives its connection: iOS drops a backgrounded page's
stream, and the client follows the same Run again from the frames it already
has, so nothing runs twice. Only stop() or a failure ends a turn early. settle()
stores both messages in one transaction; a failed or stopped turn stores none.

Telemetry is operation names, tool names, timings, token counts and error codes.
Never prompts, replies, tool results or images.
"""

import asyncio
import json
import os
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from uuid import UUID, uuid4

import structlog
from pydantic_ai import UsageLimits
from pydantic_ai.exceptions import (
    ModelHTTPError,
    UnexpectedModelBehavior,
    UsageLimitExceeded,
)
from pydantic_ai.messages import (
    BinaryContent,
    PartDeltaEvent,
    PartStartEvent,
    TextPart,
    TextPartDelta,
)
from pydantic_ai.run import AgentRunResultEvent

from accanto.agents.sidebar import SidebarDeps, ToolRejectedError, build_sidebar_agent
from accanto.repositories import agent as conversations
from accanto.services import agent_settings
from accanto.services.access import AuthenticatedActor, RejectionError
from accanto.services.agent_context import (
    entity_day,
    history,
    sidebar_specs,
    strip_draft,
)
from accanto.services.monthly import authorize
from accanto.services.openrouter import AgentUnavailableError, resolve_model
from accanto.services.sse import sse_event, sse_heartbeat
from accanto.services.tools import TOOLS, ToolContext

# pydantic-ai prints a start-up banner; keep diagnostics to our own events.
os.environ.setdefault("PYDANTIC_AI_NO_BANNER", "1")
log = structlog.get_logger(__name__)
REQUEST_LIMIT = 12  # inbox triage reads Plans, goals and destinations first
MAX_MESSAGE = 4000
# How long a finished turn's frames wait for a client that lost its connection.
KEEP_FINISHED_SECONDS = 600
# Rejections the model can fix by changing its arguments.
RETRYABLE = {
    "invalid_record",
    "invalid_arguments",
    "stale_revision",
    "invalid_proposal",
}


# admit/read/archive: the latest active conversation (the TDD 03 routes).
LATEST = "latest"


def not_found() -> RejectionError:
    return RejectionError("conversation_not_found", "That conversation is gone.", 404)


class TurnError(Exception):
    def __init__(self, code: str, message: str):
        self.code, self.message = code, message
        super().__init__(message)

    def frame(self) -> str:
        return sse_event("error", {"code": self.code, "message": self.message})


@dataclass
class Turn:
    actor: AuthenticatedActor
    entity_uuid: UUID
    entity_id: int
    user_id: int
    content: str
    images: list[bytes] = field(default_factory=list)
    screen: str | None = None
    month: date | None = None
    deps_values: dict = field(default_factory=dict)
    prior: list = field(default_factory=list)
    claim: tuple = ()
    # None starts a conversation with this turn (TDD 08).
    conversation_id: int | None = None


@dataclass
class Reply:
    text: str
    pending_ids: list[str]


@dataclass(eq=False)
class Run:
    """One turn's SSE frames in order, kept apart from any connection. key is the
    client's Idempotency-Key for the turn; a connection follows from an index."""

    key: str | None
    frames: list[str] = field(default_factory=list)
    finished: bool = False
    task: asyncio.Task | None = None
    wake: asyncio.Event = field(default_factory=asyncio.Event)

    async def put(self, frame: str | None) -> None:
        """Record a frame; None ends the turn. Never suspends, so it completes
        even while the producing task is being cancelled."""
        if frame is None:
            self.finished = True
        else:
            self.frames.append(frame)
        self.wake.set()
        self.wake = asyncio.Event()


class AgentTurns:
    """One per application; holds the in-flight claims and the reply limit."""

    def __init__(self, config, sessions, *, model_resolver=resolve_model):
        self.config, self.sessions = config, sessions
        self.resolve_model = model_resolver
        self.in_flight: set[tuple[int, int]] = set()
        # The latest turn per (user id, Entity UUID), running or recently finished.
        self.runs: dict[tuple[int, UUID], Run] = {}
        self.replies = asyncio.Semaphore(config.agent_concurrent_replies)
        self.agent = build_sidebar_agent(sidebar_specs())

    async def admit(
        self,
        actor,
        entity_uuid,
        content,
        *,
        images=(),
        screen=None,
        month=None,
        conversation: UUID | None | str = LATEST,
    ) -> Turn:
        """conversation: a UUID to continue, LATEST for the latest active one
        (or a new one when there is none), or None to start a new one."""
        content = content.strip()
        if not content and not images:
            raise RejectionError("empty_message", "Write a message first.", 422)
        if len(content) > MAX_MESSAGE:
            raise RejectionError(
                "message_too_long", "Messages are limited to 4,000 characters.", 422
            )
        try:
            self.resolve_model(self.config)
        except AgentUnavailableError as error:
            raise RejectionError("agent_unavailable", str(error), 503) from None
        async with self.sessions() as session, session.begin():
            _, entity = await authorize(session, actor, entity_uuid, lock=False)
            settings = await agent_settings.current(session, entity["id"])
            if not settings["enabled"]:
                raise RejectionError(
                    "agent_disabled", "Turn on the assistant in Settings first.", 409
                )
            day_start = datetime.now(UTC) - timedelta(days=1)
            sent = await conversations.owner_messages_since(
                session, actor.user_id, day_start
            )
            if sent >= self.config.agent_daily_message_cap:
                raise RejectionError(
                    "daily_cap_reached",
                    "The assistant's daily message limit is reached. Try tomorrow.",
                    429,
                )
            row = (
                None
                if conversation is None
                else await conversations.find(
                    session,
                    actor.user_id,
                    entity["id"],
                    None if conversation == LATEST else conversation,
                )
            )
            if row is None and conversation not in (None, LATEST):
                raise not_found()
            prior = (
                await conversations.messages(
                    session, row["id"], self.config.agent_history_turns * 2
                )
                if row
                else []
            )
        claim = (actor.user_id, entity["id"])
        if claim in self.in_flight:
            raise RejectionError(
                "reply_in_progress", "Wait for the current reply to finish.", 409
            )
        if self.replies.locked():
            raise RejectionError(
                "agent_busy", "The assistant is busy. Try again in a moment.", 429
            )
        self.in_flight.add(claim)
        return Turn(
            actor=actor.acting_as("agent"),
            entity_uuid=entity_uuid,
            entity_id=entity["id"],
            user_id=actor.user_id,
            content=content,
            images=list(images),
            screen=screen,
            month=month,
            deps_values={
                "entity_name": entity["name"],
                "time_zone": entity["time_zone"],
                "today": entity_day(entity["time_zone"]),
                "mode": settings["mode"],
                "agent_md": settings["instructions"],
            },
            prior=history(prior),
            claim=claim,
            conversation_id=row["id"] if row else None,
        )

    def start(self, turn: Turn, key: str | None) -> Run:
        """Runs the admitted turn to its end, whether or not anyone follows it."""
        owner = (turn.user_id, turn.entity_uuid)
        run = Run(key)
        self.runs[owner] = run
        run.task = asyncio.create_task(self._produce(turn, run, owner))
        return run

    def find(self, actor, entity_uuid: UUID, key: str) -> Run | None:
        """This owner's turn for the Entity with that Idempotency-Key, if kept."""
        run = self.runs.get((actor.user_id, entity_uuid))
        return run if run is not None and run.key == key else None

    async def follow(self, run: Run, after: int = 0) -> AsyncIterator[str]:
        """The Run's frames after the first `after`, then each new one, with a
        heartbeat while none arrive. Closing it leaves the turn running."""
        sent = after
        while True:
            while sent < len(run.frames):
                yield run.frames[sent]
                sent += 1
            if run.finished:
                return
            try:
                await asyncio.wait_for(
                    run.wake.wait(), timeout=self.config.agent_heartbeat_seconds
                )
            except TimeoutError:
                yield sse_heartbeat()

    async def stop(self, actor, entity_uuid: UUID) -> bool:
        """Cancels this owner's running turn for the Entity; nothing is stored.
        Returns once the turn has ended, so the next message is admitted."""
        run = self.runs.get((actor.user_id, entity_uuid))
        if run is None or run.finished or run.task is None:
            return False
        run.task.cancel()
        await asyncio.wait([run.task])
        return True

    async def _produce(self, turn: Turn, queue: Run, owner) -> None:
        started = time.perf_counter()
        outcome = "failure"
        try:
            async with self.replies:
                reply, usage = await self._run(turn, queue)
            ids = await self._settle(turn, reply)
            await queue.put(
                sse_event(
                    "done",
                    {
                        "conversation_id": str(ids[0]),
                        "owner_message_id": str(ids[1]),
                        "agent_message_id": str(ids[2]),
                        "pending_change_ids": reply.pending_ids,
                    },
                )
            )
            outcome = "success"
            log.info(
                "agent_turn",
                outcome=outcome,
                ms=round((time.perf_counter() - started) * 1000),
                **usage,
            )
        except TurnError as error:
            log.warning("agent_turn", outcome="failure", code=error.code)
            await queue.put(error.frame())
        except asyncio.CancelledError:
            log.info("agent_turn", outcome="stopped")
            await queue.put(TurnError("stopped", "You stopped this reply.").frame())
            raise
        except Exception as error:
            log.warning("agent_turn", outcome="failure", error=type(error).__name__)
            await queue.put(
                TurnError("internal_error", "The reply did not come through.").frame()
            )
        finally:
            await queue.put(None)
            self.in_flight.discard(turn.claim)
            asyncio.get_running_loop().call_later(
                KEEP_FINISHED_SECONDS, self._forget, owner, queue
            )

    def _forget(self, owner, run: Run) -> None:
        if self.runs.get(owner) is run:
            del self.runs[owner]

    async def _run(self, turn: Turn, queue) -> tuple[Reply, dict]:
        pending: list[str] = []
        context = ToolContext(self.sessions, turn.actor, config=self.config)
        turn_id = uuid4()

        async def call(name: str, arguments: dict, call_id: str) -> dict:
            tool = TOOLS[name]
            await queue.put(sse_event("tool", {"name": name, "status": "started"}))
            arguments, draft = strip_draft(arguments)
            started = time.perf_counter()
            try:
                args = tool.input.model_validate(arguments)
                extra = (
                    {"draft": draft}
                    if draft and tool.output.__name__ == "WriteResult"
                    else {}
                )
                # The server derives the retry identity; the model never does.
                result = await tool.run(
                    context,
                    turn.entity_uuid,
                    args,
                    f"turn:{turn_id}:{call_id}",
                    **extra,
                )
            except RejectionError as error:
                log.info("agent_tool", tool=name, code=error.code)
                await queue.put(sse_event("tool", {"name": name, "status": "failed"}))
                if error.status == 401 or error.code == "entity_not_found":
                    raise TurnError("session_expired", "Sign in again.") from None
                raise ToolRejectedError(
                    error.code, error.message, retry=error.code in RETRYABLE
                ) from None
            log.info(
                "agent_tool",
                tool=name,
                ms=round((time.perf_counter() - started) * 1000),
            )
            await queue.put(sse_event("tool", {"name": name, "status": "done"}))
            payload = result.model_dump(mode="json")
            for change in _pending_changes(payload):
                pending.append(change["id"])
                summary = change["summary"]
                if isinstance(summary, dict):
                    summary = summary.get("untrusted", "")
                drafted = json.loads(change["input"]["untrusted"])
                await queue.put(
                    sse_event(
                        "pending_change",
                        {**change, "summary": summary, "input": drafted},
                    )
                )
            return payload

        deps = SidebarDeps(
            **turn.deps_values,
            call=call,
            screen=turn.screen,
            month=turn.month,
            image_count=len(turn.images),
        )
        prompt: list = [turn.content or "Please look at the attached image(s)."]
        prompt += [
            BinaryContent(data=image, media_type="image/jpeg") for image in turn.images
        ]
        text = None
        streamed: list[str] = []
        usage: dict = {}
        try:
            async with (
                asyncio.timeout(self.config.agent_reply_timeout),
                self.agent.run_stream_events(
                    prompt,
                    deps=deps,
                    message_history=turn.prior,
                    model=self.resolve_model(self.config),
                    usage_limits=UsageLimits(request_limit=REQUEST_LIMIT),
                ) as events,
            ):
                async for event in events:
                    delta = _text_of(event)
                    # Each text part is its own block: text written before a tool
                    # call never runs into the text after it.
                    if streamed and isinstance(event, PartStartEvent) and delta:
                        delta = "\n\n" + delta
                    if delta:
                        streamed.append(delta)
                        await queue.put(sse_event("delta", {"text": delta}))
                    elif isinstance(event, AgentRunResultEvent):
                        # Store what was streamed, not only the final part, so the
                        # reply does not change when the turn ends.
                        text = "".join(streamed).strip() or str(event.result.output)
                        run_usage = event.result.usage
                        usage = {
                            "requests": run_usage.requests,
                            "input_tokens": run_usage.input_tokens,
                            "output_tokens": run_usage.output_tokens,
                        }
        except TurnError:
            raise
        except TimeoutError:
            raise TurnError("timeout", "The reply took too long. Try again.") from None
        except UsageLimitExceeded:
            raise TurnError(
                "too_many_steps", "That needed too many steps. Ask something narrower."
            ) from None
        except (UnexpectedModelBehavior, ModelHTTPError) as error:
            log.warning("agent_model_failed", error=type(error).__name__)
            raise TurnError("upstream_error", "The model did not answer.") from None
        except Exception as error:
            log.warning("agent_model_failed", error=type(error).__name__)
            raise TurnError("upstream_error", "The model did not answer.") from None
        if text is None:
            raise TurnError("upstream_error", "The model did not answer.")
        return Reply(text=text, pending_ids=pending), usage

    async def _settle(self, turn: Turn, reply: Reply):
        async with self.sessions() as session, session.begin():
            # A session revoked during the turn stores nothing.
            await authorize(session, turn.actor, turn.entity_uuid, lock=False)
            return await conversations.insert_turn(
                session,
                turn.user_id,
                turn.entity_id,
                turn.conversation_id,
                {
                    "role": "owner",
                    "content": turn.content,
                    "image_count": len(turn.images),
                },
                {
                    "role": "agent",
                    "content": reply.text,
                    "pending_change_ids": [UUID(i) for i in reply.pending_ids],
                },
                retention_days=self.config.agent_retention_days,
            )

    async def conversations(self, actor, entity_uuid) -> list[dict]:
        """The Entity's active conversations, latest turn first."""
        async with self.sessions() as session, session.begin():
            _, entity = await authorize(session, actor, entity_uuid, lock=False)
            rows = await conversations.active(session, actor.user_id, entity["id"])
        return [
            {
                "id": str(r["uuid"]),
                "title": conversations.title(r["first_question"]),
                "message_count": r["message_count"],
                "created_at": r["created_at"].isoformat(),
                "updated_at": r["updated_at"].isoformat(),
            }
            for r in rows
        ]

    async def read(self, actor, entity_uuid, conversation=LATEST) -> list[dict]:
        """One conversation's messages; LATEST with none yet is empty."""
        async with self.sessions() as session, session.begin():
            _, entity = await authorize(session, actor, entity_uuid, lock=False)
            row = await conversations.find(
                session,
                actor.user_id,
                entity["id"],
                None if conversation == LATEST else conversation,
            )
            if row is None and conversation != LATEST:
                raise not_found()
            rows = await conversations.messages(session, row["id"]) if row else []
        return [
            {
                "id": str(r["uuid"]),
                "role": r["role"],
                "content": r["content"],
                "image_count": r["image_count"],
                "pending_change_ids": [str(i) for i in r["pending_change_ids"]],
                "created_at": r["created_at"].isoformat(),
            }
            for r in rows
        ]

    async def archive(self, actor, entity_uuid, conversation=LATEST) -> bool:
        """Hides a conversation; its messages stay until retention removes them.
        Returns whether one was archived (LATEST with none is not an error)."""
        async with self.sessions() as session, session.begin():
            _, entity = await authorize(session, actor, entity_uuid, lock=True)
            row = await conversations.find(
                session,
                actor.user_id,
                entity["id"],
                None if conversation == LATEST else conversation,
            )
            if row is None:
                if conversation == LATEST:
                    return False
                raise not_found()
            await conversations.archive(session, row["id"])
            return True


def _pending_changes(payload) -> list[dict]:
    found = []
    if isinstance(payload, dict):
        change = payload.get("pending_change")
        if isinstance(change, dict):
            found.append(change)
        for value in payload.values():
            if isinstance(value, list | dict) and value is not change:
                found += _pending_changes(value)
    elif isinstance(payload, list):
        for value in payload:
            found += _pending_changes(value)
    return found


def _text_of(event) -> str:
    if isinstance(event, PartStartEvent) and isinstance(event.part, TextPart):
        return event.part.content
    if isinstance(event, PartDeltaEvent) and isinstance(event.delta, TextPartDelta):
        return event.delta.content_delta
    return ""
