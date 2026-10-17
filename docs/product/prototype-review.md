# Daily workspace prototype

Updated 2026-10-16. The financial meanings are agreed in [CONTEXT.md](../../CONTEXT.md).
This browser-local implementation evaluates interactions; it is not production
financial authority, authenticated access, or database durability.

## Open and preserve work

Run `just dev-fe`, or open [the standalone HTML](daily-workspace-prototype.html).
Regenerate it with `pnpm --dir src/accanto/web/frontend prototype`.
The workspace starts empty. Settings exports/restores browser data. Origins have
separate storage. An unreadable load is reported and blocks writes; export the
untouched stored data before recovery. Legacy Replacement-total backups remain
blocked pending explicit conversion to activity, rather than silently losing totals.

Saved versions retain their original inputs and stored calculations, including
legacy salary, tax, override and lump-sum fields. A legacy draft requires an
explicit conversion before saving new net-income versions. Inspect and enter
per-source net amounts and generic savings funding yourself, especially where a
legacy total override cannot be attributed to individual sources. Historical
account labels and goal activity are retained as legacy data; they do not become
funded accounts automatically. Create tracked accounts with deliberately chosen
starting positions. Historical HTML experiments remain references only.

## Complete journeys

1. **Plans → Income estimates:** add two monthly salaries: $6,000 gross less
   $1,200 withholding and $300 payroll deductions; $4,000 less $800 and $200.
   The combined net estimate is $7,500. Save, reopen, duplicate and change one
   scenario. Manually copy the desired amount into a Plan. No tax calculation,
   automatic application or estimate-to-Plan relationship exists.
2. **Goals → Open a savings account:** open Savings at $800 on October 1.
   Its protected ongoing Unallocated goal holds $800. Create a finite Laptop
   goal in that account with a $1,000 target. Use **Transfer, reassign or reconcile
   savings** to reassign $800 from Unallocated to Laptop. Account savings stays
   $800; there is no contribution or income.
3. **Plans:** enter $4,000 monthly net salary and $1,000 planned use of Savings.
   Total funding is $5,000; the tithe target is $400. Add annual/monthly fixed
   costs and destination allocations. Save even if overallocated. The provisional
   percentage formulas disclose their component amounts. Save another version;
   the first remains unchanged. A copied scenario gets new Income source IDs.
4. **Activity:** try an October 16 $1,000 Laptop purchase funded from Laptop.
   The $200 shortfall is rejected. Record a $200 income-funded saving contribution
   first, then the purchase on the same date. Laptop ends at $0. The month records
   $200 new saving, $1,000 spending and $1,000 savings used, without new income.
   Editing dates or deleting the funding cannot leave later balances negative.
5. **Refund:** open the purchase and select Record refund. Enter -$200 and
   November 1. October spending remains $1,000; November contains -$200 and
   Laptop receives $200. The original origin is retained. Excess/early refunds,
   purchase-origin changes while refunds exist, and deleting a purchase before
   its refunds are rejected. Deleting a mistaken entry uses soft deletion; undo
   revalidates the history.
6. **Goal lifecycle:** complete Laptop, reviewing its return to Unallocated.
   A later linked refund may restore funds to that completed goal; use an
   explicit reassignment to Unallocated. New contributions remain blocked.
   Transfer all remaining savings to another account before archival. Reopen
   restores only goals active when that account was archived.
7. **Reconciliation:** select one goal and enter a signed dated correction.
   Reconcile $5,200 to $5,000 with -$200. Opening and contributions stay intact;
   the adjustment affects neither income nor saving actuals. There is no
   physical-bank-account reconciliation or automatic distribution.
8. **Investments and loans:** Goals also offers opening positions for investments
   and loans. Record subsequent observations separately. A $300 loan payment is
   one fixed-cost entry linked to the loan; it does not reduce observed principal.
   Record $0 owed before archiving the loan. Duplicate account/date observations
   reject; correct the existing observation. Investment contributions need no
   regular-funding status.
9. **Month:** explicitly select a saved version for the first Review. The next
   calendar month preselects that comparison, not a newer version. Record actuals
   or explicit zeros; missing expected items stay unknown. A known total creates
   a dated delta; saving adjustments require an explicit goal. Mark reviewed with
   unknowns still present, without acknowledgment or locking. Later edits flag
   changes while preserving the annotation and saved comparison.
10. **Continuity:** reload, export/restore, edit/delete/undo and inspect at narrow
    mobile widths. Keyboard: N, Ctrl/Cmd K, Alt 1–6; dialogs contain focus and
    unsaved Plan navigation is guarded.

## Verification and limits

Unit tests cover legacy snapshots, unknown/zero, exact-cent results, allocation
rollups, order-sensitive funding, backdated corrections, refunds, transfers,
completed goals, archival, and observations. Browser tests exercise the main
loop, backup/restore, keyboard behavior, checkpoints, and account/refund/estimate
entry. Test fixtures are isolated from the user's browser storage.

Browser writes retain before/after snapshots with prototype actor, UTC time and
interface. These snapshots and tab-conflict checks are prototype continuity
features, not tamper-resistant audit storage or atomic multi-client write safety.
Production requires the database mechanisms in the TDD. Browser storage has a
finite quota; failed saves remain explicit and preserve attempted input.

Advanced income matching and dedicated restoration interfaces remain deferred.
Cross-Plan sources are not auto-matched by name; unmatched actuals count once and
expected sources remain unknown. No matching cardinality policy is inferred.
Opening positions are protected in this prototype; an opening-edit form is not
provided. Loan observation correction loads the existing observation into the position form.
No financial data is sent to an external provider.
