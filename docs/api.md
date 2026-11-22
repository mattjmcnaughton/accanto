# API reference

The production API supports direct net-income Plans, named fixed costs, planned savings funding, destination allocations and guilt-free spending,
dated income/fixed-cost/spending/saving entries, monthly Reviews against saved versions,
independent income estimates, savings account openings/goals, and investment/giving
destinations with recorded contributions, plus savings movements and goal-level
reconciliation. The production browser uses these commands with cookie sessions;
the preserved standalone prototype remains a separate reference. Linked refunds, lifecycle and separate investment/debt observations
are implemented by the routes below. Unsupported categories/fields
reject rather than approximate.
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
Hosted MCP OAuth uses a separate four-tool listener with local implementation
merged; real-provider/hosted compatibility remains gated.

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
The [deployment runbook](technical/deployment.md) records migration, rollback and
post-recovery revocation requirements.
Reapply grants deliberately when migrations add tables. Database triggers also
reject audit changes and mutation of saved versions/lines. The bootstrap requires
operator database access. The local Compose superuser is for development only.

## Supported routes

All financial routes are below `/api/entities/{entity_id}`, where `entity_id` is
an external UUID. Financial writes require `Idempotency-Key` (1–120 characters).

| Method | Suffix | Body / result |
| --- | --- | --- |
| POST | `/plans` | Name, income lines, fixed-cost lines and spending; returns Plan UUID and draft |
| GET | `/plans` | Plans with saved revisions and current drafts |
| PUT | `/plans/{plan_id}/draft` | Full replacement inputs plus expected revision |
| POST | `/plans/{plan_id}/versions` | Expected draft revision; freezes snapshot and creates next draft |
| POST | `/activity` | Income/fixed-cost/spending/saving with explicit date, amount, optional source/fixed-cost/goal and note; `is_adjustment` for signed corrections; one savings funding origin on spending |
| POST | `/activity/known-total` | Desired total and contributing-entry fingerprint; fixed-cost totals remain category-level and unassigned; saving requires a goal; creates one signed adjustment |
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
| GET | `/savings-accounts` | Entity's savings accounts and goals |
| GET | `/savings-accounts/{account_id}` | One savings account with goal identities and opening positions |
| POST | `/savings-accounts` | Create account, protected Unallocated goal and opening designations atomically |
| PUT | `/savings-accounts/{account_id}` | Correct account name/opening and all goal designations with `expected_revision` |
| POST | `/savings-accounts/{account_id}/goals` | Create a goal with `expected_account_revision` and zero opening amount |
| PUT | `/savings-accounts/{account_id}/goals/{goal_id}` | Rename, set target/type or inactivate/reactivate an ordinary goal with `expected_revision` |
| GET | `/savings-accounts/movements` | Current reassignments, transfers and reconciliations in financial-date/recording order |
| POST | `/savings-accounts/movements` | Create one movement or one goal-level reconciliation |
| PUT | `/savings-accounts/movements/{movement_id}` | Correct an existing record with its kind and `expected_revision`; original recording order is retained |
| DELETE | `/savings-accounts/movements/{movement_id}` | Soft delete with `{kind, expected_revision}`; replay later history |
| GET/POST | `/investments`, `/giving-recipients` | List/create named destinations with optional positive cumulative target; investments may have an optional dated opening observation |
| PUT | `/investments/{destination_id}`, `/giving-recipients/{destination_id}` | Name, target, active state and `expected_revision` |
| GET/POST | `/investment-activity`, `/giving-activity` | Current history or create contribution/adjustment with optional `destination_id` |
| PUT/DELETE | `/investment-activity/{entry_id}`, `/giving-activity/{entry_id}` | Correct entry or soft delete with `expected_revision` |
| POST | `/activity/{purchase_id}/refunds` | Record a linked refund using positive `amount`, `date`, and optional `note` |
| PUT/DELETE | `/activity/refunds/{refund_id}` | Correct a linked refund's date, amount or note, or soft delete it; both require `expected_revision` |

Amounts are USD decimal **strings**, exact cents, maximum absolute value
`999999999.99` per entered amount. Ordinary entries and known totals are
nonnegative. Signed adjustments and linked refund entries may have negative
amounts. Refund commands take a positive amount. Fractional cents and numeric
JSON values reject.
Zero is explicit, absence is unknown. Dates are `YYYY-MM-DD`; there is no implicit
today. Month selection uses dates, independently of UTC recording timestamps.

