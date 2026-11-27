# 12 — Inbox batch flow: proposal run, flow mode and Ignored

Status: Implemented
Updated: 2026-11-26

## Purpose and scope

Clearing a batch of about 150 synced transactions was slow. The built-in agent
could not propose for all of them in one reply: about 9 of its 12 requests go to
reads, and 150 proposals take minutes of output against a 90-second reply
timeout. Every Inbox keypress also reloaded nine reads, including the whole
inbox history. This change adds:

- a **proposal run**: the built-in agent proposes for every waiting item in the
  background, 25 items a step, as a job run (TDD 11);
- **flow mode** in the Inbox: one waiting item at a time, `Enter` accept, `l`
  Later, `s` Ignore, `e` edit, `z` undo, `Esc` leave; reviewed items advance
  immediately and record or ignore together in the background;
- the label **Ignored** for status `skipped`, which already was the lasting way to
  ignore an outside transaction.

Design and analysis: the "Inbox batch processing" artifact, confirmed by the
owner with the Storybook prototype (2026-11-26). Excluded: "Accept all ready"
(bulk record of every proposal that passed its dry run), retries of failed
steps, an ignore reason, and automatic ignore rules (P1 in TDD 02).

## Workflows and domain rules

| Rule | Source | Commands | Enforcement | Verification |
| --- | --- | --- | --- | --- |
| A proposal run records nothing | TDD 02 I1 | Proposal run steps | Steps call only `inbox.propose` | Integration: 31 items proposed, zero entries |
| Every item in a step leaves with a proposal, so the run always advances | — | Step | Unsure, missing or rejected answers become an empty proposal with a "Not sure" rationale | Integration: the unsure item has an empty proposal and `needs_choice`; the run ends in 2 steps |
| A run acts as the owner who started it, re-checked every step | Constitution §2 | Start, step | The run stores the session or API key UUID; each step resolves it and authorizes the Entity; revoked, expired, assistant off or Read only fails the run with a code | Integration: a revoked key fails the next step with `invalid_credential`; Read only rejects start |
| One active run per Entity | TDD 11 | Start | `job_run_active` index | Integration: starting twice returns the same run |
| Existing proposals are kept | — | Step | Steps take only items with no proposal | Integration: the owner's proposal survives |
| Ignored survives re-sync and stays out of totals | TDD 02 | Sync, skip | `synced_status` keeps `skipped`; totals read only entries | Existing inbox integration tests |
| Later saves nothing | — | Flow | Client-only reordering | Unit: no request on `l` |

## Implementation and data

- **Migration `6j030`**: `job_run.credential_kind` and `credential_uuid`, both
  null for scheduled runs. `/readyz` pins `6j030`.
- **Agent**: `agents/inbox_proposer.py`, a tool-less pydantic-ai agent whose
  output is one proposal per item. The step puts the items, the assignment
  options (names marked untrusted) and AGENT.md in one prompt; one model request
  per step. `AGENT_MODEL=stub` uses a deterministic stand-in.
- **Service**: `services/inbox_proposals.py`: `start_run`, `read_run`,
  `stop_run`, and `proposal_step`, registered as the `inbox_proposals` handler
  in the app lifespan. `StepError(code)` stores a fixed code on the run.
- **API**: `POST/GET/DELETE /inbox/proposal-run`; `limit` on `GET /inbox`.
- **Agent tool catalog and MCP**: `list_inbox` takes `limit`, so MCP clients can
  propose in chunks with `set_proposals`. Starting a run is **not** a tool
  (decision): a run spends the built-in agent's model on the owner's behalf; an
  MCP client already proposes with its own model.
- **UI**: Inbox header "Propose with agent" and "Start flow" (`F`); a run strip
  with progress and Stop, polled every 2 s while active; "Proposals ready: n
  proposed, m need you"; flow mode reusing the detail pane and pickers for edit;
  `s` with a selection ignores every selected item. In flow, each write's
  returned item patches the list and the other screens refresh once when flow
  ends (Constitution §9).
- **CONTEXT.md**: Ignored, Proposal run, Flow; a Proposal may be empty.

## Atomicity, concurrency, and retries

Each proposal is its own write with an idempotency key naming the run, item and
revision, so a repeated step (stale lease) cannot double-write. A step that sets
nothing ends the run instead of repeating. Stopping cancels the run; an
in-flight step finishes its writes but cannot settle (TDD 11 fencing).

## Verification

- `tests/integration/test_inbox_proposals.py` (real PostgreSQL, stub model).
- `tests/integration/test_trace_privacy.py` runs a proposal run in the real
  server and checks its log and export for canaries.
- `Inbox.test.tsx`: decisions advance without waiting, consecutive records use
  one batch, Undo cancels an unsent ignore, and a rejected item returns with
  its reason. An uncertain response retries the same payload and key.
- `tests/e2e/test_agent_browser.py`: the run and a flow pass in the browser.
- Storybook: Screens / Transactions inbox, AgentProposing through Ignored.

Flow distinguishes unconfirmed commands from saved entries. Leaving flow, hiding
the page or closing it starts a best-effort flush. Only the existing tab holds
the commands and retry identities (TDD 01). Before advancing, the browser marks
this Entity and flow instance as unconfirmed; the marker contains no item ID,
payee, amount, classification, payload or credential. A later visit warns if
confirmation never arrived. Closing offline can require repeating a decision;
the marker is a warning to reconcile, not a durable financial write queue.

## Open decisions

- Accept all ready: later, after seeing the proposal quality.
- Retries of a failed step, and cleanup of finished job runs (TDD 11).
