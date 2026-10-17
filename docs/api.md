# API reference

The production API supports direct net-income Plans and guilt-free spending,
dated income/spending entries, monthly Reviews against saved versions, and
independent income estimates. The production browser uses these commands with
cookie sessions; the preserved standalone prototype remains a separate reference.
Fixed costs, savings, refunds and observations are not yet production endpoints.
Unsupported categories/fields reject rather than approximate.
Income estimates do not calculate tax or populate Plans.

## Local setup and credentials

Start Postgres and apply migrations with the migration owner's `DATABASE_URL`:

```sh
docker compose up -d --wait postgres
uv run alembic upgrade head
```

An operator can provision an **already admitted and verified identity** in a
trusted terminal. This command is not public registration or identity verification.
Use the actual issuer/subject of the admitted identity; it creates its first Entity
and prints a secret API key once. Do not capture that output in logs.

```sh
uv run python -m accanto.bootstrap \
  --issuer YOUR_VERIFIED_ISSUER --subject YOUR_VERIFIED_SUBJECT \
  --entity 'My finances' --time-zone America/New_York
```

Store the returned key securely. Requests use `Authorization: Bearer <key>`;
only SHA-256 hashes are persisted. `POST /api/keys` with `{"name":"My script"}`
issues another key (plaintext returned once); `DELETE /api/keys/{key_id}` revokes
one of the current User's keys. There is no expiry. Revocation and Entity access
changes apply to subsequent requests, including retries. Browser sign-in uses OIDC
and opaque server-side sessions; see the browser authentication endpoints below.
Hosted MCP OAuth remains a separate increment.

For deployment, use a non-owner, non-superuser runtime login distinct from the
migration owner. After creating that login securely, grant only required access
(example role name `accanto_app`):

```sql
GRANT USAGE ON SCHEMA public TO accanto_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO accanto_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO accanto_app;
REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM accanto_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
```

Do not grant table ownership, role administration, trigger bypass or TRUNCATE.
Reapply grants deliberately when migrations add tables. Database triggers also
reject audit changes and mutation of saved versions/lines. The bootstrap requires
operator database access. The local Compose superuser is for development only.

## Supported routes

All financial routes are below `/api/entities/{entity_id}`, where `entity_id` is
an external UUID. Financial writes require `Idempotency-Key` (1–120 characters).

| Method | Suffix | Body / result |
| --- | --- | --- |
| POST | `/plans` | Name, income lines and spending; returns Plan UUID and draft |
| GET | `/plans` | Plans with saved revisions and current drafts |
| PUT | `/plans/{plan_id}/draft` | Full replacement inputs plus expected revision |
| POST | `/plans/{plan_id}/versions` | Expected draft revision; freezes snapshot and creates next draft |
| POST | `/activity` | Explicit date, category, amount, optional source and note; `is_adjustment` for signed corrections |
| POST | `/activity/known-total` | Desired total and contributing-entry fingerprint; creates one signed adjustment |
| GET | `/activity` | Current entries ordered by financial date and recording order |
| PUT | `/activity/{entry_id}` | Replacement entry plus expected revision |
| DELETE | `/activity/{entry_id}` | Expected revision in JSON body; soft deletes |
| POST | `/reviews` | Month's first date and saved version UUID |
| GET | `/reviews/{YYYY-MM-01}` | Saved expectations, current entries and partial actuals |
| PUT | `/reviews/{YYYY-MM-01}` | Expected revision, same-Plan saved version, note, reviewed flag and optional checkpoint refresh |
| GET | `/income-estimates` | Entity's saved estimate scenarios and authoritative results |
| GET | `/income-estimates/{estimate_id}` | One scenario with ordered assumption lines |
| POST | `/income-estimates` | New named scenario and lines; no previous revision |
| PUT | `/income-estimates/{estimate_id}` | Full replacement assumptions with `expected_revision` |
| POST | `/income-estimates/{estimate_id}/duplicate` | New independent scenario with `{name, expected_revision}` |

