"""What a real server exports to Logfire excludes financial data (Constitution §6).

Runs uvicorn with a Logfire token against a local fake OTLP receiver and the
fake YNAB server, drives REST, MCP, YNAB sync and built-in agent requests that
carry synthetic canary values, then decodes every exported span, metric and
log, then runs the scheduled tick over the same data.
tests/external/test_logfire_live.py runs the same scenario against real
Logfire and checks what its query API returns. Every value is invented.
"""

import asyncio
import contextlib
import gzip
import json
import os
import subprocess
import sys
import threading
import time
from datetime import UTC, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from uuid import uuid4

import httpx
import pytest
from cryptography.fernet import Fernet
from google.protobuf.json_format import MessageToDict
from opentelemetry.proto.collector.logs.v1.logs_service_pb2 import (
    ExportLogsServiceRequest,
)
from opentelemetry.proto.collector.metrics.v1.metrics_service_pb2 import (
    ExportMetricsServiceRequest,
)
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import (
    ExportTraceServiceRequest,
)
from pydantic import SecretStr
from sqlalchemy import insert, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from accanto.config import settings
from accanto.models import monthly as m
from accanto.services.access import issue_session
from accanto.services.api_keys import issue_key
from accanto.services.browser_auth import csrf_token
from tests.e2e.test_browser import free_port, wait_ready
from tests.fakes import ynab_server as y

