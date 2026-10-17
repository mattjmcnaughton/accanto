# 01 — Accanto MVP technical design

Status: Workflow baseline agreed; implementation design selected; delivery incremental
Updated: 2026-10-16

## Purpose and scope

Implement the [MVP PRD](../prd/01-mvp.md) under the
[constitution](../../CONSTITUTION.md), [domain context](../../CONTEXT.md) and
[architecture](../architecture.md). This design replaces earlier exploratory
mechanisms. Production uses pure Python rules, application services and relational
Postgres records; the browser prototype is interaction evidence, not authority.
No rules engine, event sourcing, message bus or generic integration framework.

First vertical slice: an admitted User operating one Entity can create/save a
monthly Plan with net-income sources and spending, record dated income/spending,
and read/create a monthly Review against that saved version. Include authenticated
API access, persistence, audit, retry safety and revision checks immediately.
Extend typed cost/allocation/account workflows incrementally. Commands not delivered
in this slice must be unavailable rather than accepting unvalidated payloads.
Browser OIDC integration and the API-backed UI are explicit delivery steps; the
browser prototype remains visibly separate until those steps are complete.

## Workflows and domain rules

The actor is the authenticated User with current access to the Entity. Services
load plain facts and invoke named pure functions. Rejection leaves all financial,
audit and retry records unchanged; return a code and actionable explanation. The
same rule applies to every listed command, including correction/deletion paths.

| Rule | Authoritative source | Commands affected | Enforcement / required facts | Verification |
| --- | --- | --- | --- | --- |
| Immutable Plan intention | CONTEXT, Save a Plan version; Domain boundaries | Create/edit/copy draft, save version, target Review | Pure calculations; service freezes complete revision/lines; DB rejects saved-record mutation | v2 leaves v1 and Review unchanged; copy has new source IDs |
| Net income and separate savings funding | CONTEXT, Planned use of savings and lump-sum income | Draft edits/save/copy | Sum direct net lines; account funding separate; tithe uses income only | $4,000 + $1,000 = $5,000 funding, $400 tithe |
| Cent-valued results | Constitution §1 | All money commands | Decimal domain functions; decimal-string DTOs; numeric checks | Three annual $100 lines yield $24.99 monthly; ±1.005 → ±1.00 |
| Independent estimates | CONTEXT Decisions 10–12 | Create/edit/duplicate estimate | Validate per-line gross/deductions/frequency; save estimate/lines and audit together; no Plan FK | $4,500 + $3,000 = $7,500; edit copy leaves original/Plan unchanged |
| Protected Unallocated and opening conservation | CONTEXT, Mandatory Unallocated goal; Decisions 1–2, 22 | Account creation; goal edits; archive/reopen | Pure designation checks; service creates account/goal/designations; unique role plus deferred existence check | $10,000 portions sum once; no contribution; role cannot be removed |
| Opening-date boundary | CONTEXT Decisions 1–2, 22 | All account-linked writes/corrections | Pure date validation against openings; protected opening fields once any activity exists (including deleted history) | Same day allowed; earlier activity rejects; reopening does not reset |
| Nonnegative ordered history | CONTEXT Decisions 4–6, 9 | Activity, transfer, reassignment, reconciliation create/edit/delete; supported undo | Pure replay by date/order across affected goals; locked Entity transaction spans validation and write | $800 cannot fund $1,000; funding first succeeds; later negative balances reject deletion |
| Transfer/reassignment conservation | CONTEXT, Reassign saved money; Record a savings transfer | Create/edit/delete movements; completion | One movement row supplies equal effects; pure account/goal eligibility | $200 moves without income/contribution; both effects roll back together |
| Goal reconciliation | CONTEXT Decisions 3, 8 | Create/edit/delete reconciliation | One required goal; signed amount; ordinary history check | $5,200 − $200 = $5,000; other goal and contribution totals unchanged |
| Saving adjustments require a goal | CONTEXT, Saving-category adjustments require a goal | Create/edit/delete/undo actual adjustment | Required destination even for zero; signed category and goal effect share one entry | $400 → $500 adds $100 to selected goal and monthly saving |
| Linked refunds | CONTEXT Decisions 7, 15–19 | Refund create/edit/delete/undo; purchase edit/delete | Pure purchase/refund-set rules under Entity lock: cap, dates, stable origin/category; no cascade | $1,000/$300 permits $700 not $701; early date/origin change/deletion reject |
| Goal completion and returned refund | CONTEXT, Complete a saving goal; Decision 16 | Complete finite goal, linked refund, return to Unallocated | Return remainder and lifecycle atomic; narrow completed-goal exceptions | $100 returned on completion; later $200 refund keeps completed status |
| Savings lifecycle | CONTEXT Decisions 13–14 | Archive/reopen account; any affected activity | Zero balance and lifecycle provenance; account/goals/audit same transaction | Nonzero rejects; reopening leaves previously completed/inactive goals unchanged |
| Debt and investment observations | CONTEXT Decisions 20–23; Debt accounts | Setup, observation create/correct/delete, debt archive/reopen, payments/contributions | Pure date/lifecycle/latest-observation rules; partial unique account/date; opening protected | $300 payment does not infer principal; zero observation allows archival; duplicate rejects |
| Unknown versus zero | CONTEXT, Unknown actual; Domain boundaries | Record/correct/delete actual; read Review | Pure rollup from current entries and expected saved lines; missing stays null | Explicit zero resolves one item; category adjustment does not resolve other unknown sources |
| Monthly Review and annotation | CONTEXT, Start monthly Review; Annotate a month | Create/retarget/edit Review/checkpoint | Entity/month unique; saved-only target; visible prior-month default; no financial lock | New v3 does not replace prior-month v2; mark with gaps remains editable |
| Transparent percentages | CONTEXT, Percentage metrics | Read Plan/Review views | Named numerator/base and amounts; unknown/zero denominator → unavailable | $2,500/$4,000=62.5%; $2,500/$5,000=50%, distinct labels |
| Entity isolation | Constitution §2; CONTEXT, Domain boundaries | Every read/write/retry | Current ownership authorization; scoped repository queries and FKs | Foreign Entity UUID denied, including previously successful retries after access loss |
| Durable audited writes | Constitution §§1, 7 | Every saved financial change | Service transaction; immutable audit DB permissions/triggers; revision and retry rows | Inject failure → no partial records; same key → one audit; stale key with changed input → conflict |

