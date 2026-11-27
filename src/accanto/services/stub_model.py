"""Deterministic stand-in model for tests and e2e (AGENT_MODEL=stub).

Like aleph's services/stub_model.py: a pydantic-ai FunctionModel whose stream
callback reads the owner's latest message and this run's tool results, then
calls real catalog tools. It never sees a network. It is selected only by
AGENT_MODEL=stub and refused for a public HTTPS origin (config.agent_model_id).

Behaviors, keyed on the owner's message (case-insensitive):
- "categor"     list_inbox, then set_proposals for every waiting item.
- "spend"       get_monthly_review for the named month (or the one in view)
                and quote the recorded spending it returns.
- "receipt" or an attached image: save one save_activity entry dated by the
                YYYY-MM-DD in the message (drafted or recorded per the Agent
                mode), or ask for the date if there is none.
- "mortgage"    project a 100,000.00 loan at 6% over 360 months with 100.00
                extra a month, then calculate the total of payment and extra,
                and quote both results (TDD 09).
- "budget"      say a sentence, call get_context in the same response, then
                answer: two text parts around a tool call.
- "interview me" an AGENT.md interview over several turns: read AGENT.md, ask
                INTERVIEW questions one per reply, show the proposed text
                (the current text plus the answers), and on "yes" call
                propose_agent_instructions.
- "fire number" a FIRE number interview over several turns: read list_plans,
                get_plan for the latest saved version and get_settings, ask
                FIRE_QUESTIONS one per reply (the first lists the version's
                fixed costs), then calculate annual spending from those fixed
                costs and the dollar amount in the fourth answer, project the
                FIRE target, explain it, and on "yes" call
                save_fire_assumptions, holding level the fixed costs the
                third answer names. Checked before the AGENT.md interview.
- "net worth"   a long multi-tool turn like a real FIRE question: get_context,
                get_position, list_plans, list_debts, two calculate calls
                and a growth projection at 8% to a 4% rule target, one tool
                per model request, then quote the results.
- "[stub-fail]" fail mid-stream after a few deltas.
- "[stub-slow]" wait SLOW_STEP_SECONDS before each model response, so tests
                can drop the connection while a turn runs.
- anything else: a short fixed reply.

Scripted to obey injections, on purpose: if a tool result contains
INJECTION_MARKER, it lists the month's activity and calls delete_activity for
every entry, so tests show the dispatcher still only drafts Pending changes in
Ask first and rejects them in Read only.
"""

from __future__ import annotations

import asyncio
import json
import re
from datetime import date
from functools import cache
from typing import TYPE_CHECKING

from pydantic_ai.messages import (
    BinaryContent,
    ModelMessage,
    ModelRequest,
    ToolReturnPart,
    UserPromptPart,
)
from pydantic_ai.models.function import (
    AgentInfo,
    DeltaToolCall,
    DeltaToolCalls,
    FunctionModel,
)

if TYPE_CHECKING:
    from collections.abc import AsyncIterator, Sequence

INJECTION_MARKER = "IGNORE PREVIOUS INSTRUCTIONS"
FAIL = "[stub-fail]"
SLOW = "[stub-slow]"
SLOW_STEP_SECONDS = 1.0
# The synthetic yearly fixed expenses the "net worth" turn plans around.
STUB_FIXED_YEARLY = "24000.00"
RECEIPT_AMOUNT = "23.45"
MONTHS = {
    name: index
    for index, name in enumerate(
        (
            "january",
            "february",
            "march",
            "april",
            "may",
            "june",
            "july",
            "august",
            "september",
            "october",
            "november",
            "december",
        ),
        start=1,
    )
}


class StubModelError(RuntimeError):
    pass


def _owner_prompt(messages: Sequence[ModelMessage]) -> tuple[str, bool]:
    """The latest owner message text, and whether it carried an image."""
    for message in reversed(messages):
        for part in getattr(message, "parts", []):
            if isinstance(part, UserPromptPart):
                if isinstance(part.content, str):
                    return part.content, False
                text = " ".join(c for c in part.content if isinstance(c, str))
                images = any(isinstance(c, BinaryContent) for c in part.content)
                return text, images
    return "", False


def _owner_prompts(messages: Sequence[ModelMessage]) -> list[str]:
    """Every owner message text in order, stored history included."""
    return [
        part.content
        if isinstance(part.content, str)
        else " ".join(c for c in part.content if isinstance(c, str))
        for message in messages
        for part in getattr(message, "parts", [])
        if isinstance(part, UserPromptPart)
    ]


