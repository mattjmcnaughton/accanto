# Running and debugging the personal deployment on an Amp Box

The personal alpha runs as the `accanto` deployment on the shared Amp Box
`mattjmcnaughton/apps`, with Neon PostgreSQL and Auth0 sign-in. This page is the
operator and agent runbook for deploying and debugging it with Amp. The general
release, rollback and recovery requirements in [deployment.md](deployment.md)
still apply; this page only covers how to carry them out on a Box.

The deployment holds real personal financial data. Every debugging step below
uses logs, health endpoints, schema state and provider metadata. None of them
needs to read financial rows, and none should.

## What runs where

| Piece | Where | Notes |
| --- | --- | --- |
| Build | The orb or machine running `amp boxes deploy` | `scripts/box-build.sh` builds a relocatable CPython 3.12, the locked dependencies and the accanto wheel with the SPA into `box-release/`. No source, tests or fixtures ship. |
| Web service | Box `mattjmcnaughton/apps`, deployment `accanto`, service `web` | Defined in `.amp/box.yaml`. Runs as the deployment's own unprivileged account. Uvicorn access logs are off. |
| Scheduled jobs | Same deployment, service `jobs` | Also in `.amp/box.yaml`: waits 60 s, runs `python -m accanto.jobs.tick` once, sleeps an hour and is restarted by systemd, so it runs hourly and about a minute after every deploy. The wait keeps it from competing with `web`'s start for the CPU during a deploy ([TDD 11](../tdds/11-background-jobs.md)). It never listens on a port. |
| Deploy target | `.amp/box-deploy.json` | Box, deployment name, branch and custom domain `accanto.mattjmcnaughton.com`; the `onamp.dev` URL redirects there. |
| Database | Neon project `accanto` | `accanto_owner` runs migrations and never reaches the Box. `accanto_app` is the restricted runtime login in the Box's `DATABASE_URL`. |
| Sign-in | Auth0 application "Accanto" | Callback `<deployment URL>/api/auth/callback`. |
| Access | Public URL | Accanto's Auth0 sign-in, email allowlist and provisioned users are the only gate; only login and health endpoints answer without credentials. Amp `--private` was removed: when its access lapses it redirects API requests, which the app's `fetch` refuses. |

Background job runs ([TDD 11](../tdds/11-background-jobs.md)) advance inside the
`web` service. The `jobs` service runs the scheduled tick; to run one now, use
`amp boxes exec ... --as-app -- python/bin/python3 -m accanto.jobs.tick` (see
"Running a command as the app"). Both log step names and counts only.

Runtime configuration lives on the deployment, never in Git:

- Secrets: `DATABASE_URL` (asyncpg URL with `?ssl=verify-full`), `OIDC_CLIENT_ID`,
  `OIDC_CLIENT_SECRET`, `OIDC_ALLOWED_EMAILS` (a JSON list, such as
  `["me@example.com"]`), `BROWSER_CSRF_SECRET`.
- Environment variable: `OIDC_ISSUER`, exactly as the provider's discovery document
  reports it. Auth0 issuers end with `/`.
- Optional, for performance tracing: secret `LOGFIRE_TOKEN` (a write token for
  the private `accanto` Logfire project) and environment variable
  `LOGFIRE_ENVIRONMENT=production`. Without the token nothing is exported; see
  [telemetry.md](telemetry.md).
- Optional, for Notifications ([TDD 20](../tdds/20-notifications.md)): secret
  `VAPID_PRIVATE_KEY`, printed by `just vapid-keys`. Both services read it: `web`
  serves its public key and `jobs` signs pushes with it. Unset hides
  Notifications and sends nothing. Replacing it invalidates every Device's
  subscription; each must turn Notifications on again.
- Optional environment variable: `REPORT_BUG_EMAILS`, a JSON list of the
  signed-in emails that see Report bug ([TDD 21](../tdds/21-report-bug.md)).
  It takes effect at each User's next sign-in.
- Set by Amp: `PORT` and `AMP_DEPLOYMENT_URL`, which becomes `BROWSER_ORIGIN`.

List what is stored, without values, with `manage_amp` (topics `secrets` and
`environment_variables`, operation `list`, scope `box`, box `mattjmcnaughton/apps`,
deployment `accanto`). Set values with the same tool; a user-provided value is
entered in a masked dialog and never appears in a transcript. Changes take effect
on the next deploy.

## Deploying

Deploys use pushed code only. From an orb on this repository:

```sh
amp boxes deploy
```

The CLI builds, uploads, switches to the new release, waits for the port and
switches back to the previous release if the service does not start. Check
`"status": "ready"` and `deployedCommitSHA` in its output, then check readiness
as described below.

The CLI waits only about 12 seconds for the port, and the b1.small Box imports
Python roughly three times slower than an orb. So startup does not import the
assistant (pydantic-ai, openai) or MCP (fastmcp, mcp) stacks. They load on the
first assistant request and the first `/mcp` request, and
`tests/unit/test_app.py` fails if startup imports them again.

Migrate **before** deploying an application version that needs a new schema.
Migrations run from an orb with the owner credential, never from the Box:

```sh
PGSSLROOTCERT=/etc/ssl/certs/ca-certificates.crt \
DATABASE_URL="<owner asyncpg URL with ?ssl=verify-full>" \
uv run alembic upgrade head
```