URL = os.environ.get("ACCANTO_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="Requires isolated PostgreSQL")
ROOT = Path(__file__).parents[2]

# Every attribute key the server exported in this scenario, reviewed against §6.
# A new key (from a library upgrade or a new span) fails here until reviewed.
REVIEWED_KEYS = {
    "screen", "cold", "shell_ms", "inbox_ms", "api_count", "api_window_ms",
    "event_ms", "long_task_ms",
    # Resource: service, host and SDK metadata
    "service.name", "service.version", "service.instance.id",
    "deployment.environment.name", "host.arch", "host.id", "host.name",
    "os.type", "os.version", "process.pid", "process.runtime.description",
    "process.runtime.name", "process.runtime.version", "telemetry.sdk.language",
    "telemetry.sdk.name", "telemetry.sdk.version", "logfire.version",
    # Logfire bookkeeping; logfire.msg repeats the span name or truncated SQL
    "logfire.span_type", "logfire.msg", "logfire.msg_template", "logfire.json_schema",
    "logfire.level_num", "logfire.pending_parent_id", "logfire.scrubbed",
    "code.filepath", "code.function", "code.lineno",
    # HTTP server and client (YNAB, Auth0): method, route template, URL with
    # UUIDs and plan IDs, status, client address and user agent
    "http.method", "http.route", "http.target", "http.url", "http.scheme",
    "http.host", "http.flavor", "http.status_code", "http.server_name",
    "http.user_agent", "net.host.port", "net.peer.ip", "net.peer.port",
    "fastapi.route.name", "fastapi.route.operation_id",
    "fastapi.arguments.errors",  # type and loc only (telemetry.request_attributes)
    "fastapi.arguments.start_timestamp", "fastapi.arguments.end_timestamp",
    "fastapi.endpoint_function.start_timestamp",
    "fastapi.endpoint_function.end_timestamp",
    # SQL with placeholders
    "db.system", "db.name", "db.user", "db.statement", "db.operation",
    "net.peer.name",
    # Accanto spans and logs: counts, identifiers and flags only
    "lock", "entry_count", "item_count", "source_id", "counts",
    # MCP: method, tool, OAuth client and (scrubbed) session identifiers
    "mcp.method.name", "mcp.protocol.version", "mcp.session.id", "enduser.id",
    "fastmcp.server.name", "fastmcp.component.type", "fastmcp.component.key",
    "fastmcp.provider.type", "fastmcp.span.seam", "gen_ai.tool.name",
    # Pydantic AI with include_content=False: message part types and tool names,
    # static tool definitions, model, token counts and timings
    "agent_name", "gen_ai.agent.name", "gen_ai.agent.call.id",
    "gen_ai.conversation.id", "gen_ai.operation.name", "gen_ai.system",
    "gen_ai.provider.name", "gen_ai.request.model", "gen_ai.response.model",
    "gen_ai.tool.call.id", "gen_ai.tool.definitions", "gen_ai.input.messages",
    "gen_ai.output.messages", "pydantic_ai.all_messages", "model_name",
    "model_request_parameters", "gen_ai.usage.input_tokens",
    "gen_ai.usage.output_tokens", "gen_ai.aggregated_usage.input_tokens",
    "gen_ai.aggregated_usage.output_tokens",
    "gen_ai.client.operation.time_to_first_chunk", "logfire.metrics",
    # Exceptions: type, frames and fingerprint; telemetry.SafeSpanExporter drops
    # exception.message and the message lines of the stack trace
    "exception.type", "exception.stacktrace", "exception.escaped",
    "logfire.exception.fingerprint", "recorded_by_logfire_fastapi",
    # Real models (seen in production): provider host, response IDs, token and
    # cache counts, cost
    "server.address", "gen_ai.response.id", "gen_ai.response.finish_reasons",
    "gen_ai.usage.cache_read.input_tokens", "gen_ai.usage.cache_creation.input_tokens",
    "gen_ai.usage.details.audio_tokens", "gen_ai.usage.details.cache_read_tokens",
    "gen_ai.usage.details.cache_write_tokens", "gen_ai.usage.details.image_tokens",
    "gen_ai.usage.details.is_byok", "gen_ai.usage.details.reasoning_tokens",
    "gen_ai.aggregated_usage.cache_read.input_tokens",
    "gen_ai.aggregated_usage.cache_creation.input_tokens",
    "gen_ai.aggregated_usage.details.audio_tokens",
    "gen_ai.aggregated_usage.details.cache_read_tokens",
    "gen_ai.aggregated_usage.details.cache_write_tokens",
    "gen_ai.aggregated_usage.details.image_tokens",
    "gen_ai.aggregated_usage.details.is_byok",
    "gen_ai.aggregated_usage.details.reasoning_tokens",
    "pydantic_ai.cache.established_tokens", "pydantic_ai.cache.hit_ratio",
    "pydantic_ai.new_message_index", "operation.cost",
    # Metrics: request duration and size by route template; DB pool usage (the
    # pool name is the database URL without user or password); token usage
    "pool.name", "state", "gen_ai.token.type",
    # Added by Logfire's backend (seen in the live test): boolean view flags
    "logfire.agent_run_candidate.v1", "logfire.model_call_candidate.v1",
}  # fmt: skip


async def seed(suffix):
    """A synthetic owner, Entity, API key and browser session."""
    assert URL
    engine = create_async_engine(URL, hide_parameters=True)
    async with async_sessionmaker(engine)() as db, db.begin():
        user = await db.scalar(
            insert(m.users)
            .values(issuer="synthetic-trace", subject=suffix)
            .returning(m.users.c.id)
        )
        entity = await db.scalar(
            insert(m.entities)
            .values(owner_id=user, name=f"Synthetic canary {suffix}", time_zone="UTC")
            .returning(m.entities.c.uuid)
        )
        key = await issue_key(db, user, "Synthetic trace key")
        browser = await issue_session(db, user)
    await engine.dispose()
    return entity, key["key"], browser["token"]


@contextlib.contextmanager
def server(tmp_path, telemetry_env):
    """Uvicorn plus the fake YNAB server; shutting down flushes the exporter."""
    assert URL
    ynab_port, port = free_port(), free_port()
    origin = f"http://127.0.0.1:{port}"
    secrets = {
        "csrf": f"synthetic-csrf-secret-{uuid4().hex}",
        "fernet": Fernet.generate_key().decode(),
    }
    env = {
        k: v for k, v in os.environ.items() if not k.startswith(("LOGFIRE_", "OTEL_"))
    }
    env.update(
        telemetry_env,
        DATABASE_URL=URL,
        OTEL_BSP_SCHEDULE_DELAY="100",
        OTEL_METRIC_EXPORT_INTERVAL="500",
        BROWSER_ORIGIN=origin,
        BROWSER_CSRF_SECRET=secrets["csrf"],
        SOURCE_SECRET_KEY=secrets["fernet"],
        YNAB_API_URL=f"http://127.0.0.1:{ynab_port}/v1",
        AGENT_MODEL="stub",
        JOB_RECONCILER_INTERVAL="0.2",
    )
    log = (tmp_path / "server.log").open("w")
    ynab = subprocess.Popen(
        [sys.executable, "-m", "tests.fakes.ynab_server", "--port", str(ynab_port)],
        cwd=ROOT, stdout=log, stderr=subprocess.STDOUT,
    )  # fmt: skip
    app = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "accanto.app:app", "--host",
         "127.0.0.1", "--port", str(port), "--no-access-log"],
        cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT,
    )  # fmt: skip
    try:
        wait_ready(origin + "/readyz", app)
        for _ in range(100):  # any answer means the fake YNAB server is up
            with contextlib.suppress(httpx.TransportError):
                httpx.get(f"http://127.0.0.1:{ynab_port}/v1/plans")
                break
            time.sleep(0.1)
        yield origin, secrets
    finally:
        for process in (app, ynab):
            process.terminate()
            process.wait(timeout=15)
        log.close()


