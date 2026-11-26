# 02 — Transactions inbox and source adapters

Status: Draft
Updated: 2026-11-22

## Purpose and scope

Let an Entity bring in transactions from an outside source and turn each one
into an actual entry quickly from the keyboard, instead of typing them by hand.
The **Transactions inbox** is part of Accanto and doesn't depend on any one
source. A **source adapter** fetches transactions from one provider and stages
them in the inbox. YNAB is the first adapter, because YNAB already receives
bank transactions through Plaid. Write-back to a source is a later phase.

Read with the [constitution](../../CONSTITUTION.md), [domain context](../../CONTEXT.md),
[architecture](../architecture.md), and the [MVP TDD](01-mvp.md), which owns the
`actual_entry` record and its relationships.

Interaction reference: [Transactions inbox mockup](https://ampcode.com/artifacts/visuals/transactions-inbox-mockup-d46ef2ce-b6b0-489a-a369-d23c510793e9),
with synthetic data.

**Scope.** Decision S1 moves read-only YNAB import into scope. The brief and
PRD deferral must be amended to read: *"Read-only import into the Transactions
inbox, starting with YNAB, is in scope. Other bank ingestion, write-back to
sources, and payment execution remain deferred."* Under constitution §6,
importing reads only data the source already holds. Write-back would send
Accanto data out and needs its own decision.

**Adapter boundary.** Constitution §5 forbids a generic provider framework
ahead of a concrete need. The inbox is provider-neutral because it only ever
sees a staged-transaction shape (below). The YNAB adapter is the only
implementation. There is no plugin registry, adapter discovery, or
configuration schema. A second source (CSV upload, another aggregator) would
add one module that produces the same shape.

Excluded: sources other than YNAB, background or scheduled sync, bank
reconciliation, YNAB budget/category balances and Ready to Assign, scheduled
transactions, and non-USD sources.

## Proposed domain terms (add to CONTEXT.md when agreed)

| Term | Meaning |
| --- | --- |
| Transaction source | An outside system connected to an Entity that supplies transactions, such as a YNAB plan. Accanto reads from it; it is not an authority over Accanto's records. |
| Staged transaction | One transaction (or one split line) from a Transaction source, waiting in the Transactions inbox. It is not an actual entry and never contributes to totals. Its status is waiting, skipped, recorded, or conflict. |
| Transactions inbox | The Entity's list of staged transactions. Each is recorded as an actual entry or skipped by an explicit action. |
| Proposal | A partial completion of a staged transaction (category, assignment, funding origin, refund link, or skip) with a rationale and its proposer. It is not an actual entry and is never applied without an explicit record. |

## Workflow

1. **Connect a source.** For YNAB: store an access token and pick one YNAB
   plan; Accanto checks the plan is USD. Select which YNAB accounts to import
   (default none).
2. **Sync.** The adapter fetches changes since its stored cursor and stages
   new, changed, and deleted transactions. Sync records nothing as an actual
   entry.
3. **Propose (optional).** Any API caller, typically an AI agent, attaches a
   proposal to staged transactions: "pre-label the transactions". Accanto
   holds no suggestion logic of its own.
4. **Record or skip.** The person, or any caller the person allows, records
   a staged transaction from its proposal or with changes, links a refund, or
   skips. Recording calls the existing entry commands with their normal domain
   checks. A rejected item stays waiting with the reason shown.
5. **Review.** The monthly Review shows "N transactions waiting in the inbox"
   for its month, so a short total isn't mistaken for a complete one.

### Proposals

A proposal is a partial completion of a staged transaction: category,
assignment, funding origin, refund link (purchase entry), or skip, plus a
short rationale. It stores who proposed it (User, interface, API key or
session) and when. Setting a proposal:

- validates its shape and that every reference exists in the same Entity;
- runs the record command's domain checks as a dry run and stores any
  rejection reason with the proposal, without failing the request;
- changes no actual entries or totals, and bumps the item's revision.

A proposal may be incomplete (for example, a category without an
assignment); recording then needs the missing fields. Proposals are replaced,
not merged, and cleared by `DELETE`. Recording from a proposal re-runs every
check under the Entity lock; a passed dry run is not a guarantee.

Accanto has no mapping tables or "last time you chose this" logic. The agent
derives proposals itself from the inbox, recorded entries, and its own
instructions. Per-item facts from the source (`kind`, source category, payee)
are exposed for it to use.

### API

Under `/api/entities/{entity_id}`:

| Method and path | Purpose |
| --- | --- |
| `GET /inbox?status=&month=&source=` | List staged transactions with source facts, proposal, rejection, revision |
| `GET /inbox/{item_id}` | One staged transaction |
| `PUT /inbox/{item_id}/proposal` | Set the proposal (expected revision required) |
| `DELETE /inbox/{item_id}/proposal` | Clear it |
| `PUT /inbox/proposals` | Set several proposals; per-item outcomes |
| `POST /inbox/{item_id}/record` | Record from the proposal, or from a body that overrides it |
| `POST /inbox/record` | Bulk record; each item in its own transaction; per-item outcomes |
| `POST /inbox/{item_id}/skip`, `/unskip` | Skip or return to waiting |
| `POST /inbox/{item_id}/undo` | Soft-delete the recorded entry and return the item to waiting |
| `POST /inbox/{item_id}/resolve` | Resolve a conflict: keep or delete the recorded entry |
| `GET/POST/PUT/DELETE /sources...` | Connect YNAB, select accounts, show sync state |
| `POST /sources/{source_id}/sync` | Fetch changes and stage them |

Writes take `Idempotency-Key` and expected revisions like existing commands.
Any authenticated caller with Entity access can use every endpoint, including
record (decision I2). Expose the same operations as MCP tools if the existing
MCP surface makes that cheap; otherwise list it as follow-up.

### Keyboard

From the mockup: `j`/`k` move; `Enter` records from the proposal (or
skips, when skip is proposed; records all selected items when some are
selected); `1`–`6` set the category and open the assignment picker when one is
needed; `a` assignment; `f` funding origin; `r` refund link from ranked
purchase candidates; `s` skip or un-skip; `x` select; `z` undo the last record,
skip, or bulk action; `v` cycle Waiting/Skipped/Recorded; `?` help. Pickers use
↑/↓ and type-to-filter.

## Staged-transaction shape (the adapter boundary)

The only thing the inbox and services know about a source:

```text
StagedTransactionInput
  source_ref          stable id from the source (YNAB transaction id + split line id)
  parent_ref          optional, groups split lines
  account_ref, account_name
  financial_date      date
  amount              Decimal cents, signed (inflow positive)
  payee               str
  source_category     optional (id, name)
  memo                optional
  kind                ordinary | transfer_on_budget | transfer_tracking | card_payment
  cleared, approved   booleans; false where the source has no such concept
  deleted             bool
```

And the client contract, as a `Protocol` in the consuming service:

```python
class TransactionSource(Protocol):
    async def changes_since(
        self, cursor: str | None
    ) -> tuple[list[StagedTransactionInput], str]: ...
```

Connection setup (listing YNAB plans, accounts, categories) is YNAB-specific
and stays in the YNAB adapter and its router.

### YNAB adapter specifics

From the [YNAB API](https://api.ynab.com/) and the official
[`ynab` SDK](https://github.com/ynab/ynab-sdk-python) (5.0.0, API 1.88):

- `GET /plans/{plan_id}/transactions?last_knowledge_of_server=N` returns only
  changes; deletions appear with `deleted: true`. The cursor is
  `server_knowledge`.
- Amounts are integer milliunits. Convert with `Decimal(milliunits) / 1000` and
  reject anything that isn't whole cents; never use `amount_currency`.
- `date` is used as the financial date unchanged.
- Each subtransaction becomes its own staged transaction under the parent.
- `kind` comes from `transfer_account_id` and account types (on-budget,
  tracking, credit card).
- 200 requests per token per rolling hour; a sync uses one or two.
- Implementation: a thin `httpx` client (T2).

## Data

```text
transaction_source          one per connected source
  entity_id, kind ('ynab'), external_ref (YNAB plan id)
  secret_ciphertext         (T1)
  cursor                    nullable until first sync
  revision

source_account_selection    source_id, account_ref, name_snapshot

staged_transaction          the inbox
  source_id, source_ref, parent_ref
  UNIQUE (source_id, source_ref)
  latest                    JSONB copy of the latest StagedTransactionInput
  status                    waiting | skipped | recorded | conflict
  actual_entry_id           FK, UNIQUE, set when recorded
  rejection                 last domain rejection reason, nullable
  changed_after_staging     bool, for "Updated in YNAB"
  proposal                  JSONB, nullable (category, assignment, funding,
                            refund_of, skip, rationale)
  proposal_rejection        dry-run rejection reason, nullable
  proposed_by_user_id, proposed_interface, proposed_at
  revision
```

Proposal changes are audited like other writes, though they are not financial
activity.

## Workflows and domain rules

| Rule | Source | Commands | Enforcement | Verification |
| --- | --- | --- | --- | --- |
| Staged transactions are not actual entries | CONTEXT.md Actual entry, Unknown actual (proposed terms above) | Sync; Review | Totals read only `actual_entry`; Review shows the waiting count | Integration: syncing 3 transactions leaves Review totals unchanged and shows "3 waiting" |
| Category, sign, assignment, and saving-goal rules | CONTEXT.md Actual entry, Unassigned activity, Saving goal | Record staged transaction | Recording calls the existing entry/contribution/refund service paths; no separate write path | Integration: recording as saving without a goal is rejected and the item stays waiting with the reason |
| Funding origin and remaining saved | CONTEXT.md Funding origin, Remaining saved | Record | Existing savings checks under the Entity lock | Integration: $640 from a goal with $180 saved is rejected; switching to current income records it |
| Refunds link to a purchase | CONTEXT.md; MVP TDD refund relationship | Record as refund | Existing refund rules (cap, date, origin) | Integration: a +$48 inflow links to a $90 purchase; a second +$48 against it is rejected once the cap is reached |
| Exact cents | Constitution §1 | Sync (YNAB adapter) | Pure conversion rejecting partial cents | Unit: 12340 → $12.34; 12345 rejected |
| Nothing recorded without an explicit record call (I1) | Constitution §1, deliberate choices | Sync; Propose; Record | Sync and propose never write `actual_entry` | Integration: sync, then proposals for every item, creates no entries and leaves Review totals unchanged |
| Failures change nothing | Constitution §7 | Sync; Record | Sync: one transaction for staging and cursor. Record: one transaction for entry, relationships, audit, item status | Integration: a YNAB 5xx leaves cursor and inbox unchanged |
| Retries don't duplicate | Constitution §7 | Sync; Record | `UNIQUE (source_id, source_ref)`; recording uses the staged transaction's id and revision as the idempotency key | Integration: pressing Enter twice records one entry and one audit record |

## Atomicity, concurrency, and retries

- **Sync** fetches outside the database transaction, then upserts staged
  transactions and stores the new cursor in one transaction, holding a lock on
  the `transaction_source` row. A concurrent sync gets "sync in progress".
- **Record** runs under the Entity lock: check the staged transaction's
  revision and status, write the entry and its relationships, audit
  (`interface = inbox`, source recorded in the audit snapshot), and mark the
  item recorded, all together. A rejection rolls back and saves only the reason.
- **Bulk record** records each selected item in its own transaction so one
  rejection doesn't block the rest; the response reports each outcome.
- **Undo** soft-deletes the entry through the normal delete command and returns
  the item to waiting, atomically.
- A sync that changes an already-recorded transaction never edits the entry;
  it marks the item and applies F7.

## Telemetry and secrets

Per constitution §6: log operation names, counts, timings, source HTTP status,
and record UUIDs. Never log amounts, payees, memos, category names, or tokens.
Test fixtures are handwritten and synthetic.

## Code placement

- `domains/inbox.py`: pure proposal validation and staged-transaction status
  transitions.
- `integrations/ynab.py`: the YNAB `httpx` client and mapping to
  `StagedTransactionInput`, including milliunit conversion and `kind`.
- `services/inbox.py`: sync orchestration against `TransactionSource`, record,
  bulk record, skip, undo.
- `routers/inbox.py`, `routers/sources.py` (connect YNAB, accounts, mappings),
  with DTOs in `dtos/`.
- Frontend: `features/inbox/`, plus the waiting count on the Review.

## Phase 2: write-back (not agreed)

Unchanged from the earlier draft: categories don't map back one-to-one, neither
side has labels (YNAB has six flags), YNAB can't edit split categories, our own
writes return in the next delta, and §6 needs a decision on what leaves
Accanto. Starting point if agreed: field ownership (the source owns amount,
date, account, payee; Accanto owns category), with explicit write-back actions
only. Write-back would add a second method on the YNAB adapter, not on the
generic `TransactionSource`.

## Alternatives and tradeoffs

- **Auto-record mapped transactions, hold only exceptions.** Fewer keystrokes,
  but it records without a deliberate choice and hides suggestions' mistakes.
  Rejected for I1.
- **A plugin-style adapter registry.** Premature with one source (§5).
- **CSV as the first source.** No credentials, but no updates/deletes and the
  person already has YNAB with Plaid.
- **Official `ynab` SDK.** Synchronous; see T2.

## Delivery and compatibility

Additive migration only. Disconnecting a source keeps recorded entries and the
inbox history. A live-YNAB contract test is marked `external`.

Acceptance: connect YNAB, select accounts, sync, and process every type shown in
the mockup through the API and the browser keyboard flow. Syncing again changes
nothing. A YNAB failure changes nothing. The Review shows its waiting count.

## Decisions

### Decided

| Id | Decision |
| --- | --- |
| S1 | Read-only import into scope now, with the narrow brief/PRD wording above. |
| S2 | Import first; design write-back after using it. Phase 1 keeps `source_ref` links and the latest source copy. |
| I1 | Transactions inbox: nothing becomes an actual entry without an explicit record call. Bulk record is explicit. |
| F1 | Superseded by I1: unmapped items wait with no suggestion. |
| F2 | Spending inflows wait until linked to a purchase as a refund. Ranked candidates are shown; nothing links automatically. |
| F3 | Superseded by P1: income source is part of a proposal. Unassigned income is a choice, never applied automatically. |
| F4 | Superseded by P1: funding origin is part of a proposal and editable per item. |
| F5 | Superseded by P1: how to treat transfers and card payments is the agent's guidance; Accanto exposes `kind`. |
| A1 | Generic Transactions inbox with source adapters; YNAB is the only adapter. No generic provider framework. |
| P1 | No suggestion engine or mapping tables. Callers attach proposals through the API; the person finalizes. |
| I2 | Any authenticated caller with Entity access may use every inbox endpoint, including record. No new key scopes. |
| D1 | Sending staged transaction data to an outside AI provider is allowed only when the person explicitly enables it. That opt-in belongs to the agent's design; this API sends nothing outside Accanto. |

### Open
- **F6.** Stage unapproved or uncleared transactions now, or wait until approved.
- **F7.** Source edits and deletes after recording: flag only (proposed), with
  keep-or-delete chosen by the person.
- **F8.** Payee: keep it in `note`, or add a payee field to actual entries.
- **T1.** Secret storage: encrypt at rest with an application key (new secret
  and rotation), and whether to use YNAB OAuth.
- **T2.** HTTP client: thin `httpx` client (proposed) over the synchronous SDK.
- **T3.** Manual sync only for now; a schedule is a new service under §5.
  The background job infrastructure it would use is adopted in
  [TDD 11](11-background-jobs.md); scheduled sync itself is not built.
- **UI.** Accept the mockup's binding changes (`v`, `1`–`6` opening pickers,
  oldest first). Until decided, follow the mockup.

F6 and F7 default to the mockup's behavior (stage unapproved items with a
badge; flag deletes as conflicts resolved by keep or delete) and stay open.
T1 defaults to encryption at rest with a new `source_secret_key` setting; T2 to
`httpx`; T3 to manual sync.