Investment and giving contribution commands take `date`, `amount`, optional
`destination_id`, `note`, `is_adjustment`, `funding_origin`, and
`saving_goal_id` when savings funded; corrections also take
`expected_revision`. An omitted destination is Unassigned. Ordinary investment
contributions are nonnegative; signed adjustments can correct recorded totals.
Giving refunds use the linked purchase refund command. Inactive destinations reject new assigned entries
but permit correction of their existing assigned entries. Soft deletion removes
progress while retaining entry and assignment history. Optional investment
`opening: {"date":"2026-01-01","amount":"25000.00"}` is an observed starting
value: it is protected and contributes `0.00` to progress. Named investment
activity cannot predate its opening. Progress sums current assigned entries,
separately from observed market value or tax eligibility. Monthly Reviews expose
recorded investing and giving totals when entries exist; full comparison metrics
are a later increment.

## Savings accounts and goals

Create an account with an opening date, amount and designated ordinary goals:

```json
{
  "name": "Example savings",
  "opening_date": "2026-01-01",
  "opening_amount": "10000.00",
  "goals": [
    {"name":"Emergency","kind":"finite","target":"8000.00","opening_amount":"5000.00"},
    {"name":"Laptop","kind":"finite","target":"1200.00","opening_amount":"1000.00"}
  ]
}
```

The response includes the account `uuid`, `revision`, `opening_amount`, and
`balance`, plus stable goal UUIDs. It creates one mandatory ongoing Unallocated
goal with no target and the remaining `4000.00`. The account balance is
`10000.00`: opening money is summed from goals once and creates no contribution
or saving actual. `remaining_saved` initially equals each goal's opening portion;
`contribution_progress` is `0.00`. `funded_status` is `Funded` when remaining
saved meets an explicit target, `Not yet funded` below it, and `null` for an
ongoing goal without a target. Finite targets must be positive; ongoing targets
may be absent or positive. Excess designations reject the entire request.

`PUT /savings-accounts/{account_id}` takes `name`, `opening_date`,
`opening_amount`, `expected_revision`, and `designations`: exactly one
`{"goal_id":"GOAL_UUID","opening_amount":"AMOUNT"}` for every ordinary goal,
including goals with zero opening. Unallocated is calculated as the remainder.
Corrections preserve every goal's identity and conserve the opening. After any
retained linked savings activity exists, including soft-deleted history, opening
date, amount and designations are fixed; a name edit with unchanged opening remains
allowed. A stale revision rejects rather than overwriting another edit.

Create a later goal with `{"name":"Home repair","kind":"ongoing","target":null,
"expected_account_revision":1}`. Its opening is zero and it does not move any
money. Edit an ordinary goal by sending `name`, `kind`, optional `target`, `active`,
and its `expected_revision`. Its account association and identity cannot move.
Inactive goals retain their opening, history and references. Unallocated has no
independent edit or lifecycle command. All writes require the shared
`Idempotency-Key`; an identical retry returns the recorded response, while
reusing the key with different input conflicts. Financial change, complete audit
snapshot and retry outcome commit together under the Entity lock.

Saving contributions and savings-funded outflows use `/activity`. Each saving
entry, including a zero or signed adjustment, supplies `saving_goal_id`. An
outflow uses `funding_origin: "income"` by default. Spending, fixed costs,
debt payments, giving, and investing can use previously saved money by sending
`funding_origin: "savings"` and one `saving_goal_id`; the
goal determines its account. For example, with a synthetic Laptop goal holding
`800.00`, a `1000.00` savings-funded purchase rejects. Record a `200.00` saving
contribution on the same date first, then the purchase succeeds. The month has
`200.00` new saving and `1000.00` spending; the purchase also appears as
`1000.00` savings used. The goal retains `200.00` contribution progress and has
`0.00` remaining. A saving known-total adjustment also requires one goal and
its fingerprint contains only that goal's saving entries.

