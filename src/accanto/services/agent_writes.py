"""Agent mode gate, Pending changes and their application (TDD 03).

Every catalog write goes through dispatch(). Inside the existing write()
transaction (Entity lock, retry lookup, audit and recorded outcome), the hook
reads the Agent mode and either runs the existing command or stores a Pending
change. A Pending change records nothing; applying it later runs the same
command with the server key ``agent:{pending_id}``.
"""

from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import insert, select, update

from accanto.models import agent as a
from accanto.services import agent_settings
from accanto.services.access import AuthenticatedActor, RejectionError
from accanto.services.inbox import Hook, keep_rejection
from accanto.services.monthly import DryRun, authorize, json_values, scoped, write

# Deletes that cannot be restored always pend, in both Agent modes (PRD AG-06).
IRREVERSIBLE = frozenset(
    {"delete_savings_movement", "delete_observation", "delete_tag"}
)


@dataclass
class Command:
    """One existing service command, as write() dispatches it."""

    operation: str
    payload: dict
    target: UUID | date | None = None
    # Inbox record/undo/resolve run through their own write() hook.
    hook: Callable[[], Hook] | None = None


def pending_view(row) -> dict:
    return json_values(
        {
            "id": row["uuid"],
            "tool": row["tool"],
            "summary": row["summary"],
            "status": row["status"],
            "created_by_interface": row["created_by_interface"],
            "input": row["input"],
            "created_at": row["created_at"],
            "resolved_at": row["resolved_at"],
            "revision": row["revision"],
        }
    )


async def store_pending(session, entity, actor, payload):
    """Dispatched by write() for "draft_pending_change"; no financial effect."""
    row = (
        (
            await session.execute(
                insert(a.pending)
                .values(
                    entity_id=entity["id"],
                    created_by_interface=actor.interface,
                    tool=payload["tool"],
                    operation=payload["operation"],
                    input=payload["input"],
                    target=payload["target"],
                    expected_revision=payload["expected_revision"],
                    summary=payload["summary"][:400],
                )
                .returning(a.pending)
            )
        )
        .mappings()
        .one()
    )
    return pending_view(row)


class AgentHook(Hook):
    """Decide under the Entity lock: run the command now, or draft it."""

    interface = None

    def __init__(
        self, tool, tool_input, command: Command, summary, *, run=False, draft=None
    ):
        self.tool, self.tool_input, self.command = tool, tool_input, command
        self.summary, self.force_run, self.draft = summary, run, draft
        self.inner: Hook | None = None
        self.pended = False

    async def pends(self, session, entity, actor) -> bool:
        if self.force_run:
            return False
        # The built-in agent never writes from inside a model run (TDD 03).
        if actor.interface == "agent" or self.tool in IRREVERSIBLE:
            return True
        return await agent_settings.mode(session, entity["id"]) == "propose"

    async def before(self, session, entity, actor):
        if await self.pends(session, entity, actor):
            self.pended = True
            return (
                "draft_pending_change",
                {
                    "tool": self.tool,
                    # Sidebar draft notes (uncertain fields, source text) ride
                    # with the input for the card; rebuild() strips them.
                    "input": {**self.tool_input, "_draft": self.draft}
                    if self.draft
                    else self.tool_input,
                    "operation": self.command.operation,
                    "target": str(self.command.target) if self.command.target else None,
                    "expected_revision": self.tool_input.get("expected_revision"),
                    "summary": self.summary,
                },
                None,
            )
        if self.command.hook:
            self.inner = self.command.hook()
            result = await self.inner.before(session, entity, actor)
            self.interface = self.inner.interface
            return result
        return self.command.operation, self.command.payload, self.command.target

    async def after(self, session, entity, actor, response, audit):
        if self.pended:
            return {"status": "pending", "pending_change": response}
        if self.inner:
            response = await self.inner.after(session, entity, actor, response, audit)
        return {"status": "recorded", "result": response}


def scope_of(tool, command: Command) -> str:
    return f"agent:{tool}:{command.target or ''}"


async def dispatch(
    sessions,
    actor: AuthenticatedActor,
    entity_uuid: UUID,
    tool: str,
    tool_input: dict,
    command: Command,
    request_key: str,
    summary: str,
    draft: dict | None = None,
):
    """Run or draft one catalog write; returns {"status", ...} (JSON values)."""
    tool_input = json_values(tool_input)
    scope = scope_of(tool, command)
    async with sessions() as session:
        async with session.begin():
            _, entity = await authorize(session, actor, entity_uuid, lock=False)
            likely = (
                actor.interface == "agent"
                or tool in IRREVERSIBLE
                or await agent_settings.mode(session, entity["id"]) == "propose"
            )
        if likely:
            # Validate the draft with the command's own checks, rolled back. A
            # recorded outcome for this key is returned unchanged (replay).
            try:
                return await write(
                    session,
                    actor,
                    entity_uuid,
                    tool,
                    request_key,
                    tool_input,
                    command.target,
                    hook=AgentHook(tool, tool_input, command, summary, run=True),
                    scope=scope,
                    dry_run=True,
                )
            except DryRun:
                pass
        hook = AgentHook(tool, tool_input, command, summary, draft=draft)
        try:
            return await write(
                session,
                actor,
                entity_uuid,
                tool,
                request_key,
                tool_input,
                command.target,
                hook=hook,
                scope=scope,
            )
        except RejectionError as error:
            if getattr(hook.inner, "checked", False) and command.operation == (
                "inbox_record"
            ):
                await keep_rejection(session, actor, entity_uuid, command.target, error)
            raise


