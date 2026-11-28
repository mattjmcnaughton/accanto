# 22 — Delete Entity

Status: Implemented
Updated: 2026-11-27

## Purpose and scope

Now that an Entity is shared with other people, and first sign-in creates one
automatically, an owner needs a way to end an Entity they no longer want. This
adds **Delete Entity**: the owner, from Settings in a signed-in browser, types
the Entity's name and it is gone for everyone who shares it. See the
[constitution](../../CONSTITUTION.md) §1 (soft deletion, append-only audit) and
§2 (browser-only management, authorization on every request),
[CONTEXT.md](../../CONTEXT.md) and [TDD 19](19-entity-members.md).

Excluded: restoring a deleted Entity, a grace period, transferring ownership,
exporting before deleting, and physically erasing financial records.

## Workflows and domain rules

- **Delete Entity.** Actor: the Entity owner, signed-in browser. Input: the
  Entity's exact name (trimmed, case-sensitive). Outcome: every request to it,
  by anyone, through any credential, is 404; the person returns to `/`, which
  opens another Entity they can access or the "No Entity is available yet"
  state with Create Entity. Rejections: a member (403 `owner_required`), an API
  key and so any agent or MCP client (403 `browser_session_required`), another
  User's Entity (404), a wrong name (422 `name_mismatch`). Failures change nothing.

| Rule (domain name) | Authoritative source | Commands affected | Enforcement | Verification |
| --- | --- | --- | --- | --- |
| Only the owner deletes; members leave | CONTEXT.md Delete Entity | Delete Entity | `entity_members.owner_only` | Member is 403 and nothing changes; integration |
| Browser only, like managing members | Constitution §2 by analogy | Delete Entity | `BrowserToken` and `browser_only` | Owner's and member's API keys are 403; integration |
| The typed name must match | This TDD | Delete Entity | Service compares trimmed input with the name read under the lock | Lowercased name is 422; UI keeps the button disabled; integration and unit |
| A deleted Entity is unreachable everywhere, including a write already waiting | Constitution §2 | Every command and read; assistant turn settle | `authorize` reads `deleted_at` after the Entity row lock; the assistant settles under the lock | A member's write queued behind the delete is 404 and not applied; integration |
| Never touches another Entity | Constitution §2 | Delete Entity | Every statement is scoped to the locked Entity's id | Every row of the owner's other Entity and a stranger's Entity is unchanged, table by table; integration |
| Audit history only grows | Constitution §1 | Delete Entity | No audit row is updated or deleted (trigger and grants); the delete adds its own rows under one operation | Earlier rows unchanged, four new action types; integration |
| Background work stops | This TDD | Entry schedule tick, Notifications, job runs, first sign-in | Filters on `deleted_at`; active runs cancelled | Due work excludes the Entity; integration |

## Implementation and data

- **Migration `6z046`:** nullable `entity.deleted_at`. `/readyz` pins `6z046`.
- **Decision: soft delete with no grace period.** The constitution requires
  soft deletion of financial records and an append-only audit log whose rows
  reference the Entity, so financial rows cannot be physically removed without
  breaking that history. A recoverable grace period would need a restore path,
  a purge job and UI for a deleted-but-pending state; the typed-name
  confirmation is the guard instead. The UI says it can't be undone and no
  interface restores it; an operator could still recover it from the database.
- **Removed or erased now**, because each grants access or holds a secret or a
  person's words: `entity_member` rows (audited `remove_member`), the
  Transaction provider token (`secret_ciphertext` cleared, audited
  `edit_transaction_provider` with token-free views), connected sources
  (disconnected, audited `disconnect_source`), active `job_run`s (cancelled),
  `agent_conversation` and their messages for every person (deleted without
  audit, like retention in TDD 08). The Entity row gets `deleted_at` and a new
  revision, audited `delete_entity`.
- **Kept, unreachable:** Plans, entries, balances, inbox items, schedules,
  routines, tags, settings, Pending changes, retry outcomes and audit rows.
  Notification preferences are per User, not per Entity, so they stay;
  `notification_send` rows stay as history. Devices are per User.
- `services/entity_settings.delete_entity`, `DELETE /api/entities/{id}`.
- Listing filters: `account_metadata` (session, `get_context`), `ensure_own_entity`,
  `notifications.send_due`, `schedules.due_work`.
- Agent tool catalog and MCP: **not** a tool (decision per constitution §2),
  like managing members. `get_context` no longer lists a deleted Entity.
- UI: Settings → Delete Entity (owner only) with a dialog requiring the name;
  the no-Entity state now offers Create Entity.
- **Last Entity:** allowed. The owner lands on the no-Entity state and can
  create one there; their next sign-in also creates "Personal" as for any User
  who owns none. Refusing would force people to keep data they want gone.

## Atomicity, concurrency, and retries

One transaction under the Entity row lock (lock order unchanged: credential →
Entity). Writes waiting on the lock read `deleted_at` afterwards and are 404.
Lock-free reads that started before the commit may still answer from their
snapshot; the next request is 404. An assistant turn re-authorizes under the
lock before storing, so a reply finishing after the delete stores nothing. No
Idempotency-Key: a retry is 404, which the UI treats as done.

## Verification

- `tests/integration/test_entity_deletion.py` (real PostgreSQL): every rule
  above, including a row-for-row snapshot of the owner's second Entity and a
  stranger's Entity across every Entity-scoped table, and deleting the last Entity.
- `features/settings/Settings.test.tsx`: the name gate and redirect; no delete
  for a member. `features/workspace/entities.test.tsx`: Create Entity from the
  no-Entity state.

## Delivery and compatibility

Migrate and deploy together; no grant changes. Rolling the application back to
`6y045` code would make deleted Entities reachable again, so roll forward.

## Open decisions

None blocking. A restore window, export before delete, and physical purge of
deleted Entities after a retention period are deferred.
