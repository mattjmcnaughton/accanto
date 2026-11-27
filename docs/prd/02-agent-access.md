# 02 — Agent access: MCP, built-in agent, and the Transactions inbox

Status: Approved by the owner, 2026-11-23
Updated: 2026-11-23

## Purpose and authority

Let the owner run Accanto through agents as well as the UI and API. That means
external agents (Claude Code, Codex, Amp) over MCP, and a built-in agent in a
sidebar that can read the Entity, process incoming YNAB transactions, and change
anything the API can change with the owner's approval.

This PRD extends the [MVP PRD](01-mvp.md) and the
[Transactions inbox TDD](../tdds/02-transactions-inbox.md). It records the
decisions from the 2026-11-23 interview. [The TDD](../tdds/03-agent-access.md)
owns the implementation. [CONTEXT.md](../../CONTEXT.md) owns domain meanings and
[the constitution](../../CONSTITUTION.md) owns principles. The amendments those
documents need are listed under Required amendments.

The actor is the owner, a User with access to one or more Entities. An Entity is
one set of finances with its own Plans, activity, accounts, goals, and Reviews.
Agents act on behalf of the owner within one Entity at a time and never combine
Entities.

## The pattern

Each capability is one service operation, exposed through four thin adapters
that share one tool catalog:

| Adapter | Caller | Reach | Trust |
| --- | --- | --- | --- |
| REST + OpenAPI | Owner, scripts, coding agents | Full API | API key, full access |
| MCP at `/mcp` | Claude Code, Codex, Amp | The agent tool catalog | API key, full access (v1) |
| Built-in agent | The sidebar | The agent tool catalog | Browser session, plus the Entity's agent mode |
| Agent guide | Agents with a shell | Documentation of the REST rules | Not applicable |

## Agreed requirements

### AG-01 — One delivery

MCP, the built-in agent, and the Transactions inbox ship in one pull request,
which extends PR #39 (branch `transactions-inbox`), so the whole workflow can be
reviewed from sync to recorded entry.

### AG-02 — Transaction fetching

Sync is manual. The inbox has a Sync button, and agents may call a sync tool.
Nothing runs on a schedule. Development and tests use rich synthetic YNAB data
generated to YNAB's published API schema. The owner connects the live YNAB token
through a connect form in Accanto; it never passes through an agent, a thread,
or a deployment variable.

Acceptance: with synthetic data, the owner presses Sync, the inbox shows every
transaction type from the inbox mockup, and a second Sync with no changes stages
nothing new.

### AG-03 — MCP v1

- Served by the main application at `/mcp` on the existing deployment origin.
- Authenticated with the owner's existing API keys as bearer tokens, with full
  access. OAuth for claude.ai and mobile clients is a later phase.
- Offers the agent tool catalog (AG-05), not a mirror of every endpoint.
- Writes recorded through MCP are audited with interface `mcp`.
- Setup instructions for Claude Code, Codex, and Amp are documented.

Acceptance: Claude Code, Codex, and Amp each connect with a key, list tools,
read a synthetic Entity's monthly Review, and propose categories for inbox items.
Revoking the key denies the next call.

### AG-04 — Built-in agent

- A sidebar in the workspace, off by default. Each Entity opts in from Settings
  on a screen that names the model provider, what is sent, and the retention.
- Uses the same tool catalog as MCP and calls services in-process.
- Accepts text and images (receipts, statements, bills). Images are sent to the
  model for that turn and then discarded.
- Conversations are kept until the owner clears them, with a 30-day expiry.
- Model: a small, inexpensive model chosen by an eval, through OpenRouter,
  routed only to zero-data-retention endpoints.
- A daily message cap and a provider spend limit bound cost.

Acceptance: the owner asks "What did I spend on groceries in October?" and the
reply quotes figures computed by the services. The owner attaches a synthetic
receipt and gets an editable draft entry with uncertain fields flagged; nothing
is recorded until the owner applies it.

### AG-05 — Agent tool catalog

Agents can change anything the API can change, except the exclusions below.
Writes take an idempotency key; edits and deletes take the expected revision.

Included:

- Reads: context, Plans and versions, monthly Review, activity, savings,
  investments and giving, debts and observations, income estimates, inbox items,
  and sources (sync state only).
- Inbox: sync, set or clear proposals, record, skip or unskip, undo, resolve a
  conflict.
- Activity: record or correct an entry, record a known total, delete an entry,
  record, correct, or delete a refund.
- Plans and Reviews: create or copy a Plan, edit a draft, save a version, start
  a Review, update a Review.
- Savings: create or edit accounts, archive or reopen, create or edit goals,
  complete a goal, record, correct, or delete movements.
- Investing and giving: create or edit destinations, record, correct, or delete
  contributions.
