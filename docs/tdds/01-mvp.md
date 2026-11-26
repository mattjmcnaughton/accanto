# 01 — Accanto MVP technical design

Status: Agreed workflow baseline; reconciled implementation design; production partial
Updated: 2026-10-17

## Purpose and scope

Implement the [MVP PRD](../prd/01-mvp.md) under the
[constitution](../../CONSTITUTION.md), [domain context](../../CONTEXT.md) and
[architecture](../architecture.md). This design replaces earlier exploratory
mechanisms. Production uses pure Python rules, application services and relational
Postgres records; the browser prototype is interaction evidence, not authority.
The prototype is an example of possible interactions, not a production
specification. Its incidental restrictions do not establish financial policy or
require production to reproduce its screens. Agreed domain rules and product
requirements govern the design; preserve existing data independently of UI choices.
No rules engine, event sourcing, message bus or generic integration framework.

The implemented first vertical slice lets an admitted User operating one Entity
create/save a monthly Plan with net-income sources and spending, record dated income/spending,
and read/create a monthly Review against that saved version. Include authenticated
API access, persistence, audit, retry safety and revision checks immediately.
Extend typed cost/allocation/account workflows incrementally. Commands not delivered
in this slice must be unavailable rather than accepting unvalidated payloads.
Browser OIDC integration and the API-backed UI are explicit delivery steps; the
browser prototype remains visibly separate until those steps are complete.

## Workflows and domain rules