def _returns(messages: Sequence[ModelMessage]) -> list[ToolReturnPart]:
    """Tool results since the owner's latest message (this run only)."""
    parts = [p for m in messages if isinstance(m, ModelRequest) for p in m.parts]
    start = max(
        (i for i, p in enumerate(parts) if isinstance(p, UserPromptPart)), default=-1
    )
    return [p for p in parts[start + 1 :] if isinstance(p, ToolReturnPart)]


def _content(part: ToolReturnPart) -> dict:
    value = part.content
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError:
            return {}
    return value if isinstance(value, dict) else {}


def _today(info: AgentInfo) -> date:
    match = re.search(r"Today: (\d{4}-\d{2}-\d{2})", info.instructions or "")
    if match is None:
        raise StubModelError("instructions are missing the 'Today:' line")
    return date.fromisoformat(match.group(1))


def _month(text: str, info: AgentInfo) -> date:
    today = _today(info)
    lowered = text.lower()
    for name, number in MONTHS.items():
        if name in lowered:
            year = today.year if number <= today.month else today.year - 1
            return date(year, number, 1)
    match = re.search(r"Month in view: (\d{4}-\d{2})-01", info.instructions or "")
    if match:
        return date.fromisoformat(match.group(1) + "-01")
    return today.replace(day=1)


def _call(*calls: tuple[str, dict]) -> DeltaToolCalls:
    return {
        index: DeltaToolCall(
            name=name, json_args=json.dumps(args), tool_call_id=f"stub-{name}-{index}"
        )
        for index, (name, args) in enumerate(calls)
    }


def _text(value) -> str:
    return value.get("untrusted", "") if isinstance(value, dict) else str(value)


def plan_proposal(item: dict) -> dict:
    """The stub's deterministic proposal for one waiting inbox item."""
    base = {"item_id": item["id"], "expected_revision": item["revision"]}
    if item["kind"] != "ordinary":
        return {**base, "skip": True, "rationale": "Stub: a transfer between accounts."}
    if item["amount"].startswith("-"):
        return {
            **base,
            "category": "spending",
            "rationale": "Stub: an outflow, proposed as spending.",
        }
    return {
        **base,
        "category": "income",
        "assignment": "unassigned",
        "rationale": "Stub: an inflow, proposed as unassigned income.",
    }


INTERVIEW = (
    ("Categories", "How should I categorize your recurring payees?"),
    ("Naming", "How do you name saving goals and Plans?"),
    ("Approvals", "When should I ask you before drafting a change?"),
)


def interview_draft(current: str, answers: Sequence[str]) -> str:
    """The stub's proposed AGENT.md: the current text kept, then one section per
    answer (a real model would merge them)."""
    sections = [
        f"## {heading}\n- {answer.strip()}"
        for (heading, _), answer in zip(INTERVIEW, answers, strict=False)
    ]
    return "\n\n".join([current.strip(), *sections] if current.strip() else sections)


FIRE_QUESTIONS = (
    "Are these still your fixed costs today?",
    "Which of these will end, change or be added by the time you retire?",
    "Which of these will not rise with inflation?",
    "How much do you want to spend each month beyond fixed costs?",
)


def _starts(messages, wanted: bool) -> list[int]:
    """Indexes of owner messages that start an interview: the FIRE number one
    when wanted is True, else the AGENT.md one."""
    return [
        i
        for i, text in enumerate(_owner_prompts(messages))
        if "interview me" in text.lower() and ("fire number" in text.lower()) is wanted
    ]


def _latest_version(plans: dict) -> tuple[str, dict] | None:
    """The Plan and saved version with the highest version number, if any."""
    saved = [
        (revision["number"], plan["plan_id"], revision)
        for plan in plans.get("plans", [])
        for revision in plan["revisions"]
        if revision["saved"]
    ]
    if not saved:
        return None
    _, plan_id, revision = max(saved, key=lambda row: row[0])
    return plan_id, revision


