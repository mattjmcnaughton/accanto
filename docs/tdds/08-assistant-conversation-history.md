# 08 — Assistant conversation history

Status: Draft, awaiting the owner's review
Updated: 2026-11-26

## Purpose and scope

The owner asked for "conversation history" in the assistant and "an option for
archiving conversations which soft deletes them". Today
([TDD 03](03-agent-access.md)) each User has one conversation per Entity, and
*New conversation* hard-deletes it. This design keeps several **Assistant
conversations** per User and Entity, lists them so one can be reopened, and adds
**Archive**, which hides a conversation without deleting it. Read with the
[constitution](../../CONSTITUTION.md), [CONTEXT.md](../../CONTEXT.md) and
[architecture](../architecture.md).

Excluded: search, renaming, pinning, restoring an archived conversation from the
UI, and storing tool steps with a reply (a separate change). Conversations stay
plain text: tool results and images are still never stored.

## Workflows and domain rules

The owner, signed in to the browser, can:

- start a new conversation: the next message creates it;
- see the Entity's active conversations, newest first, each titled by its first
  question;
- reopen one and continue it;
- archive one: it leaves the list and can no longer be read or continued, but its
  rows stay in the database until retention removes them.

| Rule (domain name) | Authoritative source | Commands affected | Enforcement | Verification |
| --- | --- | --- | --- | --- |
| A conversation belongs to one User and one Entity; a User may have several per Entity | CONTEXT.md, Assistant conversation | Send, read, list, archive | Every lookup filters by `user_id` and `entity_id` after `authorize` | Integration: another Entity's conversation id is `404 conversation_not_found` |
| Archived conversations are hidden, not deleted | Owner request | List, read, send, archive | `archived_at` set once; lookups require `archived_at IS NULL` | Integration: archived conversation is absent from the list, `404` to read or send, and its rows remain |
| Retention is unchanged: a conversation, archived or not, is hard-deleted 30 days after its latest turn | TDD 03; Settings disclosure | List, read, send | Expired rows of the User and Entity are deleted when any of them is read or admitted | Existing expiry behavior; integration of the list path |
| One reply at a time per User and Entity | TDD 03 | Send | Unchanged in-flight claim | Existing integration test |
| A conversation is created with its first stored turn, so the list never shows empty ones | This TDD | Send without a conversation | `insert_turn` creates the row in the settle transaction | Integration: a failed first turn leaves no conversation |
| Pending changes outlive their conversation | TDD 03 | Archive | Archive touches only `agent_conversation` | Integration: pending changes still listed |

Rejections leave everything unchanged: `conversation_not_found` (404) for an
unknown, archived, expired or other-Entity conversation.

## Implementation and data

- **Migration `6g027`** (after `6f026`): on `agent_conversation`, drop
  `UNIQUE (user_id, entity_id)`, add `archived_at timestamptz NULL`, and index
  `(user_id, entity_id)`. Existing conversations become the first entry in each
  history; nothing is backfilled.
- **Repository** `repositories/agent.py`: `active` (list with title, latest
  turn time and message count), `find`, `latest`, `archive`, and `insert_turn`
  taking the conversation id or `None` to create one. The title is derived from
  the first owner message (first 80 characters), not stored.
- **Service** `services/agent.py`: `admit` takes a conversation UUID, the latest
  conversation, or none (new); the `done` frame adds `conversation_id`.
- **API** (browser session only, like the rest of the agent routes;
  [api.md](../api.md#assistant-conversations)):
  `GET /agent/conversations`, `GET /agent/conversations/{id}`,
  `POST /agent/conversations/{id}/messages` (continue) and
  `POST /agent/conversations/messages` (new), `POST
  /agent/conversations/{id}/archive`. The TDD 03 routes stay as aliases for the
  latest active conversation; `DELETE /agent/conversation` now archives it
  instead of deleting it.
- **Agent tool catalog and MCP: left out, deliberately.** Conversations are the
  built-in assistant's own chat, not financial data; an MCP client keeps its own
  history, and the built-in agent receives its conversation as model history.
  Listing or archiving them through tools would let an agent hide its own
  transcript from the owner.
- **UI:** the panel header gains a History button. History lists the active
  conversations with Open and Archive; *New conversation* starts an empty one
  without deleting anything, so it no longer asks for confirmation.
- **CONTEXT.md:** adds *Assistant conversation*.

- **Interactive reads ([constitution §9](../../CONSTITUTION.md#9-bound-the-work-of-interactive-reads)):**
  the list is one set-based query (title, latest turn and count by subquery and
  join) after the expiry purge: 2 statements for 2 or 40 conversations, measured
  on PostgreSQL with synthetic data. It is bounded by retention (30 days) and the
  daily message cap rather than paging. Reads take no row locks
  (`authorize(lock=False)`); archive locks the Entity like other writes.

## Atomicity, concurrency, and retries

A turn's two messages and, for a new conversation, the conversation row commit
in one transaction after the reply, as before; a failed or stopped turn stores
nothing. The in-flight claim stays per User and Entity, so two tabs cannot
create two conversations from the same send. Archive is idempotent on an
already archived row only in the sense that a second call is `404`; it never
changes messages or Pending changes.

## Verification

- Integration (`tests/integration/test_agent_turns.py`, real PostgreSQL): start a
  second conversation, list both newest first with titles, continue the older
  one, archive one (gone from the list, `404` to read and send, rows kept), and
  the TDD 03 aliases follow the latest active conversation.
- Frontend unit: History lists conversations, opens one, and archive removes it.
- Storybook: history list and a reopened conversation; e2e still passes.

## Alternatives and tradeoffs

- **Keep the 30-day expiry for archived conversations.** Archiving is "hidden",
  and the Settings screen already promises 30 days of retention; keeping archived
  rows forever would break that promise. If the owner wants longer history, the
  retention setting is the place to change it.
- **Store a title.** Deriving it from the first question avoids a second source
  of truth and a rename feature nobody asked for.

## Delivery and compatibility

Additive migration plus dropping one unique constraint; reapply the runtime
grants in `docs/api.md` after upgrading. Old clients keep working through the
singular routes. Ships after the assistant UI commit, as its own commit.