All savings-changing commands load the affected ordered history, including future
recorded dates. Account totals derive from nonnegative goal portions, not a second
ledger. Opening rows precede ordinary activity. A transfer has one order value
for both effects; editing retains it. Successful operation order is allocated
from a database sequence under the Entity lock; gaps after rollback are harmless.

## Implementation and data

Use `domains/` for Decimal calculations, rollup completeness, history validation,
refund eligibility and lifecycle decisions. Inputs/results are plain dataclasses
or values, with no HTTP/ORM imports. `services/` owns authorization, transaction
boundaries and orchestration. `repositories/` owns scoped queries; no speculative
repository interfaces. `dtos/` is separate from SQLAlchemy models. Routes and
future MCP tools call the same services.

### Money and dates

Accepted money input is a finite decimal string with at most two fractional
places, magnitude at most $999,999,999.99. Reject excess precision before database
coercion. Store USD amounts in `numeric(14,2)` with input-bound checks. Use Decimal
context precision 28; half-even at monthly line results and tithe results. Original
annual amounts remain separate from monthly results; totals sum cent-valued lines.
Estimator outputs round each monthly line then sum those results. No exact
multi-month schedule is implemented; a future split must specify residual order.
Ratios are presentation results, never reconstructed inputs or financial writes.

Financial dates use SQL `date`. UTC `timestamptz` records write/audit times. Entity
stores an IANA zone, validated with Python `zoneinfo`; defaults use that zone.
Changing zone changes defaults, never existing financial dates. Store monetary
values as decimal strings in API responses and audit JSON, never float conversions.
UUIDs are generated with `uuid4`; all tables keep internal bigint identities and
external UUIDs, including relationships and write support.

### Physical schema conventions

The relational layouts below remain the agreed full-MVP target. Use typed rows,
not whole-workspace JSONB. JSONB is for audit snapshots and idempotency responses.
All financial rows have Entity scope, revision, UTC creation/update metadata and,
where deletable, `deleted_at`. FKs use internal IDs and restrict deletion.
Entity-scoped composite FKs or constraint triggers enforce cross-Entity reference
integrity. Relationship tables enforce compatible actual-entry categories.

Partial unique indexes enforce one draft per Plan, one Unallocated role per
savings account, and one non-deleted observation per account/date.
Opening observations retain their protected start-of-day role and one opening per account.
A deferred constraint trigger verifies exactly one Unallocated goal and opening
conservation at transaction end. Account/goal lifecycle provenance is stored as
`archived_by_account` plus the prior state. A completed goal may later have a
positive linked-refund balance; completion is not a permanent zero constraint.

