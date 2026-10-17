# 01 — MVP implementation tickets

Status: Implementation in progress; 001–002 complete locally, 003–004 in progress

This backlog implements the [MVP PRD](../../prd/01-mvp.md) and
[MVP TDD](../../tdds/01-mvp.md), under [CONTEXT](../../../CONTEXT.md) and the
[constitution](../../../CONSTITUTION.md). Those documents own requirements and
rules; this file owns work order, dependencies and completion evidence. Ticket
IDs are stable. Update status and link the implementing commit/PR and verification
when a ticket is completed. These are repository tickets, not published issues.

## Starting point and frontend direction

Baseline: `b20330d`. The existing backend implements the authenticated direct-API
income/spending monthly slice with relational persistence, immutable versions,
audit, retries and stale-edit checks. Extend it; do not rebuild it merely to match
a new frontend. See the TDD implementation inventory and [API guide](../../api.md).

Build the production frontend afresh in `src/accanto/web/frontend/`. Retain useful
React/Vite/TypeScript tooling and deployment integration. Replace the prototype
workspace components, navigation, local-storage model and financial calculators;
do not turn `WorkspaceApp` into an API adapter or port its domain module. Reuse
individual presentation primitives only after checking they fit the new workflow.
The prototype is an example, not a required screen layout or a source of policy.

Ticket 001 retires the prototype from the active application. Its source can be
copied to ignored `.agentic/legacy/prototype/` for local reference, using an explicit
allowlist of source/configuration files. That local copy is not a build dependency
or a durable archive. Git history at the baseline and the committed standalone
HTML remain recoverable references. Do not move or rewrite browser storage, saved
Plan versions or private exports; do not package browser data or database contents.
A clean checkout must build without `.agentic/`.

This is ticket planning only. The current frontend has not yet been moved or reset.

## Shared completion requirements

Every financial command ticket includes its pure domain rules, typed persistence
and migration, service transaction, authenticated documented API, and production
UI unless explicitly scoped as an infrastructure prerequisite. Use existing
router/service/repository boundaries; no generic rule engine or event framework.

- Enforce current Entity access on reads, writes and retries. UI and direct API
  call the same services; frontend validation is not authoritative.
- Protect rule evaluation and writes together under the TDD's locks. Commit all
  effects, full audit snapshots and retry outcome atomically. Reject stale edits;
  retain attempted input. Exercise rollback, replay and relevant races against
  real Postgres. Apply shared helpers/tests rather than duplicating every test.
- Use Decimal and API decimal strings, explicit financial dates, Entity-zone
  defaults, and immutable historical inputs/results. New migrations preserve
  existing data; never use the initial destructive downgrade for populated data.
- Include correction and soft deletion where the ticket lists them. Do not expose
  undo until a separately scoped command can revalidate every affected invariant.
- Use independent synthetic examples. Test pure rules with units, persistence
  guarantees with real-DB integration tests, and UI-specific behavior with focused
  browser journeys. No real user browser or financial data in fixtures/artifacts.
- Ship loading/error/empty distinctions, keyboard access, labeled controls,
  320–390px layouts and failed-save recovery with each screen, not in a final
  accessibility cleanup. Unsupported operations stay unavailable.
- Update API documentation and relevant design/status notes. Run appropriate
  local checks from [development](../../development.md); required CI gates merge.
  Attach evidence and known limitations. Never equate prototype tests with
  production coverage. Do not push, deploy or merge merely to close a ticket.

## Order and dependencies

Dependencies are completion prerequisites, not a requirement to work serially.
For later financial tickets, dependency 005 supplies the common API-backed UI.
Tickets 001–002 are **Complete locally**; 003–004 are **In progress**. Other
tickets are **Todo**, except 021 (**Policy blocked**) and 022 (**Provider gated**
for hosted verification). A dependency being satisfied does not mark a ticket done.

