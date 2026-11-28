# 23 — Spending alerts

Status: Implemented
Updated: 2026-11-28

## Purpose and scope

The owner wants to know when a month's spending passes a share of the Plan: for
guilt-free spending or fixed costs as a whole, and for a Spending subcategory
(eating out, groceries) or a Fixed cost. A Spending alert ([CONTEXT.md](../../CONTEXT.md))
sets thresholds such as 70% and 90%; when recorded spending reaches one, Home's
Needs you shows it and a Notification ([TDD 20](20-notifications.md)) is pushed,
each once a month. Agreed with the owner on 2026-11-27, including custom
thresholds from 1% to 999%.

Excluded: saving, investing and giving; alerts on past months; amounts in pushes;
a separate notification system.

## Workflows and domain rules

| Rule (domain name) | Authoritative source | Commands affected | Enforcement | Verification |
| --- | --- | --- | --- | --- |
| A Spending alert holds no amount; it reads the Plan version Home compares against (the month's Review version, else the latest saved one) | CONTEXT.md, Spending alert | list, dismiss, tick | `services/spending_alerts.plan_version` | Integration: a later saved version changes the percentage until a Review links the first |
| Percentage is recorded (refunds included, deletions excluded) of the Plan amount, rounded down; no amount means waiting, never zero | Constitution §1 | list, tick | `domains/spending_alerts.percent_used` | Unit: $104.99 of $150 is 69%, $105 is 70%; integration: Books `no_estimate` |
| Thresholds are 1–10 distinct whole percentages, 1–999 | Owner decision | create, edit | DTO, pure `thresholds`, DB check | Unit and integration rejections |
| One alert per target; a subcategory belongs to spending, a Fixed cost to fixed costs, both in the Entity; archived subcategories cannot gain one | CONTEXT.md | create | Service under the Entity lock; unique expression index; composite FKs | Integration: `spending_alert_exists`, `record_not_found` |
| Each threshold is pushed at most once per User and calendar month; reaching several at once claims all and names the highest | Owner decision | tick | `spending_alert_notice` claimed before delivery with a conditional upsert | Integration: dropping back under 125% and reaching it again pushes nothing |
| Dismissal hides a reached alert on Home for that User until a higher threshold or the next month | Owner decision | dismiss | Notice row `dismissed_at` | Integration and Home unit test |

Spending alerts are not financial records: they change no entry, Plan or total.
Create, edit and delete are audited and retry-safe through `services.monthly.write`.

## Implementation and data

- Migration `7b048` (after `7a047`): `spending_alert` (target, `thresholds
  smallint[]`, revision) and `spending_alert_notice` (User, alert, month,
  threshold, `pushed_at`, `outcome`, `dismissed_at`; cascades with its alert), and
  `notification_preference.spending_alerts` (default on).
- API: `/api/entities/{id}/spending-alerts` ([docs/api.md](../api.md#spending-alerts)).
- Agent and MCP: `list_spending_alerts` reads; `save_spending_alert` and
  `delete_spending_alert` follow the Agent mode. Dismissal is browser UI only:
  it is a person's acknowledgement, not something an agent does for them.
- UI: rules live next to the money, not in Settings (owner decision, 2026-11-28).
  A bell on each Plan worksheet row an alert can watch (Fixed costs, each fixed
  cost, Guilt-free spending, each active subcategory; key `b`) shows its
  thresholds and opens the alert dialog, on any Plan or version, because a rule
  targets the row, not the version. The dialog names the version it reads. The
  Spending alerts screen (sidebar Recurring, beside Routines and Schedules) lists
  every rule with this month's progress and adds, edits or deletes one. Both use
  one dialog: presets 50/70/90/100, any other percentage, 70 and 90 preselected.
  Home's Needs you, red past 100%; Settings keeps only the Notifications switch.
  The worksheet reads `/spending-alerts` (one more request on that screen).
- Push: the notifications tick, after the daily kinds, at any tick from the
  User's hour on. Text names the target and threshold, such as "Eating out passed
  70% of its estimate."; never an amount or payee.

## Atomicity, concurrency, and retries

Writes run under the Entity row lock with idempotency keys. A push is claimed in
its own transaction before delivery (`ON CONFLICT … WHERE pushed_at IS NULL`), so
overlapping ticks push a threshold once; a dismissal row that exists first does
not block its push.

## Verification

`tests/unit/test_spending_alerts.py`, `tests/integration/test_spending_alerts.py`
(real PostgreSQL: API, tick, agent tools, constant SQL for 3 and 23 rules),
Home and screen-load tests, Storybook stories on synthetic data.