All linked saving activity receives immutable recording order. Earlier-than-opening
activity and any correction or deletion that makes a goal negative at that or a
later recorded point reject with goal, date and shortfall. Corrections retain
original order; links to original accounts remain stored even after movement or
soft deletion, permanently fixing their opening setup. Transactions include
balance validation, audit snapshots and retry outcomes under the Entity lock.

For a same-account reassignment, `POST /savings-accounts/movements` takes
`{kind: "reassignment", date, from_goal_id, to_goal_id, amount, note}`. For a
cross-account transfer, use `kind: "transfer"` with the same fields. `amount` is
a positive exact-cent USD string. The goals must differ and belong to the same
account for reassignment or different accounts for transfer. Both goals and
accounts must be active; neither endpoint may precede its account opening date.
One record applies equal negative and positive effects, without creating income,
spending or a contribution.

To reconcile one goal, send `{kind: "reconciliation", date, goal_id,
known_amount, note}`. `known_amount` is a nonnegative exact-cent USD string
observed for that goal at that point in ordered history. For example, a goal
with `5200.00` recorded remaining savings and `known_amount: "5000.00"`
records one `-200.00` adjustment. The account balance changes through its
goal rollup, while opening amounts, other goals and contribution totals remain
unchanged. Account-wide reconciliation is not offered. A zero difference rejects
with `no_correction`.

`PUT` sends the same fields plus `expected_revision`; its `kind` must identify
the existing record type. A corrected reconciliation recomputes its signed
difference at its financial date and retained recording order, excluding its
prior effect. Corrections may retain an existing inactive goal endpoint while
its account remains active; a new endpoint or new reconciliation requires an
active goal. `DELETE` sends `{kind, expected_revision}`. Corrections and
deletions reject when either old or new affected history would go negative.
The record, full audit snapshots and retry outcome commit atomically under the
Entity lock. A stale revision conflicts; retrying the same request key and input
returns its recorded result, while reusing a key with changed input conflicts.
Deleted movements stay stored for audit; there is no restoration endpoint.

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

Plan revisions include a nullable UTC `updated_at` (serialized like `saved_at`, as
`YYYY-MM-DD HH:MM:SS[.ffffff]+00:00`). Database triggers maintain it
when the revision or any of its financial lines changes. Pre-migration revisions
remain unknown (`null`) until edited; migration time is not an edit time. Saved
versions retain their timestamp under the existing immutability rules. Clients
must continue using `revision`, not `updated_at`, for optimistic concurrency.

### Fixed costs

`POST /plans` and `PUT /plans/{plan_id}/draft` accept `fixed_costs`, an array
of named lines with `amount` as a USD decimal string and `frequency` of
`monthly` or `annual`. A persisted line also has a stable Entity-scoped
`fixed_cost_id`. Retain that ID when editing or copying the line; omit it to
create a new cost. Copied Plans share Fixed cost identities while Income
sources receive new identities. Each line returns its entered amount,
frequency and cent-valued `monthly_amount`; `fixed_cost_total` sums those
monthly results. Three annual inputs of `100.00` therefore produce three
`8.33` monthly lines and a `24.99` monthly total while retaining all three
`100.00` inputs. The total reduces the Plan's unassigned amount.

### Plan funding and destination allocations

Plan create and draft replacement also accept `savings_funding` lines with
`account_id` and `amount`, `saving_goals` lines with `goal_id` and `amount`, and
`investments` and `giving` lines with `destination_id` and `amount`. IDs are
Entity-scoped UUIDs from the savings and destination APIs. Each reference may
appear once per category; amounts are nonnegative USD decimal strings. Existing
fixed-cost lines may include `debt_account_id` for a loan payment.

Drafts, copies and saved versions return those lines with stored labels
(`account_name`, `goal_name`, or `destination_name`). They also return
`savings_funding_total`, `funding_total`, `saving_total`, `investing_total`,
`giving_total`, `allocation_total`, `giving_difference`, and `unassigned` as
decimal strings. Total funding is planned net income plus planned use of
savings. Allocations sum spending, fixed costs, saving, investing and giving.
Tithe remains 10% of planned net income; giving allocations may differ from
that target. A negative `unassigned` flags overallocation but does not block
saving. Plan commands neither reserve nor move money. Inactive or completed
references remain readable in saved lines and may be explicitly retained or
removed when revising a draft.
New or revised drafts use `rule_version: "monthly-allocation-2"`; existing
saved versions retain their earlier rule labels and stored results.

