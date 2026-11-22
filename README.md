# Accanto

A financial companion for planning a rich life: conscious spending, giving,
experiences, saving, and financial independence.

Accanto helps you decide where each month's money should go, record where it
actually went, and review the difference, without blurring what you intended,
what you received, what you contributed and what you hold.

- **Plan** each month: income, fixed costs, guilt-free spending, giving, savings
  goals and investments. Saved versions never change, so you can compare scenarios.
- **Record** dated activity once, with where the money came from. Refunds land in
  their own month and restore their original funding.
- **Review** the month against the Plan you chose, and see on Home what needs attention.
- **Keep track** of savings goals, investments, giving recipients and loans.

![Home in the light theme](docs/screenshots/home-light.png)

![Review in the dark theme](docs/screenshots/review-dark.png)

Both screenshots use synthetic fixture data. See
[every screen in light, dark and at 390 px](docs/screenshots/README.md).

## Try it in two minutes

Storybook renders every screen with the same synthetic data, with no backend,
database or sign-in. It needs Node 22+, pnpm and just.

```sh
git clone https://github.com/mattjmcnaughton/accanto.git
cd accanto
pnpm --dir src/accanto/web/frontend install
just storybook-fe
```

Open http://localhost:6006 and start with **Screens → Home**. The toolbar switches
to the dark theme and the phone width. To run the real app with Postgres and
sign-in, follow [full-stack local development](#full-stack-local-development).

## Status

Accanto is a personal alpha: one owner, one Entity, USD only, with no public sign-up.
The production frontend uses browser sign-in and the authenticated API, with
Postgres persistence. Estimate results are copied into Plans by hand; there is no
live link. Coverage and outstanding release gates are recorded in the
[readiness matrix](docs/technical/release-readiness.md).
See [API usage](docs/api.md) and [browser configuration](docs/development.md#browser-identity-setup-manual-provider-configuration).

Running the real workspace needs the full-stack setup below, configured browser
authentication and a provisioned identity; the development guide has a local signed
provider fixture for isolated synthetic testing. The UI reports an unavailable
backend or sign-in explicitly; it never falls back to browser-local financial data.

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
The image configures no browser identity provider, hosted MCP, or AI provider.
Use a separate restricted database runtime role as described in the API guide.
[Deployment and recovery](docs/technical/deployment.md) records compatible rollback
and provider evidence requirements; it does not authorize deployment. The personal
alpha runs on an Amp Box, described in [Box operations](docs/technical/box-operations.md).

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
