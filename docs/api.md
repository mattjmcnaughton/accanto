# API reference

The production API supports direct net-income Plans, named fixed costs, planned savings funding, destination allocations and guilt-free spending,
dated income/fixed-cost/spending/saving entries, monthly Reviews against saved versions,
savings account openings/goals, and investment/giving
destinations with recorded contributions, plus savings movements and goal-level
reconciliation. The production browser uses these commands with cookie sessions;
the preserved standalone prototype remains a separate reference. Linked refunds, lifecycle and separate investment/debt observations
are implemented by the routes below. Unsupported categories/fields
reject rather than approximate.

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
only SHA-256 hashes are persisted. Further keys are issued, listed and revoked
only from a signed-in browser (Settings, `/api/keys` below): an API key cannot
read or manage any credential, its own included. There is no expiry. Revocation and Entity access
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
| POST | `/plans/{plan_id}/versions` | Expected draft revision; freezes snapshot and creates next draft. Unreviewed Reviews on the previous latest version move to the new version |
| POST | `/activity` | Income/fixed-cost/spending/saving with explicit date, amount, optional source/fixed-cost/spending-subcategory/goal and note; `is_adjustment` for signed corrections; one savings funding origin on spending |
| POST | `/activity/known-total` | Desired total and contributing-entry fingerprint; fixed-cost totals remain category-level and unassigned; saving requires a goal; creates one signed adjustment |
| GET | `/activity` | Current entries ordered by financial date and recording order; optional `?tag_id=` keeps entries with that tag |
| PUT | `/activity/{entry_id}` | Replacement entry plus expected revision |
| DELETE | `/activity/{entry_id}` | Expected revision in JSON body; soft deletes |
| POST | `/reviews` | Month's first date and saved version UUID |
| GET | `/reviews/{YYYY-MM-01}` | Saved expectations, current entries and partial actuals |
| PUT | `/reviews/{YYYY-MM-01}` | Expected revision, same-Plan saved version, note, reviewed flag and optional checkpoint refresh |
| GET | `/routines` | Routines with cadence, steps, current occurrence, next date and the last 12 occurrences ([Routines](#routines)) |
| GET | `/routines/{routine_id}` | One routine, same shape |
| POST | `/routines` | Name, cadence, `starts_on` and steps; no previous revision |
| PUT | `/routines/{routine_id}` | Full replacement with `expected_revision`; `active: false` archives |
| GET | `/routines/{routine_id}/occurrences/{scheduled_on}` | One occurrence's checklist; 404 on a date the cadence does not schedule |
| PUT | `/routines/{routine_id}/occurrences/{scheduled_on}` | `{skipped, note, expected_revision}` skips or reopens the occurrence (0 before it is stored) |
| PUT | `/routines/{routine_id}/occurrences/{scheduled_on}/steps/{step_id}` | `{status, note?}`: `done`, `skipped` or `null` to clear |
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
| GET/POST | `/investments`, `/giving-recipients` | List/create named destinations with optional positive cumulative target; investments may have an optional dated opening observation and [projection assumptions](#projections) |
| PUT | `/investments/{destination_id}`, `/giving-recipients/{destination_id}` | Name, target, active state and `expected_revision`; investments also take optional `opening_date` and projection assumptions, and an omitted assumption is left unchanged |
| GET | `/projections?years=N` | A Projection of investments, loans and net worth, 1–100 years ([Projections](#projections)) |
| GET | `/debts/{debt_id}/payoff-schedule` | A loan's month-by-month payoff from its latest amount owed at its fixed rate and monthly payment ([Loan accounts](#loan-accounts-and-dated-balance-observations)) |
| GET/PUT | `/fire-assumptions` | Annual spending and withdrawal rate for the FIRE target ([Projections](#projections)) |
| GET/POST | `/investment-activity`, `/giving-activity` | Current history or create contribution/adjustment with optional `investment_id` or `giving_recipient_id` |
| PUT/DELETE | `/investment-activity/{entry_id}`, `/giving-activity/{entry_id}` | Correct entry or soft delete with `expected_revision` |
| POST | `/activity/{purchase_id}/refunds` | Record a linked refund using positive `amount`, `date`, and optional `note` |
| PUT/DELETE | `/activity/refunds/{refund_id}` | Correct a linked refund's date, amount or note, or soft delete it; both require `expected_revision` |
| GET/POST | `/tags` | Current tags with entry counts, or create one from `name` |
| PUT/DELETE | `/tags/{tag_id}` | Rename or archive (`name`, `active`, `expected_revision`), or delete with `expected_revision` |
| POST | `/activity/tags` | Label-only: `entries: [{entry_id, expected_revision, tag_ids}]` replaces each entry's tags, all or none |
| GET/POST | `/spending-subcategories` | Spending subcategories with entry counts, or create one from `name` |
| PUT | `/spending-subcategories/{subcategory_id}` | Rename, archive or restore (`name`, `active`, `expected_revision`); never deleted |

Amounts are USD decimal **strings**, exact cents, maximum absolute value
`999999999.99` per entered amount. Ordinary entries and known totals are
nonnegative. Signed adjustments and linked refund entries may have negative
amounts. Refund commands take a positive amount. Fractional cents and numeric
JSON values reject.
Zero is explicit, absence is unknown. Dates are `YYYY-MM-DD`; there is no implicit
today. Month selection uses dates, independently of UTC recording timestamps.

Investment and giving contribution commands take `date`, `amount`, an optional
assignment (`investment_id` on investment routes, `giving_recipient_id` on
giving routes; the other field rejects), `note`, `is_adjustment`, and
`funding_goal_id` when savings funded; corrections also take
`expected_revision`. An omitted assignment is Unassigned. Ordinary investment
contributions are nonnegative; signed adjustments can correct recorded totals.
Giving refunds use the linked purchase refund command. Inactive destinations reject new assigned entries
but permit correction of their existing assigned entries. Soft deletion removes
progress while retaining entry and assignment history. Optional investment
`opening: {"date":"2026-01-01","amount":"25000.00"}` is an observed starting
value: it contributes `0.00` to progress, its amount is protected, and it cannot
be deleted. An investment edit may send `opening_date` to move the opening's date
(omit it to keep the date). The move bumps the opening's revision and is audited;
a later date is refused (`422 activity_before_opening`) when a current assigned
contribution or observation would then predate it, so correct or delete that
activity first. Soft-deleted activity does not block a move. An investment without
an opening rejects `opening_date` (`422 no_opening`), as does a giving recipient
(`422 invalid_opening`). Named investment activity cannot predate its opening. Progress sums current assigned entries,
separately from observed market value or tax eligibility. Monthly Reviews expose
recorded investing and giving totals when entries exist; full comparison metrics
are a later increment.

## Tags

A Tag is an Entity-defined label. Any actual entry can carry zero or more:
income, fixed costs, guilt-free spending, saving, investing and giving,
including adjustments and inbox recordings. Tags change no amount, category,
funding origin, Plan or total. Tags overlap, so tagged amounts are never shares
of a category total.

Entry and contribution commands (`/activity`, `/investment-activity`,
`/giving-activity`) take an optional `tag_ids` list of tag UUIDs (at most 20).
It replaces the entry's tags; omit it to leave them unchanged. Every entry
response includes `tag_ids`. Repeats collapse to one. A deleted tag or one from
another Entity returns `404 tag_not_found`; an archived tag can stay on an entry
that has it but returns `422 archived_tag` when added.

A linked refund always carries its purchase's current tags. A new refund copies
them, and changing the purchase's tags changes its refunds' tags in the same
transaction (each refund's revision and audit advance). Setting a refund's tags
returns `422 refund_tags`.

Tag names are 1–120 characters after whitespace collapses, unique per Entity
ignoring case (`409 tag_exists`). Rename, archive (`active: false`) and restore
use `PUT /tags/{tag_id}`. `DELETE /tags/{tag_id}` removes the tag from every
entry (each entry's revision and audit advance) and frees its name. Any change
to an entry's tags advances its revision, so a reviewed month shows
`checkpoint_changed`. An unchanged tag set leaves the revision as it was.

## Spending subcategories

A Spending subcategory, such as "Eating out" or "Books", is guilt-free spending's
assignment, as a Fixed cost is for fixed costs ([TDD 07](tdds/07-spending-subcategories.md)).
A `spending` entry takes an optional `spending_subcategory_id`; omitting it or
sending `null` leaves the entry Unassigned. Like `fixed_cost_id`, a `PUT` replaces
the whole entry, so a correction that omits it makes the entry Unassigned. Every
entry response includes `spending_subcategory_id` and the subcategory's current
`spending_subcategory_name` (no snapshot: renaming relabels past entries).

Another category with a subcategory returns `422 spending_subcategory_category`;
one from another Entity returns `404 spending_subcategory_not_found`. An archived
subcategory (`active: false`) stays on entries that name it, which can still be
corrected, but returns `422 archived_spending_subcategory` for any other entry.
Names are 1–120 characters after whitespace collapses and unique per Entity
ignoring case, archived ones included (`409 spending_subcategory_exists`).
Subcategories are never deleted, and renaming or archiving one does not change
any entry's revision.

A linked refund names its purchase's subcategory: a new refund copies it, and
changing the purchase's subcategory changes its refunds' in the same transaction
(each refund's revision and audit advance). A refund's subcategory cannot be set
on its own. Adjustments and known totals are Unassigned unless they name one.

Subcategories change no amount, total, Plan or saved version, and have no planned
amounts. The Review's `comparison.spending` adds `breakdown`: one row per
subcategory present in the month, plus `id: null` for Unassigned, each with
`name`, `recorded` and its `entries`. Every spending entry is in exactly one row,
so the rows add up exactly to `comparison.spending.recorded`. Rows are sorted
largest first, with Unassigned last. `items` stays empty, so every spending entry
is also in `unplanned`.

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

**Field transition (2026-11-25).** Entry inputs and responses use
`funding_goal_id` for an outflow's funding goal, and `investment_id` /
`giving_recipient_id` for contribution assignments. Requests in the earlier form,
`funding_origin: "savings"` plus `saving_goal_id` on an outflow, or the shared
`destination_id` on a contribution, are still accepted and mapped during a
transition period. They are not in the published schema. A request that sends
both forms with different goals rejects. Responses use only the new names.

Saving contributions and savings-funded outflows use `/activity`. Each saving
entry, including a zero or signed adjustment, supplies `saving_goal_id`: the goal
the money goes to. Only saving entries take `saving_goal_id`. An outflow is funded
from current income unless it sends `funding_goal_id`. Spending, fixed costs,
debt payments, giving, and investing use previously saved money by sending one
`funding_goal_id`, including an account's Unallocated goal; the goal determines
its account. Responses include `funding_goal_id` and a read-only
`funding_origin` (`"income"` or `"savings"`) derived from it. For example, with a synthetic Laptop goal holding
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

## Routines

A routine is a checklist on a schedule ([TDD 13](tdds/13-routines.md)). It is not
a financial record: ticking a step records nothing, and only a person's command
ticks one. Recorded activity never does. Create one with `POST /routines`:

```json
{
  "name": "Saturday money check",
  "cadence": {"frequency": "weekly", "interval": 1, "weekdays": ["sat"]},
  "starts_on": "2026-11-07",
  "steps": [
    {"title": "Process transactions", "link_screen": "inbox"},
    {"title": "Review last month", "link_screen": "review", "link_month_offset": -1},
    {"title": "Pay the card", "link_url": "https://bank.example.com"}
  ]
}
```

Cadences: `weekly` with `weekdays`; `monthly` with `month_day` (1–28, or −1 for
the last day) or `week` (1–4, or −1 for the last) and `weekday`; `yearly` with
`month` and `month_day`. `interval` (1–52) repeats every so many weeks, months
or years, counted from `starts_on`'s week, month or year. Other fields are null
or empty. Dates are calendar dates in the Entity time zone.

A step has at most one link: an accanto screen (`home`, `activity`, `inbox`,
`review`, `plans`, `routines`, `savings`, `investments`, `giving`,
`loans`, `settings`) or an `https` URL. `link_month_offset` (−12 to 12) applies
to `home`, `activity` and `review` and counts from the occurrence's scheduled
date. To edit, send the whole routine with `expected_revision`; include `step_id`
to keep a step. An omitted step leaves the routine, but occurrences that ticked
it keep it with the title it had then.

An occurrence is stored at the first action on it. Its `state` is derived:
`upcoming` before its date, `due` on it, `overdue` until the next scheduled date,
then `missed`; `done` once every step is ticked or skipped (`completed_on` is
that day, later than `next_on` when finished late) and `skipped` when the whole
occurrence is skipped. Ticks are accepted on any scheduled date up to the first
one after today; later dates return `422 not_scheduled`. Ticking a skipped
occurrence returns `409 occurrence_skipped`. Routine commands are audited and
retried like every write.

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
`weekly`, `biweekly` (every two weeks), `monthly`, `quarterly` or `annual`. A persisted line also has a stable Entity-scoped
`fixed_cost_id`. Retain that ID when editing or copying the line; omit it to
create a new cost. Copied Plans share Fixed cost identities while Income
sources receive new identities. Each line returns its entered amount,
frequency and cent-valued `monthly_amount`; `fixed_cost_total` sums those
monthly results. Three annual inputs of `100.00` therefore produce three
`8.33` monthly lines and a `24.99` monthly total while retaining all three
`100.00` inputs. The total reduces the Plan's unassigned amount. Each
`monthly_amount` is `amount` × payments per year (52, 26, 12, 4 or 1) ÷ 12,
rounded half-even to cents: `100.00` weekly is `433.33`, biweekly `216.67` and
quarterly `33.33`. A line whose monthly amount would exceed `999999999.99` is
rejected with 422. Reviews compare this smoothed amount with the payments
recorded in the month; they do not count payments per month.

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

## Create Entity

`POST /api/entities` with `Idempotency-Key` and `{"name": "Personal", "time_zone":
"America/Chicago"}` creates an empty Entity owned by the caller (browser session or
API key) and returns `{id, name, time_zone, revision}`. The name is trimmed and
must be 1–120 characters; a valid IANA zone is required (422 otherwise). The Entity
and its `create_entity` audit record (`before: null`) and retry outcome commit
together. The retry identity is per User: the same key and input returns the first
result, the same key with other input returns `409 key_reuse`. Nothing is copied
from another Entity; there is no delete, archive or copy. A new Entity appears in
`GET /api/auth/session`; other Users get 404 for it like any unowned Entity.

Each Entity is a separate boundary: a record UUID from another Entity of the same
User is `404 record_not_found`, exactly like a foreign one. A YNAB plan can be
connected to only one of the User's Entities at a time: connecting a plan that is
connected (not disconnected) in another of them returns `409
source_connected_elsewhere` naming that Entity. Disconnect it there first.

## Projections

Illustrative figures from explicit assumptions ([TDD 14](tdds/14-projections.md)),
never activity, observations or balances. Nominal dollars only: inflation is not
modelled yet ([#44](https://github.com/mattjmcnaughton/accanto/issues/44)).

Investments carry three optional assumptions on create and edit:
`expected_return_percent` (annual percent, −10 to 30, two decimals; null uses the
Entity's `default_return_percent` from settings), `expected_contribution` (USD,
nonnegative) and `expected_contribution_frequency` (`monthly`, the default, or
`annual`). An edit that omits one leaves it unchanged; null clears it. Giving
recipients refuse them (422).

`GET /projections?years=N` (1–100, default 20) projects from the Entity's today:
each investment starts at its latest observed value and compounds monthly at the
effective rate (1 + R)^(1/12) − 1, with its contribution (annual ÷ 12, none for
an inactive investment) added at each month's end. Savings remaining saved stay
at today's amount. Each loan starts at its latest observation; one with a fixed
`interest_rate_percent` and a `monthly_payment` that exceeds its monthly interest
is paid down month by month as its payoff schedule is ([TDD 15](tdds/15-debt-payoff.md)),
and any other loan stays at that amount. Like investments, a loan starts at its
latest observation as of the Entity's today, so its projected payoff can fall
later than its payoff schedule's, which starts at the observation's date. Loan
payments are not subtracted from
investment contributions, and a repaid loan's payment is not invested. It returns
`as_of`, `default_return_percent`, `today {investments, savings, loans,
net_worth}`, `timeline` (one row per year from 0), `milestones` (always 5, 10 and
20 years), each row `{years, date, investments, loans, net_worth, contributed}`;
`investments` per investment with `status` (`projected` or `no_value`),
`return_percent`, `return_source` (`investment` or `default`),
`monthly_contribution` and milestone `amount`s; `loans` per loan with `debt_id`,
`name`, `active`, `status` (`amortizing`, `no_terms`, `interest_not_covered` or
`paid_off`), `latest {date, amount}`, `interest_rate_percent`, `monthly_payment`,
`payoff_date` (null unless repaid within the projection's span) and milestone
`amount`s; and `fire`. An active investment without an observed value
makes every total and the FIRE date null (unknown, never zero). Amounts round
half-even to cents at reporting.

`GET /fire-assumptions` returns `{annual_spending, withdrawal_percent, revision}`
(defaults null and `4.00`); `PUT` takes them with `expected_revision` (the
Entity's revision) and an `Idempotency-Key`. With annual spending set, `fire` is
`{annual_spending, withdrawal_percent, target, months_to_target, reached_on}`:
the target is spending ÷ withdrawal rate, rounded up, and the date is the first
month projected investments (not cash savings) reach it, null beyond 100 years.

## Entity settings and API key metadata

`GET /api/entities/{id}/settings` returns `id`, `name`, `time_zone`,
`default_return_percent` (projection default, `6.00` for a new Entity), `revision`
and Entity-zone `today`. To update, send `PUT` to the same path with
`Idempotency-Key` and `{name, time_zone, expected_revision}`, optionally with
`default_return_percent` (omit to keep it). The response returns
current `id`, `name`, `time_zone` and the incremented `revision`; reload settings
or session metadata for current date defaults. A valid IANA zone is required.
A zone change affects future defaults only; existing financial dates, Review
months/targets and saved Plan versions stay unchanged. Settings edits and their
before/after audit snapshots and retry outcomes commit atomically. Stale revisions
return 409; current authorization is required even for successful retry outcomes.

These settings and the FIRE assumptions above are the ones API keys and agents
may change ([TDD 03](tdds/03-agent-access.md#entity-settings-for-agents-2026-11-27)).
Agents use the catalog tools `get_settings` (all of them with the one Entity
`revision`), `save_entity_settings` (`{name, time_zone, default_return_percent?,
expected_revision}`) and `save_fire_assumptions` (`{annual_spending,
withdrawal_percent, expected_revision}`, both required so neither resets by
omission). They follow the Agent mode like any write: Read only refuses them,
Ask first drafts a Pending change, Apply directly records them, audited as `mcp`
or `agent`. Everything else in Settings is sensitive and browser-session only;
API keys get `403 browser_session_required` and no tool reaches it: the Agent
mode, assistant enablement and `PUT /agent/settings` (AGENT.md may only be
proposed, see below), the YNAB token (`/transaction-provider`) and source setup
(plans, connect, account selection, disconnect), API keys (`/api/keys`), and
sign-in and sessions. An
unknown field in a settings body, such as `mode`, is a 422.

API key management is browser session only (with CSRF, like every browser
write); an API key gets `403 browser_session_required` on all three routes, so
no script or agent can list, mint or revoke keys. The same holds for every
credential: the YNAB token (`/transaction-provider`) and any future
integration's credential are browser-only and never returned.
`GET /api/keys` lists the signed-in User's keys as `{id, name, created_at,
revoked_at}`, including revoked metadata. It never returns a token or digest.
`POST /api/keys` shows a new token once; `DELETE /api/keys/{id}` revokes
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
Creation requires `name` and a protected `opening: {date, amount}`, and accepts
optional fixed-rate terms: `interest_rate_percent` (annual percent, 0 to 40, two
decimals) and `monthly_payment` (USD, above zero). `PUT
/api/entities/{entity_id}/debts/{debt_id}` accepts `name`, `active`, and
`expected_revision` to rename, archive or reopen, and the same terms; an edit
that omits a term leaves it unchanged, and null clears it. Only fixed rates are
supported. Terms are assumptions, never activity or observations. Archival requires the latest
recorded amount owed to be zero; a payment alone does not establish zero. An
archived loan rejects new payments and new associations; an existing payment
retaining that loan identity can still be corrected with its current revision.
Its history remains visible. `draft_fixed_cost_lines`
identifies draft Plan lines linked to an archived loan for explicit revision;
saved versions remain intact.

Each loan result also has its `interest_rate_percent`, `monthly_payment` and
`payoff`: `{status, as_of, balance, interest_rate_percent, monthly_payment,
monthly_interest, months, payoff_date, total_interest, total_paid}` from the
latest observation. `GET .../debts/{debt_id}/payoff-schedule` returns the same
fields with `rows`, one per month `{month, date, payment, interest, principal,
balance}`. The first payment is a month after the observation's date; interest is
the balance × rate ÷ 12, rounded half-even to cents each month, and the last
payment clears the balance exactly. `status` is `scheduled`, or why there are no
rows (and null totals): `no_terms` (rate or payment missing), `paid_off`,
`interest_not_covered` (the payment does not exceed the first month's interest,
so the balance never falls) or `beyond_limit` (not repaid within 100 years).

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

## Pending changes

Writes an agent drafts wait as Pending changes ([TDD 03](tdds/03-agent-access.md)).
Applying and dismissing them is browser session only, so no agent applies what it
drafted; API keys get `403 browser_session_required`.

| Method | Suffix | Body / result |
| --- | --- | --- |
| GET | `/agent/pending-changes?status=pending` | Pending changes, newest first; `labels` maps each record id in a change's `input` to that record's current name (accounts, goals, fixed costs, tags, spending subcategories, investments, giving recipients, debts) |
| POST | `/agent/pending-changes/{pending_id}/apply` | `{input?}` (owner edits); runs the drafted command once with key `agent:{pending_id}`; a retry returns the same outcome |
| POST | `/agent/pending-changes/apply-all` | `{changes: [{id, input?}]}` (1–100); applies them oldest drafted first, each as its own apply, and stops at the first rejection. Returns `{results: [{id, status, result?, error?}]}` in applied order, `status` `applied`, `failed` (with `error.code` and `error.message`) or `not_applied`; failed and not-applied changes stay pending. Any id not in the Entity refuses the whole request with `404 record_not_found`. Resending replays the ones already applied |
| POST | `/agent/pending-changes/{pending_id}/dismiss` | `{expected_revision}` |

## AGENT.md

The Entity's AGENT.md is the owner's standing instructions for agents
([TDD 10](tdds/10-agent-md-interview.md)). Reading it is open to any caller with
Entity access, including API keys; changing it is browser-session only, through
`PUT /agent/settings`. Agents may only draft a new AGENT.md as a Pending change
(`propose_agent_instructions`), which pends in every Agent mode and changes only
the text when applied; an applied draft based on an older revision is
`409 stale_revision`.

| Method | Suffix | Body / result |
| --- | --- | --- |
| GET | `/agent/instructions` | `{instructions, revision}`; `revision` is 0 before anything was saved |

## Assistant conversations

Browser session only, like every `/agent` route: API keys are refused. Each User
has several conversations per Entity ([TDD 08](tdds/08-assistant-conversation-history.md)).
Archiving hides a conversation and keeps its messages; any conversation, archived
or not, is deleted 30 days after its latest turn. Pending changes are never
affected.

| Method | Suffix | Body / result |
| --- | --- | --- |
| GET | `/agent/conversations` | Active conversations, latest turn first: `id`, `title` (first question), `message_count`, `created_at`, `updated_at` |
| GET | `/agent/conversations/{conversation_id}` | Its messages; `404 conversation_not_found` once archived or expired |
| POST | `/agent/conversations/messages` | Multipart `content`, `screen`, `month`, `images[]`; starts a conversation and streams SSE; `done` carries `conversation_id` |
| POST | `/agent/conversations/{conversation_id}/messages` | Same, continuing that conversation |
| POST | `/agent/conversations/{conversation_id}/archive` | `{"archived": true}` |
| GET | `/agent/conversation` | Messages of the latest active conversation (`[]` when none) |
| POST | `/agent/conversation/messages` | Continues the latest active conversation, or starts one |
| DELETE | `/agent/conversation` | Archives the latest active conversation; `{"cleared": false}` when none |
| POST | `/agent/turn/stop` | Stops the reply sent with the `Idempotency-Key` header (every running reply without one), which stores nothing and ends with an `error` frame, code `stopped`; `{"stopped": false}` when none runs |

A turn outlives its connection: closing the stream does not stop it. Send an
`Idempotency-Key` with each message. Posting the same key again, with `after`
set to the number of data frames already handled (heartbeats are not counted),
follows that turn from there instead of starting another, while it runs and for
10 minutes after it ends. A nonzero `after` with a key the server no longer has
returns `409 turn_gone`.

Each conversation runs one reply at a time: another message to a conversation
whose reply is running returns `409 reply_in_progress`, while other
conversations, including a new one, reply meanwhile (up to the server's
concurrent reply limit, `429 agent_busy`). A reply's hold on its conversation
ends with the reply however it ends, and lapses after twice the reply timeout
plus 30 seconds in any case.

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
| GET | `/transaction-provider` | `{kind, configured, revision}`; the Settings-level provider (`ynab`); never returns the token |
| PUT | `/transaction-provider` | `{kind, access_token, expected_revision}`; checks the token with the provider, then stores it encrypted |
| DELETE | `/transaction-provider` | `{expected_revision}`; forgets the token; connected sources stay but cannot sync until one is saved |
| GET | `/sources/ynab/plans` | YNAB plans the saved token can read |
| POST | `/sources/ynab` | `{plan_id, start_date}`; connects a USD plan through the saved token; transactions before `start_date` are never staged; `409 source_connected_elsewhere` if another of the User's Entities has it connected |
| GET | `/sources/{source_id}/accounts` | The plan's accounts and which are selected |
| PUT | `/sources/{source_id}/accounts` | `{account_ids, expected_revision}`; default is none; adding an account re-reads history |
| DELETE | `/sources/{source_id}` | `{expected_revision}`; stops importing the plan; recorded entries and inbox history stay |
| POST | `/sources/{source_id}/sync` | Fetch changes since the stored cursor and stage the cleared ones; returns counts (`added`, `changed`, `removed`, `conflicts`, `unchanged`, `ignored`, and `uncleared`: new transactions not staged because they are still uncleared). Records nothing |
| GET | `/inbox?status=&month=YYYY-MM-01&source=&proposed=&limit=` | Staged transactions (default: all but removed), oldest first, with source facts, proposal, rejections and revision; `proposed=true` keeps only items with a proposal, `false` only items without one; `limit` (1–500) returns the first items, to work in chunks |
| POST | `/inbox/proposal-run` | `202`; starts the built-in agent's proposal run over every waiting item without a proposal, or returns the active run. Records nothing. Needs the assistant on and an Agent mode other than Read only (`agent_disabled`, `read_only`); a browser session or API key (`proposal_run_credential` otherwise) |
| GET | `/inbox/proposal-run` | `{run, waiting, proposed, needs_you, chunk}`: the latest run (`state` queued, running, succeeded, failed or cancelled; `steps`; `counts` proposed, needs_you, failed; `error_code`) and the waiting items' proposal counts |
| DELETE | `/inbox/proposal-run` | Stops the active run; proposals it set stay |
| GET | `/inbox/{item_id}` | One staged transaction |
| PUT | `/inbox/{item_id}/proposal` | Set a proposal (replaces any earlier one) |
| DELETE | `/inbox/{item_id}/proposal` | `{expected_revision}`; clear it |
| PUT | `/inbox/proposals` | `{proposals: [{item_id, ...proposal}]}`; per-item outcomes |
| POST | `/inbox/{item_id}/record` | `{expected_revision, completion?}`; records from the proposal, or from `completion`, which replaces it |
| POST | `/inbox/record` | `{items: [{item_id, expected_revision, completion?}]}` (up to 200); validates in request order and commits accepted entries, audit and retry outcomes together. Each rejected item reports its own reason. |
| POST | `/inbox/{item_id}/skip`, `/unskip` | `{expected_revision}`; ignore an item (the UI calls status `skipped` Ignored) or return it to waiting. A re-sync of the same transaction keeps it ignored |
| POST | `/inbox/{item_id}/undo` | `{expected_revision}`; soft-deletes the recorded entry through its normal delete command; the item waits again |
| POST | `/inbox/skip`, `/inbox/unskip`, `/inbox/undo` | `{items: [{item_id, expected_revision}]}` (up to 200); the batch form of the commands above. Each item is its own write under the request's `Idempotency-Key`, so one rejection keeps the rest; per-item outcomes `{item_id, ok, item?, entry?, error?}` |
| POST | `/inbox/{item_id}/resolve` | `{expected_revision, resolution: "keep" \| "delete"}` for a conflict |
| PUT | `/inbox/{item_id}/note` | `{expected_revision, note}` (up to 1000 characters; `""` clears it); the owner's note on a waiting or ignored item. Returns the item with `note` and `noted_at`. A recorded item's note is on its actual entry (`inbox_status` here). Agents (the built-in assistant and MCP) cannot write it: `owner_note`, 403 |
| PUT | `/inbox/note` | `{note, items: [{item_id, expected_revision}]}` (up to 200); the same note on each item, each its own write; per-item outcomes `{item_id, ok, item?, error?}` |

A **proposal** (and a record `completion`) is any subset of `category`
(`income`, `fixed_cost`, `spending`, `saving`, `investing`, `giving`),
`assignment` (an Income source, fixed cost, spending subcategory, saving goal,
investment or giving recipient UUID, or `"unassigned"`; optional for guilt-free
spending, where none means Unassigned), `funding` (`"income"` or a saving goal UUID),
`refund_of` (a purchase entry UUID), or `skip: true`, optional `tag_ids` (not
with `refund_of` or `skip`), plus `rationale` and
`expected_revision`. Setting a proposal checks its shape and that every reference
exists in the Entity, then runs the record command's checks as a dry run and
stores any rejection in `proposal_rejection` without failing the request. It never
writes actual entries. `proposed_by` records the User, interface and time.

Recording maps the staged transaction to the existing command: `POST /activity`
for income, fixed costs, guilt-free spending and saving; the investment and giving
contribution commands; or the linked refund command for `refund_of`. Those
commands' rules, audit, and stale-edit checks apply unchanged; the audit
interface is `inbox`. An inflow to an outflow category must be a refund. The entry
note is the payee, then the memo and the owner's inbox note when present,
joined with ` · `. A rejection leaves the item waiting with its reason
in `rejection`. The record retry identity is the item and its expected revision,
so repeating the same press returns the first outcome without a second entry.

Statuses: `waiting`, `skipped`, `recorded`, `conflict` (recorded, then changed or
deleted in the source; the entry is never edited by sync), and `removed`
(deleted in the source before recording). Sync stages a new transaction only
once YNAB reports it `cleared` or `reconciled`; YNAB sends it again in a later
delta when it clears, at its posted amount and date. A transaction deleted
before it clears, such as a cancelled hold, is never staged. Staged items keep
their status if YNAB later reports them uncleared. A YNAB failure changes neither the
cursor nor the inbox. YNAB milliunits convert to exact cents; an amount with
partial cents fails the sync. `kind` is `ordinary`, `transfer_on_budget`,
`transfer_tracking` or `card_payment`; how to treat each is the proposer's choice.
`GET /reviews/{month}` reports `inbox_waiting`, the count of waiting staged
transactions dated in that month.