Amounts are USD decimal **strings**, exact cents, maximum absolute value
`999999999.99` per entered amount. Ordinary entries and known totals are
nonnegative. Only entries explicitly marked `is_adjustment: true` accept signed
amounts. Fractional cents and numeric JSON values reject.
Zero is explicit, absence is unknown. Dates are `YYYY-MM-DD`; there is no implicit
today. Month selection uses dates, independently of UTC recording timestamps.

## Independent income estimates

An estimate is an optional assumption scenario, separate from actual receipts and
Plan Income sources. A line contains per-payment gross, entered withholding and
payroll deductions. Create one with `POST /income-estimates`:

```json
{
  "name": "Two synthetic roles",
  "lines": [
    {"name":"Role A","gross":"6000.00","withholding":"1200.00","payroll":"300.00","frequency":"monthly"},
    {"name":"Role B","gross":"4000.00","withholding":"800.00","payroll":"200.00","frequency":"monthly"}
  ]
}
```

The returned lines have `uuid` and `monthly_net` values of `4500.00` and
`3000.00`, and `monthly_total` is `7500.00`. Frequencies are `annual` (1/year),
`monthly` (12/year), `twice_monthly` (24/year), `weekly` (52/year), and `daily`
(explicit nonnegative `paid_days` per year, including zero). Enter paid days as
integer digits; responses serialize the count as an exact string. Non-daily lines omit
`paid_days`. Entered amounts are exact nonnegative cents; monthly line results
are rounded half-even to cents before totaling. Negative estimated net is not
clamped. The smoothed result is not an exact payment schedule or a tax calculation.

To edit, send the whole name and lines plus `expected_revision`. Include
`line_id` with a previously returned line `uuid` to retain that line identity;
omitting it creates a new line, and omitted old lines are removed from the
current scenario. Stale edits reject without modifying inputs. Duplicate with a
new name and the current expected revision; it copies assumptions into new
estimate and line identities. These editable scenarios have audit history but
no immutable estimate versions. Users manually copy or type the result into a
Plan; there is no `Use in Plan` command, link, or automatic synchronization.

## Plan → activity → Review

These bodies can be sent using `/docs` or your own HTTP client with the headers
above. Use a new request identity for each intended change and retain it for retry.

Create a Plan (`POST /plans`):

```json
{
  "name": "Regular month",
  "incomes": [{"name": "Salary", "amount": "4000.00"}],
  "spending": "800.00"
}
```

The response includes `plan_id`, `draft.revision` and
`draft.incomes[].source_id`. Preserve source UUIDs when editing an existing line;
omitting one creates a new source identity. Save with
`POST /plans/{plan_id}/versions`, body `{"expected_revision":1}`. Keep the returned
`version.uuid`; its inputs, results and rule version will not change. The new
draft starts at revision 1. An overallocated Plan can be saved; negative unassigned
money is a visible result. The provisional tithe target is 10% of net income,
half-even rounded; it is guidance, not an additional allocation in this slice.

Record income (`POST /activity`), substituting the returned source UUID:

```json
{
  "date": "2026-10-15",
  "category": "income",
  "amount": "4000.00",
  "source_id": "SOURCE_UUID",
  "note": "October receipt"
}
```

Record spending with `{"date":"2026-10-16","category":"spending","amount":"75.00"}`.
Income may be unassigned; it counts once in the month's recorded income, but does
not resolve a missing expected source. Assignments in this increment support the
original Plan only; future cross-Plan matching policy is not settled by this API.

To correct a known category total, read `GET /activity` and select the current
entries for the chosen month/category. For Income, also select exactly one source
UUID or `null` for Unassigned income. Send every contributing entry's `uuid` and
`revision` in the fingerprint. For example, after a synthetic `210.00` spending
entry, `POST /activity/known-total` accepts:

```json
{
  "date": "2026-10-16", "month": "2026-10-01", "category": "spending",
  "desired_total": "250.00",
  "contributing_entries": [{"uuid": "ENTRY_UUID", "revision": 1}],
  "note": "Known monthly total"
}
```

The response is an ordinary activity response labeled `is_adjustment: true`,
with amount `40.00`. It remains in activity and Review history; deleting it
returns the recorded total to `210.00`, while a later `40.00` detail would make
the total `290.00` if the adjustment remains. An empty fingerprint and desired
`0.00` records explicit known zero. A category-only adjustment does not resolve
unknown expected Income sources. The server checks the fingerprint under the
Entity lock and returns `409 stale_total` without a write if entries changed.
Reload current entries and reconcile the intended total before submitting a new
request. Keep the same request identity for uncertain retries.

Direct signed corrections use `POST /activity` or `PUT /activity/{entry_id}`
with `is_adjustment: true`, an explicit date/category, and a signed amount such
as `"-5.00"`. A negative ordinary receipt/payment still rejects. Adjustments
are corrections to recorded totals; refunds and withdrawals have separate
workflows and are not represented by this flag.

Create the Review with `POST /reviews`, body
`{"month":"2026-10-01","version_id":"SAVED_VERSION_UUID"}`, then retrieve it using
`GET /reviews/2026-10-01`. With the example entries, income difference is `0.00`
and spending difference is `-725.00`. Missing expected income sources make the
income difference `null`; no spending entries makes spending actual/difference
`null`. Explicit zero entries are known zero. This partial slice does not claim a
complete cashflow or savings result.

Edit a Review with `PUT /reviews/2026-10-01`, for example
`{"expected_revision":1,"version_id":"SAVED_VERSION_UUID","note":"Synthetic takeaway","reviewed":true}`.
This marks the month even when actuals remain unknown. The response's Review
revision increments; `GET` returns `review.reviewed_at` and
`checkpoint_changed`. Later entry changes, note edits or same-Plan retargets
leave the annotation in place and show `checkpoint_changed: true`. Set
`checkpoint: true` with `reviewed: true` to deliberately update the checkpoint;
set `reviewed: false` to clear it. The chosen saved version must belong to the
Review's current Plan. Retargeting creates no activity and does not change other
Reviews. Cross-Plan retargeting awaits the explicit matching policy.
The edit requires `Idempotency-Key`; replaying the same key and body returns the
recorded outcome. A stale `expected_revision`, reused key with different input,
or cross-Plan version is a `409` with a specific error code. Reload the Review
before reconciling an attempted edit. The edit response contains the updated
Review record; use `GET` for the comparison and current activity rollup.

## Corrections and failure recovery

Edits/deletions carry the current `expected_revision`; reload with GET and
reconcile after `409 stale_revision`. A correction replaces supplied entry fields;
retain the source UUID if it still applies. Deleted entries remain in storage and
audit but leave current totals. There is no restoration endpoint yet.

Each financial mutation commits its records, complete before/after audit and retry
outcome together, under an Entity lock. Repeating the same request identity/input
returns the recorded outcome even after later edits; reusing it with different
input gives `409 key_reuse`. Scope is User + Entity + operation + target, so another
key for the same User can retry. Outcomes currently remain indefinitely (minimum
retention policy is 30 days); current authorization is checked before replay.

`401` means invalid/revoked credential, `404` means unavailable scoped record,
`409` means conflict and `422` means invalid input. A `503 storage_unavailable` or
lost response means the caller must retry with the **same** identity and input;
it must not assume either success or a new operation. Retain attempted inputs.
No financial values/notes or SQL parameters belong in operational telemetry.

Health probes remain `GET /healthz` and `GET /readyz`. Interactive schemas are
available at `/docs`. No deployment or hosted-provider compatibility is claimed.

## Browser authentication

