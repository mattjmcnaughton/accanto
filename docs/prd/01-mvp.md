# 01 — Accanto MVP

Status: Agreed workflow baseline; production implementation incremental
Updated: 2026-10-16

## Purpose and authority

Make the monthly loop usable: create/save a Plan, record activity, review a month.
[CONTEXT.md](../../CONTEXT.md) defines meanings and financial policies;
[the constitution](../../CONSTITUTION.md) defines engineering obligations.
This PRD reconciles the completed workflow interview, superseding contradictory
prototype experiments. [The TDD](../tdds/01-mvp.md) owns implementation choices.

The actor is the person using Accanto. User is the identity; Entity is the
financial workspace. Planning, recording and reviewing are not permission roles.
Initial scope is one owner, one Entity and USD. All financial references stay
within that Entity. Starts empty; test/demo fixtures never populate ordinary work.

## Agreed requirements and acceptance

### MVP-01 — Monthly Plans and immutable versions

Multiple named Plans have editable drafts and immutable versions capturing all
inputs, labels, assumptions and calculation results. Direct monthly net amounts
are entered for each Plan-owned Income source. Source identities persist within
a Plan; copies receive new source identities, while fixed-cost identities retain
their existing shared behavior. No name-based identity inference.

Fixed costs accept monthly or annual inputs, with cent-valued monthly lines.
Saving, investing and giving totals sum destination lines. Saving allocations
reference goals including an account's Unallocated goal. Guilt-free spending
includes personal spending allocations (“dividends”) as ordinary spending.

Planned use of savings consists of account-and-amount lines. It creates no
receipt, reservation, transfer or savings use. Independent scenarios do not
reserve savings against each other. Tithe is 10% of planned net income; recipient
allocations can differ. Unassigned is total funding less all allocations.

Acceptance:

- $4,000 net salary + $1,000 other net income = $5,000 planned income.
- $4,000 income + $1,000 savings funding = $5,000 funding and a $400 tithe target.
- $5,300 allocated against $5,000 funding saves with a $300 overallocation warning.
- Three annual $100 cost lines produce $8.33 each and $24.99 monthly fixed costs;
  annual inputs remain $300. Saved results do not change after rule changes.
- Saving v2 does not alter v1 or retarget any Review. Copying a scenario does not
  share its Income source identities with its original.
- An October $50 allocation shortfall does not add $50 to November automatically.
- Archived/completed references in drafts are flagged for explicit revision;
  amounts are not removed, redirected or rewritten in saved versions.

### MVP-02 — Independent income estimates

Multiple named, editable saved scenarios each contain multiple income lines.
Each line has gross per payment, entered withholding and payroll deductions,
frequency and explicit paid days for daily income. Frequencies annualize to 1,
12, 24, 52 or entered paid days, then smooth monthly. Twice a month is not biweekly.
Tax estimation is deferred. Preserve inputs and show line and combined results.
Duplicate creates an independent scenario and lines. Save changes with audit
history, not immutable estimate versions. Manual copy/paste is the only handoff
to Plans; no Use in Plan, mapping, linking or synchronization.

Acceptance: monthly $6,000 − $1,200 − $300 and $4,000 − $800 − $200 yield $4,500,
$3,000 and $7,500 combined. Saving/reopening retains inputs. Editing a duplicate
changes neither its original nor any Plan or receipt.

### MVP-03 — Accounts, goals and opening positions

Savings, investments and loan debt have dated start-of-day opening positions.
Opening money is not income, spending or contribution progress. Account-linked
activity before opening rejects; same-day activity follows opening. Once activity
exists the opening boundary is fixed. Reopening does not reset it.

Each savings account has exactly one mandatory ongoing Unallocated goal, identified
by role rather than name, with no target and no independent lifecycle. Every goal
belongs to one account. Opening designations sum exactly to the account opening;
account totals sum goals once. No default account or inferred legacy-label account.
Finite goals require positive targets; ongoing goals have optional positive targets.
Funded is remaining saved meeting target, not lifetime contributions or completion.

Acceptance: $10,000 opening designated $5,000 Emergency, $1,000 Laptop and $4,000
Unallocated remains $10,000 total and creates no saving actual. An ongoing Home
repair goal with no target shows its remaining amount without a target percentage.

