# 10 — AGENT.md interview and agent read access

Status: Draft, awaiting the owner's review
Updated: 2026-11-26

## Purpose and scope

The owner asked for an "interview me to create my AGENT.md" option, "where the
agent asks you questions to populate its AGENT.md", and "an MCP option for
retrieving the AGENT.md values". AGENT.md already exists
([TDD 03](03-agent-access.md), PRD AG-07): one Markdown document per Entity in
`agent_settings.instructions`, with the settings `revision`, editable in
Settings and included in the built-in agent's context every turn. It was not
served to MCP and agents could not propose edits to it (PRD 02 out of scope).
This design lifts both exclusions, narrowly. Read with the
[constitution](../../CONSTITUTION.md), [CONTEXT.md](../../CONTEXT.md) and
[architecture](../architecture.md).

**Per Entity, not per User.** Conventions such as "transfers from Joint
Checking are skipped" or how goals are named belong to one set of finances; a
User with Family and Personal Entities needs different ones, and the built-in
agent already serves one Entity per conversation. Kept as it is.

Excluded: structured fields (the document stays free Markdown), version history
of AGENT.md beyond the audit row, interview state stored outside the
conversation.

## Workflows and domain rules

- **Interview** (built-in agent): the owner chooses *Interview me for AGENT.md*
  in an empty conversation. The agent reads AGENT.md, asks one question per
  reply (with a one-line reason and 2–4 likely answers), proposes the whole new
  AGENT.md in the conversation, and only after the owner approves calls
  `propose_agent_instructions`. The owner applies the resulting Pending change.
- **Edit directly**: Settings › Assistant, as before, with a rendered preview.
- **Read**: `get_agent_instructions` (built-in agent and MCP) and
  `GET /agent/instructions` (browser session or API key).

| Rule | Source | Commands | Enforcement | Verification |
| --- | --- | --- | --- | --- |
| No agent changes its own instructions | PRD AG-05, AG-08 | `propose_agent_instructions` | In `agent_writes.ALWAYS_PENDS`: pends in Ask first and Apply directly, for MCP and the sidebar; Read only refuses it like every write | Integration: Apply directly, MCP and sidebar drafts pend, no audit row until applied; Read only refuses every write tool |
| Applying changes AGENT.md only | This TDD | Apply | `edit_agent_instructions` keeps `enabled` and `mode` from the current row | Integration: mode stays `record`, enabled stays true |
| An update never silently overwrites newer text | Constitution §7 | Draft, apply | `expected_revision` checked in the draft's dry run and again under the Entity lock at apply | Integration: older draft applies as `stale_revision`; new draft on old revision rejected |
| Agents never reach enablement or mode | PRD AG-05 | Catalog | No tool input has `enabled`/`mode`; only `propose_agent_instructions` has `instructions` | Unit: catalog schema check |
| AGENT.md text cannot escape its prompt block | TDD 03 trusted content | Every turn | Any spelling of the `agent_md` tag is replaced with `[redacted]` | Unit: forged closing tag |

**MCP may read AGENT.md and may draft a new one, never write it.** Reading
helps external clients follow the owner's conventions. Writing directly would
let a client (or a prompt injection reaching it) rewrite the trusted
instructions every later turn obeys, so a draft is always a Pending change the
owner reads and applies in Accanto. Since drafting is the same tool for both
surfaces, MCP gets it too; the owner sees which interface drafted each card.

## Implementation and data

No migration: `agent_settings` already stores the text and revision.

- Services: `agent_settings.read_instructions`, `write_agent_instructions`
  (dispatched by `monthly.write` as `edit_agent_instructions`, audited like
  `edit_agent_settings`).
- Catalog: `get_agent_instructions` (read), `propose_agent_instructions`
  (write; always pends). MCP server instructions mention both.
- API: `GET /agent/instructions` ([api.md](../api.md#agentmd)). Settings writes
  stay browser-only.
- Built-in agent: interview rules in `SYSTEM_PROMPT`; the stub model scripts a
  three-question interview for tests and e2e.
- UI: an *Interview me for AGENT.md* card in an empty conversation; Pending
  cards render a drafted AGENT.md as Markdown; Settings shows a preview.
- CONTEXT.md: AGENT.md updated, AGENT.md interview added.

### Borrowed from aleph, and changed

From aleph's path-draft *Interview* (`agents/path_draft.py`): one question at a
time with a one-line *why* and a few likely answers plus own words; never asking
again what was answered; folding answers into the existing draft instead of
replacing it; the model proposes and the person authorizes; delimiter
neutralization of free text inside its prompt block (`_delimiters.py`).

Changed for Accanto: aleph runs stateless structured-output rounds with the
answers held by the client; here the interview is an ordinary assistant
conversation (stored, resumable, and the sidebar's catalog tools let it ask
about real payees and goals), and the result is a Pending change rather than
filling a form, so the owner's approval goes through the same Ask-first path as
every other agent change.

## Privacy

AGENT.md may hold financial context. It is never logged or put on spans: the
new paths log nothing but the existing operation names, and
`tests/integration/test_trace_privacy.py` now sets a canary AGENT.md, reads it
over MCP and REST, and checks the export and server log.

## Open decisions

- Whether the drafted AGENT.md on a Pending card should be editable before
  applying (today: edit it in Settings after applying).