async def drive(origin, secrets, suffix):
    """Exercise every instrumented path; return the values that must not export."""
    entity, key, session = await seed(suffix)
    note = f"synthetic-canary-note-{suffix}"
    amount = "765.43"  # invented; the stub agent shows it as $765.43
    invalid = f"synthetic-invalid-{suffix}"
    prompt = f"synthetic-canary-prompt-{suffix} what did I spend in October?"
    agent_md = f"synthetic-canary-agent-md-{suffix} Example Grocer is groceries."
    code = f"synthetic-oidc-code-{suffix}"
    config = settings.model_copy(
        update={"browser_csrf_secret": SecretStr(secrets["csrf"])}
    )
    prefix = f"/api/entities/{entity}"
    api = {"Authorization": f"Bearer {key}"}
    cookie = {"Cookie": f"accanto_session={session}"}
    browser = {**cookie, "Origin": origin, "X-CSRF-Token": csrf_token(session, config)}
    year = datetime.now(UTC).year - 1
    month = datetime.now(UTC).date().replace(day=1).isoformat()
    private = [note, amount, "765,43", invalid, prompt, agent_md, code, key, session]
    private += [f"Synthetic canary {suffix}", y.FAKE_TOKEN, *secrets.values()]

    async with httpx.AsyncClient(base_url=origin, trust_env=False) as client:

        async def call(method, path, body=None, headers=api, **kwargs):
            response = await client.request(
                method,
                prefix + path,
                json=body,
                headers={**headers, "Idempotency-Key": str(uuid4())},
                **kwargs,
            )
            assert response.status_code == 200, response.text
            return response.json()

        timing = dict(
            screen="inbox",
            cold=False,
            shell_ms=48,
            inbox_ms=304,
            api_count=10,
            api_window_ms=285,
            event_ms=16,
            long_task_ms=55,
        )
        for screen, headers, status in [
            ("inbox", browser, 204),
            (note, browser, 422),
            ("inbox", api, 403),
        ]:
            response = await client.post(
                "/api/auth/screen-timing",
                headers=headers,
                json={**timing, "screen": screen, "extra": note},
            )
            assert response.status_code == status

        # Validation errors quote the rejected input.
        rejected = await client.post(
            prefix + "/plans",
            json={"name": invalid, "incomes": [], "spending": invalid},
            headers=api,
        )
        assert rejected.status_code == 422
        plan = await call(
            "POST",
            "/plans",
            {
                "name": note,
                "incomes": [{"name": note, "amount": "3000.00"}],
                "spending": "900.00",
            },
        )
        version = await call(
            "POST", f"/plans/{plan['plan_id']}/versions", {"expected_revision": 1}
        )
        await call(
            "POST",
            "/reviews",
            {"month": f"{year}-10-01", "version_id": version["version"]["uuid"]},
        )
        for day in ("12", "14"):
            await call(
                "POST",
                "/activity",
                {
                    "date": f"{year}-10-{day}",
                    "category": "spending",
                    "amount": amount,
                    "note": note,
                },
            )
        activity = await client.get(prefix + "/activity", headers=cookie)
        review = await client.get(f"{prefix}/reviews/{year}-10-01", headers=cookie)
        assert note in activity.text and amount in review.text

        # MCP: tool results carry the same values.
        listed = await client.post(
            "/mcp",
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {
                    "name": "list_activity",
                    "arguments": {"entity_id": str(entity), "month": f"{year}-10-01"},
                },
            },
            headers={
                **api,
                "MCP-Protocol-Version": "2025-03-26",
                "Accept": "application/json, text/event-stream",
            },
        )
        assert listed.status_code == 200 and note in listed.text

        # Routines (TDD 13): names, step titles and tick notes are typed text.
        routine_note = f"synthetic-canary-routine-{suffix}"
        private.append(routine_note)
        today = datetime.now(UTC).date()
        weekday = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")[today.weekday()]
        routine = await call(
            "POST",
            "/routines",
            {
                "name": note,
                "cadence": {"frequency": "weekly", "weekdays": [weekday]},
                "starts_on": today.isoformat(),
                "steps": [{"title": note, "link_url": "https://bank.example.com"}],
            },
        )
        step = routine["steps"][0]["uuid"]
        await call(
            "PUT",
            f"/routines/{routine['uuid']}/occurrences/{today}/steps/{step}",
            {"status": "done", "note": routine_note},
        )
        ticked = await client.post(
            "/mcp",
            json={
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/call",
                "params": {
                    "name": "get_routine_occurrence",
                    "arguments": {
                        "entity_id": str(entity),
                        "routine_id": routine["uuid"],
                    },
                },
            },
            headers={
                **api,
                "MCP-Protocol-Version": "2025-03-26",
                "Accept": "application/json, text/event-stream",
            },
        )
        assert ticked.status_code == 200 and routine_note in ticked.text

        # Entry schedules (TDD 18): the name and each line's note are typed text;
        # the real tick below records today's date and logs counts only.
        schedule_note = f"synthetic-canary-schedule-{suffix}"
        private.append(schedule_note)
        await call(
            "POST",
            "/schedules",
            {
                "name": schedule_note,
                "cadence": {"frequency": "weekly", "weekdays": [weekday]},
                "starts_on": today.isoformat(),
                "lines": [
                    {
                        "category": "income",
                        "amount": "12.34",
                        "note": schedule_note,
                        "assignment": "unassigned",
                    }
                ],
            },
        )
        scheduled = await client.post(
            "/mcp",
            json={
                "jsonrpc": "2.0",
                "id": 3,
                "method": "tools/call",
                "params": {
                    "name": "list_schedules",
                    "arguments": {"entity_id": str(entity)},
                },
            },
            headers={
                **api,
                "MCP-Protocol-Version": "2025-03-26",
                "Accept": "application/json, text/event-stream",
            },
        )
        assert scheduled.status_code == 200 and schedule_note in scheduled.text

        # YNAB: a rejected token must not surface in errors, logs or spans.
        rejected_token = f"synthetic-wrong-ynab-token-{suffix}"
        wrong = await client.put(
            prefix + "/transaction-provider",
            json={
                "kind": "ynab",
                "access_token": rejected_token,
                "expected_revision": 0,
            },
            headers={**browser, "Idempotency-Key": str(uuid4())},
        )
        assert wrong.json()["detail"]["code"] == "source_unauthorized"
        private.append(rejected_token)

        # YNAB: token, payees and amounts cross outbound HTTP and the inbox.
        await call(
            "PUT",
            "/transaction-provider",
            {"kind": "ynab", "access_token": y.FAKE_TOKEN, "expected_revision": 0},
            headers=browser,
        )
        source = await call(
            "POST",
            "/sources/ynab",
            {"plan_id": y.PLAN, "start_date": month},
            headers=browser,
        )
        await call(
            "PUT",
            f"/sources/{source['id']}/accounts",
            {"expected_revision": source["revision"], "account_ids": [y.CHECKING]},
            headers=browser,
        )
        synced = await call("POST", f"/sources/{source['id']}/sync", headers=browser)
        assert synced["counts"]["added"] > 0
        inbox = await call("GET", "/inbox", headers=cookie)
        payees = {i["payee"] for i in inbox if i.get("payee")}
        assert payees
        private += payees

        # Built-in agent: the prompt, instructions, tool results and reply.
        await call(
            "PUT",
            "/agent/settings",
            {
                "enabled": True,
                "mode": "ask_first",
                "instructions": agent_md,
                "expected_revision": 0,
            },
            headers=browser,
        )
        # The inbox proposal run (TDD 12): its steps send payees and AGENT.md to
        # the model in the background and log counts only.
        started = await client.post(prefix + "/inbox/proposal-run", headers=api)
        assert started.status_code == 202, started.text
        for _ in range(100):
            run = await call("GET", "/inbox/proposal-run")
            if run["run"]["state"] not in {"queued", "running"}:
                break
            await asyncio.sleep(0.1)
        assert run["run"]["state"] == "succeeded" and run["proposed"] == run["waiting"]
        # AGENT.md over REST (API key) and MCP.
        assert (await call("GET", "/agent/instructions"))["instructions"] == agent_md
        instructions = await client.post(
            "/mcp",
            json={
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/call",
                "params": {
                    "name": "get_agent_instructions",
                    "arguments": {"entity_id": str(entity)},
                },
            },
            headers={
                **api,
                "MCP-Protocol-Version": "2025-03-26",
                "Accept": "application/json, text/event-stream",
            },
        )
        assert instructions.status_code == 200 and agent_md in instructions.text

        # Settings over MCP: read, then a FIRE assumption carrying a canary amount.
        async def mcp_call(name, arguments):
            response = await client.post(
                "/mcp",
                json={
                    "jsonrpc": "2.0",
                    "id": 3,
                    "method": "tools/call",
                    "params": {
                        "name": name,
                        "arguments": {"entity_id": str(entity), **arguments},
                    },
                },
                headers={
                    **api,
                    "MCP-Protocol-Version": "2025-03-26",
                    "Accept": "application/json, text/event-stream",
                },
            )
            assert response.status_code == 200, response.text
            assert '"isError":true' not in response.text.replace(" ", ""), name
            return response.text

        spending = "87654.32"  # invented
        private += [spending, "87,654.32"]
        current = await mcp_call("get_settings", {})
        assert f"Synthetic canary {suffix}" in current
        assert y.FAKE_TOKEN not in current and secrets["fernet"] not in current
        revision = json.loads(
            next(line for line in current.splitlines() if line.startswith("data:"))[5:]
            if current.lstrip().startswith("event")
            else current
        )["result"]["structuredContent"]["revision"]
        saved = await mcp_call(
            "save_fire_assumptions",
            {
                "idempotency_key": str(uuid4()),
                "annual_spending": spending,
                "withdrawal_percent": "4.00",
                "expected_revision": revision,
            },
        )
        assert spending in saved
        reply = await client.post(
            prefix + "/agent/conversation/messages",
            data={"content": prompt},
            headers=browser,
            timeout=30,
        )
        assert reply.status_code == 200 and "event: done" in reply.text

        # The callback's query string carries the authorization code.
        await client.get(f"/api/auth/callback?code={code}&state={code}")

        # Database errors quote what failed: here a trigger raises a canary
        # message, as Postgres errors can quote values (a duplicate key's DETAIL).
        failure = f"synthetic-db-failure-{suffix}"
        trigger = f"trace_failure_{suffix}"
        assert URL
        engine = create_async_engine(URL)
        try:
            async with engine.begin() as connection:
                await connection.execute(
                    text(
                        f"CREATE FUNCTION {trigger}() RETURNS trigger LANGUAGE plpgsql "
                        f"AS $$ BEGIN IF NEW.entity_id = (SELECT id FROM "
                        f"{m.entities.name} WHERE uuid = '{entity}') THEN RAISE "
                        f"EXCEPTION '{failure} {amount}'; END IF; RETURN NEW; END $$"
                    )
                )
                await connection.execute(
                    text(
                        f"CREATE TRIGGER {trigger} BEFORE INSERT ON {m.audit.name} "
                        f"FOR EACH ROW EXECUTE FUNCTION {trigger}()"
                    )
                )
            failed = await client.post(
                prefix + "/activity",
                json={
                    "date": f"{year}-10-20",
                    "category": "spending",
                    "amount": amount,
                    "note": note,
                },
                headers={**api, "Idempotency-Key": str(uuid4())},
            )
            assert failed.status_code == 503, failed.text
        finally:
            async with engine.begin() as connection:
                await connection.execute(
                    text(f"DROP TRIGGER IF EXISTS {trigger} ON {m.audit.name}")
                )
                await connection.execute(text(f"DROP FUNCTION IF EXISTS {trigger}()"))
            await engine.dispose()
        private.append(failure)
    return private


