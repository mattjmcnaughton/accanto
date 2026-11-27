# Accanto

A financial companion for planning a rich life: conscious spending, giving,
experiences, saving and financial independence.

Plan where each month's money goes, record where it went, and review the difference.

- **Plan** each month: income, fixed costs, guilt-free spending, giving, saving and
  investing. Saved versions never change, so you can compare them.
- **Record** activity by hand, or accept it from the **Transactions inbox**: YNAB
  transactions and your own scheduled entries wait there until you record them.
  Search it, add notes, record several at once, or work through it in flow mode.
- **Review** each month against the Plan you chose. Home shows what needs you.
- **Track** savings goals, investments, giving and loans, including loan payoff
  schedules.
- **Project** net worth and a FIRE date, in today's or future dollars.
- **Routines** are checklists on a schedule, such as a Saturday money check.
- **Ask the assistant**, with several conversations kept, or connect your own agent
  over [MCP](docs/technical/mcp-clients.md). Agents can also read and change safe
  settings.

On a phone the tabs are Home, Inbox, Assistant, Activity and More.

![Home in the light theme](docs/screenshots/home-light.png)

![Transactions inbox in the light theme](docs/screenshots/inbox-light.png)

![Review in the dark theme](docs/screenshots/review-dark.png)

The screenshots use synthetic fixture data.
[See every screen in light, dark and at 390 px](docs/screenshots/README.md).

## Try it in two minutes

Storybook shows every screen with synthetic data. It needs no backend, database or
sign-in, just Node 22+, pnpm and just.

```sh
git clone https://github.com/mattjmcnaughton/accanto.git
cd accanto
pnpm --dir src/accanto/web/frontend install
just storybook-fe
```

Open http://localhost:6006 and start with **Screens → Home**. The toolbar switches
to the dark theme and the phone width.

## Status

A personal alpha: one owner, USD only, no public sign-up. It runs on an Amp Box
([Box operations](docs/technical/box-operations.md)). The
[readiness matrix](docs/technical/release-readiness.md) lists what is covered and
what is still open.

## Run it locally

Needs Python 3.12+, uv, Node 22+, pnpm 11.21.0, just and Docker.

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
- Postgres: localhost:5433

Signing in needs an identity provider. For local testing, use the synthetic provider
in [Development](docs/development.md#disposable-browser-acceptance-fixture). The
[`managing-fixtures` skill](skills/managing-fixtures/SKILL.md) seeds a synthetic
workspace to explore.

## Checks

```sh
just gate              # format, lint, types, unit tests
just gate-expensive    # plus integration and browser tests (needs Postgres)
```

## Container

```sh
docker build -t accanto:local .
docker run --rm -p 8000:8000 \
  -e DATABASE_URL='postgresql+asyncpg://USER:PASSWORD@HOST:5432/accanto' \
  accanto:local
```

Run `alembic upgrade head` against the database first, and supply the sign-in
settings from [Development](docs/development.md#browser-identity-setup-manual-provider-configuration).
See [Deployment and recovery](docs/technical/deployment.md).

## More

- [Product brief](docs/product/brief.md): direction and status
- [Domain context](CONTEXT.md): what the financial words mean
- [Architecture](docs/architecture.md) and [Development](docs/development.md)
- [API](docs/api.md) and [MCP clients](docs/technical/mcp-clients.md)

FastAPI, React/TypeScript and Postgres. MIT licensed.