For example, `4000.00` planned income and `1000.00` savings funding produce
`5000.00` total funding and a `400.00` tithe target. Allocations totaling
`5300.00` produce `unassigned: "-300.00"`. A shortfall in one Plan never
carries into another Plan automatically.

`/activity` accepts `category: "fixed_cost"`, optional `fixed_cost_id` and
`debt_account_id`, and either funding origin. An omitted cost ID is Unassigned
fixed-cost activity.
Ordinary payments are nonnegative, including explicit zero. Signed corrections
require `is_adjustment: true`; refunds use the linked command. Current
activity and Review detail retain an assigned cost's original canonical name
even if a Plan line is later renamed or removed. Plan lines also retain their
own saved labels. In a Review, an
expected saved fixed-cost line with no assigned payment remains unknown even
when other fixed-cost payments or a category adjustment exist. The category
total includes assigned and Unassigned entries once, and its difference from
the saved Plan is unavailable while expected lines remain unknown.

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
half-even rounded; it is guidance, not an additional allocation.

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

To refund a purchase, `POST /activity/{purchase_id}/refunds` with
`{"date":"2026-11-04","amount":"300.00"}`. This creates a separate negative
entry with `refund_of` and `remaining_refundable`; the purchase stays in its
original month. The refund inherits category, destination or debt, and funding
origin. For a synthetic `1000.00` October purchase, this November refund leaves
October `1000.00` and November `-300.00`. A further `700.00` succeeds;
`701.00` rejects. Refund dates cannot precede the purchase. Editing a refund
replaces its old amount for cap checks. A purchase with current refunds cannot
be deleted or change origin, category, destination, or debt; amount and date
edits must still satisfy the cap and date rules. Delete current refunds
explicitly first. Rejected writes leave activity, savings, audit, and retry
outcomes unchanged.

Create the Review with `POST /reviews`, body
`{"month":"2026-10-01","version_id":"SAVED_VERSION_UUID"}`, then retrieve it using
`GET /reviews/2026-10-01`. With the example entries, income difference is `0.00`
and spending difference is `-725.00`. Missing expected income sources make the
income difference `null`; no spending entries makes spending actual/difference
`null`. Explicit zero entries are known zero. This partial slice does not claim a
complete cashflow or savings result.

Review response `version` contains the saved destination and funding lines.
`expected` exposes saving, investing, giving, savings funding, funding and
allocation totals from the selected version. `differences` exposes saving,
investing and giving actual minus expected totals when both are known.
`destination_comparisons` contains `saving_goals`, `investments`, and `giving`
arrays. Each saved line carries its reference UUID, saved name, `planned`,
`recorded`, and `difference`. Missing destination entries leave `recorded` and
`difference` as `null`; a surplus at one destination cannot hide another's
shortfall. A later Review using the same saved version starts with the same
planned lines and has its own monthly actuals.
Legacy versions that predate those Plan fields return `null` expectations,
and `destination_comparisons: null`, not invented zero allocations. An actual category with no entries also stays
unknown (`null`).

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
It returns `{plan_id, draft}` with fresh Plan and Income source identities
and shared Fixed cost, savings account, goal, investment and giving identities.
Copied historical lines retain saved labels where available, even if a reference has
since been renamed or inactivated. Older Debt lines without a stored account
label use the current account name in the new copy. Archived Debt account links and inactive
destinations may be retained explicitly in a copied or edited draft; selecting
one anew is rejected.
The new draft calculates current rules from the selected inputs. The source,
its immutable versions, receipts, and Review targets remain unchanged.

Saved scenario comparisons use the stored lines, result fields, and
`rule_version` returned by `GET .../plans`. Do not recalculate historical versions
using current rules. Copies do not infer cross-Plan receipt matching.

## Loan accounts and dated balance observations

`GET/POST /api/entities/{entity_id}/debts` list and create named loan accounts.
Creation requires `name` and a protected `opening: {date, amount}`. `PUT
/api/entities/{entity_id}/debts/{debt_id}` accepts `name`, `active`, and
`expected_revision` to rename, archive or reopen. Archival requires the latest
recorded amount owed to be zero; a payment alone does not establish zero. An
archived loan rejects new payments and new associations; an existing payment
retaining that loan identity can still be corrected with its current revision.
Its history remains visible. `draft_fixed_cost_lines`
identifies draft Plan lines linked to an archived loan for explicit revision;
saved versions remain intact.

