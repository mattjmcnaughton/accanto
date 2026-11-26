"""The inbox proposal run: the built-in agent proposes for every waiting item (TDD 12).

A person starts a run from the Inbox (or the API). It is a job run of kind
`inbox_proposals` (TDD 11): each step reads the next 25 waiting items that have
no proposal, oldest first, asks the model for one proposal per item in a single
request, and stores each through the inbox's own propose command, which
validates references and dry-runs the record checks. Nothing is recorded.

- Every item in a step ends with a proposal, so the run always advances. When
  the model is unsure, returns nothing for an item, or returns a proposal the
  command rejects, the item gets an empty proposal whose rationale says why: it
  shows as "Needs you" in the Inbox.
- Each step acts as the owner through the session or API key that started the
  run, re-checked every step, under the `agent` interface. Signing out, a
  revoked key, the assistant turned off or Read only stops the run with a code.
- A step is safe to repeat: it only takes items still without a proposal, and
  each write's idempotency key names the run, item and revision.
"""

import hashlib
import json
import re

import structlog
from pydantic_ai.messages import ModelResponse, ToolCallPart
from pydantic_ai.models.function import AgentInfo, FunctionModel
from pydantic_ai.usage import UsageLimits
from sqlalchemy import func, select

from accanto.agents.inbox_proposer import build_proposer_agent
from accanto.dtos import tools as t
from accanto.models import inbox as st
from accanto.models import monthly as m
from accanto.repositories import jobs
from accanto.services import agent_settings, inbox
from accanto.services.access import RejectionError, resolve_stored_credential
from accanto.services.destinations import read_destinations
from accanto.services.jobs import Step, StepError
from accanto.services.monthly import authorize, read_plans
from accanto.services.openrouter import (
    STUB_MODEL_ID,
    AgentUnavailableError,
    agent_model_id,
    resolve_model,
)
from accanto.services.savings import read_accounts
from accanto.services.spending_subcategories import read_spending_subcategories
from accanto.services.tags import read_tags

KIND = "inbox_proposals"
CHUNK = 25
log = structlog.get_logger(__name__)
_agent = build_proposer_agent()


# Start, read and stop ---------------------------------------------------------


async def _settings_allow(session, entity_id):
    settings = await agent_settings.current(session, entity_id)
    if not settings["enabled"]:
        return "agent_disabled"
    if settings["mode"] == "read_only":
        return "read_only"
    return None


async def start_run(session, actor, entity_uuid, config):
    """Queue a run, or return the active one. Records nothing."""
    try:
        agent_model_id(config)
    except AgentUnavailableError as error:
        raise RejectionError("agent_unavailable", str(error), 503) from None
    async with session.begin():
        actor, entity = await authorize(session, actor, entity_uuid, lock=True)
        # Steps re-check this credential by UUID; OAuth (MCP) has none to store.
        if actor.credential_kind not in {"session", "api_key"}:
            raise RejectionError(
                "proposal_run_credential",
                "Start a proposal run from Accanto or with an API key.",
                403,
            )
        blocked = await _settings_allow(session, entity["id"])
        if blocked == "agent_disabled":
            raise RejectionError(
                "agent_disabled", "Turn on the assistant in Settings first.", 409
            )
        if blocked == "read_only":
            raise RejectionError(
                "read_only",
                "The Agent mode is Read only: agents cannot change this Entity.",
                403,
            )
        await jobs.start(
            session,
            entity["id"],
            KIND,
            actor.user_id,
            (actor.credential_kind, actor.credential_uuid),
        )
        return await _view(session, entity["id"])


async def read_run(session, actor, entity_uuid):
    async with session.begin():
        _, entity = await authorize(session, actor, entity_uuid, lock=False)
        return await _view(session, entity["id"])


async def stop_run(session, actor, entity_uuid):
    """Cancel the active run; proposals already set stay."""
    async with session.begin():
        _, entity = await authorize(session, actor, entity_uuid, lock=True)
        run = await jobs.latest(session, entity["id"], KIND)
        if run is not None:
            await jobs.cancel(session, entity["id"], run["uuid"])
        return await _view(session, entity["id"])