Saved revision and line UPDATE/DELETE triggers reject mutation. Review target
constraints require a saved revision in the same Entity. Source IDs remain tied
to one Plan. New drafts copy saved lines using new row IDs but stable source IDs.
Soft deletion never deletes relationships. Index history queries by Entity,
financial date and recording order, and source/destination FKs.

### Agreed relational storage decisions

The initial migration implements the income/spending subset: User, Entity, API
keys, Plans, sources, revisions/lines, actual entries/assignments, monthly Reviews,
audit and idempotency outcomes. The remaining tables below are design decisions
to implement with their command families.
Use relational rows for financial records and saved Plan versions; JSONB remains
appropriate for the agreed audit before/after snapshots.

#### Internal and external identities

Every table defaults to both identifiers, including relationship tables, audit
rows, and idempotency outcomes:

```sql
id   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
uuid uuid NOT NULL UNIQUE
```

Internal foreign keys reference `id`; public API/MCP identifiers use `uuid`.
Both identifiers are stable for the lifetime of a record, including soft deletion
and restoration. A copied record receives new identifiers. Generate external UUIDs with uuid4. Possessing a UUID never replaces Entity authorization.

Relationship tables have their own `id` and `uuid`; preserve one-per-entry
cardinality with a separate `NOT NULL UNIQUE` foreign key, not by using the entry
foreign key as the relationship's primary key. Existing business uniqueness
constraints, such as Entity/month and idempotency scope/key, remain additional
constraints. The row UUID is not the caller's idempotency key. Draft line and
other tables described without full column listings inherit this convention.

#### Plan revisions

- `plan` holds the stable Plan identity and Entity relationship.
- `income_source` belongs to a Plan and retains its identity across that Plan's
  revisions. Copying a Plan creates new Income source identities.
- `plan_revision` belongs to a Plan and represents either its single editable
  draft or an immutable saved version. Store the version number, saved timestamp,
  concurrency revision, calculation-rule version, and applicable inputs/results
  in typed columns.
- Income, fixed-cost, savings-funding, and destination-allocation line tables
  reference `plan_revision`. Preserve referenced identities, historical names,
  original inputs, and calculated monetary results in relational columns.
- Saving freezes the draft and its lines as a saved version and creates a new
  editable draft by copying those rows in the same transaction. The new rows
  retain source/destination identities but receive new revision/line IDs.
- `monthly_review` references a saved revision. Enforce one draft per Plan,
  immutable saved revisions and lines, and saved-only Review targets. Use the triggers and constraints specified above.

#### Goal-backed savings and the Unallocated goal

`saving_goal.role` distinguishes `ordinary` from `unallocated`. Each account
must have exactly one Unallocated goal, created atomically with the account.
It is ongoing, has no target, and cannot be independently inactivated, completed,
archived, or deleted. A uniqueness constraint can enforce at most one; account
creation and lifecycle enforcement must also guarantee existence. Use the unique role index and deferred existence/conservation trigger specified above.

All savings destinations and origins require goal references. Their accounts
are derived from those goals. Use a separate contribution destination table:

```text
entry_saving_destination
  id                   bigint identity PRIMARY KEY
  uuid                 uuid NOT NULL UNIQUE
  actual_entry_id       NOT NULL UNIQUE, FOREIGN KEY -> actual_entry
  saving_goal_id        NOT NULL, FOREIGN KEY -> saving_goal
```

Every saving-category entry, including positive, negative, and zero adjustments,
has exactly one such destination. Require explicit goal selection, including
Unallocated; no implicit account or goal attribution. Amount and date
remain on the actual entry. Saving Plan allocations, opening designations,
reassignment and transfer endpoints, and savings reconciliation similarly
identify goals, including Unallocated. Opening designations across all goals
must equal the account opening amount; the undistributed portion is assigned
to Unallocated. Account totals sum goals once, without adding the opening
amount again. Planned use of savings remains an account-level Plan intention.

#### Savings funding of actual entries

Use a separate relationship table rather than savings-specific origin columns
on every actual entry:

```text
entry_savings_funding
  id                   bigint identity PRIMARY KEY
  uuid                 uuid NOT NULL UNIQUE
  actual_entry_id       NOT NULL UNIQUE, FOREIGN KEY -> actual_entry
  saving_goal_id        NOT NULL, FOREIGN KEY -> saving_goal
```