`GET/POST /api/entities/{entity_id}/debt-observations` and
`GET/POST /api/entities/{entity_id}/investment-observations` list and create
independent dated observations. POST takes `date`, `amount`, and `account_id`.
Debt observations require a loan account; investment observations may be
unassigned. PUT on `/{observation_id}` corrects with those fields plus
`expected_revision`; DELETE takes `expected_revision` and soft deletes. Opening
observations cannot be corrected or deleted. At most one current ordinary
observation exists for each account/date. A protected opening and one ordinary
observation may coexist on that date; the ordinary one is latest on a tie.

`POST/PUT /activity` accepts an optional `debt_account_id` only for a fixed-cost
entry, alongside an optional `fixed_cost_id` for Plan comparison. The one entry
contributes once to fixed-cost actuals. A debt-linked fixed-cost Plan line has
`debt_account_id`; archived loans require explicit removal or reopening before
saving a new draft allocation. Neither payments nor contributions change observed
balances. Financial dates are explicit in API writes; browser defaults come from
the Entity's current time zone.

All writes above require the normal authenticated `Idempotency-Key`, current
Entity access, and expected revisions for corrections. Financial records, complete
before/after audit snapshots, and retry outcomes commit together.

### Savings lifecycle

All lifecycle writes use the same authenticated Entity boundary and
`Idempotency-Key` as activity. `POST /api/entities/{entity}/savings-accounts/{account}/archive`
and `/reopen` take `{"expected_revision": 1}`. Archive requires zero recorded
savings, archives goals together and moves no money. Reopen restores only goals
archived by that account action; completed and independently inactive goals keep
their state. Archived accounts must reopen before any financial correction,
including moving an old entry to another account.

`POST /api/entities/{entity}/savings-accounts/{account}/goals/{goal}/complete`
takes `{"date":"2026-10-19","expected_revision":1,"expected_return":"100.00"}`
(a deliberately synthetic example). It completes an active finite goal, returns
its positive remainder to the same account's Unallocated goal, and audits both
atomically. Zero creates no movement. A changed remainder produces
`stale_completion`; reload and explicitly review the new return amount.
Completion-generated reassignments are retained and cannot be independently
edited/deleted: that would silently undo part of completion.

Goal responses include `completed` and `archived_by_account`. Completed goals
accept linked refunds to their original origin while staying completed. Use the
ordinary reassignment endpoint to explicitly return that money from the completed
goal to the same account's Unallocated goal. Other new contributions, outflows,
transfers and reconciliations into completed goals remain unavailable. Normal
refund caps, dates, original-origin checks and ordered nonnegative history apply;
removing money already returned or used can reject with a historical shortfall.
Saved Plans stay immutable, and draft allocations retain inactive references for
explicit revision. Planning creates no savings movement.

Monthly comparison reads also return `comparison` by income, fixed cost, spending,
saving, investing and giving. Each category exposes planned amount, recorded
subtotal, incompleteness and difference; `items` match immutable saved identities
and labels, with contributing entries. `unplanned` entries count once in the
subtotal and `adjustments` identify dated corrections without filling missing
item identities. Unknown expected items withhold category differences.

`summary` separates new saving, recorded savings used, net saving, total investing
and income-funded investing/fixed costs. `savings_used_incomplete` marks missing
expected outflows; net saving is unavailable until its required inputs are known.
Transfers, reassignments, openings and balance observations are excluded.

`metrics` exposes separate planned and actual formulas with numerator, denominator,
component amounts, percentage and an unavailable reason. Actual income-based
ratios use only same-month recorded amounts. `planned_metrics` on Plan snapshots
is derived presentation; it does not rewrite immutable saved results or inputs.
Selected planned savings funding includes its saved account labels and amounts.

## Transactions inbox and sources

Read-only import from a Transaction source (YNAB first) into the Transactions
inbox. Design: [TDD 02](tdds/02-transactions-inbox.md). Staged transactions are
not actual entries and never contribute to totals; an entry exists only after an
explicit record call. Any authenticated caller with Entity access (browser
session, API key) can use every route below, including record. Writes take
`Idempotency-Key` and `expected_revision` like other commands.