# Pending change lifecycle (browser session only; see routers/agent.py) --------


async def read_pending(session, actor, entity_uuid, *, status=None):
    async with session.begin():
        _, entity = await authorize(session, actor, entity_uuid, lock=False)
        query = select(a.pending).where(a.pending.c.entity_id == entity["id"])
        if status:
            query = query.where(a.pending.c.status == status)
        rows = (
            (await session.execute(query.order_by(a.pending.c.created_at.desc())))
            .mappings()
            .all()
        )
        return [pending_view(row) for row in rows]


async def pending_row(session, actor, entity_uuid, pending_uuid):
    async with session.begin():
        _, entity = await authorize(session, actor, entity_uuid, lock=False)
        return await scoped(session, a.pending, entity["id"], pending_uuid)


async def apply(
    sessions,
    actor: AuthenticatedActor,
    entity_uuid: UUID,
    pending_uuid: UUID,
    rebuild: Callable[[str, dict], tuple[dict, Command, str]],
    edited_input: dict | None = None,
):
    """Apply once with key agent:{pending_id}; a retry returns the same outcome.

    rebuild(tool, input) validates the (possibly owner-edited) input with the
    tool's own input model and returns (input, command, summary).
    """
    actor = actor.acting_as("agent")
    async with sessions() as session:
        row = await pending_row(session, actor, entity_uuid, pending_uuid)
        tool_input, command, summary = rebuild(
            row["tool"], edited_input if edited_input is not None else row["input"]
        )

        async def guard(session, entity):
            current = (
                (
                    await session.execute(
                        select(a.pending)
                        .where(a.pending.c.id == row["id"])
                        .with_for_update()
                    )
                )
                .mappings()
                .one()
            )
            if current["status"] != "pending":
                raise RejectionError(
                    "pending_change_resolved",
                    "This pending change was already applied or dismissed.",
                )

        async def finish(session, entity, response):
            await session.execute(
                update(a.pending)
                .where(a.pending.c.id == row["id"])
                .values(
                    status="applied",
                    input=json_values(tool_input),
                    resolved_at=datetime.now(UTC),
                    revision=a.pending.c.revision + 1,
                )
            )

        hook = AgentHook(
            row["tool"], json_values(tool_input), command, summary, run=True
        )
        try:
            return await write(
                session,
                actor,
                entity_uuid,
                row["tool"],
                f"agent:{pending_uuid}",
                json_values(tool_input),
                command.target,
                hook=hook,
                scope=f"apply_pending:{pending_uuid}",
                guard=guard,
                finish=finish,
            )
        except RejectionError as error:
            if getattr(hook.inner, "checked", False) and command.operation == (
                "inbox_record"
            ):
                await keep_rejection(session, actor, entity_uuid, command.target, error)
            raise


async def dismiss(session, actor, entity_uuid, pending_uuid, expected_revision):
    """A status change on a draft; not financial activity, so no audit row."""
    async with session.begin():
        _, entity = await authorize(session, actor, entity_uuid, lock=True)
        row = await scoped(session, a.pending, entity["id"], pending_uuid)
        if row["revision"] != expected_revision:
            raise RejectionError(
                "stale_revision",
                "Reload the current record and reconcile your changes.",
            )
        if row["status"] != "pending":
            raise RejectionError(
                "pending_change_resolved",
                "This pending change was already applied or dismissed.",
            )
        record = (
            (
                await session.execute(
                    update(a.pending)
                    .where(a.pending.c.id == row["id"])
                    .values(
                        status="dismissed",
                        resolved_at=datetime.now(UTC),
                        revision=row["revision"] + 1,
                    )
                    .returning(a.pending)
                )
            )
            .mappings()
            .one()
        )
        return pending_view(record)


def record_id(response: Any):
    """The id of the record a command wrote, across command response shapes."""
    if not isinstance(response, dict):
        return None
    for key in ("uuid", "plan_id", "id"):
        if response.get(key):
            return str(response[key])
    entry = response.get("entry")
    if isinstance(entry, dict) and entry.get("uuid"):
        return str(entry["uuid"])
    return None