async def _view(session, entity_id):
    """The latest run's progress and the waiting items' proposal counts."""
    run = await jobs.latest(session, entity_id, KIND)
    has = func.coalesce(func.jsonb_typeof(st.staged.c.proposal), "null") == "object"
    waiting, proposed, unsure = (
        await session.execute(
            select(
                func.count(),
                func.count().filter(has),
                func.count().filter(
                    has,
                    st.staged.c.proposal["category"].astext.is_(None),
                    st.staged.c.proposal["skip"].astext != "true",
                    st.staged.c.proposal["refund_of"].astext.is_(None),
                ),
            ).where(st.staged.c.entity_id == entity_id, st.staged.c.status == "waiting")
        )
    ).one()
    return {
        "run": None
        if run is None
        else {
            "id": str(run["uuid"]),
            "state": run["state"],
            "steps": run["steps"],
            "counts": run["counts"],
            "error_code": run["error_code"],
            "started_at": run["created_at"].isoformat(),
            "finished_at": run["finished_at"] and run["finished_at"].isoformat(),
        },
        "waiting": waiting,
        "proposed": proposed,
        "needs_you": unsure,
        "chunk": CHUNK,
    }


# One step ---------------------------------------------------------------------


def _options(plans, accounts, investments, recipients, subcategories, tags):
    """Assignment ids by category, with names marked untrusted."""

    def named(rows):
        return [{"id": str(r.id), "name": {"untrusted": r.name}} for r in rows if r.id]

    lines: dict[str, dict] = {"income": {}, "fixed_cost": {}}
    for plan in plans:
        for revision in t.project_plan(plan).revisions:
            for line in revision.incomes:
                lines["income"][line.id] = line
            for line in revision.fixed_costs:
                lines["fixed_cost"][line.id] = line
    goals = [
        {"id": str(g.id), "name": {"untrusted": f"{a.name}: {g.name}"}}
        for a in t.project_savings(accounts).accounts
        if a.active
        for g in a.goals
    ]

    def active(rows):
        return [r for r in rows if r.active]

    return {
        "income": named(lines["income"].values()),
        "fixed_cost": named(lines["fixed_cost"].values()),
        "spending": named(
            active(
                t.project_spending_subcategories(subcategories).spending_subcategories
            )
        ),
        "saving": goals,
        "investing": named(
            active(t.project_destinations("investment", investments).destinations)
        ),
        "giving": named(
            active(t.project_destinations("giving", recipients).destinations)
        ),
        "tags": named(active(t.project_tags(tags).tags)),
    }


def _prompt(items, options, agent_md):
    facts = [
        {
            "item_id": str(it.id),
            "date": it.date.isoformat(),
            "amount": str(it.amount),
            "payee": {"untrusted": it.payee},
            "memo": it.memo and {"untrusted": it.memo},
            "account": {"untrusted": it.account_name},
            "source_category": it.source_category and {"untrusted": it.source_category},
            "kind": it.kind,
        }
        for it in items
    ]
    parts = [
        f"ITEMS:\n{json.dumps(facts)}",
        f"OPTIONS:\n{json.dumps(options)}",
    ]
    if agent_md.strip():
        parts.append(f"AGENT.md (the owner's standing preferences):\n{agent_md}")
    return "\n\n".join(parts)