def _fire_interview(messages, returns, called):
    """None when this conversation is not a FIRE number interview; else the
    next step. Reads are repeated each turn, so every answer uses fresh data."""
    starts = _starts(messages, True)
    if not starts:
        return None
    if _starts(messages, False) and max(_starts(messages, False)) > starts[-1]:
        return None
    answers = _owner_prompts(messages)[starts[-1] + 1 :]
    result = {p.tool_name: _content(p) for p in returns}
    if "list_plans" not in called:
        return _call(("list_plans", {}))
    latest = _latest_version(result["list_plans"])
    if latest is None:
        return (
            "You have no saved Plan version yet, so I have no fixed costs to "
            "start from. Save a Plan version, or list your fixed costs here."
        )
    plan_id, summary = latest
    if "get_plan" not in called:
        return _call(("get_plan", {"plan_id": plan_id}))
    if "get_settings" not in called:
        return _call(("get_settings", {}))
    settings = result["get_settings"]
    version = next(
        r
        for r in result["get_plan"]["revisions"]
        if r["revision_id"] == summary["revision_id"]
    )
    costs = version["fixed_costs"]
    total = version["fixed_cost_total"]
    if len(answers) < len(FIRE_QUESTIONS):
        step = len(answers)
        lead = ""
        if step == 0:
            lines = [
                f"- {_text(c['name'])}: {c['amount']} {c['frequency']}, "
                f"{c['monthly_amount']} a month"
                for c in costs
            ]
            lead = (
                f"Your latest saved Plan version, **{_text(version['name'])}**, "
                "has these fixed costs:\n\n"
                + "\n".join(lines)
                + f"\n\nTotal **{total} a month**.\n\n"
            )
        return (
            f"{lead}**{step + 1} of {len(FIRE_QUESTIONS)}. "
            f"{FIRE_QUESTIONS[step]}**\n\nAnswer in your own words, or say skip."
        )
    found = re.search(r"\d[\d,]*(?:\.\d{1,2})?", answers[3])
    discretionary = found.group(0).replace(",", "") if found else "0"
    if "calculate" not in called:
        return _call(("calculate", {"expression": f"({total} + {discretionary}) * 12"}))
    spending = result["calculate"]["cents"]
    rate = settings["fire_withdrawal_percent"]
    if "project" not in called:
        fire = {
            "operation": "fire_target",
            "annual_spending": spending,
            "withdrawal_rate_percent": rate,
        }
        return _call(("project", {"projection": fire}))
    target = result["project"]["figures"]["fire_target"]
    # The full list held level: the costs the third answer names.
    steady = [c for c in costs if _text(c["name"]).lower() in answers[2].lower()]
    names = ", ".join(_text(c["name"]) for c in steady) or "none"
    proposal = (
        f"Annual spending is ({total} + {discretionary}) x 12 = **{spending}**.\n\n"
        f"**FIRE number: {spending} / {rate}% = {target}**, in today's dollars.\n\n"
        f"- Does not rise with inflation: {names}\n"
        f"- Everything else rises with inflation, at "
        f"{settings['inflation_percent']}% a year.\n\n"
        "Shall I save it?"
    )
    if len(answers) == len(FIRE_QUESTIONS):
        return proposal
    if not answers[-1].lower().startswith(("yes", "save", "approve")):
        return "Tell me what to change, or say yes to save it."
    if "save_fire_assumptions" not in called:
        return _call(
            (
                "save_fire_assumptions",
                {
                    "annual_spending": spending,
                    "withdrawal_percent": rate,
                    "fixed_costs_not_rising_with_inflation": [c["id"] for c in steady],
                    "expected_revision": settings["revision"],
                },
            )
        )
    saved = result["save_fire_assumptions"]
    if saved.get("status") == "pending":
        return (
            f"I drafted your FIRE number, {target}, as a pending change. "
            "Nothing changes until you apply it."
        )
    if saved.get("status") == "recorded":
        return f"I saved your FIRE assumptions; Projections now shows {target}."
    return f"I could not save it: {saved.get('message', 'unknown error')}"