For an eligible outflow, a relationship row means savings funded it; absence
means current income funded it. This absence rule does not give income receipts
a funding origin. The required goal may be the account’s Unallocated goal; its
account is derived from the goal, not duplicated in the relationship.
There is at most one savings-funding relationship per entry; split funding is
outside scope.

The relationship stores no duplicate amount or financial date. Spending or
contribution totals and savings use derive from the same actual entry. Enforce
eligible entry kinds and same-Entity references through the goal and its account. Use scoped FKs and category constraint triggers.

Create or change the entry and its funding relationship atomically, together
with audit snapshots and the successful idempotency outcome. Stale-edit checks
cover funding changes as well as entry fields. Soft-deleting an entry excludes
both its category and savings effects while retaining its funding relationship;
restoration remains subject to the agreed domain validation. Funding changes
must remain auditable. Linked refunds preserve their original funding origin;
CONTEXT Decision 18 blocks origin changes while non-deleted linked refunds exist.

#### Purchase refund relationship

Use a separate relationship table:

```text
entry_refund
  id                   bigint identity PRIMARY KEY
  uuid                 uuid NOT NULL UNIQUE
  refund_entry_id       NOT NULL UNIQUE, FOREIGN KEY -> actual_entry
  original_entry_id     NOT NULL, FOREIGN KEY -> actual_entry
```

Each refund has its own actual entry containing its signed amount and financial
date, and references exactly one original purchase in the same Entity. Multiple
partial refunds may reference that purchase. Enforce eligible purchase/refund
entry kinds and reject self-links. The relationship duplicates neither amount
nor date. The refund follows the purchase's funding origin; callers cannot
independently choose its funding destination.

A $900 October purchase followed by a $200 November refund preserves October's
$900 spending and records -$200 in November. If Laptop savings funded the
purchase, the refund restores $200 there without creating income or a saving
contribution. Record the refund, relationship, audit history, and successful
idempotency outcome atomically; restoration of savings derives from that entry.

Retain relationships on soft deletion, excluding deleted activity from totals.
The already-agreed purchase deletion rule still applies: block deletion while
non-deleted linked refunds exist; no cascading deletion. Apply CONTEXT Decisions
16–18 for completed-goal refunds, the aggregate refund cap, and blocking purchase
funding-origin changes while non-deleted refunds exist. Apply the shared transaction protocol below; dedicated restoration remains deferred.

#### Savings reassignment within an account

Use one record for both effects of changing the purpose of saved money:

```text
savings_reassignment
  id                   bigint identity PRIMARY KEY
  uuid                 uuid NOT NULL UNIQUE
  entity_id            NOT NULL, FOREIGN KEY -> entity
  financial_date       NOT NULL
  from_goal_id         NOT NULL, FOREIGN KEY -> saving_goal
  to_goal_id           NOT NULL, FOREIGN KEY -> saving_goal
  amount               positive exact USD cents
  note                 optional
```

The goals must differ and belong to the same savings account within the Entity.
Either may be its Unallocated goal. Derive the account from the goals. A $200
reassignment from Unallocated to Laptop decreases the former and increases the
latter by $200, without changing account totals, income, spending, or contribution
totals. Both effects derive from this single row, not separate debit/credit rows.

Validate sufficient savings and applicable dated-history rules atomically with
the write. Apply the standard revision, audit, idempotency, and supported soft
deletion/restoration policies. Goal completion and its required reassignment to
Unallocated commit together. Account-to-account movement remains a savings
transfer, not a reassignment. The UI may describe reassignment as moving money
between goals; this does not change the domain distinction.

#### Savings transfer between accounts

Keep account-to-account transfers separate from within-account reassignments:

```text
savings_transfer
  id                   bigint identity PRIMARY KEY
  uuid                 uuid NOT NULL UNIQUE
  entity_id            NOT NULL, FOREIGN KEY -> entity
  financial_date       NOT NULL
  from_goal_id         NOT NULL, FOREIGN KEY -> saving_goal
  to_goal_id           NOT NULL, FOREIGN KEY -> saving_goal
  amount               positive exact USD cents
  note                 optional
```

