# 15 — Debt payoff: fixed-rate loan terms, payoff schedules and amortizing projections

Status: Implemented
Updated: 2026-11-27

## Purpose and scope

The owner asked to show how each loan pays down, meaning the interest rate, the
monthly payment and the resulting schedule, and to include that pay-down in
projected net worth. Read with the [constitution](../../CONSTITUTION.md) §1, §2
and §9, [CONTEXT.md](../../CONTEXT.md) (Debt account, Loan terms, Payoff
schedule, Projection, Net position) and [TDD 14](14-projections.md), whose
Projection this extends.

In scope: an optional fixed annual interest rate and level monthly payment on
each Debt account; a payoff schedule from the latest recorded balance; loans
that amortize in `GET /projections` (the Projections page and Home's card).

Excluded: variable or introductory rates; fees, escrow and extra payments on a
saved loan (the agent's `amortize` and `prepay_or_invest` math tools already
model extras); splitting recorded payments into principal and interest, or
reconciling them with the schedule; changing today's net worth or Net position,
which keep using the latest observations; credit cards.

## Workflows and domain rules

| Rule (domain name) | Authoritative source | Commands affected | Enforcement | Verification |
| --- | --- | --- | --- | --- |
| Loan terms are optional assumptions | CONTEXT.md Loan terms | `create_debt`, `edit_debt` | DTO validation (`debt_rate`, money above zero); DB checks | Integration: 40.01%, −1% and $0 payment refused (422); existing loans have null terms |
| An edit that omits a term keeps it | api.md Loan accounts | `edit_debt` | `EditDebt.unchanged`, as for investment assumptions | Integration: a rename keeps the payment; explicit null clears only the payment |
| Schedule starts from the latest observation | CONTEXT.md Payoff schedule | read only | `payoff_schedule` (pure) | Unit: $10,000 at 6% paying $193.33 is 60 months, first month $50.00 interest and $143.33 principal, matching any loan table |
| A payment that does not exceed the interest is flagged | CONTEXT.md Payoff schedule | read only | `debt_status` returns `interest_not_covered`; no rows | Unit: $10,000 at 12% paying $100.00 is flagged and paying $100.01 is scheduled; integration: no rows |
| Projections amortize loans with terms | CONTEXT.md Projection | read only | `project_entity` uses the same monthly rows | Unit: the year-one balance matches the closed form within $0.05 and the loan is repaid by year five; a loan without terms stays flat |

A schedule never writes anything. Changing terms is an audited, idempotent
`edit_debt` on the Debt account's revision, like a rename.

## Implementation and data

Migration `6o035`, additive, chains after `6n034`:

| Column | Type | Rule |
| --- | --- | --- |
| `debt_account.interest_rate_percent` | numeric(5,2), null | 0 to 40 |
| `debt_account.monthly_payment` | numeric(14,2), null | 0.01 to 999,999,999.99 |

- **Domain** (`domains/projections.py`): `payoff_schedule(balance, as_of, rate,
  payment)` returns status, totals and monthly rows. Interest is balance × rate ÷
  12, rounded half-even to cents each month as `amortize` does, and the last
  payment is the balance plus that month's interest. The first payment is one
  month after the observation's date. Status is `scheduled`, `paid_off`,
  `no_terms`, `interest_not_covered` or `beyond_limit` (over 1,200 months).
  When principal falls by only cents, rounding can add months beyond the
  unrounded closed form ($100.01 against $100.00 of interest: 934 months instead
  of about 926). This is the statement behaviour, so it is kept.
- **Projections**: `project_entity` takes a list of loans (id, name, active,
  latest, terms) instead of a single total. A loan whose terms cover its interest
  follows the same monthly rows from the Entity's today; others stay at their
  latest amount. Each timeline row gains `loans`, and the result gains a `loans`
  list with status, payoff date and milestone amounts. Like investments, a loan
  starts at its latest observation as of today, so today's net worth stays on
  recorded balances; a loan last observed months ago therefore pays off that
  much later in Projections than in its schedule (which starts at the
  observation). The By loan note says so; a new observation aligns them.
- **Services and API**: `DebtResult` gains the terms and a `payoff` summary;
  `GET /debts/{id}/payoff-schedule` returns the rows ([api.md](../api.md#loan-accounts-and-dated-balance-observations)).
  `services/projections.read_projection` reads each loan's latest observation and
  terms in the one statement that previously summed amounts.
- **Agent catalog and MCP**: `list_debts` reports terms and a payoff summary
  (status, monthly interest, months, payoff date, interest remaining); `save_debt`
  takes the terms through the shared DTOs. No new tool is needed.
- **UI**: Loans shows terms and a payoff line on each card, Rate, Monthly
  payment and Payoff columns, and an "interest not covered" flag. Its details
  dialog edits the terms and shows the payoff summary, a balance chart and the
  monthly table. Projections gains a By loan table and shows loans owed at each
  milestone; Home's note says loans with terms are paid down. The Loans and
  Projections screens reuse the existing responsive layouts on phones.
- **Fixtures**: the synthetic education loan has 4.50% and $180.00 terms; the
  vehicle loan has none.

### Product choice: payments and investing

Loan payments are not subtracted from projected investment contributions, and a
repaid loan's payment is not redirected into investments. Expected contributions
are entered as what the owner expects to invest, already net of the budget that
pays the loans, so subtracting payments would count them twice. Redirecting a
freed payment would invent a decision the owner has not made. This is
conservative: after payoff, net worth rises only by the debt that no longer
exists. A later "invest freed loan payments" option would add the freed payment
to contributions from the payoff month.

## Atomicity, concurrency, and retries

Terms are written by the existing `edit_debt` command: it is idempotent,
audited, and checked against `expected_revision`, so a stale edit is refused
(409) and a retry returns the recorded outcome. Schedules and projections are
reads in one `read_snapshot`, so the balance and terms come from the same
snapshot. A payoff-schedule read for another Entity's loan is 404.

## Read cost (§9)

`GET /projections` is 13 SQL statements for 2 or 12 investments and for 3 or 13
loans (integration test), the same as before this change: loans and their terms
come from one `DISTINCT ON` statement. `GET /debts` adds no statements: the
payoff summary is computed from rows it already reads. Each schedule is one
request when the details dialog opens.

## Verification

Unit tests use published loan figures and the closed form
B·(1+r)^n − P·((1+r)^n − 1)/r. Integration tests cover validation, omitted and
cleared terms, the schedule endpoint, the interest-not-covered flag, amortizing
projections, Entity isolation and read cost on real PostgreSQL. Frontend tests
cover adding terms, out-of-range refusal, the card flag, the schedule table and
saving terms against the revision. Storybook has `Screens/Loans` with a
`PaymentUnderInterest` story. All data is synthetic.

## Delivery and compatibility

Additive migration. Existing loans have null terms, stay `no_terms`, and project
flat as before. Clients that omit terms on edit keep them. `project_entity`'s
`loans` argument changed from a total to a list; its only caller is
`read_projection`. No grants change (no new tables).

## Open decisions

- Whether projections should invest a loan's payment after it is repaid
  (recommended later as an explicit option; see above).
- Variable rates are deferred until requested.