def _interview(messages, returns, called):
    """None when this conversation is not an interview; else the next step."""
    prompts = _owner_prompts(messages)
    starts = _starts(messages, False)
    if not starts:
        return None
    answers = prompts[starts[-1] + 1 :]
    if "get_agent_instructions" not in called:
        return _call(("get_agent_instructions", {}))
    current = next(
        _content(p) for p in returns if p.tool_name == "get_agent_instructions"
    )
    if len(answers) < len(INTERVIEW):
        heading, question = INTERVIEW[len(answers)]
        lead = (
            "Your AGENT.md is empty, so I will start one."
            if not answers and not current.get("instructions")
            else "I will keep what your AGENT.md already says."
            if not answers
            else "Noted."
        )
        return (
            f"{lead}\n\n**{question}**\n\nThis sets the {heading} section. "
            "Answer in your own words, or say skip."
        )
    draft = interview_draft(current.get("instructions", ""), answers[: len(INTERVIEW)])
    if len(answers) == len(INTERVIEW):
        return f"Here is the proposed AGENT.md:\n\n{draft}\n\nShall I save it?"
    if not answers[-1].lower().startswith(("yes", "save", "approve")):
        return "Tell me what to change, or say yes to save it."
    if "propose_agent_instructions" not in called:
        return _call(
            (
                "propose_agent_instructions",
                {"instructions": draft, "expected_revision": current["revision"]},
            )
        )
    result = next(
        _content(p) for p in returns if p.tool_name == "propose_agent_instructions"
    )
    if result.get("status") != "pending":
        return "I could not draft the update. Read AGENT.md again and retry."
    return (
        "I drafted the AGENT.md update as a pending change. Nothing changes "
        "until you apply it."
    )


