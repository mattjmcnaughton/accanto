# Development

See [the README](../README.md) for setup and runtime commands and [API usage](api.md)
for admitted-user bootstrap, runtime database permissions and the monthly workflow.

The frontend lives in `src/accanto/web/frontend`. Vite proxies `/api`,
`/healthz`, and `/readyz` to the backend on port 8000. Postgres runs on 5433.

## Amp orb toolchain

Like Aleph, `.agents/setup` prepares the development toolchain without starting
the application. It installs Node 22.23.2 from `.nvmrc`, pnpm from the frontend's
`packageManager` pin (11.21.0), just 1.58.0, Python 3.12, and backend/frontend
dependencies from frozen lockfiles. Node and just downloads are checksum-verified.
The orb supplies `curl`, `tar`, `xz`, and `uv`; no Docker daemon is assumed.

Run `.agents/setup` to repeat installation safely. A repository-scoped login-shell
hook makes the tools available to subsequent Amp commands and supervised services.
Setup leaves `.env` untouched and does not configure Postgres, run migrations,
seed identities, supply provider credentials, or install E2E browser tooling.
`just gate` works without those services; integration and browser tests require
the separate setup documented below. There is no domain behavior change.

Amp runs setup when preparing an orb without an exact cached project snapshot;
installed tools need no `.agents/resume` hook. These files must reach the default
branch before new project orbs pick them up automatically.

To run the app in an orb, first configure a disposable database and authentication
as described below. Start servers through `amp orb service start`, not the local
`just dev` background-process recipe. For example, the backend can be supervised
with `amp orb service start accanto-backend --command 'just dev-be'`. Register
public previews with `amp orb portal` and share its returned portal URL, not a
loopback address. Browser sign-in requires the exact public HTTPS origin and a
registered provider callback; never expose the auto-approving test OIDC fixture
as a public provider. This bootstrap alone does not provide a signed-in preview.

## Development checks and workspace

Run `just gate` before committing. Backend unit tests need no database.
The frontend typecheck target builds the app first to generate its route tree.
Frontend unit tests run with `just test-unit-fe`. The production workspace requires
the backend, migrated database, configured browser authentication and a provisioned
identity. Missing or failed loads are shown explicitly.

The frontend transport uses same-origin cookie sessions and the implemented
monthly API. A submitted write keeps its exact JSON body and request identity in
tab memory until the server confirms it; stale conflicts require explicit
reconciliation. Session recovery opens a separate sign-in window and verifies the
same User through `/api/auth/session` before retrying with fresh CSRF. This memory
is cleared on explicit logout and does not survive closing or reloading the tab.
The workspace shell has a sidebar grouped by job (This month: Home, Activity,
Review; Planning: Plans, Income estimates; Balances: Savings, Investments, Giving,
Loans; then Settings) and, below 760 px, five tabs with More for the rest. Every
screen has its own hash address, such as `#/giving`. Home, Activity and Review share
the month chosen in the top bar, kept in the address as `?m=YYYY-MM` when it is not
the Entity's current month. With several Entities the address also carries
`?e=<Entity UUID>`; the top bar's Entity menu (and Ctrl/⌘ K) switches Entities or
creates one, and the last-used Entity ID is kept in browser storage. Add activity in the top bar opens the entry dialog from
any screen. Keys: Ctrl/⌘ K opens the Ask bar, which jumps to a screen, runs a / command
(`/inbox`, `/left`, `/month`, `/pending`, `/add`) without the model, or sends other text
to the assistant; 1 to 9 open the first nine screens in
sidebar order, N adds activity, [ and ] change the month, J and K move through rows,
and ? lists the shortcuts. Edit forms open in dialogs; a failed save's recovery
notice appears inside the open dialog. The theme choice lasts until reload.
Estimates save per-payment assumptions and show server-calculated monthly line and
combined results; manually copy a result into a Plan. Save a draft before saving an
immutable version. Activity is independent of Reviews; starting a Review visibly
preselects the immediately previous month's comparison or requires an explicit
choice. The delivered activity categories include income, fixed costs, guilt-free spending,
saving, investing and giving, with loan associations, goal funding and linked
refunds. See the [readiness matrix](technical/release-readiness.md) for source/test
mappings and release exclusions.
Unsaved navigation prompts apply to screens, selected records and months. Conflicts
retain attempted input while current records reload for explicit reconciliation.

