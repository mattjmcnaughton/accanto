# 07 — Spending subcategories

Status: Implemented
Updated: 2026-11-27

## Purpose and scope

The owner asked to "assign a guilt-free spending to, for example, books or
eating-out", so he can see where guilt-free spending goes. This adds the
**Spending subcategory** from [CONTEXT.md](../../CONTEXT.md): guilt-free
spending's **Assignment**, exactly as a Fixed cost is for fixed costs. It follows
the "Naming review" of the
[subcategories and tags design review](https://ampcode.com/artifacts/transaction-subcategories-and-tags-design-options-392d9fb8-3471-4122-be58-074a52abee35).
Read with the [constitution](../../CONSTITUTION.md) and
[architecture](../architecture.md).

Excluded: planned amounts per subcategory (the Plan's guilt-free spending stays
one number; optional, informational estimates were added later, see
[Spending estimates](#amendment-2026-11-27-spending-estimates)); subcategories for other
categories (a Fixed cost already is the fixed-cost subcategory); nesting; merging;
deleting; a label-only bulk command. Tags ([TDD 05](05-tags.md)) are a separate,
overlapping concept: several per entry, any category, totals that overlap. A
subcategory is one per guilt-free spending entry and reconciles to the category
total.

## Workflows and domain rules

The owner (UI or API) or an Agent (MCP or built-in, through the Agent mode
dispatcher) can:

- create, rename, archive and restore subcategories;
- name a subcategory, or none (Unassigned), when recording or correcting a
  guilt-free spending entry (`spending_subcategory_id`);
- propose and record an inbox item's subcategory through the existing
  `assignment`, which replaces the old "Guilt-free spending has no assignment"
  rejection with an optional assignment;
- read the month's guilt-free spending grouped by subcategory in the Review.

| Rule (domain name) | Authoritative source | Commands affected | Enforcement | Verification |
| --- | --- | --- | --- | --- |
| Only guilt-free spending has a Spending subcategory, at most one per entry, optional | CONTEXT.md, Spending subcategory, Assignment | Create/edit entry, inbox propose/record | DTO validator; service check; `entry_spending_subcategory.actual_entry_id` unique | Unit: inbox maps `assignment` to `spending_subcategory_id`, none is Unassigned; integration: fixed-cost entry with one is 422 |
| A subcategory belongs to the entry's Entity | CONTEXT.md, Domain boundaries | Same | Composite FK `(spending_subcategory_id, entity_id)`; service lookup | Integration: another Entity's subcategory is `404 spending_subcategory_not_found` |
| An archived subcategory stays on its entries, which stay correctable, but cannot be chosen for another entry | CONTEXT.md, Spending subcategory; Active / inactive | Create/edit entry, inbox record | Pure `domains/spending_subcategories.check_assignment`, checked under the Entity lock | Integration: new entry is `422 archived_spending_subcategory`; correcting a kept entry succeeds |
| Subcategories are archived, never deleted; renaming relabels past entries | Owner decision (design review) | Edit subcategory | No delete route or tool; entries read the current name (no snapshot) | Integration: rename shows the new name on an older entry |
| A linked refund names its purchase's subcategory | CONTEXT.md, Spending subcategory; Record a purchase refund | Create refund, edit purchase | Refund creation copies the link; a purchase change rewrites its refunds' links in the same transaction, bumping and auditing each | Integration: refund inherits, then follows a change |
| Subcategories change no amount, total, Plan or saved version, and have no planned amounts | CONTEXT.md, Spending subcategory; constitution §1 | All | Only `explain_review` reads them, to group already-counted entries | Unit and integration: category total unchanged |
| The Review breakdown adds up exactly to the guilt-free spending total | CONTEXT.md, Spending subcategory; constitution §1 | Review read | Pure `domains/monthly_comparison.breakdown` puts every entry in exactly one group (Unassigned is `id: null`); `compare_category` with the identity key and no planned lines | Unit: refund nets to `0.00`, adjustment is Unassigned, sum equals recorded; integration: same on PostgreSQL |
| Changing an entry's subcategory is an entry edit | Constitution §1, §7; CONTEXT.md, Review checkpoint | Entry edit, refund propagation | Revision bump and before/after audit; rename or archive bumps only the subcategory's revision | Integration: refund revision advances when its purchase changes |
| Names: 1–120 characters, unique per Entity ignoring case | This TDD | Create/rename | Pure `subcategory_name`; unique index on `(entity_id, lower(name))` | Integration: 409 on a case-insensitive repeat |
| Subcategory names are Untrusted data | Constitution §6; CONTEXT.md, Untrusted data | Agent tool projections | `SpendingSubcategory.name` and `BreakdownLine.name` are `Untrusted` | Unit: `test_tool_catalog.py` |

Rejections leave every record unchanged and return a code:
`spending_subcategory_not_found` (404), `spending_subcategory_category`,
`archived_spending_subcategory`, `invalid_spending_subcategory` (422),
`spending_subcategory_exists` (409), plus the usual `stale_revision`.

## Implementation and data

- **Migration `6f026`** (after `6e025`): `spending_subcategory (id, uuid,
  entity_id, name, active, revision)` with `UNIQUE (id, entity_id)` and the name
  index; `entry_spending_subcategory (id, uuid, actual_entry_id unique,
  spending_subcategory_id, entity_id)` with composite FKs, matching
  `entry_fixed_cost` without its name snapshot. Additive; existing entries stay
  Unassigned and nothing is backfilled.
- **Domain:** `domains/spending_subcategories.py` (`subcategory_name`,
  `check_assignment`); `domains/monthly_comparison.breakdown`.
- **Service:** `services/spending_subcategories.py` inside
  `services.monthly.write()`: create, edit, and the `assign_entry` hook the entry
  command calls. `services/refunds.py` copies the link on refund creation. Entry
  snapshots include `spending_subcategory_id` and `spending_subcategory_name`.
- **API:** `GET/POST /spending-subcategories`, `PUT
  /spending-subcategories/{id}`, `spending_subcategory_id` on `/activity`
  ([api.md](../api.md#spending-subcategories)), and
  `comparison.spending.breakdown` on Review reads. Like `fixed_cost_id`, a `PUT`
  replaces the whole entry, so omitting it makes the entry Unassigned.
- **Inbox:** `assignment` for `spending` is a subcategory UUID, `"unassigned"`, or
  absent (Unassigned); `check_references` checks it exists; `command_for` passes
  it as `spending_subcategory_id`.
- **Agent tools:** `list_spending_subcategories`; `Entry.spending_subcategory_id`;
  `CategoryComparison.breakdown`; gated write `save_spending_subcategory`
  (create, rename, archive, restore), a Pending change in propose mode, like
  `save_tag`. Entries take it through `save_activity` and `set_proposals`.
- **UI:** a Spending subcategories manager on Activity, also opened from the Plan
  worksheet, which lists active subcategories under guilt-free spending without
  amounts (its + adds one, a row's ⋯ renames or archives); a Subcategory picker in
  the guilt-free spending entry form; the subcategory in each row's description;
  the Inbox `a` key and Subcategory field for guilt-free spending (optional, shown
  as Unassigned); in the Review, guilt-free spending's lines are its subcategory
  groups, with recorded amounts and their entries and no planned or difference
  columns.

## Atomicity, concurrency, and retries

Every command runs in the shared `write()` transaction under the Entity row lock,
with audit rows and the idempotency outcome, so archiving cannot race an entry
that chooses the same subcategory. A purchase's subcategory change and its
refunds' changes commit together. Retrying with the same key and body returns the
recorded outcome.

## Verification

- Unit: `tests/unit/test_monthly_comparison.py` (breakdown sums, refund nets,
  adjustment Unassigned), `tests/unit/test_inbox.py` (spending assignment is
  optional), `tests/unit/test_tool_catalog.py` (tool names, Untrusted names).
- Integration: `tests/integration/test_spending_subcategories.py` and the inbox
  journey in `tests/integration/test_inbox.py`, on PostgreSQL.
- UI: Activity, Inbox and Review unit tests; Storybook `Subcategorized` stories
  for Activity and Monthly Review.

## Alternatives and tradeoffs

- **A `subcategory` column beside the assignment machinery** (design option B):
  rejected in the naming review; it would add a second name for Assignment.
- **A built-in list:** not the owner's taxonomy, and unlike every other named
  record. Rejected.
- **Tags for this:** tags overlap, so they cannot give a breakdown that adds up.
- **A name snapshot like `entry_fixed_cost.name`:** a rename should relabel past
  entries; the audit log keeps the old name.

## Delivery and compatibility

`6e025` code ignores the new tables and keeps an entry's link when editing it, but
does not copy it to new refunds or clear it on a category change; the next
`6f026` edit clears a stale link. Grant the runtime role access to the two new
tables after upgrading ([deployment](../technical/deployment.md)).

## Open decisions

- **Agent creation (decided 2026-11-26 by the owner): allowed when needed.**
  Agents may create, rename and archive subcategories through
  `save_spending_subcategory`, a Pending change in propose mode, as with tags.
- **Label-only edits flag a reviewed month.** Changing an entry's subcategory
  bumps its revision, which marks a reviewed month for another look, as tags do.
- **No bulk label command in v1.** Backfilling history goes entry by entry
  through `save_activity`; a `set_entry_spending_subcategories` command can be
  added if agent backfill is wanted.

## Amendment 2026-11-27: Spending estimates

The owner asked: "I want the ability to set estimated amount for sub-categories
in guilt-free, I just don't want it to be mandatory." This adds the **Spending
estimate** from [CONTEXT.md](../../CONTEXT.md): an optional monthly amount per
subcategory in a Plan revision.

**Where estimates live (decided here): per Plan revision**, in
`plan_spending_estimate_line`, like every other Plan line. A draft edit replaces
them, saving a version copies them, and a copy keeps them, so a saved version's
estimates never change and Reviews read the version they compare against.
Rejected: a column on `spending_subcategory`, which would rewrite past Reviews
whenever an estimate changed (constitution §1).

| Rule (domain name) | Authoritative source | Commands affected | Enforcement | Verification |
| --- | --- | --- | --- | --- |
| Estimates are optional and informational: no Plan total, unassigned amount or Review difference reads them | CONTEXT.md, Spending estimate | Create/edit/copy Plan, save version, Review read | Plan results ignore `spending_estimates`; `with_estimates` only annotates the breakdown | Unit: `test_monthly_comparison.py`; integration: totals unchanged after adding estimates |
| Estimates need not add up to guilt-free spending; uncovered money is Unestimated, an excess is shown as the amount over | CONTEXT.md, Spending estimate | Review read, Plan worksheet | Pure `domains/monthly_comparison.with_estimates` (`unestimated` = planned − sum, may be negative) | Unit and integration: `-25.50` when estimates exceed the total |
| At most one estimate per subcategory per revision; nonnegative cents | This amendment | Create/edit Plan | DTO money validator; `UNIQUE (plan_revision_id, spending_subcategory_id)`; `duplicate_allocation` | Database constraint |
| An estimate names a subcategory of its Entity; an archived one keeps an estimate it had but gains none | CONTEXT.md, Spending subcategory | Create/edit/copy Plan | Composite FK; `services/spending_subcategories.plan_estimates` with `check_assignment` | Integration: `archived_spending_subcategory`, `spending_subcategory_not_found`, kept on edit and copy |
| An estimated subcategory with no entry is not an unknown to answer | Constitution §1 (unknown is not zero) | Review read | Breakdown row with `recorded: null`; the UI shows "—" and asks nothing | UI unit: `ReviewDetails.test.tsx` |

Changing estimates is a draft edit (revision bump and audit, in `write()` under
the Entity lock). Interfaces: `spending_estimates` on Plan inputs and snapshots
([api.md](../api.md#spending-estimates)); `PlanDetail.spending_estimates`,
`BreakdownLine.estimated` and `CategoryComparison.estimated`/`unestimated` in the
agent tools (`create_plan`, `edit_plan_draft`); the Plan worksheet's subcategory
rows take an optional estimate and show Unestimated below them; the Review's
guilt-free spending lines show Recorded beside Estimated. Migration `6v042`
(after `6u041`) is additive with no backfill and needs runtime grants for the new
table and its identity sequence ([deployment](../technical/deployment.md)).

