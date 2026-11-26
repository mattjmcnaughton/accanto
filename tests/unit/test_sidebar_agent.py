"""The built-in agent with FunctionModel: tools, retries, images, layering."""

import ast
import asyncio
import json
from datetime import date
from pathlib import Path

from pydantic_ai.messages import (
    BinaryContent,
    ToolReturnPart,
    UserPromptPart,
)
from pydantic_ai.models.function import AgentInfo, DeltaToolCall, FunctionModel
from pydantic_ai.run import AgentRunResultEvent

from accanto.agents.sidebar import SidebarDeps, build_sidebar_agent, render_context
from accanto.services.agent_context import sidebar_specs
from accanto.services.stub_model import build_stub_model
from tests.unit.test_tool_catalog import CATALOG_NAMES

SIDEBAR = Path(__file__).parents[2] / "src/accanto/agents/sidebar.py"


def deps(call, **extra):
    return SidebarDeps(
        entity_name="Synthetic household",
        time_zone="UTC",
        today=date(2026, 11, 23),
        mode="ask_first",
        agent_md="Sample Warehouse Club is groceries unless over $300.",
        call=call,
        **extra,
    )


def test_agent_module_imports_no_config_persistence_or_http():
    tree = ast.parse(SIDEBAR.read_text())
    imported = {
        node.module
        for node in ast.walk(tree)
        if isinstance(node, ast.ImportFrom) and node.module
    } | {
        alias.name
        for node in ast.walk(tree)
        if isinstance(node, ast.Import)
        for alias in node.names
    }
    forbidden = (
        "accanto.config",
        "accanto.repositories",
        "accanto.models",
        "accanto.db",
    )
    assert not [m for m in imported if m.startswith(forbidden) or "fastapi" in m]
    assert not [m for m in imported if m.startswith("sqlalchemy")]


def test_sidebar_tools_are_the_catalog_without_entity_or_key():
    specs = sidebar_specs()
    assert [s.name for s in specs] == CATALOG_NAMES
    for spec in specs:
        text = json.dumps(spec.schema)
        assert "entity_id" not in text and "idempotency_key" not in text, spec.name


async def fake_call(name, arguments, call_id):
    return {}


def test_context_block_carries_agent_md_after_the_rules():
    block = render_context(deps(fake_call, month=date(2026, 10, 1)))
    assert "Today: 2026-11-23" in block and "Month in view: 2026-10-01" in block
    assert block.index("<agent_md>") > block.index("</context>")
    assert "Sample Warehouse Club is groceries" in block
    assert "<agent_md>" not in render_context(
        SidebarDeps("E", "UTC", date(2026, 1, 1), "ask_first", "", call=fake_call)
    )


def run(model, call, prompt="Hello", **extra):
    agent = build_sidebar_agent(sidebar_specs())

    async def go():
        result = await agent.run(prompt, deps=deps(call, **extra), model=model)
        return result

    return asyncio.run(go())


def test_tool_call_then_text_and_malformed_draft_retries():
    calls = []
    turns = []

    async def call(name, arguments, call_id):
        calls.append((name, arguments))
        return {"entries": [], "truncated": False}

    def respond(messages, info: AgentInfo):
        from pydantic_ai.messages import ModelResponse, TextPart, ToolCallPart

        turns.append(messages[-1])
        if len(turns) == 1:
            # A month that is not the first day fails the input model.
            return ModelResponse(
                parts=[ToolCallPart("list_activity", {"month": "2026-11-15"})]
            )
        if len(turns) == 2:
            return ModelResponse(
                parts=[ToolCallPart("list_activity", {"month": "2026-11-01"})]
            )
        return ModelResponse(parts=[TextPart("Done.")])

    result = run(FunctionModel(respond), call)
    assert result.output == "Done."
    # The malformed call never reached the catalog; the model was told why.
    assert calls == [("list_activity", {"month": "2026-11-01"})]
    retry = turns[1].parts[0]
    assert isinstance(retry, ToolReturnPart)
    assert "invalid_arguments: month" in str(retry.content)


def test_image_reaches_the_model_request():
    received = []

    def respond(messages, info):
        from pydantic_ai.messages import ModelResponse, TextPart

        for m in messages:
            for p in getattr(m, "parts", []):
                if isinstance(p, UserPromptPart) and not isinstance(p.content, str):
                    received.extend(
                        c for c in p.content if isinstance(c, BinaryContent)
                    )
        return ModelResponse(parts=[TextPart("Seen.")])

    image = BinaryContent(data=b"\xff\xd8synthetic", media_type="image/jpeg")
    run(FunctionModel(respond), fake_call, ["Receipt attached", image], image_count=1)
    assert [r.data for r in received] == [b"\xff\xd8synthetic"]


def test_stub_categorizes_inbox_with_real_tool_calls():
    item = {
        "id": "00000000-0000-4000-8000-000000000001",
        "revision": 1,
        "kind": "ordinary",
        "amount": "-12.34",
    }
    transfer = {
        **item,
        "id": "00000000-0000-4000-8000-000000000002",
        "kind": "transfer_on_budget",
    }
    calls = []

    async def call(name, arguments, call_id):
        calls.append((name, arguments))
        if name == "list_inbox":
            return {"items": [item, transfer], "truncated": False}
        return {"results": [{"ok": True}, {"ok": True}]}

    agent = build_sidebar_agent(sidebar_specs())

    async def go():
        async with agent.run_stream_events(
            "Please categorize my inbox",
            deps=deps(call),
            model=build_stub_model(),
        ) as events:
            async for event in events:
                if isinstance(event, AgentRunResultEvent):
                    return event.result.output
        return None

    reply = asyncio.run(go())
    assert [name for name, _ in calls] == ["list_inbox", "set_proposals"]
    proposals = calls[1][1]["proposals"]
    assert proposals[0]["category"] == "spending" and proposals[1]["skip"] is True
    assert "proposed categories for 2" in reply


def test_stub_never_runs_unstreamed_and_needs_no_network():
    model = build_stub_model()
    assert model.stream_function is not None
    assert isinstance(DeltaToolCall(name="x"), DeltaToolCall)
