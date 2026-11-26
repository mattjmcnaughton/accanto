# 07 — Agent financial math: calculator, summaries and projections

Status: In progress (calculator, activity summaries, target gaps and projections implemented)
Updated: 2026-11-26

## Purpose and scope

The owner asked for agents to do arithmetic reliably and to answer the money
questions a daily driver needs: totals over time, gaps to targets, mortgage
amortization and FIRE math. Until now [TDD 03](03-agent-access.md) relied on
instructions that forbid model arithmetic. That kept unknowns from becoming zero,
but left the agent unable to answer "how much at Costco this year" or "when do I
pay off the mortgage" without computing in its head.

This design replaces "never compute" with "never compute in your head": figures
from data are computed by the server, and arithmetic on figures the agent already
has goes through an exact decimal calculator. Read with the
[constitution](../../CONSTITUTION.md) §1 (Decimal, half-even, unknown is not
zero), [CONTEXT.md](../../CONTEXT.md) (Projection, FIRE target) and
[architecture](../architecture.md).

Excluded: tax estimation, Monte Carlo or market-risk modelling, advice, stored
loan terms (rate and term are passed per call), a read-only SQL tool, and any new
stored record. No tool here writes.

## Tools

Five tools in the shared catalog (`services/tools.py`), so the sidebar, MCP and
anything built on the catalog get the same results. Each is a thin adapter over
pure functions in `domains/`.

| Tool | Covers | Reads | Chunk |
| --- | --- | --- | --- |
| `calculate(expression)` | Ad-hoc arithmetic on figures the agent has | None (pure) | 1, done |
| `summarize_activity(start, end, …)` | T1 totals by category, assignment, tag or note; T2 per-month totals, averages and savings rate | Activity | 2, done |
| Target-gap fields on `list_savings` and `list_destinations` | T3 remaining to target and percent of target | Existing reads | 2, done |
| `project(operation, …)` | T4 months to target; P1 loan payment and schedule; P2 FIRE target; P3 growth and months to FIRE; P4 coast and required contribution; P5 prepay versus invest | None (pure) | 3, done |
| `get_position(on)` | T5 position snapshot and net position; T6 change between observations versus recorded payments or contributions | Savings, investments, debts | 4 |
| `investment_returns(investment_id?)` | P6 money-weighted return (XIRR) from contributions and observations | Investments | 5 |

Grouping thirteen functions into five tools keeps the catalog's schema small
(it is already about 12k tokens on the sidebar). Pure tools take no Entity: MCP
omits `entity_id` from their schema (`CatalogTool.pure`).

## Workflows and domain rules

| Rule (domain name) | Authoritative source | Tools | Enforcement | Verification |
| --- | --- | --- | --- | --- |
| Exact money | Constitution §1 | All | `Decimal` throughout; calculator literals parsed from source text, never through a float; 34 significant digits | Unit: `0.1 + 0.2` is `0.3`; `1000.10 * 3 - 0.30` is `3000.00` |
| Half-even at monetary results | Constitution §1 | All | Carry full precision; round half-even only where a figure is reported as money (`cents`, schedule rows) | Unit: `round(2.665, 2)` is `2.66` |
| Unknown is not zero | Constitution §1 | Summaries, position | A month or account without data is reported as unknown and excluded from averages with a count; the calculator has no `null` | Unit and integration per chunk |
| Projection | CONTEXT.md | `project`, `investment_returns` | Results echo their assumptions and are never stored as activity or observations | Unit: assumptions round-trip |
| No arithmetic in the model's head | This TDD | Prompt, catalog rules, MCP instructions | Instruction text; the calculator gives the agent a way to comply | Eval (live) |
| Bounded work | This TDD | `calculate` | Allowlisted AST nodes only; 2000 characters, 250 levels of nesting, exponents within ±1200, results within ±10^30 | Unit: escape and size cases refused |
| No figures in errors | TDD 03 | `calculate` | Fixed rejection messages; MCP errors carry code and message only | Unit and MCP integration |

## Calculator

`domains/calculator.calculate(expression) -> Decimal` parses with
`ast.parse(mode="eval")` and walks an allowlist: number constants (read from
their source text into `Decimal`), unary `+`/`-`, binary `+ - * / **`, and
calls to `abs`, `min`, `max`, `round` (half-even, default 2 places), `sqrt` and
`sum` (up to 200 values). `^` is rewritten to `**` before parsing so it keeps
power precedence. `%`, `$`, thousands separators, names, attributes, strings,
comparisons and everything else are refused with a message that does not repeat
the expression. The tool returns the full `result` and `cents` (half-even).

