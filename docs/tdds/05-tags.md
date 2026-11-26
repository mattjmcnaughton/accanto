# 05 — Tags on actual entries

Status: Implemented
Updated: 2026-11-26

## Purpose and scope

The owner asked to "tag all transactions now, with one or more tags … throughout
DB, UI, MCP, API". This adds the **Tag** from [CONTEXT.md](../../CONTEXT.md): an
Entity-defined label that any Actual entry can carry, zero or more per entry, in
all six categories, including adjustments and entries recorded from the
[Transactions inbox](02-transactions-inbox.md). It follows option C of the
[subcategories and tags design review](https://ampcode.com/artifacts/transaction-subcategories-and-tags-design-options-392d9fb8-3471-4122-be58-074a52abee35).
Read with the [constitution](../../CONSTITUTION.md) and
[architecture](../architecture.md).

Excluded: Guilt-free spending subcategories (a separate, single-valued concept
that reconciles to the category total); tags on savings transfers, balance
reconciliation adjustments and balance observations; tag totals in the Review;
merging tags; nested tags.

"Cash-account tag", a legacy prototype term that existed only in docs, is renamed
**Cash-account label** in CONTEXT.md so Tag has one meaning.

## Workflows and domain rules

The owner (in the UI or API) or an Agent (MCP or built-in, through the Agent mode
dispatcher) can:

- create, rename, archive, restore and delete tags;
- set an entry's tags when recording or correcting it (`tag_ids`);
- replace the tags on many entries at once without touching anything else
  (label-only `set_entry_tags`);
- propose tags on an inbox item, and record the item with them;
- list activity with one tag.

| Rule (domain name) | Authoritative source | Commands affected | Enforcement | Verification |
| --- | --- | --- | --- | --- |
| A Tag is descriptive: it changes no amount, category, funding origin, Plan, saved version or total | CONTEXT.md, Tag | All entry commands, `set_entry_tags` | Tags live in `entry_tag`; no calculation reads them | Integration: a label-only edit keeps amount and note (`test_tags.py`) |
| Tags overlap; tagged amounts are never shares of a category total | CONTEXT.md, Tag; constitution §1 | Reads, UI, agent tools | No tag totals in the Review; `list_tags` and UI show entry counts, not amounts or percentages; tool description repeats the rule | Review: UI shows counts only |
| An entry's tags are current Tags of its Entity; an archived tag stays on entries that have it but cannot be added | CONTEXT.md, Tag | Create/edit entry and contribution, `set_entry_tags`, inbox record | Pure `domains/tags.entry_tags`; composite FK `(tag_id, entity_id)` | Unit: `test_tags.py`; integration: foreign-Entity tag 404, archived tag 422 |
| A linked refund carries its purchase's current tags | CONTEXT.md, Tag (owner decision 2026-11-25) | Create refund, purchase tag change, `set_entry_tags` on a refund, inbox refund completion | `require_refund_tags`; service copies tags on refund creation and rewrites refunds' tags when the purchase's tags change, in the same transaction | Unit: refund rejects even `[]`; integration: refund inherits and follows |
| Changing an entry's tags is an entry edit | Constitution §1, §7; CONTEXT.md, Review checkpoint | All tag-changing commands, including tag delete and refund propagation | Revision bump plus full before/after audit snapshot; unchanged sets do not bump | Integration: `checkpoint_changed` after a label-only edit; four audit rows for a delete touching three entries |
| Deleting a tag removes it from every entry | Owner decision 2026-11-25 | `delete_tag` | Each entry edited and audited, then the tag is soft-deleted; its name is reusable | Integration: `test_tags.py` |
| Tag names: 1–120 characters, unique per Entity ignoring case | This TDD | Create/rename | Pure `tag_name`; partial unique index on `(entity_id, lower(name))` where not deleted | Unit and integration (409) |
| Tag names are Untrusted data and stay out of telemetry | Constitution §6; CONTEXT.md, Untrusted data | Agent tool projections, logs | `Tag.name` is `Untrusted`; no tag names logged | Unit: `test_tool_catalog.py` |

Rejections leave every record unchanged and return a code: `tag_not_found`
(404), `archived_tag`, `too_many_tags`, `refund_tags`, `invalid_tag` (422),
`tag_exists` (409), plus the usual `stale_revision`.

## Implementation and data

- **Migration `6d024`:** `tag (id, uuid, entity_id, name, active, revision,
  deleted_at)` with `UNIQUE (id, entity_id)` and the partial name index; `entry_tag
  (id, uuid, actual_entry_id, tag_id, entity_id)` with composite FKs to
  `actual_entry` and `tag`, `UNIQUE (actual_entry_id, tag_id)`. Additive; nothing
  is backfilled.
- **Domain:** `domains/tags.py` (`tag_name`, `entry_tags`, `require_refund_tags`).
- **Service:** `services/tags.py` runs inside `services.monthly.write()`:
  `create_tag`, `edit_tag`, `delete_tag`, `set_entry_tags`, and the `tag_entry`
  hook the entry, contribution and refund commands call. Entry snapshots (and so
  every entry response and audit snapshot) include `tag_ids` in the order added.
- **API:** `GET/POST /tags`, `PUT/DELETE /tags/{tag_id}`, `POST /activity/tags`,
  `GET /activity?tag_id=`, `tag_ids` on entry and contribution commands
  ([api.md](../api.md#tags)). `tag_ids` omitted leaves tags unchanged; `[]` clears.
- **Inbox:** `CompletionInput.tag_ids`; the stored proposal keeps them;
  `command_for` passes them to the entry command. A refund or skip completion with
  tags is rejected.
- **Agent tools:** `list_tags`; `list_activity(tag_id?)`; `Entry.tag_ids` and
  `Proposal.tag_ids`; gated writes `save_tag`, `set_entry_tags`, and `delete_tag`,
  which always pends (it cannot be restored). Agents may create tags; in propose
  mode that is a Pending change (owner decision).
- **UI:** a Tags manager (create, rename, archive/restore, delete); a tag picker in
  the Activity entry form and Inbox completion; tag chips on Activity rows; an
  Activity filter by tag.

## Atomicity, concurrency, and retries

Every tag command runs in the shared `write()` transaction under the Entity row
lock, with the audit rows and the idempotency outcome. An archive or delete
therefore cannot race an entry write that adds the same tag. `set_entry_tags` is
all-or-none and checks each entry's `expected_revision`. A purchase's tag change
and its refunds' tag changes commit together. Retrying with the same key and body
returns the recorded outcome without another revision.

## Verification

- Unit: `tests/unit/test_tags.py` (names, archived tags, deleted and foreign tags,
  limit, refunds), `tests/unit/test_inbox.py` (tags reach the command; refund and
  skip reject tags), `tests/unit/test_tool_catalog.py` (tool names, `delete_tag`
  irreversible, Untrusted names).
- Integration: `tests/integration/test_tags.py` on PostgreSQL.
- UI: Activity and Inbox unit tests, plus screenshots of the Tags manager, the
  entry picker and the filter.

## Alternatives and tradeoffs

- **Subcategory (single label) instead:** reconciles to category totals but cannot
  express cross-category slices such as a trip. It remains planned separately for
  guilt-free spending.
- **Tag names as free text on the entry:** no rename, archive or delete, and more
  drift. Rejected.
- **Refunds with their own tags:** would let "tagged Italy trip" miss returned
  money. Rejected by the owner.

## Delivery and compatibility

`6c023` code ignores the new tables; entries are only soft-deleted, so the
`entry_tag` FK never blocks it. Grant the runtime role access to `tag` and
`entry_tag` after upgrading ([deployment](../technical/deployment.md)).

## Open decisions

- **Scope beyond actual entries (decided 2026-11-26 by the owner): actual entries
  only.** Savings transfers, reassignments, balance reconciliation adjustments and
  balance observations take no tags: they move, correct or observe money already
  counted, so tagging them would misstate what a tag's activity adds up to.
  Adding them later stays additive.
- Technical: no tag totals or percentages anywhere. A future "tagged activity"
  view must label results as overlapping, never as shares.
