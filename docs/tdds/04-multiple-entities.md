# 04 — Multiple Entities per User

Status: Implemented
Updated: 2026-11-25

## Purpose and scope

One User owns several Entities, for example a "Family" and a "Personal" Entity,
and works in either from the web app, the API and agents. The schema already
allowed this (`entity.owner_id` has no uniqueness rule, every financial table
carries `entity_id` with composite foreign keys, and `authorize()` checks ownership
per request). This design adds Create Entity, Entity switching in the browser, one
rule for Transaction sources, and agent guidance. See the
[constitution](../../CONSTITUTION.md) §2 (never combine Entities implicitly),
[CONTEXT.md](../../CONTEXT.md#domain-boundaries) and
[architecture](../architecture.md).

Excluded: sharing or membership; deleting, archiving or copying an Entity;
cross-Entity links, transfers or combined totals; per-Entity API keys (a key still
reaches every Entity its User owns).

## Workflows and domain rules

- **Create Entity.** Actor: the User. Inputs: name (1–120 characters, trimmed)
  and Entity time zone (IANA, checked with `ZoneInfo`). Outcome: an empty Entity
  owned by the caller. Rejections: invalid name or zone (422), key reuse (409).
- **Switch Entity** (browser only). The User picks another owned Entity; the
  workspace starts on that Entity's current month with its own records and
  agent conversation.

| Rule (domain name) | Authoritative source | Commands affected | Enforcement | Verification |
| --- | --- | --- | --- | --- |
| Entity boundary: records never link across Entities, including Entities of one User | CONTEXT.md Domain boundaries | Every financial command | Existing `scoped()` lookups by `entity_id` and composite FKs; unchanged | Another owned Entity's goal as a funding origin is `404 record_not_found`; integration |
| Totals never combine Entities | Constitution §2; CONTEXT.md | Reads, MCP guidance | No combined endpoint; MCP instructions allow labeled side-by-side figures only | Instruction text; no endpoint exists |
| Create Entity starts empty and is audited | This TDD | Create Entity | Service `create_entity` in one transaction with audit and retry outcome | Audit row `create_entity`, empty Plans/activity, retry returns the same Entity; integration |
| One Transaction source plan per User at a time | CONTEXT.md Domain boundaries | Connect source | Service check under the User row lock, inside the connect transaction | Connected in Family → Personal rejected `409 source_connected_elsewhere`; after disconnect it succeeds; a racing connect waits and is rejected; integration |
| The sidebar agent serves one Entity | CONTEXT.md Actors and roles; TDD 03 | Agent turns | Tools are bound to the turn's Entity; `get_context` lists only it; prompt says to ask the owner to switch | `get_context` for the sidebar returns only the current Entity; integration |
| Daily assistant cap is per User | TDD 03 Turn limits | Agent turns | `owner_messages_since` counts by `user_id` | Cap 2: one message in each Entity, the third is 429; integration |

Failures change nothing: each command still commits or rolls back as a whole.

## Implementation and data

- `POST /api/entities` (`routers/entities.py`) → `services/entity_settings.create_entity`,
  validated by `domains/entity.entity_settings`. The DTO `EntityInput` is shared
  with `EntitySettingsInput`.
- `services/inbox.write_source` (`connect_source`) checks for a connected source
  with the same `kind` and `external_ref` in another Entity owned by the same
  User and rejects with the other Entity's name.
- `repositories/agent.owner_messages_since` takes a `user_id`.
- Agent tool catalog: every write result (`WriteResult`, `ItemOutcomes`,
  `SyncResult`) carries `entity: {id, name}`; names are untrusted text. MCP
  instructions require asking which Entity when there are several and the request
  names none.
- Frontend: the Entity is the `?e=<uuid>` search parameter, present only when the
  User has several Entities, next to the existing `?m=`. The root route picks the
  Entity from the address, else the last-used ID in `localStorage`
  (`accanto.entity`, the ID only), else the first. The workspace is keyed by the
  Entity, so a switch remounts it and drops in-memory Plan drafts and pending
  writes. The top bar shows a switcher with the current Entity name and a Create
  Entity choice; the command palette has the same commands. The agent panel
  header and Pending change cards name the Entity.

No new tables or columns; no migration.

## Atomicity, concurrency, and retries

- Create Entity: the Entity row, its audit record and its retry outcome commit
  together. The retry outcome is stored with the new Entity's id and looked up by
  `(user_id, "create_entity", request_key)`; the User row is locked
  (`FOR NO KEY UPDATE`) before the lookup so concurrent retries with one key
  serialize and the second returns the first outcome.
- Connect source: the existing `write()` holds the Entity lock; the service then
  locks the User row (`FOR NO KEY UPDATE`, which does not block foreign-key share
  locks) before checking other Entities and inserting. Two connects of the same
  plan from two Entities therefore run one after the other, and the second sees
  the first. Lock order everywhere is credential → Entity → User, so there is no
  cycle. The existing `one_connected_source` partial unique index still prevents
  duplicates inside one Entity. A schema constraint across Entities would need a
  denormalized `owner_id` on `transaction_source` and a migration; the service
  lock gives the same guarantee without one.
- Switching in the browser is refused while a save is in flight or an agent reply
  is streaming, and asks before discarding unsaved input (the existing
  unsaved-changes guard).

## Verification

- `tests/integration/test_multiple_entities.py` (real PostgreSQL): Create Entity
  validation, audit, retry and key reuse, browser and API-key callers, foreign
  User 404; cross-Entity goal rejected as a funding origin; YNAB rule including a
  disconnected plan and a connect that waits on the User lock while another
  connect commits; per-User daily cap with separate conversations; sidebar
  `get_context` limited to its Entity; MCP write results name the Entity.
- `src/accanto/web/frontend/src/features/workspace/entities.test.tsx`: last-used
  Entity, switching to its own month and records, ID-only storage, palette
  commands, unsaved-changes guard, block while streaming, panel names the Entity.

## Alternatives and tradeoffs

- Entity as a path segment (`#/e/<id>/plans`) would change every route and link;
  a search parameter fits the existing `?m=` with little churn.
- Keeping the daily cap per Entity would let a User multiply it by creating
  Entities.

## Delivery and compatibility

No migration. Single-Entity Users see no address change and the same screens,
plus the Entity switcher. Rollback to the previous application is safe: extra
Entities stay valid rows; the previous UI simply shows the first.

## Open decisions

None blocking. Per-Entity API keys are deferred.
