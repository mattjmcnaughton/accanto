# CLAUDE.md

A financial companion for planning a rich life.

Read [CONSTITUTION.md](CONSTITUTION.md) for the agreed product and engineering
principles before planning, implementation, or review.

Read [CONTEXT.md](CONTEXT.md) before domain or product work. Use its ubiquitous
language consistently in code, tests, and UI copy; update it when domain meanings
change.

Python web application using FastAPI, uvicorn, uv, ruff, ty, and pytest. Frontend lives in `src/accanto/web/frontend/`.

## Quick Reference

| Command | Purpose |
| ------- | ------- |
| `just fmt` | Check formatting (backend + frontend) |
| `just fmt-fix` | Fix formatting (backend + frontend) |
| `just lint` | Check linting (backend + frontend) |
| `just lint-fix` | Fix linting (backend + frontend) |
| `just typecheck` | Run type checker (backend + frontend) |
| `just test-unit` | Run unit tests (backend + frontend) |
| `just test-integration` | Run integration tests |
| `just test-e2e` | Run e2e tests |
| `just test-all` | Run all tests |
| `just test-external` | Run tests hitting external services |
| `just gate` | Fast pre-push check (fmt + lint + typecheck + test-unit) |
| `just gate-expensive` | Full check (gate + integration + e2e) |
| `just gate-external` | Everything (gate-expensive + external) |
| `just dev` | Start backend and frontend dev servers |
| `just dev-be` | Start backend dev server only |
| `just dev-fe` | Start frontend dev server only |

All formatting, linting, typecheck, test-unit, and gate targets have `-be` and `-fe` variants (e.g. `just fmt-be`, `just fmt-fe`).

## Project Structure

```
src/accanto/
  app.py                    # FastAPI app factory
  config.py                 # Pydantic-settings based config
  logging.py                # structlog setup
  telemetry.py              # Logfire/OpenTelemetry tracing (see CONSTITUTION §6)
  routers/                  # HTTP endpoint definitions
    health.py               # /healthz, /readyz
  services/                 # Business logic
  dtos/                     # Pydantic request/response models
  web/                      # Frontend integration
    serve.py                # Static file serving for production
    frontend/               # Frontend application (scaffolded separately)
  db.py                     # Async engine/session setup
  models/                   # SQLAlchemy models
  repositories/             # Data access layer
tests/
  unit/                     # Unit tests
  integration/              # Integration tests
  e2e/                      # End-to-end tests
```

## Key Conventions

- Source code lives in `src/accanto/` (src layout).
- **Layering:** routers -> services -> repositories.
- **Placement:** read `docs/architecture.md` before adding modules. Keep pure financial rules independent of HTTP and persistence; introduce narrow interfaces only at useful testing or integration boundaries.
- **Data model changes flow through every layer** in the same change: migration
  and models, domain rules and services, routers and `docs/api.md`, the agent
  tool catalog and MCP (`dtos/tools.py`, `services/tools.py`), the frontend, and
  `CONTEXT.md`. Skip a layer only when the TDD records that decision (see
  CONSTITUTION.md §2).
