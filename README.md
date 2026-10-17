# Accanto

A financial companion for planning a rich life: conscious spending, giving,
experiences, consumption, saving, and financial independence.

The frontend is an interactive design prototype for Plans, monthly Reviews,
Activity, saving goals, investments, and charitable giving. It starts empty and keeps data in browser storage,
with export/restore. No backend is required to evaluate the prototype. Yearly
Reviews and FIRE projections are deferred.

Run `just dev-fe`, or open the generated
[standalone prototype](docs/product/daily-workspace-prototype.html). See the
[review walkthrough](docs/product/prototype-review.md) for workflows and current
design decisions. The production backend now supports an authenticated direct-API
income/spending Plan → activity → monthly Review loop with Postgres persistence.
See [API usage](docs/api.md). The browser remains a separate local prototype;
API-backed UI, browser sign-in and the remaining financial commands are next.

## Stack

Like Aleph, Accanto uses FastAPI, a React/TypeScript frontend under the Python
package, and Postgres with SQLAlchemy and Alembic. Vite proxies backend requests
in development; FastAPI serves the built frontend in production.

## Local development

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

Checks formatting, linting, types, the frontend production build, and backend
unit tests. Frontend tests cover the prototype financial workflows. A browser walkthrough
runs with `pnpm --dir src/accanto/web/frontend exec playwright test`. Backend
integration tests exercise the monthly API against an explicitly configured local
test database; see [development](docs/development.md). Backend E2E remains pending.

The backend tests cover liveness, frontend deep-link serving, and preserving
404 responses for missing APIs and assets, plus pure Decimal domain rules. The
initial migration includes typed monthly records, credentials, audit and retry
outcomes; real Postgres checks cover concurrency, authorization and rollback.

## Production image

```sh
docker build -t accanto:local .
docker run --rm -p 8000:8000 \
  -e DATABASE_URL='postgresql+asyncpg://USER:PASSWORD@HOST:5432/accanto' \
  accanto:local
```

The image builds React and runs FastAPI as a non-root user. Run migrations using
`alembic upgrade head` inside the image against the same database before startup.
No deployment, browser identity provider, hosted MCP, or AI provider is configured.
Use a separate restricted database runtime role as described in the API guide.

## Product and architecture

- [Product brief](docs/product/brief.md): current direction and decisions still open.
- [Domain context](CONTEXT.md): shared financial language.
- [Architecture](docs/architecture.md): package structure and conventions.
- [Development](docs/development.md): commands and local environment.

Scaffolded from `python-web` and composed `frontend-react` at template commit
`72a28b9be899c6ccd39f06f8482d55e460556acd`. Copier answers are stored with each
component. MIT licensed.