Browser requests use a same-origin, Secure HttpOnly `accanto_session` cookie.
`GET /api/auth/login` redirects to the configured identity provider;
`GET /api/auth/callback` validates the one-use login and redirects to `/`.
Use a user-initiated popup for reauthentication so unsaved input stays in memory.
A popup closing is not proof of login: always re-read session metadata.

`GET /api/auth/session` returns:

```json
{
  "user": {"id": "00000000-0000-4000-8000-000000000001"},
  "entities": [{
    "id": "00000000-0000-4000-8000-000000000002",
    "name": "Synthetic Entity",
    "time_zone": "America/New_York",
    "today": "2026-10-16"
  }],
  "csrf_token": "opaque-session-bound-value"
}
```

These UUIDs are deliberately synthetic examples. `today` is computed by the server
in each Entity's zone. A direct API-key request can also read this metadata and
receives `csrf_token: null`. No request may supply both a session cookie and an
Authorization header.

Cookie-authenticated writes, including `POST /api/auth/logout`, require exact
`Origin` and `X-CSRF-Token`. Logout returns `{"signed_out": true}`, invalidates the
server session and clears its cookie. API-key callers use Bearer credentials and
need no CSRF token. Session expiry is absolute at 12 hours. Refresh session metadata
after login, verify the same User, then retry uncertain writes with their original
Idempotency-Key and exact payload. Clear financial workspace memory on explicit
logout; do not persist browser credentials or financial state in localStorage.

Authentication errors use `detail: {code, message}`: 401 for invalid/expired,
ambiguous credentials or invalid login; 403 for CSRF failure, unadmitted identity,
or `identity_setup_required`; 503 for unconfigured/unavailable sign-in. API
responses are `no-store`. An unknown `(issuer, subject)` requires operator setup;
a matching verified email never merges accounts.

## Entity settings and API key metadata

`GET /api/entities/{id}/settings` returns `id`, `name`, `time_zone`, `revision`
and Entity-zone `today`. To update, send `PUT` to the same path with
`Idempotency-Key` and `{name, time_zone, expected_revision}`. The response returns
current `id`, `name`, `time_zone` and the incremented `revision`; reload settings
or session metadata for current date defaults. A valid IANA zone is required.
A zone change affects future defaults only; existing financial dates, Review
months/targets and saved Plan versions stay unchanged. Settings edits and their
before/after audit snapshots and retry outcomes commit atomically. Stale revisions
return 409; current authorization is required even for successful retry outcomes.

`GET /api/keys` lists the authenticated User's keys as `{id, name, created_at,
revoked_at}`, including revoked metadata. It never returns a token or digest.
Existing `POST /api/keys` shows a new token once; `DELETE /api/keys/{id}` revokes
that key only, and repeated owner-session revocation retains its original timestamp.
Foreign-user key identifiers return 404. A revoked key cannot authenticate again.

Do not automatically retry an uncertain key-creation response: its secret is not
recoverable and is never stored in retry outcomes. Report creation as unconfirmed,
reload the metadata list, revoke an unwanted key, then explicitly create another.
Keep a newly displayed secret only in memory; clear it on dismissal, navigation
and logout. Do not record it in browser storage, logs, screenshots or recordings.

### Copy a Plan

`POST /api/entities/{entity_id}/plans/{plan_id}/copies` accepts
`{"name":"Alternative", "source_revision_id":"<draft-or-saved-revision-uuid>", "expected_revision":1}`.
Choose the exact stored draft or saved version from `GET .../plans`; supply that
revision's concurrency revision. A stale selection is rejected. The command uses
the normal authentication, CSRF (browser), and `Idempotency-Key` requirements.
It returns `{plan_id, draft}` with fresh Plan and Income source identities.
The new draft calculates current rules from the selected inputs. The source,
its immutable versions, receipts, and Review targets remain unchanged.

Saved scenario comparisons use the stored `incomes`, result fields, and
`rule_version` returned by `GET .../plans`. Do not recalculate historical versions
using current rules. Copies do not infer cross-Plan receipt matching.