- **Field names** for a reference are named after the specific record (`fixed_cost_id`, `investment_id`, `funding_goal_id`), never a generic name shared by several record types or one field carrying two meanings. An entry's assignment and its funding origin are separate fields.
- **DTOs** are Pydantic models for API I/O, always separate from DB models.
- **Frontend** is composed into `src/accanto/web/frontend/` using the `frontend-react` template.
- **Interactive reads:** Apply [Constitution §9](CONSTITUTION.md#9-bound-the-work-of-interactive-reads) when changing a screen load, a list endpoint, or a read transaction. Count API requests at the screen boundary, compare SQL counts with small and larger synthetic lists, or test overlapping requests with real Postgres, according to the risk changed. Report the observed counts or concurrency result in the review.
- Tests are organized by type in `tests/unit/`, `tests/integration/`, `tests/e2e/`.
- Use `@pytest.mark.external` for tests that hit external services.
- Python tool config is in `pyproject.toml`; frontend tools have their own config.
- Backend: `just dev-be`. Frontend: `just dev-fe`. Both: `just dev`.

## More Information

- `docs/product/brief.md` — current product direction
- `CONTEXT.md` — shared financial domain language
- `docs/architecture.md` — read before adding new modules or changing project structure
- `docs/development.md` — read for environment setup, debugging, or common tasks
- `docs/api.md` — API endpoint reference
- `docs/technical/box-operations.md` — read before deploying or debugging the live Amp Box deployment
- `docs/technical/telemetry.md` — read before adding spans, span attributes, tracing integrations or telemetry dependencies

## Logs, telemetry and secrets

Logs (structlog to stdout, uvicorn, libraries) and Logfire traces and metrics
follow [CONSTITUTION.md §6](CONSTITUTION.md#6-keep-financial-data-out-of-operational-telemetry);
[docs/technical/telemetry.md](docs/technical/telemetry.md) has the details and
what each path records. They carry only operation names, timings, placeholder
SQL, identifiers, counts, statuses and error types or codes. In particular:

- **Secrets** (the YNAB access token, session cookies, CSRF secret, API keys,
  OIDC codes, `LOGFIRE_TOKEN`, provider keys) live in `SecretStr` settings, in
  `Authorization` headers or encrypted columns. Never put them in a URL, a log
  field, a span attribute, an exception message or an error response, and never
  print or paste them, including in task notes.
- **Logging:** structlog events take a constant name plus counts, UUIDs, codes,
  statuses and `ms`. Never log request or response bodies, model content,
  `str(error)`, `exc_info` or tracebacks; log `type(error).__name__` or a code.
  Keep uvicorn access logs off (`--no-access-log`): query strings carry OIDC codes.
- **Errors:** raise `RejectionError` (or `SourceError`) with fixed messages, and
  map other exceptions to fixed text as `app.py` and `mcp_server.safe_error` do.
  Keep `hide_parameters=True` on engines.
- **Spans:** use `logfire.span` with a constant name, never `@logfire.instrument`
  (it records every argument, including credentials). Spans leave the process
  only through `telemetry.SafeSpanExporter`, which drops exception messages; do
  not add another exporter or turn on Logfire's own.
- **Tests:** a new span, attribute, integration, secret or logging path extends
  `tests/integration/test_trace_privacy.py` (canaries checked in the export and
  the server log) and its reviewed key list. Check production Logfire by span
  names, attribute keys and counts only, never by reading values.

## Privacy and committing

- Never put personal financial records, identifying financial examples, exports,
  screenshots of real data, or credentials in source, docs, fixtures, task notes,
  generated artifacts, or commit messages. Use deliberately synthetic examples.
- Do not derive examples from the user's finances, even with names changed.
  Exclude private contact details, account identifiers, statement references,
  and identifying employer, bank, income, expense or balance combinations.
- Record demos, screenshots and videos only in an isolated browser populated
  with synthetic data. Never capture the user's existing workspace. Keep media
  outside the checkout unless explicitly requested for inclusion and reviewed.
- Keep private working data outside the checkout. Git ignores are a secondary
  safeguard; local tool snapshots can retain even untracked files.
- Stage explicit paths and inspect the staged diff before committing. Check
  generated standalone HTML as well as its source. Do not blindly stage all work.
- Privacy checks must cover tracked and untracked task artifacts, generated
  files and staged changes. Confirm that packaging bundles code/assets only,
  never browser storage, exports or database contents. Pattern scans alone do
  not establish that financial examples are synthetic; review their provenance.
- Report exactly what was checked. Do not promise that the repository contains
  "no personal information": normal author names/emails may remain in Git and
  project metadata. Distinguish that metadata from private financial/user data,
  and do not expand a repository check to external storage without authorization.
- A deletion commit does not remove old sensitive data. If found, stop publication
  and inspect branches, tags, tool refs, reflogs and unreachable objects; obtain
  authorization before destructive history cleanup. Never push automatically.