def proposal_step(config, sessions, model_resolver=None):
    """The job handler for `inbox_proposals`, bound to sessions and config."""

    def model():
        if model_resolver is not None:
            return model_resolver(config)
        if agent_model_id(config) == STUB_MODEL_ID:
            return build_stub_proposer()
        return resolve_model(config)

    async def step(run) -> Step:
        if run.credential_kind is None or run.credential_uuid is None:
            raise StepError("proposal_run_credential")
        async with sessions() as session:
            async with session.begin():
                try:
                    actor = await resolve_stored_credential(
                        session, run.credential_kind, run.credential_uuid
                    )
                except RejectionError:
                    raise StepError("invalid_credential") from None
                actor = actor.acting_as("agent")
                entity_uuid = await session.scalar(
                    select(m.entities.c.uuid).where(m.entities.c.id == run.entity_id)
                )
                try:
                    _, entity = await authorize(session, actor, entity_uuid, lock=False)
                except RejectionError:
                    raise StepError("entity_not_found") from None
                blocked = await _settings_allow(session, entity["id"])
                if blocked:
                    raise StepError(blocked)
                agent_md = (await agent_settings.current(session, entity["id"]))[
                    "instructions"
                ]
            rows = await inbox.read_inbox(
                session,
                actor,
                entity_uuid,
                statuses=["waiting"],
                month=None,
                source=None,
                proposed=False,
                limit=CHUNK,
            )
            if not rows:
                return Step(done=True)
            items = [t.project_item(row) for row in rows]
            options = _options(
                await read_plans(session, actor, entity_uuid),
                await read_accounts(session, actor, entity_uuid),
                await read_destinations(session, actor, entity_uuid, "investment"),
                await read_destinations(session, actor, entity_uuid, "giving"),
                await read_spending_subcategories(session, actor, entity_uuid),
                await read_tags(session, actor, entity_uuid),
            )
        try:
            result = await _agent.run(
                _prompt(items, options, agent_md),
                model=model(),
                usage_limits=UsageLimits(request_limit=2),
            )
            answers = {p.item_id: p for p in result.output.proposals}
        except AgentUnavailableError:
            raise StepError("agent_unavailable") from None
        except Exception as error:
            log.warning("inbox_proposal_model_failed", error=type(error).__name__)
            raise StepError("upstream_error") from None

        counts = {"proposed": 0, "needs_you": 0, "failed": 0}
        for it in items:
            answer = answers.get(it.id)
            body = (
                answer.model_dump(mode="json", exclude={"item_id"})
                if answer
                else {"rationale": "Not sure: the agent returned nothing for this."}
            )
            written = await _propose(sessions, actor, entity_uuid, run, it, body)
            if written is None and answer is not None:
                written = await _propose(
                    sessions,
                    actor,
                    entity_uuid,
                    run,
                    it,
                    {"rationale": "Not sure: the agent's proposal was not valid."},
                )
            if written is None:
                counts["failed"] += 1
            elif written:
                counts["proposed"] += 1
            else:
                counts["needs_you"] += 1
        # A step that set nothing cannot advance; stop instead of repeating it.
        done = counts["proposed"] + counts["needs_you"] == 0 or len(items) < CHUNK
        return Step(counts=counts, done=done)

    return step


async def _propose(sessions, actor, entity_uuid, run, it, body):
    """Set one proposal: True when it chooses something, False when it is
    empty (Needs you), None when the command rejected it."""
    fields = {**body, "expected_revision": it.revision}
    fields["rationale"] = (fields.get("rationale") or "")[:2000]
    # One key per run, item, revision and attempt (proposal or its fallback).
    key = hashlib.sha256(
        f"proposal-run:{run.uuid}:{it.id}:{it.revision}:{len(body)}".encode()
    ).hexdigest()
    try:
        async with sessions() as session:
            await inbox.propose(session, actor, entity_uuid, it.id, key, fields)
    except RejectionError as error:
        if error.status == 401 or error.code == "entity_not_found":
            raise StepError(error.code) from None
        return None
    return bool(body.get("category") or body.get("skip") or body.get("refund_of"))


# The deterministic stand-in (AGENT_MODEL=stub) --------------------------------

_ITEMS = re.compile(r"^ITEMS:\n(.*)$", re.M)


def _stub(messages, info: AgentInfo) -> ModelResponse:
    """Transfers are skipped, payees with "Unknown" stay unsure, other outflows
    are guilt-free spending and inflows unassigned income."""
    text = "".join(
        str(part.content)
        for message in messages
        for part in message.parts
        if getattr(part, "part_kind", "") == "user-prompt"
    )
    match = _ITEMS.search(text)
    items = json.loads(match.group(1)) if match else []
    proposals = []
    for item in items:
        base = {"item_id": item["item_id"]}
        payee = item["payee"]["untrusted"]
        if item["kind"] != "ordinary":
            proposals.append({**base, "skip": True, "rationale": "Stub: a transfer."})
        elif "Unknown" in payee:
            proposals.append({**base, "rationale": "Not sure: stub cannot tell."})
        elif item["amount"].startswith("-"):
            proposals.append(
                {**base, "category": "spending", "rationale": "Stub: an outflow."}
            )
        else:
            proposals.append(
                {
                    **base,
                    "category": "income",
                    "assignment": "unassigned",
                    "rationale": "Stub: an inflow.",
                }
            )
    return ModelResponse(
        parts=[ToolCallPart(info.output_tools[0].name, {"proposals": proposals})]
    )


def build_stub_proposer() -> FunctionModel:
    return FunctionModel(_stub)