| ID | Ticket | Depends on | PRD coverage |
| --- | --- | --- | --- |
| 001 | Retire prototype and establish a fresh frontend shell | — | MVP-09 |
| 002 | Share authenticated application access across API keys and sessions | — | MVP-09 |
| 003 | Browser sign-in, session lifecycle and Entity discovery | 002 | MVP-09 |
| 004 | Frontend API transport and recoverable writes | 001, 003 | MVP-09 |
| 005 | Production income/spending Plan → activity → Review loop | 004 | MVP-01, 04, 08, 09 |
| 006 | Entity settings and user-owned API key management | 005 | MVP-09 |
| 007 | Copy Plans and compare saved scenarios | 005 | MVP-01 |
| 008 | Review notes, annotations and same-Plan retargeting | 005 | MVP-08 |
| 009 | Signed adjustments and known-total entry | 005 | MVP-04, 08 |
| 010 | Fixed-cost planning and activity | 009 | MVP-01, 04, 08 |
| 011 | Independent multi-income estimates | 005 | MVP-02 |
| 012 | Savings accounts, goals and conserved openings | 005 | MVP-03 |
| 013 | Goal-backed contributions and savings-funded spending | 009, 012 | MVP-04, 05 |
| 014 | Savings transfers, reassignments and reconciliation | 013 | MVP-05 |
| 015 | Investment/giving destinations and contributions | 009 | MVP-03, 04, 07 |
| 016 | Loan accounts, payments and balance observations | 010, 015 | MVP-03, 07 |
| 017 | Complete Plan allocations and savings funding | 007, 010, 012, 015, 016 | MVP-01, 08 |
| 018 | Savings funding across outflows and linked refunds | 013, 015, 016 | MVP-04, 06, 07 |
| 019 | Savings lifecycle, completion and returned refunds | 014, 017, 018 | MVP-06 |
| 020 | Full monthly comparison and transparent metrics | 008, 017, 018, 019 | MVP-08 |
| 021 | Resolve minimum cross-Plan Review matching | 008; policy agreement | MVP-08 |
| 022 | Hosted MCP OAuth and explicit tool contracts | 020; configured provider | MVP-09 |
| 023 | Production release evidence and operational readiness | 006–020 | MVP-01–09 |

**First usable browser milestone:** 001–005, with provider compatibility verified
before release. It deliberately exposes only the existing income/spending scope.
**Full agreed financial workflow milestone:** 006–020 and 023. It remains explicitly
limited to identity-based income comparison while 021 is blocked. Do not claim
cross-Plan matching or hosted MCP complete unless their tickets actually ship.
022 is a separate hosted-interface milestone; it does not delay direct API work.

## Tickets

### 001 — Retire prototype and establish a fresh frontend shell

**Status: Complete locally.** Integration commit `a234137` (ticket commit
`48e6741`). Frontend format/lint/build/types and focused shell test pass; backend
static/deep-link tests pass. Frozen clean-copy builds pass without `.agentic/`.
Isolated agent-browser checks prove the new shell and absence of prototype-storage
access against the baseline; keyboard and 320/390px checks pass. The standalone
HTML remains byte-identical. Independent review found no actionable findings.

**Outcome:** the active frontend is a small, new production application, with no
implicit browser-local financial workspace. No financial-domain change.

**Work:** inventory the root route, workspace source/tests/styles, prototype
packaging script and generated route tree. Preserve the committed standalone HTML
at its current path. Optionally copy only tracked prototype source/config to
`.agentic/legacy/prototype/`, with baseline SHA and run instructions. Remove the
prototype from active imports/test discovery and remove or redirect its packaging
command so it cannot overwrite the preserved HTML with the new application.
Create the minimal accessible shell and explicit not-yet-connected state. Update
README/development instructions to distinguish new app and legacy reference.

**Acceptance / evidence:** clean-checkout frontend build, lint/types and focused
shell test pass without `.agentic/`; backend deep-link/static serving still works.
The new app never reads, writes or clears the prototype storage key. Archive
inventory contains code/assets only, excluding dependencies, `.env`, reports,
exports and local data. Preserve the standalone file byte-for-byte; document that
moving origins/files can affect access to browser-local data. Do not manufacture
an import/migration feature or copy financial state into the new app.

### 002 — Share authenticated application access across API keys and sessions

**Status: Complete locally.** Integration commit `54820ac` (ticket commit
`c9f7ac8`). Backend gates and four real-Postgres tests pass, including populated
schema preservation, current authorization, cross-credential retries, rollback,
foreign-resource denial and deterministic logout/command serialization. Independent
review coverage findings were resolved. Frozen semantic-mutation checks detect
removed ownership, expiry and session-lock enforcement. These prove the named
conditions; they do not claim hosted provider compatibility.

