# 16 — FIRE number interview

Status: Implemented
Updated: 2026-11-27

## Purpose and scope

The owner asked for a "FIRE number chatbot": a short interview about (1)
current fixed costs, (2) expected changes to them, (3) which will not rise with
inflation, such as a fixed-rate mortgage, and (4) desired monthly discretionary
spending, that explains the FIRE number and lets him save it. It is built on the
built-in assistant and follows the [AGENT.md interview](10-agent-md-interview.md)
pattern. Read with the [constitution](../../CONSTITUTION.md),
[CONTEXT.md](../../CONTEXT.md) (FIRE target, Projection assumption, Plan
version) and [TDD 14](14-projections.md).

Excluded: a new data model. The per-cost inflation flag and the inflation rate
belong to the inflation work ([TDD 17](17-inflation.md):
`fixed_cost.rises_with_inflation`, `entity.inflation_percent`, migration
`6r038`); this design only reads them (`get_plan`, `get_settings`) and writes
the flags through the field that work adds to `save_fire_assumptions`.

## Workflows and domain rules

- **Start:** *Interview me for my FIRE number* on Projections opens the
  assistant and sends the interview prompt.
- **Pre-fill:** the assistant reads `list_plans`, `get_plan` for the saved Plan
  version with the highest version number, and `get_settings`. Question 1 lists
  that version's fixed costs (amount, frequency, monthly amount) and their
  monthly total, so the owner confirms or adjusts rather than retyping. With no
  saved version it asks the owner to list them.
- **Questions 2–4,** one per reply with a one-line reason and 2–4 likely
  answers: changes by retirement; which costs will not rise with inflation,
  starting from the current flags; monthly discretionary spending, offering the
  Plan's guilt-free spending.
- **Proposal:** annual spending = (retirement fixed costs + discretionary) × 12
  with `calculate`; the FIRE number with `project` (`fire_target`) at the saved
  withdrawal rate. The reply explains annual spending ÷ withdrawal rate in
  today's dollars, which costs rise with inflation and which do not, and asks
  to save.
- **Save:** only after the owner approves, `save_fire_assumptions` with the
  annual spending, withdrawal rate, revision and
  `fixed_costs_not_rising_with_inflation` (the full list held level, by
  Fixed cost id). The card's summary counts them and its rows name them, as
  every Pending card names the records it references.

| Rule | Source | Commands | Enforcement | Verification |
| --- | --- | --- | --- | --- |
| Nothing is saved before the owner approves | TDD 10 pattern | `save_fire_assumptions` | System prompt; the stub drafts only after "yes" | Integration and e2e: no card after the proposal |
| Saving follows the Agent mode | TDD 03 | `save_fire_assumptions` | Existing dispatcher: Ask first pends, Read only refuses | Integration: Read only records nothing; Ask first drafts one card; applying it saves |
| The FIRE number is derived, never stored | This TDD | Projections | Projections computes annual spending ÷ withdrawal rate from what is saved | Integration and e2e: the target after applying |

**Derived, not stored.** A stored FIRE number would go stale as soon as the
owner edits annual spending, the withdrawal rate or the inflation setting on
Projections. The saved annual spending is a snapshot of the interview's answer,
not linked to the Plan's fixed costs, because retirement costs differ from
today's on purpose (a cost ends, another starts). Matt approved this choice.

## Implementation and data

No migration.

- `agents/sidebar.py`: the interview rules in `SYSTEM_PROMPT`.
- `dtos/tools.py`: `get_plan` lines report `monthly_amount` (fixed costs), so
  the agent quotes the monthly figure without converting frequencies itself.
- `services/stub_model.py`: a scripted four-question interview for tests and
  e2e, checked before the AGENT.md interview, whose prompt it also contains.
- UI: the entry card on Projections; the assistant panel, Markdown replies and
  Pending card are unchanged.

## Verification

`tests/integration/test_fire_interview.py` (stub model, real PostgreSQL) checks
the pre-filled costs, each question, the figures worked by hand, Read only and
Ask first, and that applying holds exactly the named cost level. `tests/e2e/test_agent_browser.py` runs the interview from the
Projections button and checks the new target after applying. Storybook:
Screens/Assistant › Fire Interview (+ Phone), Screens/Projections › Fire
Interview Entry (+ Phone).
