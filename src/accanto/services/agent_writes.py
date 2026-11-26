"""Agent mode gate, Pending changes and their application (TDD 03).

Every catalog write goes through dispatch(). Inside the existing write()
transaction (Entity lock, retry lookup, audit and recorded outcome), the hook
reads the Agent mode and runs the existing command, stores a Pending
change, or rejects it (Read only). A Pending change records nothing; applying
it later runs the same command with the server key ``agent:{pending_id}``.
"""

from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import insert, select, union_all, update

from accanto.models import agent as a
from accanto.models import debts, income_estimates
from accanto.models import destinations as d
from accanto.models import monthly as m
from accanto.models import savings as s
from accanto.services import agent_settings
from accanto.services.access import AuthenticatedActor, RejectionError
from accanto.services.inbox import Hook, keep_rejection
from accanto.services.monthly import DryRun, authorize, json_values, scoped, write

# Deletes that cannot be restored always pend, even in Apply directly (PRD AG-06).
IRREVERSIBLE = frozenset(
    {"delete_savings_movement", "delete_observation", "delete_tag"}
)


def read_only() -> RejectionError:
    return RejectionError(
        "read_only",
        "The Agent mode is Read only: agents cannot change this Entity.",
        403,
    )


async def pends(session, entity, tool) -> bool:
    """The Agent mode decision; Read only rejects (catalog.writable checks first)."""
    mode = await agent_settings.mode(session, entity["id"])
    if mode == "read_only":
        raise read_only()
    return tool in IRREVERSIBLE or mode == "ask_first"


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

    async def before(self, session, entity, actor):
        # Under the Entity lock, so a mode change cannot race the write.
        if not self.force_run and await pends(session, entity, self.tool):
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
            likely = await pends(session, entity, tool)
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
        names = await record_names(
            session, entity["id"], {i for row in rows for i in uuids_in(row["input"])}
        )
        return [
            {
                **pending_view(row),
                "labels": {i: names[i] for i in uuids_in(row["input"]) if i in names},
            }
            for row in rows
        ]


# Records a draft may reference by id; the card shows their current names.
NAMED = (
    s.accounts,
    s.goals,
    m.fixed_costs,
    m.tags,
    m.spending_subcategories,
    d.investments,
    d.recipients,
    debts.debts,
    income_estimates.estimates,
)


def uuids_in(value) -> set[str]:
    """Every UUID string anywhere in a drafted input."""
    if isinstance(value, dict):
        return {i for v in value.values() for i in uuids_in(v)}
    if isinstance(value, list):
        return {i for v in value for i in uuids_in(v)}
    if isinstance(value, str) and len(value) == 36:
        try:
            return {str(UUID(value))}
        except ValueError:
            return set()
    return set()


async def record_names(session, entity_id, ids: set[str]) -> dict[str, str]:
    """Current names of the Entity's records among ids, in one query."""
    if not ids:
        return {}
    query = union_all(
        *(
            select(table.c.uuid, table.c.name).where(
                table.c.entity_id == entity_id, table.c.uuid.in_(ids)
            )
            for table in NAMED
        )
    )
    return {str(row.uuid): row.name for row in await session.execute(query)}


async def pending_row(session, actor, entity_uuid, pending_uuid):
    async with session.begin():
        _, entity = await authorize(session, actor, entity_uuid, lock=False)
        return await scoped(session, a.pending, entity["id"], pending_uuid)


async def drafted_order(session, actor, entity_uuid, pending_uuids) -> list[UUID]:
    """The given Pending changes oldest first; any unknown id refuses them all."""
    async with session.begin():
        _, entity = await authorize(session, actor, entity_uuid, lock=False)
        found = (
            await session.scalars(
                select(a.pending.c.uuid)
                .where(
                    a.pending.c.entity_id == entity["id"],
                    a.pending.c.uuid.in_(pending_uuids),
                )
                .order_by(a.pending.c.created_at, a.pending.c.id)
            )
        ).all()
    if len(found) != len(set(pending_uuids)):
        raise RejectionError(
            "record_not_found", "Record is unavailable in this Entity.", 404
        )
    return list(found)


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
            # A goal create overwrites nothing on its account, and the command
            # re-checks what it needs (account present and active). Rebase it so
            # goals drafted together still apply after each bumps the revision.
            if command.operation == "create_saving_goal":
                account = await scoped(
                    session, s.accounts, entity["id"], command.target
                )
                command.payload["expected_account_revision"] = account["revision"]

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