Both goals belong to the Entity and must belong to different savings accounts.
Either may be its account's Unallocated goal. Derive the accounts from the goals
rather than duplicating account references. One row supplies equal source and
destination effects; it creates no income, spending, or new saving contribution.
For example, $500 from Bank A's Unallocated goal to Bank B's Emergency goal
reduces the source goal/account and increases the destination goal/account by
$500, leaving total Entity savings unchanged.

Validate sufficient funds and dated-history constraints atomically with the
write, including concurrent operations. Both effects, audit history, and the
successful idempotency outcome commit together. Apply standard revision and
soft-deletion/restoration policies, including the existing requirement to
validate affected history when removing transfer effects. Keep this table
separate from `savings_reassignment`, whose goals must share an account.

#### Investment and debt balance observations

Store observations separately from actual activity, in separate tables for
investment value and debt owed:

```text
investment_balance_observation
  id                   bigint identity PRIMARY KEY
  uuid                 uuid NOT NULL UNIQUE
  entity_id            NOT NULL, FOREIGN KEY -> entity
  investment_id        nullable, FOREIGN KEY -> investment
  financial_date       NOT NULL
  amount               exact USD cents
  is_opening           NOT NULL

debt_balance_observation
  id                   bigint identity PRIMARY KEY
  uuid                 uuid NOT NULL UNIQUE
  entity_id            NOT NULL, FOREIGN KEY -> entity
  debt_account_id      NOT NULL, FOREIGN KEY -> debt_account
  financial_date       NOT NULL
  amount               exact USD cents
  is_opening           NOT NULL
```

Investment observations may remain unassigned under CONTEXT.md. An opening
investment observation must identify its investment; debt observations always
identify their debt account. All account references stay within the Entity.
Opening and later observations share the respective table, distinguished by
`is_opening`. Account opening setup must preserve the starting observation
without inventing contributions or payments.

A loan opening at $10,000 owed, followed by a $300 payment, does not automatically
have a $9,700 balance. A later lender statement showing $9,750 is a separate
observation. Likewise an investment contribution does not establish market value.
Observations never enter activity totals or contribution progress. Display the
latest observed value with its financial date rather than as a live balance.

Apply standard audit, stale-edit, idempotency, and supported soft-deletion rules.
Decision 23 requires one current observation per account/financial date. Use a
database uniqueness guarantee for current records; corrections explicitly update
the existing observation with audit history and stale-edit checks. Duplicate
creation cannot silently overwrite it. Account-opening positions retain their
separate protections; this rule does not authorize editing an opening balance.

#### Monthly Review record

```text
monthly_review
  id                   bigint identity PRIMARY KEY
  uuid                 uuid NOT NULL UNIQUE
  entity_id            NOT NULL, FOREIGN KEY -> entity
  month                NOT NULL, date (first day of calendar month)
  plan_revision_id     NOT NULL, FOREIGN KEY -> plan_revision
  notes                optional
  reviewed_at          optional UTC timestamp
  revision             stale-edit protection

  UNIQUE (entity_id, month)
```

Enforce that `month` is the first day of its calendar month and that the selected
revision is saved and belongs to the same Entity. Store no editable actual
totals: derive them from the Entity's non-deleted actual entries dated within
that month, preserving unknown versus explicit zero. Entries can exist before
the Review; creating one neither copies nor creates activity.

`reviewed_at` is a freely set or cleared annotation, never a posting lock or
completeness assertion. Audit its changes and preserve the annotation when
later activity changes. Record a comparison fingerprint of the selected version, notes and current monthly entry IDs/revisions at checkpoint time. Recompute for change detection; no financial lock follows from a mismatch. Cross-Plan income matches are separate Review-owned records and do
not rewrite actual entries. Apply the standard atomic audit, stale-edit,
idempotency, and applicable deletion/restoration policies.

#### Income, investment, and giving entry relationships

Keep source and destination assignments in separate relationship tables:

```text
entry_income_source
  id                   bigint identity PRIMARY KEY
  uuid                 uuid NOT NULL UNIQUE
  actual_entry_id       NOT NULL UNIQUE, FOREIGN KEY -> actual_entry
  income_source_id      NOT NULL, FOREIGN KEY -> income_source

entry_investment_destination
  id                   bigint identity PRIMARY KEY
  uuid                 uuid NOT NULL UNIQUE
  actual_entry_id       NOT NULL UNIQUE, FOREIGN KEY -> actual_entry
  investment_id        NOT NULL, FOREIGN KEY -> investment

entry_giving_recipient
  id                   bigint identity PRIMARY KEY
  uuid                 uuid NOT NULL UNIQUE
  actual_entry_id       NOT NULL UNIQUE, FOREIGN KEY -> actual_entry
  giving_recipient_id  NOT NULL, FOREIGN KEY -> giving_recipient
```

