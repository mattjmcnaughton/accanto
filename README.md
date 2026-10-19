# Accanto

A financial companion for planning a rich life: conscious spending, giving,
experiences, consumption, saving, and financial independence.

The production frontend uses browser sign-in and the authenticated API for
Plans with all delivered allocations, dated activity and funding origins, monthly
Reviews, independent income estimates, savings lifecycle, refunds, destinations
and loan observations with Postgres persistence.
Plans have editable drafts and immutable saved versions; Reviews retain their chosen
comparison. Failed writes preserve attempted input for explicit recovery in the same
tab. Estimate results are entered into Plans manually; there is no live link.
Coverage and outstanding release gates are recorded in the
[readiness matrix](docs/technical/release-readiness.md).
See [API usage](docs/api.md) and [browser configuration](docs/development.md#browser-identity-setup-manual-provider-configuration).

## Run the production workspace

Follow the full-stack setup below, configure browser authentication, and provision
an admitted identity. The UI reports an unavailable backend or sign-in explicitly;
it never falls back to browser-local financial data. A local signed provider fixture
is available for isolated synthetic testing in the development guide.

The accepted browser-local design
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
- Liveness: `/healthz`; database/schema readiness: `/readyz`
- Postgres: localhost:5433 (kept separate from the usual 5432 port)

`just dev-be` and `just dev-fe` start either server individually. Ctrl-C stops
both servers started by `just dev`. `docker compose stop` stops Postgres while
preserving its data. The checked-in database credentials are for local use only.

## Verification

```sh
just gate
```

Checks formatting, linting, types, the frontend build, and backend and frontend
unit tests. For frontend-only changes, use `just gate-fe`. Component tests cover
source identity, Review selection, unknown values, retry identity and session recovery.
Local agent-browser acceptance covers the real API/Postgres monthly journey using
synthetic data; the prototype browser suite is retired. Hosted provider compatibility
remains a manual release check.
Backend integration tests exercise the monthly API against an explicitly configured local
test database; see [development](docs/development.md). The real browser journey
uses that API and a local signed OIDC fixture; it does not establish hosted identity
compatibility.

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

The image builds React and runs FastAPI as a non-root user. It serves the production
workspace and API. Supply the browser authentication settings described in the
development guide. Run migrations using
`alembic upgrade head` inside the image against the same database before startup.
No deployment, browser identity provider, hosted MCP, or AI provider is configured.
Use a separate restricted database runtime role as described in the API guide.
[Deployment and recovery](docs/technical/deployment.md) records compatible rollback
and provider evidence requirements; it does not authorize deployment.

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
