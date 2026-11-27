# 17 — Inflation: today's and future dollars, and fixed costs held level

Status: Implemented
Updated: 2026-11-27

## Purpose and scope

The owner asked for a Today's dollars / Future dollars toggle on Projections and
Home, with labelled, interactive chart axes, the FIRE assumptions higher on the
page and this month's planned fixed costs beside them. Costs inflate unevenly
([#44](https://github.com/mattjmcnaughton/accanto/issues/44)): groceries rise
with prices, a fixed-rate mortgage payment does not. So one Entity-wide rate
drives today's dollars, and each Fixed cost says whether it rises with
inflation. Read with [TDD 14](14-projections.md), which this extends, and
[CONTEXT.md](../../CONTEXT.md) (Inflation, Today's dollars, FIRE target).

Decided with the owner (2026-11-27): contributions stay level in nominal
dollars (cautious; a per-investment option may follow); the flag is set once per
Fixed cost, from a multi-select in the FIRE assumptions, not per Plan version;
the inflation rate lives with the FIRE assumptions on Projections.

Excluded: inflation-linked contributions, per-cost rates, inflation of savings
or loan balances beyond deflating them for display, taxes and market risk.

## Data model

Migration `6r038`, additive (chains after inbox notes `6q037` on merge):

| Column | Type | Rule |
| --- | --- | --- |
| `entity.inflation_percent` | numeric(4,2) | 0 to 15, default 3.00 |
| `fixed_cost.rises_with_inflation` | boolean | default true |

Both are written by `edit_fire_assumptions` on the Entity's revision.
`inflation_percent` and `fixed_costs_not_rising_with_inflation` are optional;
omitted, each stays as it is (and stays out of the retry digest). The list is
the full set held level: listed costs become false, every other Fixed cost of
the Entity true, each change audited on the Fixed cost in the same transaction.
An id outside the Entity is refused (404) and nothing is written. Saved Plan
versions are not rewritten; the flag is read live.

## Math (`domains/projections`)

- `inflation_factor(I, m) = (1 + I)^(m/12)`.
- `fire_target_at(S, L, W, I, m)`: spending S in today's dollars, its steady part
  L = the year's planned fixed costs held level (capped at S), withdrawal W:
  `((S − L) × factor + L) ÷ W`, rounded up. At m = 0 it equals `fire_target`.
- `project_entity(..., inflation_percent, steady_spending, dollars)` runs nominal;
  with `dollars="today"` each amount m months out is divided by the factor
  (contributions each at their own month). The FIRE date is the first month
  nominal investments reach the nominal target, so it is the same in either
  dollars; `fire.target` is the target on that date in the chosen dollars,
  `fire.target_today` is S ÷ W.

## Interfaces

- API: `GET /projections?years=N&dollars=today|future` (default `today`) adds
  `dollars`, `inflation_percent`, `fire_target` per row, `fire.steady_spending`,
  `fire.target_today` and `planned_fixed_costs` (the month's Review's Plan, else
  the most recently saved, at its latest saved version; null without one).
  `GET/PUT /fire-assumptions` carry `inflation_percent` and accept
  `fixed_costs_not_rising_with_inflation` ([api.md](../api.md#projections)).
- Agents: `get_settings` returns `inflation_percent`; `get_plan` returns
  `rises_with_inflation` on each fixed-cost line; `save_fire_assumptions` takes
  both optional fields. The FIRE number interview (TDD 16) uses them.
- UI: FIRE date and chart first (dollar and year axes; hover, tap, drag or arrow
  keys read each series), then FIRE assumptions (withdrawal rate, spending,
  inflation, the filterable fixed-cost multi-select, the planned fixed-cost
  reference). The dollars choice is per browser, shared with Home, default today.

## Read cost (§9)

`GET /projections` is 16 SQL statements for 2 or 12 investments and 3 or 13
loans (integration test), three more than TDD 14 for the planned fixed costs.

## Verification

Unit tests against independently computed factors, targets and the FIRE month;
integration tests for validation, the full-list replacement, refusal of foreign
ids, omission, audit and read cost; frontend tests for the toggle and the save.
