# Accanto product direction

Updated 2026-10-16. Accanto helps an Entity plan its money, record activity and
review a month without confusing intentions, receipts, contributions and balances.
[CONTEXT.md](../../CONTEXT.md) owns financial meanings; the
[constitution](../../CONSTITUTION.md) owns engineering obligations. The
[MVP PRD](../prd/01-mvp.md) defines scope and acceptance; the
[TDD](../tdds/01-mvp.md) specifies enforcement.

A User is the account identity. An Entity is the financial boundary. Initial
production serves one owner and one Entity; switching and sharing are deferred.
No separate Individual model, tax-return inference or person-level subtotal is
required. USD is the only currency.

## Core experience

- Create named monthly Plans with direct net-income sources, fixed costs,
  guilt-free spending, giving recipients, saving goals and investment allocations.
  Separate account-level savings funding adds to funding, never income or tithe.
  Save immutable versions and compare scenarios. Overallocation warns but does
  not block saving. Copies have independent Income source identities.
- Optionally save, edit and duplicate multi-income estimates. Annual/monthly/
  twice-monthly/weekly/daily payment assumptions subtract entered withholding
  and deductions. Manually copy results to Plans. No tax estimation or live link.
- Record dated activity independently of Reviews. Every savings dollar belongs
  to a goal in one savings account, including its mandatory Unallocated goal.
  Opening positions, transfers, reassignments and reconciliation are distinct
  from new saving. Validate savings history on every supported change.
- Record purchases once with one funding origin. Linked refunds affect their
  own month and restore the original origin. Delete erroneous records using
  soft deletion; do not erase real purchases to represent refunds.
- Review a month against one explicitly selected saved version. Unknown actuals
  stay unknown; zero is an entry. Adjustments are visible dated differences.
  A reviewed/closed annotation neither locks the month nor requires completeness.

Finite goals can be explicitly completed, returning remaining funds to their
account's Unallocated goal atomically. Ongoing goals can have no target. Savings
accounts archive at zero and reopen with lifecycle provenance preserved. Loans
have observed amounts owed, independent of payments. Investments remain tracked
without regular contributions. Giving progress is net donations, not tax eligibility.

Percentage views disclose numerator, denominator and component amounts. Plan and
actual ratios stay separate. Defaults remain provisional pending use; no generic
metric editor is needed. Shared-to-personal spending allocations (“dividends”)
are ordinary guilt-free spending, counted once.

## Delivery status

The [browser prototype](daily-workspace-prototype.html) and
[walkthrough](prototype-review.md) implement the refined interaction paths.
Legacy saved versions and label-only histories are preserved; they are not
silently converted into tracked accounts. Browser storage, backup/restore and
local audit snapshots are prototype continuity tools.

The first production increment implements create/save a Plan → record activity →
review a month for direct net income and guilt-free spending. It has Python
Decimal rules, authenticated API access, relational Postgres persistence, atomic
audit writes, retry outcomes and stale-write protection, verified separately
from the prototype. Browser sign-in/API-backed UI and remaining financial
commands are subsequent increments.
The UI must use the same application behavior as direct API access.

Advanced income matching, dedicated restoration UI, annual Plans/Reviews,
credit-card settlement, split funding, tax estimation, automated bank ingestion,
FIRE projections and AI features remain deferred. Existing household-loop and
information-architecture HTML files are historical experiments, not competing
current flows. No additional workflow interview is a prerequisite for core work.