The table describes the production target, not the currently exposed commands.
The [implementation inventory](#implementation-inventory) bounds current support.
“Supported undo” is conditional: no production restore command exists. Named
outcomes are successful commands from CONTEXT, not persisted events.

The actor is the authenticated User with current access to the Entity. Services
load plain facts and invoke named pure functions. Rejection leaves all financial,
audit and retry records unchanged; return a code and actionable explanation. The
same rule applies to every listed command, including correction/deletion paths.

| Rule | Authoritative source | Commands affected | Enforcement / required facts | Verification |
| --- | --- | --- | --- | --- |
| Immutable Plan intention | [Save a Plan version](../../CONTEXT.md#save-a-plan-version); [Domain boundaries](../../CONTEXT.md#domain-boundaries) | Create/edit/copy draft, save version, target Review | Pure calculations; service freezes complete revision/lines; DB rejects saved-record mutation | v2 leaves v1 and Review unchanged; copy has new source IDs |
| Net income and separate savings funding | [Planned use of savings](../../CONTEXT.md#planned-use-of-savings-and-lump-sum-income) | Draft edits/save/copy | Sum direct net lines; account funding separate; tithe uses income only | $4,000 + $1,000 = $5,000 funding, $400 tithe |
| Cent-valued results | [Constitution §1](../../CONSTITUTION.md#1-represent-finances-honestly) | All money commands | Decimal domain functions; decimal-string DTOs; numeric checks | Three annual $100 lines yield $24.99 monthly; $10.05 income → $1.00 tithe; $10.15 → $1.02 |
| Independent estimates | [Decisions 10–12](../../CONTEXT.md#decision-10--save-multiple-income-estimates-agreed) | Create/edit/duplicate estimate | Validate per-line gross/deductions/frequency; save estimate/lines and audit together; no Plan FK | $4,500 + $3,000 = $7,500; edit copy leaves original/Plan unchanged |
| Protected Unallocated and opening conservation | [Mandatory Unallocated](../../CONTEXT.md#mandatory-unallocated-goal--agreed-storage-and-domain-direction); [Decision 22](../../CONTEXT.md#decision-22--fix-the-opening-boundary-after-activity-agreed) | Account creation; goal edits; archive/reopen | Pure designation checks; service creates account/goal/designations; unique role plus deferred existence check | $10,000 portions sum once; no contribution; role cannot be removed |
| Opening-date boundary | [Decisions 1–2](../../CONTEXT.md#decision-1--opening-date-boundary-agreed); [Decision 22](../../CONTEXT.md#decision-22--fix-the-opening-boundary-after-activity-agreed) | All account-linked writes/corrections | Pure date validation against openings; protected opening fields once any activity exists (including deleted history) | Same day allowed; earlier activity rejects; reopening does not reset |
| Nonnegative ordered history | [Decisions 4–6](../../CONTEXT.md#decision-4--sufficient-savings-and-transfers-agreed); [Decision 9](../../CONTEXT.md#decision-9--same-day-savings-activity-order-agreed) | Activity, transfer, reassignment, reconciliation create/edit/delete; supported undo | Pure replay by date/order across affected goals; locked Entity transaction spans validation and write | $800 cannot fund $1,000; funding first succeeds; later negative balances reject deletion |
| Transfer/reassignment conservation | [Reassignment](../../CONTEXT.md#reassign-saved-money); [Transfer](../../CONTEXT.md#record-a-savings-transfer) | Create/edit/delete movements; completion | One movement row supplies equal effects; pure account/goal eligibility | $200 moves without income/contribution; both effects roll back together |
| Goal reconciliation | [Decision 3](../../CONTEXT.md#decision-3--reconcile-a-recorded-balance-agreed); [Decision 8](../../CONTEXT.md#decision-8--reconcile-an-individual-savings-amount-agreed) | Create/edit/delete reconciliation | One required goal; signed amount; ordinary history check | $5,200 − $200 = $5,000; other goal and contribution totals unchanged |
| Saving adjustments require a goal | [Saving adjustments](../../CONTEXT.md#saving-category-adjustments-require-a-goal) | Create/edit/delete/undo actual adjustment | Required destination even for zero; signed category and goal effect share one entry | $400 → $500 adds $100 to selected goal and monthly saving |
| Linked refunds | [Decision 7](../../CONTEXT.md#decision-7--delete-a-purchase-with-linked-refunds-agreed); [Decisions 15–19](../../CONTEXT.md#decision-15--refund-versus-deletion-agreed) | Refund create/edit/delete/undo; purchase edit/delete | Pure purchase/refund-set rules under Entity lock: cap, dates, stable origin/category; no cascade | $1,000/$300 permits $700 not $701; early date/origin change/deletion reject |
| Goal completion and returned refund | [Complete a goal](../../CONTEXT.md#complete-a-saving-goal); [Decision 16](../../CONTEXT.md#decision-16--refund-into-a-completed-saving-goal-agreed) | Complete finite goal, linked refund, return to Unallocated | Return remainder and lifecycle atomic; narrow completed-goal exceptions | $100 returned on completion; later $200 refund keeps completed status |
| Savings lifecycle | [Decisions 13–14](../../CONTEXT.md#decision-13--archive-a-savings-account-agreed) | Archive/reopen account; any affected activity | Zero balance and lifecycle provenance; account/goals/audit same transaction | Nonzero rejects; reopening leaves previously completed/inactive goals unchanged |
| Debt and investment observations | [Decisions 20–23](../../CONTEXT.md#decision-20--archive-a-debt-account-agreed); [Debt accounts](../../CONTEXT.md#debt-accounts) | Setup, observation create/correct/delete, debt archive/reopen, payments/contributions | Pure date/lifecycle/latest-observation rules; partial unique account/date; opening protected | $300 payment does not infer principal; zero observation allows archival; duplicate rejects |
| Unknown versus zero | [Domain boundaries](../../CONTEXT.md#domain-boundaries) | Record/correct/delete actual; read Review | Pure rollup from current entries and expected saved lines; missing stays null | Explicit zero resolves one item; category adjustment does not resolve other unknown sources |
| Monthly Review and annotation | [Start Review](../../CONTEXT.md#start-a-monthly-review); [Annotate month](../../CONTEXT.md#annotate-a-month-as-reviewed-or-closed) | Create/retarget/edit Review/checkpoint | Entity/month unique; saved-only target; visible prior-month default; no financial lock | New v3 does not replace prior-month v2; mark with gaps remains editable |
| Transparent percentages | [Percentage metrics](../../CONTEXT.md#percentage-metrics--explicit-choices-before-defaults) | Read Plan/Review views | Named numerator/base and amounts; unknown/zero denominator → unavailable | $2,500/$4,000=62.5%; $2,500/$5,000=50%, distinct labels |
| Entity isolation | [Constitution §2](../../CONSTITUTION.md#2-support-both-ui-and-api-operation); [Domain boundaries](../../CONTEXT.md#domain-boundaries) | Every read/write/retry | Current ownership authorization; scoped repository queries and FKs | Foreign Entity UUID denied, including previously successful retries after access loss |
| Durable audited writes | [Constitution §1](../../CONSTITUTION.md#1-represent-finances-honestly), [§7](../../CONSTITUTION.md#7-make-failures-explicit-and-preserve-data) | Every saved financial change | Service transaction; immutable audit DB permissions/triggers; revision and retry rows | Inject failure → no partial records; same key → one audit; stale key with changed input → conflict |
| Allocation and progress distinctions | [Destination allocations](../../CONTEXT.md#destination-allocations); [Finite and ongoing goals](../../CONTEXT.md#finite-and-ongoing-saving-goals) | Draft edits/save/copy; destination setup/edit/inactivate/reactivate; contribution corrections | Pure sums/target validation; service loads stable identities and lifecycle; DB scoped references | $300 + $200 + $100 = $600 saving allocation; $50 monthly shortfall does not carry forward; opening savings fund a goal without contribution progress (unit) |
| Known-total adjustment | [Domain boundaries](../../CONTEXT.md#domain-boundaries) | Enter known total; edit/delete adjustment | Pure difference from recorded total; service checks caller's rollup fingerprint under Entity lock, then stores one signed dated adjustment | $210 → $250 creates +$40; later $40 detail yields $290; stale rollup rejects (unit + DB race) |
| Financial dates and defaults | [Ubiquitous language](../../CONTEXT.md#ubiquitous-language); [Constitution §1](../../CONSTITUTION.md#1-represent-finances-honestly) | Entry/account/observation/movement create/correct; Entity time-zone edit | Explicit date and zone facts to pure rules; service validates IANA zone and obtains current instant for defaults; DB date fields | One UTC instant has different calendar dates across zones; changing zone never moves existing entries (unit + API) |

For corrections, validate the union of original and proposed references, not only
new endpoints. Archived savings accounts must be reopened even when an edit would
move activity elsewhere. Independently inactive destinations still permit
corrections to existing entries; do not confuse them with an archived account.
A goal cannot change accounts to relocate historical money. Completed-goal refund
and return-to-Unallocated exceptions do not authorize ordinary new contributions.

Reject history failures with goal UUID, first invalid date and shortfall; reject
refund conflicts with remaining refundable amount or dependent refund IDs.
These details belong in authorized responses, never telemetry. A domain rejection
preserves all records and attempted UI input; correcting dependencies is an
explicit subsequent command, not an automatic compensating write.

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
The per-input limit is not an aggregate limit: 100 maximum income lines total
$99,999,999,999.00, within the current `numeric(14,2)` result columns. Before
expanding line counts or formulas, check derived results against column capacity
and reject overflow atomically. Fractional-cent inputs such as `1.005` reject;
half-even examples describe calculated results, not rounding user-entered activity.
Three $100 annual costs divide into $8.33 monthly lines, summing to $24.99;
rounding their combined $300 annual amount instead would incorrectly show $25.00.

Financial dates use SQL `date`. UTC `timestamptz` records write/audit times. Entity
stores an IANA zone, validated with Python `zoneinfo`; defaults use that zone.
Changing zone changes defaults, never existing financial dates. Store monetary
values as decimal strings in API responses and audit JSON, never float conversions.
UUIDs are generated with `uuid4`; all tables keep internal bigint identities and
external UUIDs, including relationships and write support.

### Implementation inventory

Inspected at `45a62fb`; paths below are the committed implementation, while later
schema sections describe additions required as command families ship.

| Surface | Implemented | Remaining production work |
| --- | --- | --- |
| [Monthly routes](../../src/accanto/routers/monthly.py), [DTOs](../../src/accanto/dtos/monthly.py) | Create/list/edit Plan draft, save/list versions; create/list/replace/soft-delete activity; create/read Review | Plan copy; all categories except `income` and `spending` (the API spelling for guilt-free spending); signed adjustments/refunds; Review edits/annotations; restoration |
| [Pure rules](../../src/accanto/domains/monthly.py) | Exact input cents, income/spending Plan results, half-even tithe, income completeness and recorded spending | Annual cost smoothing, estimator, destinations, savings history, lifecycle, refunds and ratios |
| [Monthly service](../../src/accanto/services/monthly.py), [repository](../../src/accanto/repositories/monthly.py) | Key and Entity locks, current ownership, revision checks, canonical retry hashes, audit snapshots, coherent reads | Session principal support; explicit known-total commands; remaining rule orchestration. Most SQL currently lives in the service; the repository only reads Plan lines |
| [Models](../../src/accanto/models/monthly.py), [migration](../../alembic/versions/191e70341645_monthly_core_records.py) | Typed monthly subset, scoped FKs, saved-version/audit triggers, retained source assignments on soft deletion | Full-MVP tables below; common timestamp metadata is not present on every current financial row; no cross-table savings order sequence yet |
| [Credentials](../../src/accanto/services/api_keys.py), [bootstrap](../../src/accanto/bootstrap.py) | Hashed user-owned keys, issue/revoke, operator-provisioned identity/Entity and validated zone | Browser sign-in/session/logout, authenticated Entity discovery/settings; hosted MCP |
| [Frontend transport](../../src/accanto/web/frontend/src/lib/api.ts) | Generic fetch helper only; workspace saves to localStorage | Typed monthly API responses, error/retry handling and API-backed screens; no production workspace exists yet |

MVP-010 adds Entity-scoped named fixed-cost identities shared by Plan copies,
immutable saved lines with original
monthly/annual amounts and per-line monthly results, and a stored monthly
fixed-cost total. It adds `entry_fixed_cost` as an optional assignment with a
frozen canonical label for current-income-funded payments. The pure monthly rule rounds
each annual input to cents using half-even before summing. The Entity lock
protects Plan and activity writes, assignment changes, audit snapshots and retry
outcomes in one transaction. Scoped foreign keys and a deferred category trigger
protect assignments; the saved-line trigger protects historical comparisons.
Three annual `100.00` inputs give three `8.33` results and `24.99` total.
Reviews compare only identical fixed-cost IDs from the targeted saved version;
unassigned payments and category adjustments contribute once to totals but do
not complete a missing expected cost. This slice does not add debt or
savings-funded fixed-cost payments.

MVP-018 extends the existing `saving_linked_activity` association from
savings-funded spending to fixed-cost/debt payments, giving, and investing.
That retained link already carries the entry identity, goal, date, and stable
recording order; the single actual entry amount supplies both its category or
destination progress and its savings effect. It does not create a second
savings-use amount. The additive `5j018` migration widens the existing link
trigger's eligible categories. Investing from savings counts as investment
contribution progress and reduces remaining saved, without new saving from
income.

The additive `5i018` migration adds `entry_refund` and an `is_refund` entry
marker, allowing negative real refunds without calling them adjustments. The
relationship retains original/refund entry IDs within one Entity, with no
duplicate amount or date. The refund command copies the original category,
destination, debt, and savings origin into one new entry; edits only change its
date, amount, or note. Purchase edits and all refund commands validate the pure
current refund set under the Entity lock before commit. The shared savings
history replay then checks later balances. The entry, retained links, audit
snapshots, and retry outcome commit together. Tests cover date, cap, origin,
deletion, competing refund creates, and competing purchase edit/refund create
on PostgreSQL. The UI launches the refund from the original purchase.

Activity commands now distinguish signed corrections from linked real refunds.
Outflows carry one funding origin; ordinary receipts and contributions retain
their category-specific sign rules.
Plan inputs require 1–100 income lines. Reviews require an explicit version UUID;
there is no automatic previous-month default in the service. Source assignments
may refer to any source in the Entity, but comparison matches only identical
source IDs from the selected version. Foreign-Plan receipts count once as
actual-only income; they do not resolve its missing sources. No match table or
cardinality constraint has been implemented or approved.

The current public Review response strips internal foreign keys without exposing
the target's UUID in the Review object; its accompanying `version.uuid` identifies
the target. The browser adapter must use that UUID, never internal IDs. Current
errors have mixed string/object `detail`; normalize them at the adapter boundary.

### Physical schema conventions

The relational layouts below remain the agreed full-MVP target. Use typed rows,
not whole-workspace JSONB. JSONB is for audit snapshots and idempotency responses.
The target uses Entity scope (directly or through scoped parents), revision on
mutable logical records, UTC creation/update metadata and,
where deletable, `deleted_at`. FKs use internal IDs and restrict deletion.
Entity-scoped composite FKs or constraint triggers enforce cross-Entity reference
integrity. Relationship tables enforce compatible actual-entry categories.

Partial unique indexes enforce one draft per Plan, one Unallocated role per
savings account, and one non-deleted ordinary observation per account/date.
Opening observations retain their protected start-of-day role and one opening per account.
A deferred constraint trigger verifies exactly one Unallocated goal and opening
conservation at transaction end. Account/goal lifecycle provenance is stored as
`archived_by_account` plus the prior state. A completed goal may later have a
positive linked-refund balance; completion is not a permanent zero constraint.

Saved revision UPDATE/DELETE triggers reject mutation. Every saved line table
also rejects INSERT into a saved revision, UPDATE of or into one, and DELETE
from one; adding a line must not retroactively alter a version. Review target
constraints require a saved revision in the same Entity. Source IDs remain tied
to one Plan. New drafts copy saved lines using new row IDs but stable source IDs.
Soft deletion never deletes relationships. Index history queries by Entity,
financial date and recording order, and source/destination FKs.

<a id="data-model"></a>

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
id   bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
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
[Decision 23](../../CONTEXT.md#decision-23--one-balance-observation-per-accountdate-agreed)
allows a protected start-of-day opening plus one ordinary observation on that date.
Use a partial unique index on `(account_id, financial_date)` where not deleted
and not opening, plus a separate unique opening per account. Select the latest
balance by financial date, with an ordinary observation after the opening on a
tie. This ordering is about observed positions, not inferred payment effects.
Unassigned investment observations have no account and are not folded into an
inferred account balance. Use the Entity lock for duplicate checks and lifecycle
validation; corrections explicitly update the existing ordinary observation with
audit history and stale-edit checks. Duplicate creation cannot silently overwrite
it. Account-opening positions retain their separate protections.

Verification: a synthetic October 1 loan opening of $300 and an independently
observed October 1 balance of $0 remain separate; latest owed is $0 and archival
is eligible. A payment alone leaves latest owed at $300. Pure tests establish
selection; real-DB tests prove two competing ordinary observations for that date
cannot both succeed, correction retains the opening, and audit failure rolls back.
The prototype currently rejects the second same-date record; this is a prototype
limitation, not the production policy, and is not changed by this document.

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


### Command-specific write boundaries

In addition to the common transaction protocol:

- Known-total entry takes month, category/optional assignment, financial date,
  desired total and a fingerprint of the displayed contributing entry UUIDs and
  revisions. For saving, a goal is mandatory. Under the Entity lock, reload that
  scope and reject a changed fingerprint; calculate the signed difference in the
  domain and persist one adjustment. Direct signed adjustments remain explicit
  corrections, never an implicit replacement total. Reconciliation similarly
  distinguishes a supplied signed correction from a target-balance command.
- Review edit takes expected revision, optional notes/annotation and an explicit
  saved-version target when retargeting. Same-Plan retarget keeps source identity;
  cross-Plan matching waits for its unresolved policy. Persist target/notes/mark
  and audit together. At checkpoint, store a hash of canonical comparison inputs
  (version UUID, notes, current entry UUIDs/revisions); later relevant changes
  produce an informational mismatch without clearing the mark. The fingerprint
  is not an alternate source of financial totals.
- Savings history validation covers old and new goals and both transfer accounts,
  every affected later entry, and all non-deleted refunds of affected purchases.
  Account archive/reopen and goal completion take the same Entity lock as activity.
  Validate lifecycle and the whole proposed history before writing. For competing
  $600 uses of an $800 goal, only one can succeed; for competing $700 refunds of a
  $1,000 purchase, only one can succeed. Roll back financial rows, audit and retry
  outcome together if any check or write fails.

These are remaining command contracts, not new endpoints delivered by this TDD.

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

### AI framework

Pydantic AI remains selected for approved AI features. AI features are
authorized within [PRD 02 — Agent access](../prd/02-agent-access.md) and
implemented by [TDD 03](03-agent-access.md); that PRD is also the decision on
which financial data may reach a model provider. Nothing beyond it is authorized.

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
return success before commit. Privileged SQL outside the protocol is not a
supported financial interface.

Pure reads that previously took the write locks (including Plan, Activity and
Review) instead use a read-only Postgres REPEATABLE READ transaction. Credential
revalidation, Entity ownership and all result queries share one snapshot, without
waiting for or delaying financial row locks. An already authorized read can
finish against its earlier snapshot; revocation or ownership loss committed
before a new read's snapshot denies that read. This changes scheduling, not
financial rules. Verify with overlapping reads and a concurrent Plan edit,
then with new reads after credential revocation and Entity access loss.

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

Audit rows store Entity, record type/UUID, action, User, nullable API-key UUID
where used, interface, UTC time, operation UUID and complete before/after JSON
snapshots.
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

Required coverage as each command family ships (not a claim of current coverage):
unit tests use independent examples from the rule table: Decimal boundaries,
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

The [implementation tickets](../technical/tickets/01-mvp.md) own execution order
and completion evidence. Build the production frontend afresh using the existing
React/Vite toolchain and backend services. Retire the browser-local workspace
from the active application rather than adapting its components and calculations
into the production model. Preserve the standalone prototype and existing data;
an optional ignored `.agentic/legacy/prototype/` source copy is local reference
only, never a build dependency. The reset is ticketed, not yet implemented.

1. Complete: accepted prototype and reconciled product baseline, preserving legacy
   local data and immutable versions.
2. Implemented subset: typed persistence, shared rules and authenticated API for
   net-income/spending Plan → activity → Review, with audit/revision/retry support.
3. Add API-backed UI and browser sign-in, then expand command coverage through
   fixed costs, destinations, accounts, movements, refunds and observations using
   the rule table. Unsupported commands remain explicit, not silently approximated.
4. Verify hosted MCP/provider access only when configured; no release claim until
   required CI, authentication, persistence and core UI/API workflows are complete.

There is no required prototype-to-production migration. Preserve prototype storage
and its standalone artifact while production grows separately. Alembic migrations
must be reversible where data-safe; never drop historical records on application
rollback. The initial migration downgrade drops the schema and is unsuitable for
rollback with saved data; use a forward repair or compatible application rollback. Fly.io plus Neon remain the agreed hosting direction; initial provider
recovery is accepted for single-user use. Record actual tier/recovery-window settings
at deployment. Custom disaster recovery and restoration drills remain deferred.
A restore must account for credential revocations after the recovery point.

### Next production increment: browser access to the existing monthly slice

Deliver browser sign-in and an API-backed income/spending Plan → activity → Review
journey. Reuse the accepted interaction vocabulary and existing monthly commands;
keep unsupported financial workflows visibly unavailable in this production slice.
The standalone prototype stays available with its storage and saved versions intact.
Do not silently import it, clear its storage, or copy its calculations into the
production authority.

The prerequisite is a small authentication boundary change, not new financial
rules. Today `authorize` accepts a raw API key and audit requires `api_key_uuid`.
Introduce an explicit authenticated actor carrying User identity, credential kind
and credential reference. The service must revalidate the credential and current
Entity ownership within its transaction before replay or mutation; adapters cannot
pass an unchecked User ID. Preserve credential-before-Entity lock order for
writes; browser commands lock their session before Entity. Logout/revocation uses
the same credential lock as commands.
Make audit's API-key reference nullable for browser writes and record interface
and session attribution without storing session secrets in financial snapshots.
Reuse the existing services for both callers; do not duplicate monthly commands.

Use same-origin browser API requests. Add OIDC authorization-code sign-in with
state, nonce and PKCE, verified allowlisted email admission, issuer/subject identity,
and an opaque high-entropy server-side session whose secret is stored hashed.
Use Secure, HttpOnly, SameSite=Lax cookies, CSRF token plus Origin validation on
cookie-authenticated writes, and POST logout that invalidates the session. Set a
12-hour absolute session lifetime initially; expiry requires sign-in without
silently discarding unsaved input. Do not store provider tokens or API keys in
browser storage. Reject ambiguous simultaneous cookie/Bearer credentials.
Provider registration/configuration is a delivery dependency; choose a maintained
OIDC library when implementing and test its actual provider contract before release.
No new paid service is selected by this document.

For this controlled slice, the callback resolves the verified `(issuer, subject)`
to an existing operator-provisioned User. Verified allowlisted email is an
admission check, never an account-merge key. An unknown identity receives an
explicit setup-required rejection; do not create a second Entity or attach an
existing Entity by matching email. Provider changes require deliberate operator
identity binding outside ordinary sign-in, not automatic account merging.

On session expiry, preserve pending form values and any submitted request's exact
payload/key in the existing tab's memory. Offer user-initiated sign-in in a
separate window so an OIDC redirect does not replace that tab. After sign-in,
explicitly recheck the session through the same-origin API; a window message or
closing the window is not proof of authentication. Require the same User before
resuming the pending operation; a different signed-in User must not receive or
submit its financial input. Refresh the CSRF token, then retry an uncertain save
with its original key and payload. Cancellation, popup
blocking or failed sign-in leaves the pending input visible and offers another
attempt; do not fall back to a full-page redirect that loses it. Explicit logout
clears the workspace from memory. Reloading or closing an unsaved tab is outside
this in-memory recovery guarantee; warn on navigation and do not imply that
unsaved input has been durably saved.

Add an authenticated current-user/Entity read returning external UUID, name and
zone for the admitted owner; no switching/sharing UI. Use Entity-zone date defaults
and submit explicit financial dates. The browser gets Plans/activity/Review from
the API, uses `version.uuid` for previous-calendar-month preselection, and requires
visible confirmation before creating a Review. A missing Review is distinct from
a failed load. Use the existing frontend transport with typed results and stable
request identities retained until the outcome is known; preserve input on errors.
No financial workspace fallback to localStorage on API failure.

Acceptance for this increment:

1. An admitted User signs in, reloads their persisted Entity and signs out;
   invalid state/nonce, unverified/unadmitted identity, expired/logged-out session
   and forged cookie writes reject. Direct API keys continue to work independently.
   Real-DB tests prove access loss also denies retries for both credential kinds.
   Exact issuer/subject lookup preserves the existing User and Entity; unknown
   identities and same-email/different-subject identities cannot inherit access.
2. In an isolated synthetic workspace, create $4,000 net income and $800 spending,
   save v1, record $4,000 income and $75 spending, then create October's Review:
   differences are $0 and -$725. Draft edits/new versions leave v1 and its Review
   unchanged. Missing expected income remains unknown until an explicit entry,
   including zero. Saving an overallocated Plan remains allowed with a warning.
3. November visibly preselects October's version even after a newer version exists;
   without the immediately previous month's Review, require an explicit selection.
   Creating a Review does not create/copy activity. No cross-Plan match is inferred.
4. Edit and soft-delete an entry through the UI and observe the same API rollups.
   Reload durability, failed loads, failed saves, stale edits and a lost response
   preserve input and have explicit recovery. Retrying the same successful command
   produces one change/audit outcome, including across credentials of the same User.
   Expiry during an uncertain save, reauthentication cancellation and popup blocking
   preserve the pending values/payload/key; successful reauthentication refreshes
   CSRF credentials and recovers the committed outcome without a duplicate.
5. Production browser writes have complete atomic audit snapshots and session actor
   attribution; money stays decimal strings and calculations remain in Python.
   Migration tests preserve existing keys, records, saved versions and audit rows.
   Existing audit remains readable; never invent historical session attribution.
6. Keyboard and 320–390px operation cover the journey and errors. Browser checks use
   the real API and isolated synthetic data; provider-independent auth tests run
   locally, with live-provider compatibility explicitly opt-in. Inspect telemetry
   for exclusion of financial values, notes and credentials. No timing benchmark
   from the prototype walkthrough becomes an acceptance gate.

After this increment, add the remaining command families in bounded slices from
the rule table, including Review annotations/retargeting, Plan copy, signed
adjustments, fixed costs and destination/account workflows. This is still partial
MVP delivery. Do not weaken the full PRD to match the first production screens.

### Existing implementation evidence

The first direct-API increment is implemented in the files linked in the inventory.
[API usage](../api.md) describes its supported surface.
[Money/unknown tests](../../tests/unit/test_monthly_domain.py) and the
[PostgreSQL API journey](../../tests/integration/test_monthly_api.py) exercise
immutable saved versions, current authorization on replay, two-key concurrent
retries, stale competing edits, soft deletion, an entry before/after snapshot and
rollback after injected audit failure. The journey runs with restricted runtime
permissions and tests audit and saved-version mutation rejection. It does not
exhaustively verify every snapshot field or every structural constraint; those
remain required as commands expand. Local validation does not establish hosted
identity/provider compatibility or completed MVP coverage.

The API requires explicit financial dates, so no server-local today default is
introduced. Comparison uses original source identities only; this does not settle
future cross-Plan matching cardinality. Review selection is initially create/read
only; retargeting, notes and reviewed annotations remain to implement.
No production balance/refund/transfer commands are exposed yet. Browser sign-in
and the API-backed core UI are the next usable delivery increment.

### Accepted prototype evidence and limits

The accepted prototype alignment changed browser-local interactions only. Its
checks below are prior evidence, not tests executed by this design reconciliation.
`workspace/domain.ts` enforces opening conservation, refund associations,
archived-origin checks and ordered savings history; components pass proposed changes before the workspace save.

- CONTEXT Opening amounts / Decisions 1–2: account creation accepts goal opening
  designations and assigns the residual to Unallocated in one workspace write.
  Unit and browser checks prove $1,000 = $400 designated + $600 Unallocated,
  without contributions; overdesignation rejects without writing.
- CONTEXT same-day order / corrections: create, edit and delete movements validate
  the full proposed history. Edits retain order; legacy entries use their original
  array position consistently. Both old and proposed endpoint accounts must be
  active. Tests cover insufficient funds and correction on independently inactive
  goals. Browser correction preserves one movement and its order.
- CONTEXT refunds / Decision 14: create/edit/delete checks original as well as
  proposed account references. Refunds retain loan association too; switching an
  archived origin to a different origin cannot bypass reopening. Legacy unlinked
  negative records remain readable; new refunds require an original purchase.
- Constitution financial dates: settings validates an IANA zone using Intl;
  entry, refund, account and observation defaults use it. Stored financial dates
  stay unchanged. Unit checks use an instant straddling two calendar dates.
- CONTEXT Percentage metrics: Plan views disclose net-income and total-funding
  bases; actual views use only same-month recorded values and withhold ratios
  for incomplete required amounts. No saved calculation is rewritten.

These checks and their audit snapshots are accepted together by the existing
browser save path. Tab-conflict detection is best-effort continuity, not database
concurrency safety. Production must implement the transaction/locking boundaries
above. Opening-edit and dedicated restoration interfaces remain absent; opening
positions are protected and later reconciliation is explicit. Advanced matching
and its unresolved cardinality remain deferred.

## Open decisions

Financial policy: minimum cross-Plan receipt-matching cardinality and subsequent
retargeting behavior remain unresolved. Advanced combination/splitting is deferred;
no one-to-one uniqueness constraint is approved. Implement same-Plan Reviews first.
Percentage defaults are deliberately provisional, not a blocker.

Technical delivery dependencies (not unresolved financial policy): hosted OIDC/MCP
registration, provider credentials, public endpoint and compatibility verification.
No new service/cost is authorized implicitly. Concrete code/schema choices above are selected and testable; remaining
columns are added with the corresponding command slice. Dedicated restoration and
opening-history reconstruction remain out of v1 scope. Provider compatibility
blocks release of browser/MCP access, not implementation of pure domain rules.
The browser increment has no unresolved financial-policy blocker.

### MVP-019 lifecycle implementation

Additive migration `5k019` (parent `5j018`) adds separate `completed` and
`archived_by_account` goal flags. The latter records an active goal's prior state
when its account retires; previously inactive/completed goals do not acquire it.
Reopen clears the provenance and reactivates only those goals. Unallocated's
protected definition permits inactivity only while archived with its account.
Existing identities, openings, activity, audits and saved versions are preserved;
a populated-base migration fixture compares all old fields before/after upgrade.

Completion, account archive/reopen, activity and corrections share the existing
Entity row lock and transaction with audit and retry outcomes. Pure completion,
zero-archive and restoration rules live in `domains/savings.py`. Completion uses
an explicit financial date and displayed expected remainder; a changed remainder
rejects before writing. A positive return creates one existing reassignment row,
marked with `completion_goal_id`; its independent edit/delete is blocked in service
and database to preserve the atomic completion result. Full ordered history replay
validates proposed completion and later refund/return corrections. Zero completion
writes lifecycle/audit only. Later linked refunds restore money to the completed
goal without reactivation or automatic transfer. Only explicit same-account return
to Unallocated is permitted as a new movement from that completed goal.

PostgreSQL checks cover zero/positive completion, audit-failure rollback, retry,
retirement/reopen provenance, original archived origin correction, saved Plan
preservation, and independent-key archive/activity and completion/refund-edit
races. The latter reduces an existing refund while completion returns its money;
only a valid serial outcome may commit. Fresh refund creation after completion
remains allowed and is covered separately. A synthetic production browser journey
records a purchase, completes its goal, records its refund, explicitly returns it,
uses remaining Unallocated money, archives and reopens the same account.

### MVP-020 monthly comparison implementation

`domains/monthly_comparison.py` compares stable identities against the selected
saved version, retaining unknown expected items and once-only unplanned subtotals.
`services/monthly_comparison.py` adapts immutable Plan labels/results and current
entry snapshots. `read_review` retains the Entity lock across all queries,
including funding links and contributors, so competing writes cannot produce a
mixed response. No schema change or financial write is introduced by these reads.
Known totals retain the existing explicit saving-goal, stale-contributor and atomic
write/audit rules. Saved monetary results are never recalculated for presentation.

Net saving requires known new saving and no missing expected outflow identities;
recorded savings-use subtotals remain disclosed separately with incompleteness.
Planned income/total-funding formulas and actual same-month income formulas expose
components and suppress unknown/zero bases. Defaults remain provisional. Existing
checkpoint canonical IDs/revisions already include all categories and are retained
for compatibility: no upgrade invalidates old annotations, and another month's
refund cannot mark this month changed merely by reducing remaining refundable.

### MVP-022 local MCP resource contract

The user accepted a bounded four-tool scope and JWT plus uncached introspection;
[the explicit contract](../technical/mcp-contract-proposal.md) owns the fields.
Standalone FastMCP4.1.0 supplies Streamable HTTP/resource metadata. A separate ASGI
factory calls the same monthly/account services; no API-wide export or auth server.
The only write starts a monthly Review using a saved version and request identity.
It retains existing Entity locking, scoped saved-version validation, audit and
retry outcome transaction. Planning and Review selection do not move money.
Financial meanings/rules are unchanged; no cross-Plan matching is inferred.

OAuth actors use a narrow verification callback at the existing access boundary.
The service revalidates signed identity/current active status and resolves the
provisioned exact issuer/subject, then checks current Entity ownership, including
before replay. Another check follows Entity lock acquisition so wait-time
revocation denies the operation. Existing actor/interface audit fields suffice:
MCP writes retain User and `interface=mcp`, with API/session UUIDs null. No tokens
persist, historical audit remains append-only and no migration/reset is needed.

Verification adds signed local provider cases, metadata/challenge protocol checks,
API/MCP projection parity, unknown actuals, explicit data exclusions, retry conflict,
foreign Entity/version atomic rejection, access loss, provider revocation and a
sampled revocation-during-lock-wait schedule. Existing financial/browser suites
remain regression evidence. External revocation cannot be made atomic with the
local DB commit; a change after the last successful introspection can race an
in-flight operation. Current provider availability is required; calls fail closed.
No local result establishes real-provider admission or ChatGPT/Claude hosted support.
