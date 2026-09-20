# Accanto

A financial companion for planning a rich life: conscious spending, giving,
experiences, consumption, saving, and financial independence.

This is a working application scaffold. It currently serves an Accanto starter
page and health endpoints. Plan creation, goal tracking, FIRE projections, and
the AI companion are specified in the product notes but not implemented yet.

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
unit tests. Frontend tests run when present; none exist yet. Integration and E2E
targets remain template placeholders until those suites are implemented.

The backend tests cover liveness, frontend deep-link serving, and preserving
404 responses for missing APIs and assets. No application tables or migrations
exist yet; the Alembic environment is ready for the first model.

## Production image

```sh
docker build -t accanto:local .
docker run --rm -p 8000:8000 \
  -e DATABASE_URL='postgresql+asyncpg://USER:PASSWORD@HOST:5432/accanto' \
  accanto:local
```

The image builds React and runs FastAPI as a non-root user. Run migrations using
`alembic upgrade head` inside the image against the same database before startup.
No deployment, authentication, or AI provider is configured.

## Product and architecture

- [Product brief](docs/product/brief.md): current direction and decisions still open.
- [Initial workflow specification](docs/product/workflows.md): creation and review.
- [Architecture](docs/architecture.md): package structure and conventions.
- [Development](docs/development.md): commands and local environment.

Scaffolded from `python-web` and composed `frontend-react` at template commit
`72a28b9be899c6ccd39f06f8482d55e460556acd`. Copier answers are stored with each
component. MIT licensed.