Reapply the runtime grants in [api.md](../api.md#local-setup-and-credentials)
when a migration adds tables. `/readyz` returns 503 until the database is at the
schema revision the application pins.

## Debugging with Amp

Find the deployment's status, ID, port and deployed commit first:

```sh
amp boxes deployments mattjmcnaughton/apps
```

### Is it up?

```sh
amp boxes exec mattjmcnaughton/apps --deployment accanto \
  'curl -s localhost:<port>/healthz; echo; curl -s localhost:<port>/readyz'
```

- `/healthz` failing means the process is not running: read the service log.
- `/readyz` returning `"database": "unreachable"` means the connection failed:
  check `DATABASE_URL`, Neon status and TLS.
- `/readyz` returning `"schema incompatible"` means the database is not at the
  pinned revision: run the migration.

From outside, `curl -s https://accanto.mattjmcnaughton.com/readyz` checks
readiness directly, and `/api/auth/session` must return 401 without a session.

### Service logs

The units are `amp-box-deploy-<deployment-id>-svc-web.service` and, for the
scheduled tick, `...-svc-jobs.service`. A healthy tick logs `job_tick_finished`
with `"failed": false` about once an hour, and about a minute after each deploy:

```sh
amp boxes exec mattjmcnaughton/apps \
  'sudo journalctl -u amp-box-deploy-<deployment-id>-svc-web.service -n 200 --no-pager -o cat'
```

Startup errors from settings validation can echo configuration values, including
the allowed email and connection URLs. Redact before showing logs in a thread or
issue, for example by piping through
`sed -E 's#://[^ /]*@#://<redacted>@#g; s/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/<email>/g'`.

### Sign-in problems

Check where the login redirect points, with one-time values masked:

```sh
amp boxes exec mattjmcnaughton/apps --deployment accanto \
  'curl -s -D - -o /dev/null localhost:<port>/api/auth/login | grep -i "^location" | sed -E "s/(state|nonce|code_challenge|client_id)=[^&]*/\1=…/g"'
```

It must go to the configured Auth0 tenant with
`redirect_uri=<deployment URL>/api/auth/callback`, `scope=openid email` and
`code_challenge_method=S256`. A 503 from `/api/auth/login` means browser sign-in
is not configured: the issuer, origin, client ID or CSRF secret is missing or
invalid.

After the redirect, a refused person lands back on the sign-in page with
`?refused=not_invited` ("This email isn't invited yet"): the issuer differs, the
email is not verified, or it is not in `OIDC_ALLOWED_EMAILS`.

### Adding a new person

The only manual step is the allowlist:

1. Add their email to the `OIDC_ALLOWED_EMAILS` secret (keep it a JSON list) and
   redeploy. Auth0 must also let them log in with a verified email.

Their first sign-in creates their User and their own Entity, "Personal", in their
browser's time zone. No `accanto.bootstrap`, Auth0 subject lookup or second sign-in
is needed. A User who already exists but owns no Entity (for example someone
bootstrapped without `--entity` to share yours) gets their own "Personal" Entity
on their next sign-in, alongside anything shared with them. Matching email never
links a new subject to an existing User. `python -m accanto.bootstrap` remains
only for recovery or scripted access before anyone signs in.

### Giving someone access to an existing Entity

To let a second person, such as a partner, use an Entity you own
([TDD 19](../tdds/19-entity-members.md)):

1. Add them as above and have them sign in once (this records their verified
   email in Accanto and gives them their own "Personal" Entity).
2. In Accanto, open Settings → **Shared with**, enter their name and the email
   they sign in with, and choose **Add person**. They see the Entity on their next page load.
   **Remove** there revokes their access on their next request.

Auth0's tenant logs (dashboard, or the Management API with `read:logs`) explain
refusals on the provider's side, such as a disabled connection or a wrong callback.

### Running a command as the app

```sh
amp boxes exec mattjmcnaughton/apps --deployment accanto --as-app -- <command>
```

This runs with the deployment's secrets and environment from the last deploy,
inside the read-only release (`box-release/python/bin/python3`, `PYTHONPATH=site`).
Never print secret values, and do not use it to query financial tables.

### Database and recovery

Use the Neon console or API for project status, the restore window and
point-in-time restore. Follow [deployment.md](deployment.md#provider-restoration-and-access-reconciliation)
for any restore, including credential reconciliation. Never reset, truncate or
downgrade the populated database to fix startup; it is not the fixture database.

## Failures seen so far

| Symptom | Cause | Fix |
| --- | --- | --- |
| Deploy fails: nothing listening on the port; log shows `error parsing value for field "oidc_allowed_emails"` | `OIDC_ALLOWED_EMAILS` stored as a bare address | Store it as a JSON list, then redeploy |
| Log shows `Invalid environment variable name evaluates to an empty string` | Shell-only syntax such as `${VAR%/}` in a `.amp/box.yaml` command; systemd expands `${...}` itself before the shell runs | Use plain `$VAR` or move logic into a script |
| `root certificate file ... root.crt does not exist` from asyncpg | `ssl=verify-full` with no CA bundle | Set `PGSSLROOTCERT` (certifi on the Box, the system bundle in orbs) |

## Privacy rules for agents

- Do not start Amp threads on the Box against the `accanto` deployment, and do
  not enable the Box review widget on it: both can read the live data directory
  and database.
- Debug from logs, health endpoints, schema revision and provider metadata. Do not
  read or export financial rows, and do not paste unredacted logs.
- Keep the owner credential and one-time bootstrap output outside the checkout and
  outside transcripts.
- The synthetic fixture tooling only targets a local `accanto_fixture_test`
  database. Never point it at Neon.