The preserved [standalone prototype](product/daily-workspace-prototype.html) is
a legacy reference. Do not regenerate it from the new application. Its existing
browser data and saved Plan versions are not migrated or cleared; browser storage
is origin-bound, so moving between ports, hostnames, or the standalone file can
change which data a browser can access.

## Storybook

Storybook renders each screen and each shared UI component on its own, with mocked API
responses, so no backend or database is needed:

```sh
just storybook-fe        # http://localhost:6006
just build-storybook-fe  # static build in src/accanto/web/frontend/storybook-static/ (ignored)
```

- The toolbar switches **Theme** (light, or dark through `<html data-theme="dark">`) and the
  viewport; **Phone (390 px)** is the phone width.
- Stories live in `src/stories/`: `kit/` for `src/ui`, `screens/` for the workspace screens,
  `shared/` for smaller shared components and the shell.
- MSW mocks every `/api` read from one module, `src/stories/mocks/api.ts`, over synthetic data in
  `mocks/fixtures.ts`. Pick a state for all reads, or override some:

  ```ts
  export const Empty: Story = stateStory("empty"); // also "loaded", "loading", "failed"
  export const NoPlans: Story = { parameters: { msw: mockApi("loaded", { plans: [] }) } };
  ```

- `fixtures.ts` came from the synthetic `managing-fixtures` workspace (seeded with
  `--as-of 2026-11-10`) read through the real API. Keep every mock value invented.
- Screens save through their `save` prop, so writes show in the Actions panel instead of
  reaching a server. A request no handler matches falls through to the Vite `/api` proxy and
  fails with a generic error.

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
failure, soft deletion and protected saved versions. The browser E2E smoke test
exercises the built production UI with the signed provider fixture below. No hosted
provider is needed.

Import application models in `accanto.models` so Alembic sees `Base.metadata`.
Create subsequent migrations with `uv run alembic revision --autogenerate -m ...`,
review their contents and run `uv run alembic upgrade head`. Keep immutable-history
triggers when changing tables. Do not run a destructive downgrade on user data;
a rollback must preserve saved versions and audit history.

## Privacy review before a commit

Use fictional names and deliberately synthetic financial examples. Never derive
fixtures or documentation examples from a person's financial records. Production
packaging bundles code and assets only, not browser storage or database contents.
Verify that remains true whenever changing packaging or initial state.

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

## Browser identity setup (manual provider configuration)

Browser sign-in uses Authlib 1.7.2's authorization-code client and OIDC claim
validation, with RS256/ES256 signature validation, explicit nonce, S256 PKCE and
single-use, browser-bound login transactions. `httpx` is a runtime dependency for
that async client. No provider access/refresh/ID token is stored. Browser sessions
last 12 hours absolutely; only their secret hashes are stored. API keys retain
independent revocation and work without browser cookies.

Set these environment variables through deployment secret/config management:

- `BROWSER_ORIGIN`: exact public origin (HTTPS, no path), e.g. `https://accanto.example`.
- `BROWSER_CSRF_SECRET`: at least 32 random characters; keep private and consistent
  across workers. Rotation invalidates existing CSRF tokens; re-read session metadata.
- `OIDC_ISSUER`: exact issuer, including any provider-required path/trailing slash.
- `OIDC_CLIENT_ID` and `OIDC_CLIENT_SECRET`: confidential web application credentials.
- `OIDC_ALLOWED_EMAILS`: JSON array of exactly admitted verified email addresses.

Register the exact callback `${BROWSER_ORIGIN}/api/auth/callback`; enable the
`openid email` scopes, authorization code, S256 PKCE and `client_secret_basic`.
The provider must include verified email and nonce in its signed ID token. Only
HTTPS endpoints are accepted, with HTTP loopback permitted for local test services.
Discovery issuer must match configuration exactly. Provision the existing User's
exact `(issuer, subject)` with the operator bootstrap; matching email never links
an unknown identity to an existing User or Entity. No public registration exists.

Apply migrations before starting the application. Do not roll back session audit
history to a schema that requires an API key; use a compatible application rollback
or forward repair.