**Outcome:** existing monthly services accept an explicit authenticated actor
without duplicating financial commands or trusting an adapter-supplied User ID.

**Work:** separate credential resolution from shared Entity authorization; retain
transactional revalidation and credential-before-Entity locking. Add session
persistence and nullable API-key audit attribution with a non-secret session
reference. Keep existing API-key response/replay behavior compatible.

**Acceptance / evidence:** migration preserves existing keys, audit and saved
versions without invented historical session values. Real-DB tests cover key and
session actors, access loss before replay, revoked credentials, cross-Entity
references, audit failure rollback and retries across credentials of one User.
No browser UI or hosted provider needed to establish these guarantees.

### 003 — Browser sign-in, session lifecycle and Entity discovery

**Outcome:** an admitted, operator-provisioned User can sign in, discover their
Entity and sign out without putting a long-lived API key in the browser.

**Work:** implement the TDD OIDC/session protocol, exact issuer/subject binding,
verified allowlisted email admission, 12-hour session expiry, CSRF/Origin checks,
logout and authenticated User/Entity metadata. Choose a maintained OIDC library
at implementation time; record provider setup without committing credentials.

**Acceptance / evidence:** invalid state/nonce, unverified or unadmitted identity,
unknown identity, ambiguous cookie/Bearer credentials and forged writes reject.
Matching email never merges accounts. Expiry/logout invalidate requests; existing
Entity identity and records remain unchanged. Provider-independent auth tests run
locally; actual provider compatibility is opt-in and required before browser
release. No public self-registration, sharing or automatic Entity creation.

### 004 — Frontend API transport and recoverable writes

**Outcome:** new screens can load authoritative data and recover from uncertain
writes without losing input or duplicating activity.

**Work:** extend the existing fetch entry point with typed UUID/decimal-string
contracts, credentials/CSRF support, normalized errors and stable per-operation
request identities. Keep pending input/payload/key in memory; handle session
expiry through the TDD separate-window reauthentication flow and verify the same
User before retry. Keep infrastructure limited to actual monthly commands.

**Acceptance / evidence:** focused transport/browser tests distinguish empty,
loading, unavailable, unauthenticated and conflict states. Lost response retries
the same payload/key; stale conflicts preserve input and require reconciliation.
Failed/cancelled reauthentication and blocked popups preserve pending input;
changed User cannot receive or submit it. Logout clears financial state. Navigation
warns about unsaved input; no claim that memory survives closing/reloading a tab.
No financial localStorage fallback, optimistic confirmed-save message or JS money
calculation becomes authoritative.

### 005 — Production income/spending Plan → activity → Review loop

**Outcome:** first complete new browser journey using the committed backend slice.
Design fresh screens for these tasks; do not inherit the prototype navigation.

**Work:** create/edit/save/read net-income and spending Plans; record/list/correct/
soft-delete income and spending independently of Reviews; start/read a monthly
Review with explicit saved-version selection and prior-calendar-month preselection.
Keep source UUIDs stable during draft edits. Use backend results and Entity-zone
date defaults. Unsupported categories, refunds and adjustments remain unavailable.

**Acceptance / evidence:** synthetic $4,000 income/$800 spending Plan, $4,000 receipt
and $75 spending produce Review differences $0 and -$725. Missing sources stay
unknown; explicit zero resolves the selected source only. Save an overallocated
Plan with a visible warning. New versions never retarget a Review. November
preselects October's comparison even after a newer version; no preceding Review
requires explicit choice. Reload, correction/deletion, keyboard/mobile and failed
save/retry work against real API/Postgres. Browser creation adds no duplicate
activity and shares the same audit behavior as direct API commands.

### 006 — Entity settings and user-owned API key management

**Outcome:** the admitted owner manages Entity name/time zone and script access.

**Acceptance / evidence:** authenticated settings edits use revisions, audit and
retry protection. Validate an IANA zone; changing it affects defaults without
moving financial dates or Reviews. Keys can be issued, listed by non-secret
metadata and individually revoked; secrets appear only at creation and only hashes
are stored. Existing API callers keep current-access enforcement. Test timezone
boundary instants, stale settings, foreign-user key denial and revocation through
the API; browser checks cover one-time secret handling without recordings/logs.

### 007 — Copy Plans and compare saved scenarios

**Outcome:** independently edit copied intentions and compare immutable versions.