### MVP-04 — Activity and funding origins

Record dated income, fixed costs, spending, saving, investing and giving before
or after Review creation. Income/fixed costs and investment/giving activity may
be Unassigned; saving entries, including all signed/zero adjustments, require an
explicit goal. Every outflow uses current income or exactly one savings goal;
that goal determines its account. Existing savings moved to another saving goal
uses reassignment/transfer, not a new saving contribution.

Correct amounts, dates, associations and notes through the same domain rules.
Loan payments are fixed costs with a debt account association, counted once.
Ordinary income and saving/investment contributions are nonnegative. Signed
adjustments correct recorded totals; they are not withdrawals or replacements.

Acceptance: Laptop with $800 cannot fund a $1,000 purchase. Record a $200
income-funded contribution first, then the $1,000 purchase. Result: $200 new
saving, $1,000 spending, $1,000 savings used, $0 remaining. The contribution
stands independently if the purchase never happens. Savings-funded investment
contributions enter destination progress but are not new saving from income.

### MVP-05 — Savings movements and historical validation

Reassign between distinct goals in one account; transfer between goals in different
accounts. One dated movement has equal effects at both endpoints and creates no
income, spending, saving or investment contribution. Reconciliation instead applies
one signed correction to a selected goal. There is no account-total reconciliation
or automatic redistribution. Preserve original openings and earlier balances.

Validate financial date then stable recording order, with opening first. Preserve
order on edits. Account/goal balances must remain nonnegative at every affected
historical point, including later activity. Creation, correction, deletion and
any supported restoration share this rule. Both effects and audit commit together.

Acceptance: September $100 cannot fund a September $200 transfer using an October
$400 contribution. Deleting a transfer that funded a later purchase rejects with
the affected goal, date and shortfall. Reconciling $5,200 to $5,000 records -$200
without changing contribution totals, opening or other goals.

### MVP-06 — Refunds, deletion and lifecycle

A real refund is a linked negative payment on/after the original purchase date,
retaining its original category/destination and funding origin. The non-deleted
refund sum cannot exceed the purchase amount. Apply the cap on refund edits and
purchase reductions too. Block purchase-origin changes and purchase deletion while
non-deleted refunds exist; delete refunds explicitly first, validating each action.
Soft deletion retains records/relationships and removes effects without compensating
activity. Undo, where offered, validates again. Dedicated trash/restore is deferred.

Finite goal completion returns its positive remaining amount to that account's
Unallocated goal and archives it atomically. Completed goals accept linked refunds
without reactivation; explicitly reassign returned money to Unallocated. New
contributions stay blocked. Independently inactive destinations allow corrections.

Savings archival requires zero recorded balance, archives its goals together,
and creates no financial activity. Reopen restores only goals made inactive by
that archival. Archived accounts must reopen before activity/refunds/corrections.
Preserve identities, openings, prior completed/inactive goals and Plan history.

Acceptance: $1,000 October purchase + $300 November refund leaves October $1,000
and November -$300, with no new income. Another $700 refund is allowed; $701
rejects. A completed Laptop receiving $200 stays completed; reassignment to
Unallocated conserves account savings. A nonzero savings account cannot archive.

### MVP-07 — Investments, giving and debt observations

Investments and giving are peers of saving goals, with optional cumulative
contribution targets. Investment progress is contributions, never market value;
giving progress is net donations, never inferred tax eligibility. No regular/
irregular or funding-paused investment status. Loans track observed amount owed
separately from payment history. Latest observations show dates, not live balances.

One current investment/debt observation per account/date; correct it explicitly,
never silently overwrite duplicates. Opening observations retain protection.
Debt archival requires latest recorded amount owed of zero, not a final payment.

Acceptance: $25,000 investment opening + $1,000 contributed gives $1,000 progress;
current market value is not inferred as $26,000. A $10,000 loan and $300 payment
need a separate observation to report $9,750 owed. Correcting $50,000 to $50,200
leaves one current observation and an audit snapshot, without activity.

### MVP-08 — Monthly Review and explicit metrics

