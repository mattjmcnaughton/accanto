# 14 — Projections: investment assumptions, net worth and FIRE

Status: Implemented
Updated: 2026-11-26

## Purpose and scope

The owner asked for a page of future-looking figures (net worth over time and a
FIRE date) and, to drive it, an expected annual return and an expected monthly or
annual contribution on each investment. Home shows the same projection at 5, 10
and 20 years. Read with the [constitution](../../CONSTITUTION.md) §1, §2 and §9,
[CONTEXT.md](../../CONTEXT.md) (Projection, Projection assumption, FIRE target,
Net position) and [TDD 09](09-agent-financial-math.md), whose pure growth and
FIRE functions this reuses.

Excluded: inflation and real (today's-dollar) figures, decided against for now
because costs inflate unevenly ([#44](https://github.com/mattjmcnaughton/accanto/issues/44);
since added by [TDD 17](17-inflation.md));
taxes, fees and market risk; growth of savings; amortization of loans (since
added by [TDD 15](15-debt-payoff.md)); an
agent write tool for the FIRE assumptions.

## Data model

Migration `6n034`, additive:

| Column | Type | Rule |
| --- | --- | --- |
| `investment.expected_return_percent` | numeric(5,2), null | −10 to 30; null uses the Entity default |
| `investment.expected_contribution` | numeric(14,2), null | USD, nonnegative |
| `investment.expected_contribution_frequency` | varchar(10) | `monthly` (default) or `annual` |
| `entity.default_return_percent` | numeric(5,2) | −10 to 30, default 6.00 (nominal, cautious for a diversified portfolio) |
| `entity.fire_annual_spending` | numeric(14,2), null | positive |
| `entity.fire_withdrawal_percent` | numeric(4,2) | above 0, up to 10; default 4.00 |

Writes go through the existing audited, idempotent command path
(`create_/edit_investment`, `edit_entity`, new `edit_fire_assumptions` on the
Entity's revision). An investment edit that omits an assumption keeps it, so a
client that only renames does not clear it; giving recipients refuse them.

## Projection

`domains/projections.project_entity` is pure; `services/projections.read_projection`
reads its inputs in one snapshot and is the single entry point for Projections,
Home and any later caller.

- Each investment starts at its latest balance observation and compounds monthly
  at (1 + R)^(1/12) − 1 (`grow`), adding its contribution at each month's end;
  an annual contribution is a twelfth each month; an inactive investment keeps
  growing but takes no new contributions.
- Savings (remaining saved) and loans (latest observations) stay at today's
  amounts; [TDD 15](15-debt-payoff.md) now pays down loans with fixed-rate terms. Net worth = projected investments + savings − loans.
- An active investment without an observation is `no_value` and makes every
  total and the FIRE date unknown (null), as Net position is.
- Full precision month to month; reported amounts round half-even to cents. The
  FIRE target rounds up (TDD 09). The FIRE date is the first month projected
  investments reach the target, within 100 years.
- Rows: a timeline per year to the requested horizon (1–100) and fixed
  milestones at 5, 10 and 20 years for Home.

## Interfaces

- API: `GET /projections`, `GET/PUT /fire-assumptions`, the investment fields and
  `default_return_percent` in settings ([api.md](../api.md#projections)).
- Agent catalog and MCP: `list_destinations` reports the investment assumptions
  and `save_destination` sets them (shared DTOs). The FIRE assumptions and the
  Entity default have no agent tool, as Entity settings are excluded from the
  catalog (TDD 03); agents can compute projections with `project`.
- UI: Projections under Planning (horizon 10/20/30 years, milestones, FIRE date,
  chart, per-investment table, FIRE form); assumptions in the investment edit
  dialog; default return in Settings; Home's net worth card.

## Read cost (§9)

`GET /projections` is 13 SQL statements for 2 or 12 investments (integration
test). Cold Home reads it once (`?years=20`): 7 requests instead of 6.

## Verification

Unit tests against closed-form future values; integration tests for validation,
omitted-field edits, settings, FIRE, unknown values, Entity isolation and read
cost; frontend tests and Storybook stories for each screen state.
