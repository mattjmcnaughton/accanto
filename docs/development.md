# Development

See [the README](../README.md) for setup and runtime commands and [API usage](api.md)
for admitted-user bootstrap, runtime database permissions and the monthly workflow.

The frontend lives in `src/accanto/web/frontend`. Vite proxies `/api`,
`/healthz`, and `/readyz` to the backend on port 8000. Postgres runs on 5433.

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
The UI exposes Plans, Activity, Monthly Review and independent Income estimates.
Estimates save per-payment assumptions and show server-calculated monthly line and
combined results; manually copy a result into a Plan. Save a draft before saving an
immutable version. Activity is independent of Reviews; starting a Review visibly
preselects the immediately previous month's comparison or requires an explicit
choice. Income and guilt-free spending are the only supported activity categories.
Unsaved navigation prompts apply to screens, selected records and months. Conflicts
retain attempted input while current records reload for explicit reconciliation.

The preserved [standalone prototype](product/daily-workspace-prototype.html) is
a legacy reference. Do not regenerate it from the new application. Its existing
browser data and saved Plan versions are not migrated or cleared; browser storage
is origin-bound, so moving between ports, hostnames, or the standalone file can
change which data a browser can access.

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
failure, soft deletion and protected saved versions. The backend E2E suite remains
unimplemented; local agent-browser acceptance separately exercises the production
UI with the signed provider fixture below. No hosted provider is needed.

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
or forward repair. Browser login transaction records contain short-lived PKCE
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