Migration `5l020` adds nullable `plan_revision.updated_at` and the triggers that
maintain it. Apply it before starting an application version that reads the column:
until then every Plan and Review endpoint fails with an undefined-column error, and
`/readyz` reports the schema incompatible. Record `alembic_version` first. An older
application ignores the column, so an application rollback does not need the
downgrade. Browser login transaction records contain short-lived PKCE
material; expired records are removed when a later login starts.

Production reverse proxies must suppress callback query strings, cookies and
Authorization headers in logs, traces and error reports. The application scrubs
callback query strings before Uvicorn access logging, and the supplied Uvicorn
commands disable access logs. Do not enable HTTP client debug/body logging.
All API responses use `Cache-Control: no-store`; browser writes require the exact
Origin plus `X-CSRF-Token` returned by session metadata. Secure, HttpOnly,
SameSite=Lax cookies have no Domain attribute. Do not weaken cookie settings to
accommodate an untrusted development origin.

Actual provider admission, discovery, key rotation, consent, redirect behavior and
hosted browser compatibility remain manual release checks. Local signed-provider
coverage does not establish compatibility with a real provider.

### Disposable browser acceptance fixture

`tests/oidc_fixture.py` is a local synthetic provider, excluded from the application
package. It generates an ephemeral RSA key and checks S256 PKCE before signing
an ID token for `synthetic-user` / `synthetic@example.test`. It automatically
approves this synthetic identity; never expose it as a real identity provider.
Use a new isolated test database and loopback ports; never a development database
containing user records. Bootstrap the synthetic identity with issuer
`http://127.0.0.1:55439`, subject `synthetic-user` and a synthetic Entity.

Run `uv run uvicorn tests.oidc_fixture:app --host 127.0.0.1 --port 55439 --no-access-log`.
The fixture defaults to callback origin `http://127.0.0.1:55438`. Override its
`ACCANTO_TEST_OIDC_ISSUER` and `ACCANTO_TEST_BROWSER_ORIGIN` when selecting other
isolated ports. Start Accanto on the matching browser origin with these synthetic
settings, the isolated database URL, and a deliberately synthetic CSRF secret:

- `OIDC_CLIENT_ID=synthetic-client`
- `OIDC_CLIENT_SECRET=synthetic-client-secret`
- `OIDC_ALLOWED_EMAILS='["synthetic@example.test"]'`
- `OIDC_ISSUER=http://127.0.0.1:55439`
- `BROWSER_ORIGIN=http://127.0.0.1:55438`

Use a fresh agent-browser session limited to these loopback services. Visit
`/api/auth/login`, allow the local redirect, then read `/api/auth/session` from
the same origin. Inspect stable User/Entity UUIDs, Entity-zone `today` and CSRF
metadata; post logout with exact Origin/CSRF and confirm the session then returns
401. Preserve only synthetic captures outside the checkout. Remove the fixture
processes and disposable browser profile after verification.


### Monthly browser acceptance

Build the frontend (`pnpm --dir src/accanto/web/frontend build`) before starting
FastAPI so the same origin serves the UI and API. After signing in with the local
fixture, create a synthetic Plan with $4,000 income and $800 spending and save v1.
Record $4,000 income assigned to its source and $75 spending, then create that
month's Review: differences are $0 and -$725. Reload, correct and delete the
spending entry; save an overallocated Plan version and confirm the existing Review
stays on v1. The following calendar month preselects v1; a month with no preceding
Review requires an explicit choice. Missing income sources remain unknown until
each has an entry, including explicit zero. Inspect keyboard and 320–390px layouts.

Use a fresh agent-browser session with explicit empty configuration and loopback
allowlist, never an existing profile. Keep synthetic captures outside the checkout.
The generic agent-browser fill command may not update native date/month controls;
verify their values and resulting displayed month. Acceptance capture can use the
native input value setter and dispatched input/change events while retaining the
production React handlers. This is separate from keyboard-operation verification.

## Continuous integration and browser smoke test

GitHub Actions runs three independent checks on pull requests to `main` and pushes
on `main`: `gate`, `integration`, and `e2e`. Each database job owns a fresh
PostgreSQL 16 service and applies Alembic migrations before testing. The workflow
has read-only repository permissions and performs no publishing or deployment.

The E2E job builds the app on Node 22, then uses Node 24 for pinned agent-browser
0.34.0 and its selected browser binary. It runs `just test-e2e` against the built
frontend, real database and local signed OIDC provider. The browser journey covers the delivered Plan/activity/Review loop, savings
funding/movements/lifecycle/refunds, destinations and separate loan observations,
reload durability, narrow layouts and targeted keyboard failure/retry recovery.
It is not a complete accessibility or real-provider compatibility audit.