def check_log(tmp_path, private):
    """The server's own stdout and stderr (uvicorn, structlog, libraries)."""
    captured = (tmp_path / "server.log").read_text()
    assert "Application startup complete" in captured
    for value in private:
        assert value not in captured, f"server log contains {value[:24]}"


def run_tick(tmp_path, suffix, private):
    """The scheduled tick (TDD 11) deletes this run's conversation, whose
    messages carry the prompt canary, and logs none of it."""
    assert URL

    async def expire():
        assert URL
        engine = create_async_engine(URL, hide_parameters=True)
        async with async_sessionmaker(engine)() as db, db.begin():
            expired = await db.scalars(
                text(
                    "UPDATE agent_conversation SET expires_at = now() - interval '1d'"
                    " WHERE entity_id = (SELECT id FROM entity WHERE name = :name)"
                    " RETURNING id"
                ),
                {"name": f"Synthetic canary {suffix}"},
            )
            assert expired.all()
        await engine.dispose()

    asyncio.run(expire())
    env = {k: v for k, v in os.environ.items() if not k.startswith("LOGFIRE_")}
    with (tmp_path / "tick.log").open("w") as log:
        status = subprocess.run(
            [sys.executable, "-m", "accanto.jobs.tick"],
            cwd=ROOT, env={**env, "DATABASE_URL": URL}, stdout=log,
            stderr=subprocess.STDOUT, timeout=60,
        ).returncode  # fmt: skip
    captured = (tmp_path / "tick.log").read_text()
    assert status == 0, captured
    steps = [
        json.loads(line) for line in captured.splitlines() if "job_tick_step" in line
    ]
    assert steps[0]["step"] == "conversation_retention"
    assert steps[0]["counts"]["deleted"] >= 1
    # The canary schedule's date today is staged in the inbox; only counts are logged.
    assert steps[1]["step"] == "scheduled_entries"
    assert steps[1]["counts"]["staged"] >= 1
    for value in private:
        assert value not in captured, f"tick log contains {value[:24]}"


