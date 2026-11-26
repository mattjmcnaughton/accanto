# 13 — Routines, phase 1: manual checklists

Status: Implemented
Updated: 2026-11-26

## Purpose and scope

The owner wants his recurring money habits in accanto: a Saturday check (pay the
card, buy the index fund, process transactions, check the checking account), a
monthly review and a year-end review. This adds the **Routine**, **Routine step**,
**Routine occurrence** and **Due / Overdue / Missed** from
[CONTEXT.md](../../CONTEXT.md), on the web, the API and MCP. It is phase 1 of the
[routines design spike](https://ampcode.com/artifacts/routines-design-spike-dbde5c07-15cc-43dc-b339-4310ccdea2d5).
Read with the [constitution](../../CONSTITUTION.md) and
[architecture](../architecture.md).

Excluded, for later phases: reminders of any kind outside the app (calendar
feed, ntfy push, the reminder table and loop), the assistant's "Walk me through
it" button, and links that open a prefilled form. No background job is needed.

## Workflows and domain rules

Decisions (owner, 2026-11-26): the owner ticks every step himself, and data never
ticks or suggests one. Each routine belongs to one Entity. An unfinished
occurrence is missed once the next is due and can still be completed late. No
streaks; the last 12 occurrences show as dots. The assistant ticks a step only
when the owner says it is done. Routine changes are audited through the normal
write path.

The owner (UI or API) or an Agent (MCP or built-in) can create, edit and archive
a routine; read routines and an occurrence; tick, skip, clear or annotate a step;
and skip or reopen a whole occurrence.

| Rule (domain name) | Authoritative source | Commands affected | Enforcement | Verification |
| --- | --- | --- | --- | --- |
| Scheduled dates follow the cadence in the Entity time zone; intervals count from the start's week, month or year | CONTEXT.md, Routine | Reads, occurrence writes | Pure `domains/routines.before`, `after`, `is_scheduled` | Unit `test_routines.py`: Saturdays of Nov 2026; last day gives Feb 28, 2027 and Feb 29, 2028; first Saturday of Dec 2026 is the 5th; every 2 weeks from Wed Nov 4 skips Nov 14 |
| Upcoming, due, overdue, missed follow from today and the next date; done and skipped are stored | CONTEXT.md, Due / Overdue / Missed | Reads | Pure `occurrence_state` | Unit: Nov 7 occurrence is overdue on Nov 13 and missed on Nov 14 |
| A person acts on scheduled dates only, up to the first after today | This TDD | Step and occurrence writes | `writable`; `422 not_scheduled` | Integration: two weeks ahead rejected; a missed week completes late |
| Done once every current step is ticked or skipped; clearing one reopens it | CONTEXT.md, Routine occurrence | Step writes | Service recomputes `completed_on` in the same transaction | Integration `test_routines.py` |
| An occurrence exists once per routine and date | This TDD | Occurrence writes | `UNIQUE (routine_id, scheduled_on)` under the Entity lock | Integration: two concurrent first ticks make one occurrence with two ticks |
| Routines stay in their Entity | Constitution §2 | All | Composite FKs `(routine_id, entity_id)`; scoped lookups | Integration: another Entity's path returns 404 |
| Completing a step records nothing financial; recorded activity never ticks one | CONTEXT.md, Routine step | All | The routines service reads and writes no financial table | Integration: no entries and no non-routine audit rows |
| History is unchanged by later edits | CONTEXT.md, Routine step | Edit routine | Title snapshot on each tick; removed steps stay inactive | Integration: a renamed and a removed step keep their ticked titles |
| Stale edits are rejected; retries replay | Constitution §7 | All writes | `expected_revision`, `idempotency_outcome` | Integration: same key twice gives one audit row; reused key with other input 409 |
| Names, titles, notes and URLs are Untrusted and stay out of telemetry | Constitution §6 | Tools, logs | `Untrusted` projections; no new spans or log fields | `test_tool_catalog.py`, `test_trace_privacy.py` canaries |

Rejections leave every record unchanged: `routine_not_found`, `step_not_found`,
`occurrence_not_found` (404); `invalid_cadence`, `invalid_step`, `not_scheduled`
(422); `occurrence_skipped`, `stale_revision`, `key_reuse` (409).

## Implementation and data

- **Migration `6k031`:** `routine` (cadence columns with one check constraint per
  frequency, weekdays as a bit mask), `routine_step` (`active`, unique position
  among active steps, at most one link, https only), `routine_occurrence`
  (`skipped`, `completed_on`, `note`, `revision`; unique per routine and date) and
  `routine_occurrence_step` (title snapshot, `done` or `skipped`, note). Additive.
  `/readyz` pins `6k031`.
- **Domain:** `domains/routines.py`, pure, with an explicit `today`.
- **Service:** `services/routines.py`. `create_routine`, `edit_routine`,
  `set_routine_step` and `set_routine_occurrence` run inside
  `services.monthly.write()`. The list reads in three statements (routines, active
  steps, stored occurrences with tick counts) whatever the number of routines.
- **API:** `GET/POST /routines`, `GET/PUT /routines/{id}`,
  `GET/PUT /routines/{id}/occurrences/{date}`,
  `PUT /routines/{id}/occurrences/{date}/steps/{step_id}` ([api.md](../api.md#routines)).
- **Agent tools and MCP:** reads `list_routines(due_only?)` and
  `get_routine_occurrence`; `set_routine_step` and `set_routine_occurrence` run
  directly in Ask first and Apply directly (like `set_proposals`) and are rejected
  in Read only; `save_routine` is gated (a Pending change in Ask first).
- **UI:** a Routines screen (list with dots, occurrence checklist, editor), a nav
  entry under This month without a number key, and a Home section above Needs you
  that reads only `/routines`.

## Atomicity, concurrency, and retries

Each command commits the routine or occurrence, its ticks, the audit row and the
retry outcome together under the Entity row lock, so two first ticks cannot both
create the occurrence. Routine edits check `expected_revision`; skipping or
reopening an occurrence checks its revision (0 before it is stored). Step ticks
take no revision: each sets one step's state, so the last write wins, and their
retry scope is the routine, date and step.

## Verification

- Unit: `tests/unit/test_routines.py` (cadences, states, writable dates),
  `tests/unit/test_tool_catalog.py` (tool list, which tools pend).
- Integration on PostgreSQL: `tests/integration/test_routines.py` covers the rules
  above, the statement count for 2 and 50 routines, and the tools in Ask first and
  Read only. `test_trace_privacy.py` adds routine canaries over the API and MCP.
- UI: Storybook stories for every screen state; unit tests count Home's reads.

## Alternatives and tradeoffs

- **Routine per User:** would need each step to name an Entity and to show on
  every Entity's Home. Rejected; every other record is per Entity.
- **Stored RRULE:** needs `dateutil` and a UI that edits arbitrary rules. The small
  cadence structure covers every routine named and maps to RRULE later.
- **Ticking as a Pending change in Ask first:** a tick is not financial and is
  reversible; pending it would make a walkthrough unusable.
- **History paging endpoint (`?before=`):** deferred. The list returns the last 12
  and any scheduled date can be opened directly.

## Delivery and compatibility

Additive. `6j030` code never reads the new tables. Grant the runtime role access
to them after upgrading ([deployment](../technical/deployment.md)).

## Open decisions

- Reminder delivery and what text may leave the Box (phases 3 and 4).
- Technical: step ticks are last write wins; add a revision if concurrent ticking
  of the same step from two clients ever matters.
