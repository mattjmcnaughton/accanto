# 18 — Entry schedules: planned entries staged in the inbox on a cadence

Status: Implemented; the owner approved the inbox model (2026-11-27)
Updated: 2026-11-27

## Purpose and scope

The owner wants money that moves the same way every month to show up without
typing it. For example: a 401(k) deferral recorded as income to a net-income
line on the last weekday of each month, together with the matching investing
entry into the 401(k). This adds the **Entry schedule**, **Scheduled date** and
**Inbox pair** from [CONTEXT.md](../../CONTEXT.md).

A schedule names one or more entries and a cadence. The hourly tick of
[TDD 11](11-background-jobs.md) stages each due date once in the Transactions
inbox ([TDD 02](02-transactions-inbox.md), [TDD 12](12-inbox-batch-flow.md)) as
waiting items, with the planned completion as their proposal. The owner accepts
them there like any other item, and that is what records them. Schedules reuse
the Routine cadence of [TDD 13](13-routines.md). Read this with the
[constitution](../../CONSTITUTION.md) and [architecture](../architecture.md).

Excluded:
- transfers between Accounts and loan payments (a schedule stages Monthly-ledger
  entries only: income, fixed costs, guilt-free spending, saving, investing,
  giving);
- amounts that vary by date;
- staging dates before the schedule was created;
- reminders outside the app.

## Workflows and domain rules

**Decision (owner, 2026-11-27): stage in the inbox, do not record directly.**
A due date becomes waiting inbox items on the next hourly tick. An earlier draft
recorded them directly; the owner chose the inbox model instead because:
- the inbox is already where he confirms money: single, batch (`x`) and flow
  (`F`) all apply;
- nothing counts in totals until he accepts it;
- a likely duplicate from YNAB sits next to the scheduled item, so he can see
  both and keep one.

Each staged item carries:
- payee: the schedule's name;
- memo: the line's note;
- origin: the schedule and date, in place of a Transaction source;
- proposal: the line's category, assignment, funding origin and tags, proposed
  with interface `schedule`;
- `proposal_rejection`: the record checks' verdict at staging time, so an
  inactive destination or a savings shortfall shows before anyone accepts it.

Accepting runs exactly the inbox record command. The item's note and the owner's
edits to the completion behave as for any item.

**Double counting with YNAB.** When YNAB syncs the same money, for example the
payroll deposit, a scheduled item and a YNAB item for it are both in the inbox.
Each waiting item of the pair shows **Likely the same money** with the other
item. `m` keeps the current item and ignores the other one (or ignores the
current one when the other is already recorded). Ignoring is the existing
`skip`, so `z` returns the item and a re-sync keeps a YNAB item ignored. Nothing
is linked or recorded automatically: a wrong pair would hide a real second
payment.

The owner (UI or API) or an Agent (MCP or built-in) can:
- create, edit, pause, resume and end a schedule;
- skip one upcoming (or failed) date, or put a skipped upcoming date back;
- record or ignore its inbox items through the existing inbox tools.

Only the tick stages dates.