def check(found, documents, keys, private):
    """Assert the export is complete, useful, and free of private values.

    found: (span or log name, attributes) pairs; documents: every exported
    record serialized as text; keys: every attribute key in the export.
    """
    names = {name for name, _ in found}
    attributes = [a for _, a in found]
    # Completeness first, so a broken or empty export cannot pass.
    assert {"access.authorize", "access.credential", "invoke_agent agent"} <= names
    assert any(
        n == "browser.screen"
        and a.get("screen") == "inbox"
        and str(a.get("inbox_ms")) == "304"
        for n, a in found
    )
    assert any(n == "access.authorize" and a.get("lock") is True for n, a in found)
    assert any(
        n == "monthly.entry_snapshots" and str(a.get("entry_count")) == "2"
        for n, a in found
    )
    synced = [a["counts"] for n, a in found if n == "inbox.sync_counts"]
    # A JSON string in OTLP; Logfire's query API returns JSON values parsed.
    counts = json.loads(synced[0]) if isinstance(synced[0], str) else synced[0]
    assert counts["added"] > 0 and set(counts) == {
        "added",
        "changed",
        "removed",
        "conflicts",
        "unchanged",
        "ignored",
        "uncleared",
    }
    statements = [a["db.statement"] for a in attributes if "db.statement" in a]
    assert len(statements) > 20 and any("$1" in s for s in statements)
    tools = {a.get("gen_ai.tool.name") for a in attributes}
    assert {"list_activity", "get_monthly_review"} <= tools  # MCP and agent
    assert "get_agent_instructions" in tools
    assert any("/v1/plans/" in str(a.get("http.url", "")) for a in attributes)
    rejected = [
        json.loads(e) if isinstance(e := a["fastapi.arguments.errors"], str) else e
        for a in attributes
        if str(a.get("http.status_code")) == "422"
        and a.get("http.route") == "/api/entities/{entity_id}/plans"
    ]
    assert rejected and all(e.keys() == {"type", "loc"} for e in rejected[0])
    assert not any("/api/auth/callback" in json.dumps(a) for a in attributes)

    everything = "\n".join(documents)
    # The database failure is exported by type, with frames and no message.
    assert "DBAPIError" in everything and "exception.stacktrace" in everything
    assert "exception.message" not in everything
    for value in private:
        assert value not in everything, f"exported telemetry contains {value[:24]}"
    assert keys <= REVIEWED_KEYS, f"review new attribute keys: {keys - REVIEWED_KEYS}"


