# Performance tracing with Logfire

Accanto exports OpenTelemetry traces and metrics to [Logfire](https://pydantic.dev/logfire)
to show where request time goes. [Constitution §6](../../CONSTITUTION.md#6-keep-financial-data-out-of-operational-telemetry)
sets what may and may not be exported; this page is how the code meets it. Read
both before adding a span, an attribute, an instrumentation or a telemetry
dependency.

## How it is wired

`src/accanto/telemetry.py` owns all configuration and is called from
`create_app()`:

| Integration | Records | What keeps values out |
| --- | --- | --- |
| FastAPI | one span per request: route template, path with UUIDs, status, timings, client address and user agent | `request_attributes` keeps only the `type` and `loc` of validation errors, never argument values or the rejected `input`. Headers are not captured. `/api/auth/callback` (its URL carries the OIDC code), `/healthz` and `/readyz` are not traced. |
| SQLAlchemy | one span per statement: SQL text with `$1` placeholders, database name and role | Bind values are never recorded; the engine also sets `hide_parameters=True`. |
| httpx | outbound YNAB and Auth0 calls: method, URL (YNAB plan and account IDs), status | Tokens travel in headers or bodies, which are not captured. |
| Pydantic AI | agent run, model request and tool spans; model name, token counts | `include_content=False` and `include_binary_content=False`: messages keep only part types and tool names. |
| FastMCP | built in: MCP method, tool name, OAuth client ID, session ID (scrubbed by Logfire) | Tool arguments and results are never recorded. |

Logfire's own exporter is off (`send_to_logfire=False`). When `LOGFIRE_TOKEN`
is set, spans go to `LOGFIRE_BASE_URL` (default US) through one OTLP exporter
wrapped in `SafeSpanExporter`, and metrics through one OTLP metric reader.
Without the token nothing is exported, even when other Logfire credentials are
in the environment.

`SafeSpanExporter` exists because exception text cannot be controlled at the
source: a failed database write records the driver's message (which can quote
the rejected value or a duplicate key) on the SQL span's status and as an
exception event on the request span and every enclosing span. The wrapper drops
status descriptions and `exception.message`, and cuts `exception.stacktrace`
down to headers, frames with their source line, and exception class names. `inspect_arguments=False` stops Logfire
deriving attributes from source code, and `distributed_tracing=False` ignores
trace context and baggage sent by clients.

### Custom spans

| Name | Where | Attributes |
| --- | --- | --- |
| `access.credential` | session lookup in `routers/authentication.py` | none |
| `access.authorize` | `services/monthly.authorize`, including row-lock waits | `lock` |
| `monthly.entry_snapshots` | batch entry details in `read_activity` and `read_review` | `entry_count` |
| `destinations.entry_snapshots` | `read_contributions` | `entry_count` |
| `inbox.item_views` | `read_inbox` | `item_count` |
| `inbox.sync_counts` (log) | end of a YNAB sync | `source_id` and the six sync counts |

Rules for adding one:

- Use `logfire.span("area.operation", count=...)` with a constant name. Do not
  use f-strings, and do not use `@logfire.instrument`: it records every function
  argument by default, which includes the raw credential in most services.
- Attributes are limited to counts, UUIDs, codes, booleans and statuses (§6).
- Open the span after input validation, or catch validation errors inside it:
  exception messages are recorded, and Pydantic `ValidationError` messages
  quote the rejected input.
- Extend the privacy test below, and add new attribute keys to its reviewed
  list only after checking their values.

Logfire's own scrubbing (a keyword denylist such as `session` and `password`)
stays on as a backstop. It does not scrub URLs, SQL or AI messages and cannot
recognise an amount, so it is never the control.

## Logs

- structlog writes JSON to stdout (journald on the Box). Events are fixed names
  with counts, UUIDs, codes, statuses and `ms`, for example `ynab_request`
  (operation, status, ms), `inbox_sync` (source ID and counts) and `agent_turn`
  (outcome, ms, token counts or error type). Background jobs log `job_step`
  (kind, run UUID, outcome, fixed error code, counts, ms), `job_step_error` and
  `job_reconciler_failed` (error type), and the scheduled tick logs
  `job_tick_step` (step name, outcome, counts or error type, ms); see
  [TDD 11](../tdds/11-background-jobs.md). No code path logs `exc_info`.
- Uvicorn runs with `--no-access-log` everywhere (`Dockerfile`, `.amp/box.yaml`,
  `just dev-be`). The OIDC callback also clears its query string before handling.
- Handled errors are not logged: `RejectionError` and `SQLAlchemyError` become
  fixed-text responses in `app.py`, and MCP tool errors become fixed `ToolError`
  text in `mcp_server.safe_error`, so fastmcp logs only the tool name.
- Library loggers (httpx, which would log URLs) stay at Python's default
  WARNING level; nothing configures the root logger.

## The YNAB token

It is entered once in Settings, checked against YNAB, then stored encrypted with
`SOURCE_SECRET_KEY` (Fernet) and never returned by the API. At sync time it is
decrypted in memory and sent only in the `Authorization` header, which neither
httpx instrumentation nor logging records. Outbound spans show the URL, which
holds only the plan ID and `since_date`. YNAB failures become `SourceError` codes
with fixed messages, and transport errors are re-raised without their cause.
A rejected token never appears in the error response, logs or spans; the
privacy test checks both a rejected and an accepted token.

## What Logfire shows

- Each request as a waterfall: route, `access.credential`, `access.authorize`
  (lock waits included), every SQL statement with its duration, outbound YNAB
  calls, and agent model and tool spans.
- Counts that explain the cost: entries per snapshot loop, inbox items, sync
  results, tokens per model call.
- Metrics: request duration and size by route template, database pool usage,
  model token usage.
- Errors by exception type, with stack frames but no messages.

It never shows amounts, balances, notes, names, payees, Plan or Entity names,
prompts, replies, tool arguments or results, images, exception messages,
cookies, API keys, session tokens, YNAB tokens or the OIDC code.

## Tests

- `tests/integration/test_trace_privacy.py` (runs with `just test-integration`)
  starts the real server against a local fake Logfire receiver and the fake YNAB
  server. It drives REST, MCP, a YNAB sync, a built-in agent turn and the OIDC
  callback with synthetic canary values, then runs `python -m accanto.jobs.tick`
  over the same data. It also submits a wrong YNAB token and
  makes a database write fail with a canary in the error. It then decodes every
  exported span, metric and log, and reads the server's own stdout and stderr.
  It fails if a canary or a secret appears in either, if an exception message is
  exported, if an attribute key is not in `REVIEWED_KEYS`, or if expected spans
  are missing, so a broken export cannot pass.
- `tests/external/test_logfire_live.py` (`just test-logfire-live`) runs the same
  scenario against real Logfire with environment `live-test`, then reads this
  run's records and metrics back through the query API and applies the same
  checks to what Logfire stored. It needs `ACCANTO_TEST_DATABASE_URL`,
  `LOGFIRE_LIVE_WRITE_TOKEN` and `LOGFIRE_LIVE_READ_TOKEN`. Use short-lived
  tokens for the `accanto` project and keep them outside the checkout.

## Running it in production

The `accanto` Logfire project is private, in the US region, with 30-day
retention on the Personal plan. To turn on export for the Box deployment, set
the deployment secret `LOGFIRE_TOKEN` (a write token for that project) and the
environment variable `LOGFIRE_ENVIRONMENT=production`, then redeploy. Removing
the secret turns export off again. Because the instrumentation is plain
OpenTelemetry, moving to another backend means changing the exporter, not the
spans.
