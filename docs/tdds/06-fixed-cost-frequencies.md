# 06 — Weekly, biweekly and quarterly fixed costs

Status: Implemented
Updated: 2026-11-26

## Purpose and scope

The owner asked to mark fixed costs as quarterly, biweekly and weekly, in
addition to monthly and annual. This widens the **Fixed-cost frequency** in
[CONTEXT.md](../../CONTEXT.md). Plans and Reviews stay monthly. Read with the
[constitution](../../CONSTITUTION.md) and [architecture](../architecture.md).

Excluded: twice-monthly and daily fixed costs (the income estimator has them;
nobody asked for them here); counting how many payments fall in a given month;
per-month Review prorating; annual Plans.

## Workflows and domain rules

The owner (UI or API) chooses a frequency for each fixed-cost line when creating
or editing a Plan draft. Copies and saved versions keep the entered amount and
frequency. Agents read the frequency through `get_plan`; no agent tool writes
Plan lines, so there is no agent write path to change.

| Rule (domain name) | Authoritative source | Commands affected | Enforcement | Verification |
| --- | --- | --- | --- | --- |
| Monthly amount = entered amount × payments per year ÷ 12, rounded half-even per line, then summed | CONTEXT.md, Fixed-cost frequency; constitution §1 | Create Plan, replace draft, copy | Pure `fixed_cost_monthly`; frontend preview uses the same factors | Unit: `100.00` weekly → `433.33`, biweekly → `216.67`, quarterly → `33.33`, `0.03` biweekly → `0.06`; integration: total `683.33` |
| Payments per year: weekly 52, biweekly 26, monthly 12, quarterly 4, annual 1 | CONTEXT.md, Fixed-cost frequency | Same | `FIXED_COST_PAYMENTS_PER_YEAR`; DTO literal; DB check | Unit; integration 200 round trip and saved version |
| A Review compares the smoothed amount with payments recorded that month | CONTEXT.md, Review conventions | Review reads | Unchanged: Review reads stored `fixed_cost_total` | Existing Review tests; no new rule |
| A line whose monthly amount exceeds `999999999.99` is rejected | Existing money limit | Create Plan, replace draft | DTO validator calls the domain rule (422); DB check on `monthly_amount` | Unit; integration 422 for `999999999.99` weekly |

### Why 52 and 26 per year

Weekly and biweekly payments do not divide evenly into months: a month holds four
or five weekly payments, or two or three biweekly ones. The Plan uses the
average (52 ÷ 12 or 26 ÷ 12 payments per month), the rule the income estimator
already uses for weekly income. A 53rd weekly payment in some years is ignored,
as it is for income. The Plan therefore reserves the same amount every month;
the Review shows a five-payment month as over plan and a four-payment month as
under, the same way an annual cost already shows in the month it is paid.

## Implementation and data

- **Migration `6e025`:** replaces `plan_fixed_cost_line_frequency_check` with
  the five values. No stored line or `monthly_amount` changes.
- **Domain and services:** `domains/monthly.fixed_cost_monthly` takes the five
  frequencies; services are unchanged.
- **API and `docs/api.md`:** `FixedCostLine.frequency` accepts the new values;
  responses already return the stored frequency.
- **Agent tool catalog and MCP:** `PlanLine.frequency` is already a string
  copied from the stored line, so `get_plan` reports the new values with no
  change. No tool writes Plan lines.
- **UI:** the Plan worksheet's frequency cell and detail select offer Weekly,
  Biweekly, Monthly, Quarterly and Annual; the unsaved preview uses the same
  factors and rounding. Saved versions keep showing their stored monthly amount.
- **CONTEXT.md:** defines Fixed-cost frequency and the Review comparison.

## Atomicity, concurrency, and retries

Not applicable: the existing Plan write path, locking and idempotency are
unchanged.

## Verification

`tests/unit/test_monthly_domain.py`, `tests/integration/test_monthly_api.py`
and `screens.test.tsx` (weekly `120.00` previews `$520.00`, not `120.00 × 4`).

## Delivery and compatibility

Additive. Rollback notes are in
[deployment](../technical/deployment.md): roll back only before a new frequency
is used; the downgrade fails once one is stored.

## Open decisions

None.