For local execution, install the approved agent-browser version and its browser
(`agent-browser install`, without privileged system-dependency flags), build the
frontend, and migrate a dedicated local database ending in `_test`. Then run:

```sh
ACCANTO_E2E_DATABASE_URL=postgresql+asyncpg://postgres:postgres@127.0.0.1:5433/accanto_e2e_test \
  just test-e2e
```

Missing E2E setup fails the test instead of silently skipping it. The harness
starts loopback app/provider processes on temporary ports, uses a fresh isolated
browser session restricted to loopback, and closes them on exit. Both local and CI
runs use Chromium `--no-sandbox` for hosts that restrict user namespaces; this
weakens browser process isolation and is only for these synthetic local services.
It inserts only synthetic fixtures and retains them in the disposable database; never run against
user data or share the database between concurrent runs. No screenshots, browser
storage, tokens or server logs are uploaded as CI artifacts.

## Readiness and deployment preparation

`/healthz` checks process liveness. `/readyz` checks database connectivity and exactly
the supported Alembic revision (`6b022`); empty, old, unknown or unreadable migration
metadata returns 503. It does not probe providers or establish runtime grants.
[Deployment and recovery](technical/deployment.md) separates locally verified
behavior from pending Fly.io/Neon configuration, compatible rollback and credential
revocation reconciliation. Never reset a populated database for readiness.

## MCP v1 (TDD 03)

The main application serves MCP at `/mcp` on its own origin (Streamable HTTP,
stateless, JSON responses, `Cache-Control: no-store`, no CORS). It offers the
agent tool catalog in `services/tools.py`, not a mirror of the REST API, and
authenticates with the owner's API keys as `Authorization: Bearer <key>`.
Every call resolves the key again, so revocation denies the next call; browser
cookies alone get 401. Writes are audited with interface `mcp`, and the Entity's
Agent mode decides whether they run or become Pending changes. Client setup for
Claude Code, Codex and Amp is in [MCP clients](technical/mcp-clients.md).

Keep Uvicorn access logs disabled and do not enable FastMCP argument tracing or
HTTP body logging: tool arguments carry financial values. Tool errors carry only
fixed codes and messages, never input values. The earlier OAuth resource-server
design ([MVP-022 contract](technical/mcp-contract-proposal.md)) is superseded for
v1; `mcp_auth.MCPTokenVerifier` stays for the later hosted-OAuth phase but is not
mounted. `tests/integration/test_mcp.py` exercises `/mcp` against real
PostgreSQL; it does not establish compatibility with any hosted client.

## Built-in agent (TDD 03)

The sidebar assistant is off until an Entity opts in from **Settings → Agent**.
Its backend needs `AGENT_MODEL` and, for a real model, `OPENROUTER_API_KEY`:

- `AGENT_MODEL=stub` selects the deterministic test model
  (`services/stub_model.py`): no network, nothing leaves Accanto. It is refused
  when `BROWSER_ORIGIN` is a public HTTPS origin. Tests and e2e use it.
- A real model is an OpenRouter id, for example `AGENT_MODEL=openai/gpt-6-luna`,
  routed only to zero-data-retention endpoints. For local development load the
  key into the environment without printing it:
  `OPENROUTER_API_KEY=$(cat ~/.config/accanto/openrouter-local-accanto.key)`.
  Never commit, log or paste the key, and use only synthetic data with it.

Turns stream SSE from `POST /api/entities/{id}/agent/conversation/messages`
(`delta`, `tool`, `pending_change`, `done`, `error`, and `: ping`). Limits:
8 model requests and 90 s per reply, 2 replies at once, one per conversation,
`AGENT_DAILY_MESSAGE_CAP` (default 200) owner messages per User, across all their
Entities, per 24 hours.
Conversations keep plain text only and expire 30 days after the last turn. Logs
carry operation and tool names, timings, token counts and error codes; never
prompts, replies, tool results or images. `tests/conftest.py` sets
`ALLOW_MODEL_REQUESTS = False`, so no test reaches a provider by accident.

## Demo: synthetic YNAB data and the assistant