The operator must set `SOURCE_SECRET_KEY` (a Fernet key) before connecting a
source; access tokens are stored encrypted with it and never returned. Rotating
the key makes stored tokens unreadable, so reconnect after a rotation.
`YNAB_API_URL` defaults to `https://api.ynab.com/v1`; local development and tests
point it at the fake server in `tests/fakes/ynab_server.py`.

| Method | Suffix | Body / result |
| --- | --- | --- |
| GET | `/sources` | Connected sources with selected accounts, sync state and waiting count |
| POST | `/sources/ynab/plans` | `{access_token}`; YNAB plans the token can read (stores nothing) |
| POST | `/sources/ynab` | `{access_token, plan_id, start_date}`; connects a USD plan; transactions before `start_date` are never staged |
| GET | `/sources/{source_id}/accounts` | The plan's accounts and which are selected |
| PUT | `/sources/{source_id}/accounts` | `{account_ids, expected_revision}`; default is none; adding an account re-reads history |
| DELETE | `/sources/{source_id}` | `{expected_revision}`; forgets the token; recorded entries and inbox history stay |
| POST | `/sources/{source_id}/sync` | Fetch changes since the stored cursor and stage them; returns counts. Records nothing |
| GET | `/inbox?status=&month=YYYY-MM-01&source=` | Staged transactions (default: all but removed), with source facts, proposal, rejections and revision |
| GET | `/inbox/{item_id}` | One staged transaction |
| PUT | `/inbox/{item_id}/proposal` | Set a proposal (replaces any earlier one) |
| DELETE | `/inbox/{item_id}/proposal` | `{expected_revision}`; clear it |
| PUT | `/inbox/proposals` | `{proposals: [{item_id, ...proposal}]}`; per-item outcomes |
| POST | `/inbox/{item_id}/record` | `{expected_revision, completion?}`; records from the proposal, or from `completion`, which replaces it |
| POST | `/inbox/record` | `{items: [{item_id, expected_revision, completion?}]}`; each in its own transaction; per-item outcomes |
| POST | `/inbox/{item_id}/skip`, `/unskip` | `{expected_revision}` |
| POST | `/inbox/{item_id}/undo` | `{expected_revision}`; soft-deletes the recorded entry through its normal delete command; the item waits again |
| POST | `/inbox/{item_id}/resolve` | `{expected_revision, resolution: "keep" \| "delete"}` for a conflict |

A **proposal** (and a record `completion`) is any subset of `category`
(`income`, `fixed_cost`, `spending`, `saving`, `investing`, `giving`),
`assignment` (an Income source, fixed cost, saving goal, investment or giving
recipient UUID, or `"unassigned"`), `funding` (`"income"` or a saving goal UUID),
`refund_of` (a purchase entry UUID), or `skip: true`, plus `rationale` and
`expected_revision`. Setting a proposal checks its shape and that every reference
exists in the Entity, then runs the record command's checks as a dry run and
stores any rejection in `proposal_rejection` without failing the request. It never
writes actual entries. `proposed_by` records the User, interface and time.

Recording maps the staged transaction to the existing command: `POST /activity`
for income, fixed costs, guilt-free spending and saving; the investment and giving
contribution commands; or the linked refund command for `refund_of`. Those
commands' rules, audit, and stale-edit checks apply unchanged; the audit
interface is `inbox`. An inflow to an outflow category must be a refund. The entry
note is the payee (and memo). A rejection leaves the item waiting with its reason
in `rejection`. The record retry identity is the item and its expected revision,
so repeating the same press returns the first outcome without a second entry.

Statuses: `waiting`, `skipped`, `recorded`, `conflict` (recorded, then changed or
deleted in the source; the entry is never edited by sync), and `removed`
(deleted in the source before recording). A YNAB failure changes neither the
cursor nor the inbox. YNAB milliunits convert to exact cents; an amount with
partial cents fails the sync. `kind` is `ordinary`, `transfer_on_budget`,
`transfer_tracking` or `card_payment`; how to treat each is the proposer's choice.
`GET /reviews/{month}` reports `inbox_waiting`, the count of waiting staged
transactions dated in that month.
