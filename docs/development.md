# Development

See [the README](../README.md) for setup and runtime commands and [API usage](api.md)
for admitted-user bootstrap, runtime database permissions and the monthly workflow.

The frontend lives in `src/accanto/web/frontend`. Vite proxies `/api`,
`/healthz`, and `/readyz` to the backend on port 8000. Postgres runs on 5433.

Run `just gate` before committing. Backend unit tests need no database.
The frontend typecheck target builds the app first to generate its route tree.
Prototype unit tests run with `just test-unit-fe`. The browser walkthrough runs
with `pnpm --dir src/accanto/web/frontend exec playwright test`; it uses or starts
Vite on port 8770. Set `CHROMIUM_EXECUTABLE` to an existing compatible Chromium
binary if Playwright's default browser is unavailable.

The current frontend works without the backend. Regenerate the standalone HTML
with `pnpm --dir src/accanto/web/frontend prototype`. Browser storage is local to
the origin; export/restore from Settings to move prototype data between devices.

## Real PostgreSQL API verification

Use a separate, disposable **test** database; never point these tests at user data.
They create unique fixtures, a restricted runtime role and temporary failure
triggers, and require a test database owner with role-management privileges.
Do not run concurrent copies against the same database. Existing records are not
truncated; retained test fixtures can be removed by recreating this test database.

```sh
docker compose up -d --wait postgres
docker compose exec -T postgres createdb -U postgres accanto_core_test
DATABASE_URL=postgresql+asyncpg://postgres:postgres@127.0.0.1:5433/accanto_core_test \
  uv run alembic upgrade head
ACCANTO_TEST_DATABASE_URL=postgresql+asyncpg://postgres:postgres@127.0.0.1:5433/accanto_core_test \
  just test-integration
```

Skip `createdb` if the test database already exists. Without the explicit test URL,
the monthly integration check skips. It verifies the authenticated Plan/activity/
Review journey, concurrent retries and stale edits, revoked access, atomic audit
failure, soft deletion and protected saved versions. Backend browser E2E remains
pending until the API-backed UI exists. No hosted provider is needed.

Import application models in `accanto.models` so Alembic sees `Base.metadata`.
Create subsequent migrations with `uv run alembic revision --autogenerate -m ...`,
review their contents and run `uv run alembic upgrade head`. Keep immutable-history
triggers when changing tables. Do not run a destructive downgrade on user data;
a rollback must preserve saved versions and audit history.

## Privacy review before a commit

Use fictional names and deliberately synthetic financial examples. Never derive
fixtures or documentation examples from a person's financial records. The current
prototype starts empty; its package script bundles application assets, not browser
storage. Verify that remains true whenever changing packaging or initial state.

Keep financial exports, recovery files, real-data screenshots and scratch notes
outside the repository, including untracked/ignored files: tooling may snapshot
working files separately from normal commits. The export ignore patterns are a
secondary safeguard, not a privacy guarantee. Inspect generated HTML as well as
source and documentation; a secrets scanner cannot identify every personal amount.

Commit one coherent change at a time. Use explicit `git add <paths>`, then inspect
`git diff --cached --stat`, `git diff --cached` and `git diff --cached --check` before
committing. Review task notes too. Do not use a blanket add or push automatically.
If personal data is found in history, stop publication: deleting the current file
is insufficient. History cleanup must cover tool refs, reflogs and unreachable
objects, with explicit authorization for destructive removal. Local Git cleanup
does not erase browser storage, databases, chat transcripts or external backups.