At most one Review per Entity/month, linked to exactly one saved version. Starting
one uses existing activity without copying it. Visibly preselect the immediately
previous calendar month's comparison; otherwise require explicit selection.
Retargeting never modifies receipts or other Reviews. Same-Plan identity matches
remain stable. Cross-Plan matching is explicit and Review-local; advanced matching
is deferred and minimum cardinality remains unresolved, not implicitly one-to-one.

Unknown expected items remain unknown. Display recorded subtotals as incomplete
and withhold differences until expected items have entries, including explicit
zero. Unplanned activity remains included once. Known totals create visible dated
delta adjustments. Saving-category adjustments require explicit goal attribution.
Review annotations are freely set/cleared with optional notes, no mandatory
acknowledgment, completeness check or posting lock. Later-change indicators are
informational and do not clear annotations.

Every percentage names planned/actual basis, numerator, denominator and component
amounts. Required unknown/incomplete values or a zero denominator mean unavailable.
Defaults remain provisional; compare fixed costs against income or disclosed broader
funding, new versus net saving, all versus income-funded investment contributions.
No generic metric builder is required.

Acceptance: $210 spending adjusted to $250 creates +$40; deletion returns $210;
later $40 detail gives $290 until explicitly corrected. $500 new saving less
$1,000 savings used is -$500 net saving. $2,000 savings-funded investment is
$2,000 total contributions and $0 from current income. Reviewed months remain editable.

### MVP-09 — Dependable production operation

Core commands must have documented authenticated APIs, used by the production UI
and direct callers. Current Entity access applies to every request and retry.
API keys are individually revocable, shown once, stored only hashed. Browser login
and hosted MCP follow the TDD's session/OAuth direction.

Backend rules are authoritative, independent of HTTP/persistence. Use Decimal,
decimal-string API money, UTC timestamps and date-only financial dates. Every saved
financial change commits with complete append-only audit snapshots. Stale edits
reject atomically. Same request identity/input returns the committed outcome;
different input conflicts. Failed loads/saves never appear as empty/successful data.
Preserve attempted input. No financial values, notes or credentials in telemetry.

Keyboard and 320–390px mobile operation, accessible labels/dialogs, reload durability
and clear error recovery are required. Production recovery uses the TDD's provider
baseline; prototype whole-workspace import/reset is not production scope.

## Implemented prototype versus production delivery

The React prototype and standalone HTML implement direct net Plans, independent
estimates, account funding, goal-backed savings, movements/reconciliation, linked
refunds, soft deletion/validated undo, lifecycle, observations and monthly Reviews.
Legacy versions and legacy label-only data remain preserved. Local snapshots and
tab conflict checks do not establish database audit immutability or concurrency.

The first production increment implements schema/migrations, pure Python money
and monthly rules, authenticated direct APIs, and real Postgres write-safety
tests for an income/spending Plan → activity → Review slice. It includes saved
versions, corrections, soft deletion, audit, retries and stale-write protection.
API-backed UI/browser sign-in and remaining financial commands are still required.
The partial command coverage is not the completed MVP.
No mandatory migration of prototype data into production is assumed.

## Intentional deferrals and unresolved policy

Deferred: annual Plans/Reviews/rollups; tax liability and deduction engines; split
funding; credit-card settlement; bank ingestion/payment execution; automated bank
reconciliation; investment performance/FIRE; multiple-Entity UI/sharing; AI features;
advanced income matching; dedicated restoration UI; lump-sum spread helpers.

Only cross-Plan income matching cardinality and later retarget behavior remain
unresolved financial policy for that implementation. They do not block a Review
against its original Plan. Percentage defaults remain provisional by agreement.
Technical retention, locking, transport and precision choices are settled in the
TDD rather than reopening the interview. Further product policy questions should
arise only from a concrete blocked command.

## Verification

Use independently worked examples above at the cheapest sufficient layer:
financial rule unit tests, real Postgres constraints/rollback/concurrency tests,
and browser journeys for interactions. Prototype evidence: 30 unit tests and four
browser journeys, build/typecheck and desktop/mobile inspection. These establish
prototype behavior, not production authentication, durable audit or hosted-provider
compatibility. Production progress and remaining checks belong in its implementation
plan and diary.