Amounts and financial dates remain on `actual_entry`; these rows store only
relationships. Each table permits at most one assignment per entry. Enforce
matching entry categories and same-Entity references, including through the
Income source's owning Plan. An income, investing, or giving entry with no
corresponding assignment is explicitly Unassigned and still contributes once
to its category total. Never infer assignment from matching names.

This optional assignment does not extend to saving entries or their adjustments: they require
an `entry_saving_destination` referencing a goal, including Unallocated. Apply
the existing destination lifecycle rules to new assignments and corrections.
Entry and relationship changes use the same atomic audit, revision, and
idempotency guarantees; soft deletion retains the historical relationships
while excluding the entry from current totals. Review income matches remain
comparison-only and do not change `entry_income_source`.

#### Fixed-cost and debt-payment entry relationships

```text
entry_fixed_cost
  id                   bigint identity PRIMARY KEY
  uuid                 uuid NOT NULL UNIQUE
  actual_entry_id      NOT NULL UNIQUE, FOREIGN KEY -> actual_entry
  fixed_cost_id        NOT NULL, FOREIGN KEY -> fixed_cost

entry_debt_account
  id                   bigint identity PRIMARY KEY
  uuid                 uuid NOT NULL UNIQUE
  actual_entry_id      NOT NULL UNIQUE, FOREIGN KEY -> actual_entry
  debt_account_id      NOT NULL, FOREIGN KEY -> debt_account
```

A $300 car payment is one fixed-cost actual entry. Its fixed-cost relationship
supports Plan comparison; its debt-account relationship identifies the loan for
payment history. Add a savings-funding relationship only when savings funded
the payment. Count the amount once in fixed-cost totals; do not automatically
reduce an observed debt balance. Ordinary fixed costs need no debt relationship.

Keep the debt-account association on the entry rather than deriving historical
payment assignments from a mutable planned fixed-cost line. Enforce compatible
entry categories and same-Entity references. Entry/relationship changes follow
the standard atomic audit, stale-edit, idempotency, and soft-deletion rules.

#### Shared actual entry record

```text
actual_entry
  id                   bigint identity PRIMARY KEY
  uuid                 uuid NOT NULL UNIQUE
  entity_id            NOT NULL, FOREIGN KEY -> entity
  financial_date       date NOT NULL
  category             income | fixed_costs | guilt_free_spending
                       | saving | investing | giving
  amount               exact USD cents, NOT NULL
  is_adjustment        boolean NOT NULL DEFAULT false
  note                 optional
  revision             bigint NOT NULL DEFAULT 1
  created_at           UTC timestamp
  updated_at           UTC timestamp
  deleted_at           optional UTC timestamp
```

Store the adjustment flag on the shared entry: adjustments participate in the
same category rollups, dating, assignment relationships, and correction lifecycle
as ordinary entries. For example, a $100 donation is a giving entry; a +$40
giving correction is a giving entry with `is_adjustment = true`. No separate
adjustment activity table or duplicate amount is required. Balance reconciliation
adjustments remain separate under their existing domain rules; this flag denotes
actual-entry adjustments, not savings balance reconciliation. A saving adjustment
requires exactly one `entry_saving_destination`, even when its amount is zero.
Its category and goal/account effects derive from the same signed amount and
commit atomically with the relationship and audit/outcome records. For example,
correcting $400 recorded saving to $500 creates a +$100 adjustment assigned to
an explicitly selected goal; it does not invent a default account or alter other
goals. Enforce the normal lifecycle and ordered nonnegative-history rules.

An explicit zero income entry records known zero; absence of entries remains
unknown. Enforce category-specific sign and relationship rules under CONTEXT.md;
signed adjustments do not relax funding consistency or savings-history checks.
Refunds use `entry_refund`. Source, destination, debt, and savings-funding
associations use the agreed relationship tables. Keep recorded entries independent
of Reviews and derive their month from the financial date.

Apply the agreed monetary, UTC timestamp, soft-deletion, atomic audit, stale-edit,
and idempotency guarantees. Use the money bounds, numeric columns and transaction protocol in this design.


### Additional records