Written in-house rather than vendored: popular calculator MCP servers compute in
floats, and `simpleeval` would need its number handling replaced and most of its
features disabled, while a copy would miss its security fixes.

## Activity summaries

`domains/activity_summary.summarize(entries, start, end, today)` takes entries
already narrowed by the tool's filters (category, tag, one record id per record
type, case-insensitive note text) and ignores dates outside the inclusive range.

- Per category: total, entry count, and a monthly average over **complete months
  with entries**. A month with no entries in that category is unknown, listed in
  `months_without_entries`, and never averaged as zero. A month cut by the range,
  or not yet over in the Entity's time zone, is listed in `partial_months` and
  not averaged; its entries still count in the total.
- Per month: totals for the categories with entries.
- `saving_rate` is recorded saving ÷ recorded income, and
  `saving_and_investing_rate` adds income-funded investment contributions to the
  numerator. Both show numerator and denominator; without income entries the
  percent is unknown. These use recorded activity only: unlike a Review, they do
  not check completeness against a Plan, because a range spans months that may
  have no Review.
- Percents round half-even to two places; averages round half-even to cents.

## Target gaps

`domains/targets.target_gap(target, progress)` gives the amount remaining (never
below zero) and the percent reached (above 100 when exceeded). Progress is
remaining saved for goals and contribution progress for investments and giving
recipients, matching CONTEXT.md **Recorded progress**. No target means both are
unknown.

## Projections

`project` takes one `projection` object whose `operation` selects the
calculation; the result echoes every assumption, lists `figures`, an optional
`schedule` (loans, yearly by default) or yearly `growth` rows, and a fixed note
that it is a projection. Pure functions live in `domains/projections.py`.

- **Rates.** Inputs are annual percents. Loans use the nominal monthly rate
  APR ÷ 12. Growth uses the effective monthly rate (1 + R)^(1/12) − 1, so a
  year of compounding equals R. Growth inputs state `basis: real | nominal`;
  the tool does not convert between them.
- **Loans** (`loan`). The level payment is
  P·r(1+r)^n ÷ ((1+r)^n − 1), or P ÷ n at 0%, rounded half-even to cents. Each
  month's interest is rounded half-even to cents, as statements do; with a term,
  the last scheduled payment also clears the cents left by rounding the payment,
  so a 360-month loan ends at month 360. A payment that does not cover the
  month's interest is refused. Extra payments report interest and months saved
  against the same loan without them. Loans can be described by a term or by a
  monthly payment (for an existing loan from its latest balance observation).
  Lender rounding can differ by cents; observations stay authoritative.
- **FIRE target** (`fire_target`): annual spending ÷ withdrawal rate.
- **Growth** (`growth`): balance × (1 + g) + contribution each month, for a
  number of months or until a target (at most 1200 months).
- **Coast FIRE** (`coast_fire`): target ÷ (1 + g)^n. **Required contribution**
  (`required_contribution`): (target − start·(1 + g)^n)·g ÷ ((1 + g)^n − 1), or
  zero when the start already gets there.
- **Months to target** (`months_to_target`): remaining ÷ monthly amount, rounded
  up to whole months, without growth.
- **Prepay or invest** (`prepay_or_invest`): the same monthly budget (loan
  payment + extra) two ways. Prepay sends the extra to the loan; invest sends it
  to investments. In both, once the loan is repaid the whole budget is invested.
  Net position at the horizon is investments less the remaining balance; the
  result reports both and the difference. Taxes, fees and risk are not modelled.

**Rounding exception (constitution §1).** Amounts *needed* to reach a target
(FIRE target, coast amount, required contribution) round **up** to the cent.
Rationale: half-even could report a figure that, followed exactly, falls short;
the worked case of $100,000 growing to $1,000,000 over 240 months at 5% was
$1.79 short. Everything else rounds half-even.

## Interfaces

These tools compute from existing records; there is no data model change.
They are available to the built-in agent and over MCP, which authenticates with
the owner's API keys. No REST endpoint or UI is added in this change: the
Review, Plan and savings screens already show the figures they own, and the new
summaries are agent answers. A later UI for projections would reuse the same
domain functions.

## Verification

Pure unit tests with independently worked amounts per function (published
amortization values, hand-computed FIRE figures); catalog and MCP tests for
schemas and parity; integration tests for each data-reading tool against
PostgreSQL.

## Delivery

Delivered in chunks, each a commit: calculator; activity summaries and target
gaps; projections; position; investment returns; then sidebar tool groups that
load related tools on demand to reduce context.