**Acceptance / evidence:** copy creates fresh Plan/Income source identities while
preserving applicable shared fixed-cost/destination identities as those lines are
introduced. Copy/edit/save never changes the original or retargets its Reviews.
Comparison uses stored inputs/results, including older calculation versions; it
never recomputes history under new rules. Pure/service and DB tests verify copied
relationships and atomic snapshots; a focused browser journey compares scenarios.

### 008 — Review notes, annotations and same-Plan retargeting

**Outcome:** a month can be annotated and deliberately compared with another saved
version of the same Plan while activity stays editable.

**Acceptance / evidence:** set/clear reviewed with unknowns and optional notes;
no acknowledgment or posting lock. Later relevant changes show a fingerprint
mismatch without clearing the annotation. Same-Plan retarget retains source
identity, creates no receipt and changes no other Review. Expected revision,
audit/retry and concurrent edits are covered by DB tests. Cross-Plan matching
controls remain unavailable pending 021; do not infer matches from names.

### 009 — Signed adjustments and known-total entry

**Outcome:** correct recorded income/spending totals through explicit dated deltas.

**Work:** add the adjustment discriminator and signed command validation without
relaxing ordinary receipt rules. Compute known-total differences in the backend
under the Entity lock against the caller's contributing-entry fingerprint. Add
edit/delete and visible adjustment history; extend the same behavior with later
categories rather than a generic rules engine.

**Acceptance / evidence:** $210 → $250 creates +$40; deletion restores $210; later
$40 detail yields $290. Zero with no entries is explicit zero; a category adjustment
does not resolve unknown expected sources. A changed fingerprint rejects without
writes. Unit examples plus DB races/rollback prove the behavior; UI preserves the
attempted total on conflict. No refund or withdrawal is disguised as an adjustment.

### 010 — Fixed-cost planning and activity

**Outcome:** Plan and Review distinguish recurring intentions from dated payments.

**Acceptance / evidence:** named stable fixed costs accept monthly/annual inputs;
three annual $100 lines produce $8.33 each and $24.99 monthly while retaining
$300 annual inputs. Add current-income-funded payment create/edit/delete and signed
adjustments, optional fixed-cost assignment, unknown-item completeness and unplanned
activity. Preserve shared fixed-cost identity on Plan copies and immutable labels/
results. Unit rounding/rollup tests, migration/snapshot integration tests and a
focused annual-cost-versus-dated-payment UI journey pass. Refunds await 018.

### 011 — Independent multi-income estimates

**Outcome:** create, reopen, edit and duplicate named assumption scenarios.

**Acceptance / evidence:** annual/monthly/twice-monthly/weekly/daily frequencies use
1/12/24/52/explicit paid days. Entered withholding/payroll deductions are per payment;
round monthly lines then sum. Synthetic net lines $4,500 and $3,000 total $7,500.
Duplicate creates independent IDs/inputs; edits commit with audit and stale-write
protection, not immutable estimate versions. No tax calculation, Plan relationship
or automatic application; handoff is manual copy/paste. Unit calculations, DB
save/duplicate isolation and one browser reopen/edit journey establish coverage.

### 012 — Savings accounts, goals and conserved openings

**Outcome:** establish recorded savings without inventing contributions.

**Acceptance / evidence:** create account, protected ongoing Unallocated goal and
opening designations atomically. $10,000 = $5,000 + $1,000 + $4,000 once; excess
rejects. Finite goals require positive targets; ongoing targets may be absent.
Goal account association cannot relocate history. New goal/edit/inactivation rules
preserve identity and saved references; Unallocated has no independent lifecycle.
Setup corrections before activity must preserve conservation; once any activity
exists (including deleted history), opening date/amount cannot be rewritten.
Unit rules and real-DB existence/uniqueness/conservation/rollback tests pass;
new screens distinguish opening, funded status and contribution progress.

### 013 — Goal-backed contributions and savings-funded spending

**Outcome:** recorded savings can fund a purchase through one goal-backed origin.

**Work:** implement pure ordered-history validation, stable cross-record recording
order and goal relationships. Add saving contribution/adjustment create/edit/delete,
and savings origin on spending. Validate original and proposed references and every
later affected balance in the same Entity transaction.