class Receiver(BaseHTTPRequestHandler):
    """Fake Logfire: accepts OTLP and keeps every body."""

    received: list[tuple[str, bytes]] = []

    def do_POST(self):  # noqa: N802
        body = self.rfile.read(int(self.headers.get("content-length", 0)))
        if self.headers.get("content-encoding") == "gzip":
            body = gzip.decompress(body)
        Receiver.received.append((self.path, body))
        self.send_response(200)
        self.end_headers()

    def log_message(self, format, *args):  # noqa: A002
        pass


DECODERS = {
    "/v1/traces": ExportTraceServiceRequest,
    "/v1/metrics": ExportMetricsServiceRequest,
    "/v1/logs": ExportLogsServiceRequest,
}


def decoded():
    """Every OTLP request the receiver got, as (names+attributes, text, keys)."""
    found, documents, keys = [], [], set()

    def walk(node):
        if isinstance(node, dict):
            if isinstance(node.get("key"), str) and "value" in node:
                keys.add(node["key"])
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)

    for path, body in Receiver.received:
        message = DECODERS[path]()
        message.ParseFromString(body)
        document = MessageToDict(message)
        walk(document)
        documents.append(json.dumps(document))
        for resource in document.get("resourceSpans", []):
            for scope in resource["scopeSpans"]:
                for span in scope["spans"]:
                    found.append(
                        (
                            span["name"],
                            {
                                a["key"]: next(iter(a["value"].values()), None)
                                for a in span.get("attributes", [])
                            },
                        )
                    )
    return found, documents, keys


def test_exported_telemetry_excludes_financial_data(tmp_path):
    assert URL and URL.rsplit("/", 1)[-1].endswith("_test")
    receiver = ThreadingHTTPServer(("127.0.0.1", 0), Receiver)
    Receiver.received = []
    threading.Thread(target=receiver.serve_forever, daemon=True).start()
    token = f"synthetic-logfire-token-{uuid4().hex}"
    telemetry = {
        "LOGFIRE_TOKEN": token,
        "LOGFIRE_BASE_URL": f"http://127.0.0.1:{receiver.server_address[1]}",
        "LOGFIRE_ENVIRONMENT": "test",
    }
    suffix = uuid4().hex[:12]
    try:
        with server(tmp_path, telemetry) as (origin, secrets):
            private = asyncio.run(drive(origin, secrets, suffix))
    finally:
        receiver.shutdown()
    found, documents, keys = decoded()
    check(found, documents, keys, [*private, token, URL])
    check_log(tmp_path, [*private, token, URL])
    run_tick(tmp_path, suffix, [*private, token, URL])