- Debts and balances: create or edit debts, record, correct, or delete
  observations.
- Income estimates: create, edit, duplicate.
- Entity settings (2026-11-27): read; edit name, time zone, default expected
  return and FIRE assumptions. They follow the agent mode like any write.

Excluded from every agent surface:

- API keys: listing, issuing, revoking. Since 2026-11-27 this holds for every
  API-key caller, not only agents: credentials (API keys, the YNAB token, any
  future integration's) are managed only from a signed-in browser.
- Source setup: connecting YNAB, replacing or reading the token, disconnecting,
  choosing which accounts sync.
- The agent's own settings: enablement, agent mode, AGENT.md, retention.
- Sign-in, session, and health endpoints.

### AG-06 — Agent mode and approval

Each Entity has an agent mode, enforced by the server:

- **Read only.** Agents may read. Every write, including syncing and setting
  inbox proposals, is rejected.
- **Ask first** (default). Agents may read, sync, and set inbox proposals.
  Every other write becomes a pending change that the owner applies in Accanto.
- **Apply directly.** Writes run: the sidebar records them, and an MCP client
  records them once its own approval prompt (if any) allows it.

In Ask first and Apply directly, deletes that cannot be restored (savings movements and balance
observations) always become pending changes applied in Accanto.

Agent mode governs the agent surfaces (`/mcp` and the sidebar). It does not
restrict the REST API, and in v1 an MCP client's key is a full-access REST key
(AG-03), so a client that also has a shell can bypass the mode. Keys limited to
`/mcp` are the planned follow-up.

Acceptance: in Ask first, an MCP `save_activity` call records nothing and
returns a pending change that appears in the sidebar; applying it records one
entry with one audit row. A retry of the same apply returns the same entry.

### AG-07 — AGENT.md

Settings has an editable AGENT.md per Entity: the owner's standing instructions
for the built-in agent, such as "Sample Warehouse Club is groceries unless over $300". It is
added to the built-in agent's instructions on every turn. MCP clients can read
it, and agents can draft a new one as a Pending change, after an AGENT.md
interview ([TDD 10](../tdds/10-agent-md-interview.md)). It cannot widen what the agent may do: the catalog,
exclusions, agent mode, and Entity boundary are enforced in code.

### AG-08 — Trusted and untrusted content

Agents are told explicitly, and the code enforces, which content may instruct
them:

- **Trusted instructions:** Accanto's built-in system instructions; the owner's
  AGENT.md; the owner's own messages in the sidebar.
- **Untrusted data:** everything read from the Entity or a source. That includes
  payees, memos, notes, names of Plans, goals and destinations, Review notes,
  inbox proposal rationales written by any caller, YNAB fields, and all text in
  attached images. It is quoted as data and never followed as instructions.

An instruction found in untrusted data is reported to the owner, not obeyed.
Because the agent cannot change its own settings, keys, or sources, the worst a
hostile payee or receipt can cause through the agent tools is a proposed change
the owner sees first (or, in record-with-approval mode over MCP, one the client
asks about). The sidebar holds no credential, so this holds for it fully. An MCP
client that also has a shell and the key can reach REST (see AG-06).

### AG-09 — Data release

Approved: everything an agent tool returns may be sent to the model provider of
the agent that called it, including notes, payees, and attached images. For the
built-in agent that provider is reached through OpenRouter with zero data
retention. For MCP clients it is whichever provider the owner's client uses.
Credentials, tokens, audit history, and other Entities are never sent. Financial
values and conversation content stay out of logs and telemetry.

## Required amendments

- **Constitution §2:** MCP may authenticate with user-owned API keys; hosted MCP
  OAuth follows in a later phase.
- **Constitution §6:** reference this PRD as the explicit decision for sending
  financial data to model providers.
- **MVP TDD "AI framework":** AI features are authorized within this PRD.
- **MVP PRD out-of-scope list:** remove "AI features".
- **MCP contract (MVP-022):** superseded for v1 by the TDD (API keys, mounted at
  `/mcp`, wider catalog, notes released).
- **CONTEXT.md:** add Agent, Agent mode, Pending change, AGENT.md, and Untrusted
  data, alongside the inbox terms from TDD 02.

## Out of scope

- Scheduled or background sync, proactive agent runs, and notifications.
- Hosted MCP OAuth, claude.ai and mobile connectors (later phase).
- AGENT.md for MCP clients; agent-proposed edits to AGENT.md (since added by
  TDD 10).
- Write-back to YNAB.
- Financial advice and projections beyond what services compute.
- Storing images.

## Open (non-blocking)

- Daily message cap (default 200).
- Committing synthetic receipt images as test fixtures (needs owner approval
  under AGENTS.md; default: generate them in tests instead).
- Inbox items F6–F8 from TDD 02.