**Acceptance / evidence:** $800 cannot fund $1,000; first record $200 saving, then
spend $1,000 on the same date to leave zero. Both entries remain independent;
month shows $200 saving and $1,000 spending, not $1,200 spending. Saving adjustments
require a goal even for zero. Earlier-than-opening rejects; edits retain recording
order. Deleting required funding rejects with goal/date/shortfall. Two competing
$600 outflows against $800 cannot both succeed (real DB); unit history examples
and a browser purchase/failure journey pass. No split origins or negative savings.

### 014 — Savings transfers, reassignments and reconciliation

**Outcome:** move or correct existing savings without recording new saving.

**Acceptance / evidence:** same-account reassignment and different-account transfer
use one movement with equal effects and explicit endpoint goals. Create/edit/delete
revalidates both old/new endpoints and later history; preserve order on edits.
September $100 cannot fund a September $200 transfer using October funding.
Reconcile one $5,200 goal to $5,000 with -$200, without changing opening, other
goals or contribution totals. No account-wide reconciliation or silent redistribution.
Pure conservation/history checks and real-DB races/rollback show both effects and
audit succeed together. UI exposes correction and actionable rejection details.

### 015 — Investment/giving destinations and contributions

**Outcome:** track contribution progress separately from balances and tax meaning.

**Acceptance / evidence:** create/edit/inactivate/reactivate destinations with optional
positive cumulative targets. Contributions and signed adjustments support named or
Unassigned investment/giving, correction and soft deletion. Inactive destinations
reject new contributions but permit existing-entry corrections. New investment
contributions are nonnegative; giving refunds await 018. Progress is cumulative
contributions/net donations, never market value or inferred tax eligibility.
Stopping regular contributions requires no investment status change. Unit rollups,
DB relationships/lifecycle checks and browser target/history views pass. Savings
funding arrives in 018; observed investment values arrive in 016.

### 016 — Loan accounts, payments and balance observations

**Outcome:** track loan obligations and investment values independently of activity.

**Acceptance / evidence:** investment/loan setup records protected dated openings;
loan payments are one fixed-cost outflow with a debt association. Observations
support create/correct/delete, optional unassigned investment values, and current
account/date uniqueness excluding the protected opening. An opening $300 loan and
independently observed $0 on the same day coexist; $0 is latest and permits archival.
A payment alone cannot permit it. Debt archive/reopen preserves history and blocks
new payments while archived. Account-linked dates respect openings; changing zones
never shifts them. Unit latest-value selection, DB duplicate races/audit/rollback
and a browser payoff journey pass. No principal/interest inference or credit cards.

### 017 — Complete Plan allocations and savings funding

**Outcome:** full monthly intentions retain independently editable scenarios.

**Acceptance / evidence:** add saving-goal, investment and giving lines, loan-linked
fixed costs, account-level planned savings funding and category rollups to draft,
copy, save and comparison. $4,000 income + $1,000 savings funding gives $5,000 funding
and $400 tithe; giving allocation may differ from the target. $5,300 allocation
saves with a $300 warning. A $50 shortfall never carries forward automatically.
Planning reserves/moves no money. Inactive/completed references remain visible for
explicit draft revision; saved versions and historical labels/results remain intact.
Test insert/update/delete rejection on every saved line table, additive migrations,
copy identities and independent calculations. Extend Review expected-line inputs
without fabricating zeros for legacy versions that never supported those categories.

### 018 — Savings funding across outflows and linked refunds

**Outcome:** fixed costs, debt payments, giving and investing can use saved money;
real refunds remain linked to their original eligible payment.

**Acceptance / evidence:** one entry supplies category, destination/debt and savings
effects, counted once. Savings-funded investment is contribution progress, not new
saving from income. Refunds support create/edit/delete; original category, destination,
debt association and origin remain consistent. $1,000 October purchase + $300 November
refund retains October $1,000 and November -$300; further $700 allowed, $701 rejected.
Refund date precedes no purchase; purchase edits cannot violate cap/date/origin and
purchase deletion blocks with current refunds. No cascade or silent truncation.
Pure refund/history sets and real-DB racing refunds/purchase edits establish limits;
failed writes leave all effects/audit unchanged. Browser records from the purchase.

### 019 — Savings lifecycle, completion and returned refunds

**Outcome:** finish finite goals and retire/reopen accounts without moving money
implicitly or losing prior lifecycle state.

