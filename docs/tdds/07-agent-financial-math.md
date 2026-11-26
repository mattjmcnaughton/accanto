# 07 — Agent financial math: calculator, summaries and projections

Status: In progress (calculator implemented)
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
| `calculate(expression)` | Ad-hoc arithmetic on figures the agent has | None (pure) | 1, implemented |
| `summarize_activity(start, end, …)` | T1 totals by category, assignment, tag or note; T2 per-month totals, averages and savings rate | Activity | 2 |
| Target-gap fields on `list_savings` and `list_destinations` | T3 remaining to target and percent of target | Existing reads | 2 |
| `project(operation, …)` | T4 months to target; P1 loan payment and schedule; P2 FIRE target; P3 growth and months to FIRE; P4 coast and required contribution; P5 prepay versus invest | None (pure) | 3 |
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