`app_user` stores admitted `(issuer, subject)` identity, not email as identity.
`entity` stores owner, name, IANA time zone and revision. Initial sharing is not
implemented. `api_key` stores User, name, SHA-256 digest of a cryptographically
random 32-byte token, created/revoked timestamps; no plaintext token column.
Random high-entropy tokens permit fast hash lookup without password hashing.
Keys have no automatic expiration and inherit current User access.

`income_estimate` stores Entity/name/revision; its line rows store name, gross,
withholding, payroll, frequency and paid days. No Plan relationship. Duplicate
creates new estimate/line IDs. `savings_balance_adjustment` stores Entity, goal,
financial date, signed amount, order, revision and deletion metadata. A movement
stores one amount/date/order shared by both derived effects.

### Authentication and API

Use existing FastAPI, SQLAlchemy asyncpg, Postgres 16 and Alembic. Direct API uses
Bearer API keys; every request resolves current revocation and Entity ownership
from the database. Key creation shows its secret once; individual revocation is
authenticated. Initial controlled setup may provision an already-admitted test
User and key through an operator command; it is not public self-registration.

Retain agreed browser OIDC/session direction from Aleph and hosted MCP OAuth.
Browser and MCP admission require allowlisted verified email; `(issuer, subject)`
is the identity key. No separate permission tiers. Account freezing/allowlist
removal effects remain deferred, while Entity-access removal and key revocation
must deny subsequent requests. Browser OIDC production uses secure HttpOnly
SameSite cookies, server-side sessions, CSRF checks for writes and explicit logout.
Provider configuration/interoperability must be tested before that surface ships.
Do not substitute long-lived API keys in browser localStorage for browser login.

MCP is a resource server using issuer/audience/algorithm/expiry verification and
resource metadata, not an authorization server. ChatGPT/Claude tool coverage and
hosted compatibility remain separate delivery work; no provider credentials,
tenant or recurring cost is introduced by this implementation. Test synthetic
records first. No financial data is exposed through MCP before explicit tool
contracts. Pydantic AI remains the agreed framework for later approved AI features,
not a dependency for this slice or authorization to send financial data externally.

Use `/api/entities/{uuid}/...` routes; UUID knowledge grants no authorization.
Money is decimal strings. Writes supply `Idempotency-Key` and `expected_revision`
for edits. Return 401 invalid/revoked credential, 404 absent/unauthorized Entity
or scoped reference, 409 stale revision/key reuse/domain conflict, and 422 malformed
input. Validation error responses omit entered money, notes and credentials from
logs. Generated OpenAPI documents schemas; add worked requests in `docs/api.md`.
Services return plain results; adapters map errors without logging financial input.

## Atomicity, concurrency, and retries

Use Postgres READ COMMITTED and `SELECT ... FOR UPDATE` on the Entity row for
financial writes. Recheck current owner under that lock. All supported mutations,
including access changes, use this boundary. Credential revocation takes the
credential lock used during request authorization, defining a clear serial order.
This intentionally serializes a single Entity's writes; introduce ordered account
locks only if measured throughput requires it. It is not a new financial policy.

Within one transaction: authenticate/authorize; lock Entity; canonicalize request;
look up idempotency outcome; validate expected revision; load rule facts; compute
proposed results; validate shared rules; persist records and relationships; write
complete before/after audit snapshots; store successful response; commit. Never
return success before commit. Repeat reads for a Review use a coherent transaction
snapshot. Reads must not combine financial states from interleaved transactions.

Scope retry keys by User, Entity and operation (including target resource).
Store canonical request SHA-256 and the successful response in
`idempotency_outcome`, unique by that scope/key. Canonical input includes expected
revision. Same input/key returns saved outcome even after its revision becomes
stale; different input conflicts. Current authorization always precedes replay.
Failed transactions retain no false successful outcome. Entity locking serializes
concurrent duplicate keys and aggregate checks without a separate job system.

Guarantee retention for at least 30 days; initially keep outcomes indefinitely
(no cleanup job). If cleanup is later enabled, document that keys older than 30
days may be treated as new operations. Store UTC creation/expiry policy metadata.
Audit and soft-deleted financial records have no automatic purge in v1; retention
is indefinite until an explicit later policy. Dedicated restore endpoints are
not implemented by default; any later restoration reuses all current rules.