**Acceptance / evidence:** completion returns any remainder to the same account's
Unallocated goal and archives atomically; zero remainder creates no movement.
Completed goals accept linked refunds and explicit return of that money to
Unallocated, but no new ordinary contributions. Account archival requires zero,
archives goals together, and reopening restores only goals archived by that action.
Previously completed/independently inactive goals stay so. Archived accounts must
reopen before correction even when changing the old origin to another account.
Saved Plans stay unchanged and drafts flag references. Unit lifecycle/history tests,
real-DB archive/activity and completion/refund races, and one browser lifecycle
journey pass. No dedicated restoration UI or automatic balancing transfers.

### 020 — Full monthly comparison and transparent metrics

**Outcome:** explain recorded monthly results across all delivered categories.

**Acceptance / evidence:** compare expected source/fixed-cost/destination identities
against the selected immutable version; retain unknowns and incomplete subtotals,
include unplanned activity once, and expose contributing entries/adjustments.
Saving known-total entry explicitly selects the affected goal. Reuse annotation
and fingerprint behavior across the expanded activity surface. Show formulas and
amounts for planned and actual ratios separately; unknown/incomplete or zero
required denominators yield unavailable. $500 new saving less $1,000 savings used
is -$500 net saving; $2,000 savings-funded investment is $2,000 total and $0
income-funded contributions. Observations/transfers never enter activity totals.
Unit independent examples, coherent-read integration tests and a full-month browser
journey pass. No generic metrics builder or implicit cross-Plan matching.

### 021 — Resolve minimum cross-Plan Review matching

**Status: Policy blocked; deliberate follow-up, not a prerequisite for same-Plan work.**

**Outcome:** decide and document minimum matching cardinality and what happens to
matches on subsequent retargeting before designing matching commands/schema.
Use a concrete receipt/source example when this workflow becomes the next increment.

**Acceptance:** update CONTEXT/PRD/TDD with explicit decisions and rejection cases,
then create bounded implementation tickets. Preserve receipts, Entity totals and
other Reviews; matching remains Review-local and never name-inferred. This ticket
is design only and closing it does not deliver matching. Advanced combination/
splitting stays deferred; no proposed one-to-one constraint counts as approval.

### 022 — Hosted MCP OAuth and explicit tool contracts

**Status: Provider gated; separate from direct API/browser implementation.**

**Outcome:** expose agreed commands through an authenticated MCP resource server
using the same application services and current Entity authorization.

**Acceptance / evidence:** finalize explicit tool input/output/data scope before
exposing financial data. Verify OAuth resource metadata and issuer/audience/
algorithm/expiry behavior, Entity denial, replay and credential loss. Integration
tests cover service parity; opt-in synthetic hosted checks establish intended
ChatGPT/Claude compatibility before claiming support. No authorization server,
AI feature, generic provider framework or unapproved service cost. Provider setup
is required for hosted completion, not for testing pure domain rules.

### 023 — Production release evidence and operational readiness

**Outcome:** assess the accumulated increments as a usable, deployable application.
This ticket closes cross-cutting evidence gaps; it does not postpone earlier tests.

**Acceptance / evidence:** required CI and targeted real-DB/browser checks pass;
record a PRD-to-evidence matrix and outstanding exclusions including 021/022.
Verify fresh installation and upgrades preserve synthetic existing Plans, audit,
keys and activity; restricted runtime grants protect audit and saved rows.
Confirm container/deep links/health checks, no financial/credential telemetry,
actual OIDC compatibility, and keyboard/mobile error recovery across the full loop.
Document configured provider backup/recovery windows, compatible rollback and
credential revocation handling after recovery; never reset a populated database.
Keep browser records/exports out of build artifacts. Prepare deployment instructions
for the agreed hosting direction; deployment, new service costs and publication
are separate authorized actions. Custom recovery drills remain deferred.

## Deferred scope

No tickets here implement annual Plans/Reviews, tax liability, automated bank
feeds/payments, split funding, credit-card settlement, independent withdrawals,
opening-history reconstruction, dedicated trash/restore, FIRE, AI, multiple-Entity
UI or sharing. Immediate undo is optional and absent until explicitly implemented
with the same domain checks. Prototype whole-workspace export/import/reset is not
a production requirement. Percentage defaults remain provisional; timings from
the prototype walkthrough are not acceptance gates.
