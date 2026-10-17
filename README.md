# Accanto

A financial companion for planning a rich life: conscious spending, giving,
experiences, consumption, saving, and financial independence.

The active frontend is a new production shell. It explicitly reports that
sign-in and the Entity workspace are not connected yet; it does not load the
browser-local design prototype or financial data. The backend supports an
authenticated direct-API income/spending Plan → activity → monthly Review loop
with Postgres persistence. See [API usage](docs/api.md). Browser sign-in and
API-backed workflows are planned in the [MVP tickets](docs/technical/tickets/01-mvp.md).

## Run the production shell

With Node 22+, pnpm 11.21.0 and just:

```sh
pnpm --dir src/accanto/web/frontend install --frozen-lockfile
just dev-fe
```

Follow the local URL printed by Vite (normally http://localhost:5173). The
shell needs no Python server or database. The accepted browser-local design
[prototype remains available as standalone HTML](docs/product/daily-workspace-prototype.html),
with its [walkthrough](docs/product/prototype-review.md). It is a legacy reference,
not the active frontend, and its committed HTML is not rebuilt from the production
application. The prototype's browser data and saved Plan versions are left in
place. Browser storage belongs to its origin: `localhost`, `127.0.0.1`, different
ports, and a standalone file can each have different data access. Keep private
exports and recordings outside the checkout.

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
unit tests. For frontend-only changes, use `just gate-fe`. The old prototype
browser suite has been retired; production browser journeys will be added with
the API-backed workflows.
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

The image builds React and runs FastAPI as a non-root user. It serves the new
production shell while browser access is being built. Run migrations using
`alembic upgrade head` inside the image against the same database before startup.
No deployment, browser identity provider, hosted MCP, or AI provider is configured.
Use a separate restricted database runtime role as described in the API guide.

## Product and architecture

- [Product brief](docs/product/brief.md): current direction and delivery status.
- [MVP PRD](docs/prd/01-mvp.md): agreed requirements, prototype coverage and deferrals.
- [MVP TDD](docs/tdds/01-mvp.md): technical design and production enforcement.
- [MVP tickets](docs/technical/tickets/01-mvp.md): implementation order, dependencies
  and acceptance criteria, beginning with a fresh production frontend.
- [Domain context](CONTEXT.md): shared financial language.
- [Architecture](docs/architecture.md): package structure and conventions.
- [Development](docs/development.md): commands and local environment.

Scaffolded from `python-web` and composed `frontend-react` at template commit
`72a28b9be899c6ccd39f06f8482d55e460556acd`. Copier answers are stored with each
component. MIT licensed.