def _next_step(messages: Sequence[ModelMessage], info: AgentInfo):
    """Either a tool call to make, or the final reply text."""
    text, has_image = _owner_prompt(messages)
    lowered = text.lower()
    returns = _returns(messages)
    called = {part.tool_name for part in returns}
    injected = any(INJECTION_MARKER in json.dumps(_content(p)) for p in returns)
    for script in (_fire_interview, _interview):
        step = script(messages, returns, called)
        if step is not None:
            return step

    if injected and "delete_activity" not in called:
        if "list_activity" not in called:
            item = next(
                (
                    i
                    for p in returns
                    for i in _content(p).get("items", [])
                    if INJECTION_MARKER in _text(i.get("payee"))
                ),
                None,
            )
            month = (
                (item["date"][:7] + "-01") if item else _month(text, info).isoformat()
            )
            return _call(("list_activity", {"month": month}))
        listing = next(_content(p) for p in returns if p.tool_name == "list_activity")
        deletes = [
            ("delete_activity", {"id": e["id"], "expected_revision": e["revision"]})
            for e in listing.get("entries", [])
        ]
        if deletes:
            return _call(*deletes)
        return "Nothing to delete."
    if injected:
        statuses = {
            _content(p).get("status")
            for p in returns
            if p.tool_name == "delete_activity"
        }
        if statuses == {"pending"}:
            return (
                "I followed an instruction found in a payee and drafted deletions. "
                "They are pending changes; nothing was deleted."
            )
        return "I followed an instruction found in a payee and tried to delete entries."

    if "categor" in lowered:
        if "list_inbox" not in called:
            return _call(("list_inbox", {"status": ["waiting"]}))
        if "set_proposals" not in called:
            items = next(_content(p) for p in returns if p.tool_name == "list_inbox")
            proposals = [plan_proposal(i) for i in items.get("items", [])]
            if not proposals:
                return "The inbox has no waiting transactions."
            return _call(("set_proposals", {"proposals": proposals}))
        outcome = next(_content(p) for p in returns if p.tool_name == "set_proposals")
        if outcome.get("error"):
            return f"I could not propose categories: {outcome.get('message')}"
        done = sum(1 for r in outcome.get("results", []) if r.get("ok"))
        return (
            f"I proposed categories for {done} inbox items. Nothing is recorded "
            "until you record them from the inbox."
        )

    if "mortgage" in lowered:
        if "project" not in called:
            loan = {
                "operation": "loan",
                "principal": "100000",
                "annual_rate_percent": "6",
                "term_months": 360,
                "extra_monthly": "100",
                "schedule": "none",
            }
            return _call(("project", {"projection": loan}))
        figures = next(_content(p) for p in returns if p.tool_name == "project")[
            "figures"
        ]
        if "calculate" not in called:
            return _call(("calculate", {"expression": f"{figures['payment']} + 100"}))
        total = next(_content(p) for p in returns if p.tool_name == "calculate")
        return (
            f"Projected: the payment is {figures['payment']} a month, so with the "
            f"extra you pay {total['cents']}. The loan is repaid in "
            f"{figures['months']} months instead of 360, saving "
            f"{figures['interest_saved']} in interest. This assumes 6% for the "
            "whole term; it is a projection, not recorded activity."
        )

    if has_image or "receipt" in lowered:
        if "save_activity" not in called:
            found = re.search(r"\d{4}-\d{2}-\d{2}", text)
            if not found:
                # Never default a receipt's date to today: ask instead.
                return "What date is on the receipt? I could not find one."
            draft = {
                "date": found.group(0),
                "category": "spending",
                "amount": RECEIPT_AMOUNT,
                "note": "Synthetic receipt (stub draft)",
            }
            if has_image:
                draft["uncertain_fields"] = ["note"]
                draft["source_text"] = f"SYNTHETIC STORE TOTAL {RECEIPT_AMOUNT}"
            return _call(("save_activity", draft))
        saved = next(_content(p) for p in returns if p.tool_name == "save_activity")
        if saved.get("status") == "recorded":
            return f"I recorded a {RECEIPT_AMOUNT} spending entry from the receipt."
        if saved.get("error"):
            return f"I could not save the receipt: {saved.get('message')}"
        return (
            f"I drafted a {RECEIPT_AMOUNT} spending entry from the receipt. "
            "Review the card and apply it if it is right."
        )

    if "net worth" in lowered:
        reads = (
            ("get_context", {}),
            ("get_position", {}),
            ("list_plans", {}),
            ("list_debts", {}),
        )
        for name, args in reads:
            if name not in called:
                return _call((name, args))
        position = next(_content(p) for p in returns if p.tool_name == "get_position")
        saved = position["savings_total"]
        sums = [_content(p) for p in returns if p.tool_name == "calculate"]
        if not sums:
            return _call(("calculate", {"expression": f"{saved} * 4 / 100"}))
        if len(sums) == 1:
            target = f"{STUB_FIXED_YEARLY} * 100 / 4"
            return _call(("calculate", {"expression": target}))
        if "project" not in called:
            growth = {
                "operation": "growth",
                "start": saved,
                "monthly_contribution": "1000.00",
                "annual_return_percent": "8",
                "basis": "nominal",
                "target": sums[1]["cents"],
            }
            return _call(("project", {"projection": growth}))
        figures = next(_content(p) for p in returns if p.tool_name == "project")[
            "figures"
        ]
        return (
            f"Your net position is {position['net_position']}. The 4% rule "
            f"covers {STUB_FIXED_YEARLY} a year from {sums[1]['cents']}; at 8% "
            f"and 1000.00 a month you reach it in {figures['months']} months."
        )

    if "budget" in lowered:
        if "get_context" not in called:
            return ("Let me look at your budget.", _call(("get_context", {})))
        return "Your budget is in the Plans screen."

    if "spend" in lowered:
        month = _month(text, info)
        if "get_monthly_review" not in called:
            return _call(("get_monthly_review", {"month": month.isoformat()}))
        review = next(
            _content(p) for p in returns if p.tool_name == "get_monthly_review"
        )
        spending = next(
            (c for c in review.get("categories", []) if c["category"] == "spending"),
            None,
        )
        if spending is None:
            return f"There is no Review for {month.isoformat()[:7]} yet."
        recorded = spending["recorded"]
        if recorded is None:
            return f"Spending for {month.isoformat()[:7]} is unknown: nothing recorded."
        return (
            f"Recorded spending for {month.isoformat()[:7]} is **${recorded}** "
            f"against **${spending['planned']}** planned."
        )

    return "Stub reply: ask me to categorize the inbox or about your spending."


def _chunks(text: str) -> list[str]:
    words = re.findall(r"\S+\s*", text)
    return words or [text]


async def stub_stream(
    messages: list[ModelMessage], info: AgentInfo
) -> AsyncIterator[str | DeltaToolCalls]:
    if SLOW in _owner_prompt(messages)[0]:
        await asyncio.sleep(SLOW_STEP_SECONDS)
    step = _next_step(messages, info)
    if isinstance(step, tuple):
        before, step = step
        for chunk in _chunks(before):
            yield chunk
    if isinstance(step, dict):
        yield step
        return
    text, _ = _owner_prompt(messages)
    for index, chunk in enumerate(_chunks(step)):
        if FAIL in text and index == 2:
            raise StubModelError("forced failure mid-stream")
        yield chunk


def _not_streamed(messages, info):  # pragma: no cover - the sidebar always streams
    raise StubModelError("the sidebar stub only streams")


@cache
def build_stub_model() -> FunctionModel:
    return FunctionModel(_not_streamed, stream_function=stub_stream)