Audit rows store Entity, record type/UUID, action, User, API-key UUID where used,
interface, UTC time, operation UUID and complete before/after JSON snapshots.
No secrets. Service code writes explicit snapshots of logical records including
relationship/line values. Compound operations record each changed logical record
under one operation UUID. The application role can SELECT/INSERT audit, not
UPDATE/DELETE/TRUNCATE; rejecting triggers add protection against accidental
mutation by ordinary operations. Migration role is separate and privileged.
Audit rows are never queried for financial totals. Saved versions have equivalent
mutation protection. Integration tests use an actual restricted application role.

Stale writes use integer revisions compared under the lock, incremented once on
success. UI retains attempted values on error and never automatically retries a
conflict with a fresh revision. Retry identities survive transport retries.

## Verification

Unit tests use independent examples from the rule table: Decimal boundaries,
line rounding, immutable inputs, missing versus zero, ordered history and refund
sets. Integration tests run migrations against real Postgres and prove scoped
references, duplicate constraints, transaction rollback, stale writes, concurrent
duplicates, authorization after revocation/access loss and append-only audit.
Test two competing savings reductions and refund-cap races when those commands
are added; do not claim the income/spending slice proves them.

Browser checks cover Plan → activity → Review, failed-save input preservation,
keyboard/mobile use, independent estimate copying and savings/refund workflows.
Prototype test results are documented separately. Production UI must be tested
against its API rather than taking browser-local calculations as authoritative.
No fake database establishes locks, constraints or rollback.

## Alternatives and tradeoffs

Retain relational revisions and typed relationship tables already agreed instead
of JSON financial documents. Keep mutable current records plus separate snapshots
instead of event sourcing. Entity locking is simpler than premature per-account
lock orchestration and sufficient for the initial single-user workload. Direct
API keys avoid refresh flows for scripts; browser sessions remain a separate
credential lifecycle. Hosted compatibility experiments do not block pure domain
work or the authenticated direct-API slice.

## Delivery and compatibility

1. Reconcile prototype and product documents; preserve legacy local data and
   immutable versions, replacing the receipt-linked lump-sum and tax editor flows.
2. Introduce the minimum typed persistence, shared rules and authenticated API for
   net-income/spending Plan → activity → Review, with audit/revision/retry support.
3. Add API-backed UI and browser sign-in, then expand command coverage through
   fixed costs, destinations, accounts, movements, refunds and observations using
   the rule table. Unsupported commands remain explicit, not silently approximated.
4. Verify hosted MCP/provider access only when configured; no release claim until
   required CI, authentication, persistence and core UI/API workflows are complete.

There is no required prototype-to-production migration. Preserve prototype storage
and its standalone artifact while production grows separately. Alembic migrations
must be reversible where data-safe; never drop historical records on application
rollback. Fly.io plus Neon remain the agreed hosting direction; initial provider
recovery is accepted for single-user use. Record actual tier/recovery-window settings
at deployment. Custom disaster recovery and restoration drills remain deferred.
A restore must account for credential revocations after the recovery point.

## Implementation evidence (2026-10-16)

The first direct-API increment is implemented in `domains/monthly.py`, monthly
services/repository/router and migration `191e70341645`. `docs/api.md` describes
the supported surface. Independent money/unknown tests and a real PostgreSQL API
journey verify immutable saved versions, current authorization on replay, two-key
concurrent retries, stale competing edits, soft deletion, full audit snapshots and
rollback after injected audit failure. Runtime-role permissions and database
triggers protect audit and saved versions. Local validation does not establish
hosted identity/provider compatibility or completed MVP coverage.

The API requires explicit financial dates, so no server-local today default is
introduced. It supports the original Plan source assignment only; this does not
settle future cross-Plan matching cardinality. Review selection is initially
create/read only; retargeting, notes and reviewed annotations remain to implement.
No production balance/refund/transfer commands are exposed yet. Browser sign-in
and the API-backed core UI are the next usable delivery increment.

## Open decisions

Financial policy: minimum cross-Plan receipt-matching cardinality and subsequent
retargeting behavior remain unresolved. Advanced combination/splitting is deferred;
no one-to-one uniqueness constraint is approved. Implement same-Plan Reviews first.
Percentage defaults are deliberately provisional, not a blocker.

Technical delivery dependencies: hosted OIDC/MCP registration, provider credentials,
public endpoint and compatibility verification. No new service/cost is authorized
implicitly. Concrete code/schema choices above are selected and testable; remaining
columns are added with the corresponding command slice. Dedicated restoration and
opening-history reconstruction remain out of v1 scope.
