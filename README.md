# Accanto

A financial companion for planning a rich life: conscious spending, giving,
experiences, consumption, saving, and financial independence.

The frontend is an interactive design prototype for Plans, monthly Reviews,
Activity, saving goals, investments, and charitable giving. It starts empty and
keeps data in browser storage, with export/restore. No backend is required to
evaluate the prototype. Annual Plans/Reviews, tax estimation, and FIRE
projections are deferred.

Run `just dev-fe`, or open the generated
[standalone prototype](docs/product/daily-workspace-prototype.html). See the
[review walkthrough](docs/product/prototype-review.md) for workflows and current
design decisions. The production backend now supports an authenticated direct-API
income/spending Plan → activity → monthly Review loop with Postgres persistence.
See [API usage](docs/api.md). The browser remains a separate local prototype;
API-backed UI, browser sign-in and the remaining financial commands are next.

## Try the prototype

Open the [standalone HTML](docs/product/daily-workspace-prototype.html) in a
browser, or run the frontend with Node 22+, pnpm 11.21.0 and just:

```sh
pnpm --dir src/accanto/web/frontend install
just dev-fe
```

Follow the local URL printed by Vite (normally http://localhost:5173). No Python
server, database, API key or sign-in is needed for this workflow. The current
prototype uses direct monthly net-income Plans, separate saved income estimates,
account-level planned savings funding, goal-level recorded savings activity,
linked refunds and monthly Reviews. Start with the [walkthrough](docs/product/prototype-review.md).

Data belongs to the browser origin: `localhost`, `127.0.0.1`, different ports and
the standalone file may have separate workspaces. Use Settings & data to export
and restore explicitly. Keep private data and recordings outside the checkout;
examples and tests use synthetic data. See the walkthrough for legacy-data
handling, protected openings and other prototype limits.

Rebuild the portable artifact after frontend changes:

```sh
pnpm --dir src/accanto/web/frontend prototype
```

## Stack

Like Aleph, Accanto uses FastAPI, a React/TypeScript frontend under the Python
package, and Postgres with SQLAlchemy and Alembic. Vite proxies backend requests
in development; FastAPI serves the built frontend in production.

## Full-stack local development

Requires Python 3.12+, uv, Node 22+, pnpm 11.21.0, just, and Docker.

```sh
uv sync --dev
cp .env.example .env
(cd src/accanto/web/frontend && pnpm install)
docker compose up -d --wait postgres
uv run alembic upgrade head
just dev
```

- Frontend: http://localhost:5173
- Backend and API docs: http://localhost:8000/docs
- Liveness: `/healthz`; database readiness: `/readyz`
- Postgres: localhost:5433 (kept separate from the usual 5432 port)

`just dev-be` and `just dev-fe` start either server individually. Ctrl-C stops
both servers started by `just dev`. `docker compose stop` stops Postgres while
preserving its data. The checked-in database credentials are for local use only.

## Verification

```sh
just gate
```

Checks formatting, linting, types, the frontend build, and backend and frontend
unit tests. For prototype-only changes, use `just gate-fe`. The prototype browser
journeys run separately with
`pnpm --dir src/accanto/web/frontend exec playwright test`; they are not included
in `just gate` or the backend `just test-e2e` target. Browser setup and the
`CHROMIUM_EXECUTABLE` override are described in [development](docs/development.md).
Backend integration tests exercise the monthly API against an explicitly configured local
test database; see [development](docs/development.md). Backend E2E remains pending.

The backend tests cover liveness, frontend deep-link serving, and preserving
404 responses for missing APIs and assets, plus pure Decimal domain rules. The
initial migration includes typed monthly records, credentials, audit and retry
outcomes; real Postgres checks cover concurrency, authorization and rollback.

## Container build

```sh
docker build -t accanto:local .
docker run --rm -p 8000:8000 \
  -e DATABASE_URL='postgresql+asyncpg://USER:PASSWORD@HOST:5432/accanto' \
  accanto:local
```

The image builds React and runs FastAPI as a non-root user. It still serves the
browser-local prototype; packaging it does not connect it to the monthly API or
make it a completed production application. Run migrations using
`alembic upgrade head` inside the image against the same database before startup.
No deployment, browser identity provider, hosted MCP, or AI provider is configured.
Use a separate restricted database runtime role as described in the API guide.

## Product and architecture

- [Product brief](docs/product/brief.md): current direction and delivery status.
- [MVP PRD](docs/prd/01-mvp.md): agreed requirements, prototype coverage and deferrals.
- [MVP TDD](docs/tdds/01-mvp.md): technical design and production enforcement.
- [Domain context](CONTEXT.md): shared financial language.
- [Architecture](docs/architecture.md): package structure and conventions.
- [Development](docs/development.md): commands and local environment.

Scaffolded from `python-web` and composed `frontend-react` at template commit
`72a28b9be899c6ccd39f06f8482d55e460556acd`. Copier answers are stored with each
component. MIT licensed.