Everything below is loopback-only and synthetic: a fixture workspace, the fake
YNAB server, the local OIDC fixture and either the stub model or a real model
used only on this synthetic data. Record videos in an isolated browser profile,
never one signed in to a real workspace. Run each long-lived command in its own
terminal from the repository root, with PostgreSQL running (in an orb:
`127.0.0.1:5433`, user and password `postgres`).

1. Seed a synthetic Entity for the fixture identity, with the assistant on in
   Ask first (omit `--agent` to show the opt-in in Settings instead):

   ```sh
   export ACCANTO_FIXTURE_DATABASE_URL=postgresql+asyncpg://postgres:postgres@127.0.0.1:5433/accanto_fixture_test
   uv run python skills/managing-fixtures/scripts/fixtures.py seed \
     --issuer http://127.0.0.1:55439 --agent ask_first
   ```

   An existing fixture database is refused; reset it only if its synthetic edits
   may be lost (`... reset --confirm-reset --issuer http://127.0.0.1:55439`).

2. Build the frontend once: `pnpm --dir src/accanto/web/frontend build`.

3. Serve the seeded YNAB plan (`--hostile` adds a payee carrying an injected
   instruction, to show it reported rather than obeyed):

   ```sh
   just fake-ynab            # = uv run python -m tests.fakes.ynab_server --seed 7 --port 8105
   ```

4. Start the sign-in fixture:

   ```sh
   ACCANTO_TEST_OIDC_ISSUER=http://127.0.0.1:55439 \
   ACCANTO_TEST_BROWSER_ORIGIN=http://127.0.0.1:55438 \
   uv run uvicorn tests.oidc_fixture:app --host 127.0.0.1 --port 55439 --no-access-log
   ```

5. Start Accanto pointed at the fake server, with the stub model:

   ```sh
   export DATABASE_URL=$ACCANTO_FIXTURE_DATABASE_URL
   export BROWSER_ORIGIN=http://127.0.0.1:55438
   export BROWSER_CSRF_SECRET=synthetic-demo-csrf-secret-not-for-production
   export OIDC_ISSUER=http://127.0.0.1:55439 OIDC_CLIENT_ID=synthetic-client
   export OIDC_CLIENT_SECRET=synthetic-client-secret
   export OIDC_ALLOWED_EMAILS='["synthetic@example.test"]'
   export YNAB_API_URL=http://127.0.0.1:8105/v1
   export SOURCE_SECRET_KEY=$(uv run python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())')
   export AGENT_MODEL=stub
   uv run uvicorn accanto.app:app --host 127.0.0.1 --port 55438 --no-access-log
   ```

   For a real model instead, replace the last two lines with:

   ```sh
   export AGENT_MODEL=openai/gpt-6-luna
   export OPENROUTER_API_KEY=$(cat ~/.config/accanto/openrouter-local-accanto.key)
   uv run uvicorn accanto.app:app --host 127.0.0.1 --port 55438 --no-access-log
   ```

   Keep `SOURCE_SECRET_KEY` for the life of the database: a source connected
   under one key cannot be synced under another. Never echo either key.

6. Open `http://127.0.0.1:55438` and choose **Sign in**; the fixture approves
   `synthetic@example.test` automatically.

7. Connect the synthetic plan: **Transactions inbox** → paste the token
   `synthetic-ynab-token-not-real` → **Find plans** → *Fixture household plan* →
   **Connect this plan** → check *Example Checking* and *Sample Rewards Card* →
   **Import these accounts** → **Sync now**. Seed 7 stages 19 waiting items:
   purchases, a split, a refund, payroll, transfers, a card payment, an
   unapproved and uncleared dinner, a bill and a duplicate charge.

8. Open the assistant with **Assistant** or `Ctrl/⌘ J`. With the stub model,
   messages containing "categorize" propose categories for the inbox, "spend"
   quotes the month's Review, and "receipt" with a `YYYY-MM-DD` date (or an
   attached image plus a date) drafts an entry; apply drafts from **Pending
   changes**. A real model answers freely within the same tools and rules.

9. To show delta sync, apply the second batch and sync again:
   `curl -X POST http://127.0.0.1:8105/fake/advance`, then **Sync now**: an edited
   bill, a deleted duplicate, an approval and two new purchases. Restart the fake
   server to start the plan over; the inbox keeps what Accanto already staged.