| Rule (domain name) | Authoritative source | Commands affected | Enforcement | Verification |
| --- | --- | --- | --- | --- |
| Dates follow the Routine cadence in the Entity time zone. `weekend` moves a monthly or yearly day that falls on a Saturday or Sunday to the weekday before or after, within the same month | CONTEXT.md, Entry schedule | Reads, tick | Pure `domains/routines` (`Cadence.weekend`, `_weekday_near`) and `domains/schedules.first_on_or_after`, `upcoming` | Unit `test_schedules.py`: last day + before gives Sep 30, Oct 30 (Oct 31 is a Saturday), Nov 30, Dec 31, Jan 29, Feb 26 |
| Each date is staged at most once, also across restarts, overlapping ticks and missed ticks | This TDD | Tick | `UNIQUE (schedule_id, scheduled_on)` on the occurrence; a unique line per occurrence on `staged_transaction`; staging runs under the Entity row lock and stages only `next_on`, then advances it | Integration `test_schedules.py`: two concurrent ticks and a third stage Oct 26, 28 and 29 once each (six items) and pass a skipped Oct 27 |
| A tick catches up at most 24 dates per schedule. Dates before the schedule's creation are never staged | This TDD | Create, tick | `CATCH_UP`; `next_on` starts at the first date on or after both `starts_on` and today | Integration: a schedule created on Oct 26 with an October start stages nothing before Oct 26 |
| Staging records nothing; accepting an item is an ordinary inbox record | CONTEXT.md, Actual entry; TDD 02 | Tick, inbox record | `write_stage` inserts staged transactions only; record and batch record are unchanged | Integration: no entries after staging; recording one item and a batch of three gives the four entries |
| A date that cannot be staged (a line's record no longer exists) is kept as failed with its reason, retried every tick and skippable. Its other dates continue | This TDD | Tick, skip | `check_lines` in the stage write; `keep_failure` stores the rejection (audited only when it changes) and advances `next_on` | Integration: a missing investment fails Oct 31 with `invalid_line`; the same reason an hour later adds no audit row; restoring the line stages it |
| A line that would be rejected when recorded still stages, with the reason on its proposal | TDD 02, proposal rejection | Tick | `check_proposals` stores the record dry run on each new item | Integration: an inactive investment stages, and only the investing item shows `inactive_destination` |
| Staged items are proposed as the schedule; staging is audited as the schedule | Constitution §4 | Tick | `access.schedule_actor`: the owner as user, `credential_kind` and `interface` `schedule` | Integration: three `schedule_stage` audit rows with `interface = "schedule"` and the owner as actor |
| Pausing stages nothing until resumed; dates while paused are never staged later | This TDD | Edit | Resume sets `next_on` to the first date on or after today | Integration: paused, then resumed on Nov 3, Nov 1 and 2 never arrive |
| Skip once applies to one of the next 3 dates or a failed date; a staged date's items are ignored in the inbox | This TDD | Skip | `write_skip`: `not_scheduled`, `occurrence_staged`, `not_skipped`, `occurrence_passed` | Integration: skipping a staged date and putting back a passed one are rejected |
| Editing changes future dates only; items already in the inbox stay as staged | CONTEXT.md, Entry schedule | Edit | Edit keeps `next_on`; staged items are never rewritten | Integration: a raise arrives from the next date |
| Ending sets `ends_on`; no date after it is staged | This TDD | Edit | `state = ended` once `next_on` passes `ends_on` | Integration: ended on Nov 4, Nov 4 arrives and nothing after it |
| An inbox pair is a waiting item and an item of the other origin (schedule or source), waiting or recorded, with the same exact signed amount and dates within 4 days. The nearest date wins | CONTEXT.md, Inbox pair | Inbox reads | Pure `domains/schedules.likely_pair`; `services/inbox.item_pairs`, one query per list | Unit: a 1,200.00 deposit on Dec 2 pairs with the Nov 30 income; an outflow pairs with the investment; two YNAB items never pair; 4 days pairs, 5 days or 1,200.01 does not. Integration: the deposit and the schedule's income flag each other, a far deposit flags nothing |
| Keeping one of a pair ignores the other; nothing is linked or recorded | CONTEXT.md, Inbox pair | Inbox skip | The existing skip command | Integration: recording the scheduled income and ignoring the deposit adds one entry; UI test: `m` ignores the other item and `z` returns it |
| Scheduled items never wait to clear and never take part in sync | TDD 02, decision F6 | Sync | Staged `cleared: true`; sync only reads and writes its own source's rows | Integration: `cleared` is true and `source_id` null on scheduled items |
| Schedules stay in their Entity | Constitution §2 | All | Composite FKs, including the item's occurrence; scoped lookups | Integration: another Entity's path returns 404 |
| Names and notes are Untrusted and stay out of telemetry | Constitution §6 | Tools, logs, tick | `Untrusted` projections; the tick step logs only counts | `test_trace_privacy.py` schedule canary over API, MCP and the tick |

Rejections leave every record unchanged:
- 404: `schedule_not_found`;
- 422: `invalid_schedule`, `invalid_cadence`, `invalid_line`, `not_scheduled`,
  `not_skipped`, `occurrence_passed`;
- 409: `occurrence_staged`, `stale_revision`, `key_reuse`.

## Implementation and data

- **Migration `6t040`:**
  - `entry_schedule`: the cadence columns of `routine`, plus `weekend`,
    `starts_on`, `ends_on`, `paused`, `next_on`, `lines` JSONB and `revision`.
  - `entry_schedule_occurrence`: `scheduled_on`, `status` (`staged`, `skipped` or
    `failed`), `rejection` JSONB; unique per schedule and date.
  - `staged_transaction.source_id` becomes nullable, and it gains
    `schedule_occurrence_id` (composite FK with `entity_id`). A check requires
    exactly one origin, and a partial unique index covers `(occurrence,
    source_ref)`, where `source_ref` is `line-N`.
  - Existing rows are unchanged. `/readyz` pins `6t040`. The downgrade deletes
    scheduled inbox items.
- **Domain:** `domains/routines.py` gains `weekend`. `domains/schedules.py`
  holds the lines (a line becomes a staged transaction plus a proposal; its
  completion maps to the record command through the inbox's `command_for`), the
  dates, the states and `likely_pair`. Pure, with an explicit `today`.
- **Service:** `services/schedules.py`.
  - `create_schedule`, `edit_schedule`, `set_schedule_occurrence` and
    `stage_schedule_date` run inside `services.monthly.write()`.
  - The list reads in a fixed number of statements whatever the number of
    schedules. Each recent date lists its inbox items and their statuses.
- **Tick:** step `scheduled_entries` in `jobs/tick.py` calls `stage_due`. It
  stages each date in its own transaction with a fresh request key, then stores
  the dry-run verdicts.
  - Counts: `staged`, `unchanged`, `not_staged`.
  - A date that cannot be staged is the owner's to fix and does not fail the
    tick.
- **Inbox:**
  - Items carry `schedule` (origin) and `pair`; `source_id` is null for a
    scheduled item.
  - No new commands. Search, notes, the all-done card, batch and flow treat
    scheduled items like any waiting item: the schedule's name is the payee and
    the line's note the memo, so search finds both.
- **API:** `GET/POST /schedules`, `GET/PUT /schedules/{id}`,
  `PUT /schedules/{id}/occurrences/{date}` ([api.md](../api.md#entry-schedules)).
- **Agent tools and MCP:**
  - Read: `list_schedules`.
  - Gated writes: `save_schedule` and `skip_schedule_date` (a Pending change in
    Ask first, direct in Apply directly, rejected in Read only).
  - `list_inbox` shows `schedule` and `pair`. Recording and ignoring use the
    existing inbox tools and their modes.
- **UI:**
  - Schedules screen under This month (no number key), on desktop and phone.
    Each schedule shows its entries, money in and out per date, the next dates
    as skip chips, failed dates with their reason, the last date's accepted and
    waiting items, and Pause and Edit.
  - The editor reuses the Routine cadence fields and adds the weekend rule.
  - Inbox: a Scheduled chip and origin line, and a Same money? chip with the
    pair notice and `m`.

## Atomicity, concurrency, and retries

Staging a date commits the occurrence, its items, the audit row, `next_on` and
the retry outcome together under the Entity row lock. The unique keys make a
second staging of the same date impossible even if two ticks pass the lock in
turn: the second sees `next_on` already advanced and stages nothing. Each
attempt uses a new request key, so a stored "nothing to do" outcome never
replays over a later attempt. Schedule edits check `expected_revision`; skips
are keyed by schedule and date. Recording and ignoring are the inbox's own
revisioned commands.

## Verification

- Unit: `tests/unit/test_schedules.py` (dates, weekend rule, states, a line's
  staged form, the pair rule) and `tests/unit/test_tool_catalog.py`.
- Integration on PostgreSQL: `tests/integration/test_schedules.py` covers the
  rules above, the statement count for 2 and 20 schedules, and the tools in
  each Agent mode. `test_trace_privacy.py` adds schedule canaries and the tick
  step.
- UI: Storybook stories (list, editor, errors, phone, inbox schedule items);
  unit tests for the screen's single cold read, pause and skip bodies, and the
  inbox pair key with undo.

## Alternatives and tradeoffs

- **Record directly and match a YNAB item to the recorded entry:** the first
  draft. Rejected by the owner, who prefers to confirm every entry in the inbox.
- **Link the pair instead of ignoring one:** linking would need a second
  recorded state for an item with no entry of its own. Ignoring keeps one
  model, and the ignored item remains visible under Ignored.
- **Pair automatically:** a wrong pair hides a real second payment. The rule is
  narrow enough to flag, not to decide.
- **One schedule per entry:** the 401(k) case is two entries that belong
  together. One schedule keeps them on the same dates and paused together.

## Delivery and compatibility

Additive except that `staged_transaction.source_id` becomes nullable. Code
before `6t040` joins every staged row to its source, so it leaves scheduled
items out of the inbox until the new code runs. Deploy the code with the
migration, as the merge queue does.
Grant the runtime role access to the new tables after upgrading
([deployment](../technical/deployment.md)).

## Open decisions

- Owner: whether a pair should also accept a YNAB amount within a small
  tolerance (today exact cents only).
