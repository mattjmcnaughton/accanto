# MVP ticket waves and common execution practices

This is the shared execution guide for every Accanto MVP GitHub issue. Issues own
bounded ticket scope, acceptance criteria, dependencies, claims and current status.
This document owns the common workflow; do not maintain a second status board here.
Stable identifiers such as `MVP-009` remain independent of GitHub issue numbers.

Read [CONSTITUTION.md](../../../CONSTITUTION.md), [CONTEXT.md](../../../CONTEXT.md),
[the MVP PRD](../../prd/01-mvp.md), [the MVP TDD](../../tdds/01-mvp.md),
[architecture](../../architecture.md), [development](../../development.md), and the
applicable `AGENTS.md` / `CLAUDE.md` before work. These own policy, product scope and
engineering constraints. Historical task notes never override current documents
or actual code. Do not restart settled product interviews or invent financial
policy to unblock an issue.

The repository skill is [run-wave](../../../skills/run-wave/SKILL.md), discovered
through relative skill-folder links in `.agents/skills` and `.claude/skills`.
Its stage contracts below also work when personal workflow skills are unavailable.

## Select and claim one bounded wave

1. Inspect branch, worktree, working-tree and remote baseline state. Preserve
   unrelated work and history. Never assume remote main contains the latest local
   implementation. Fetch only within the current authorization.
2. Read the selected issues and their actual dependency implementations. Choose a
   finite set with a clear integration order and enough independent scope to
   justify parallel work. Satisfied dependencies do not mean a ticket is complete.
3. Use one orchestrator to assign claims. Record ticket, unique run/worker identity,
   branch, base SHA, allowed files, last checkpoint and next action in the issue's
   execution record when issue updates are authorized. Assignees identify people;
   they are insufficient to distinguish agents sharing one account. Labels and
   comments are coordination records, not atomic distributed locks. Workers do
   not self-claim concurrently; competing orchestrators must agree on one owner.
4. Allocate one writer per worktree on a `codex/` branch. Give each worker its
   absolute worktree path, exact base, scope, authoritative references, acceptance
   criteria, permitted external actions, and expected handoff. Reviewers use the
   same candidate read-only or an isolated copy.
5. Isolate databases, ports, browser sessions and artifacts. Reserve migration IDs;
   serialize shared schema/service changes where conflicts would outweigh useful
   parallelism. Prepare against the current integration baseline. Never reset an
   existing development database or reuse personal browser sessions.
6. Bound concurrency by memory and available execution capacity. Start with two
   implementers plus an orchestrator/reviewer; add workers only when resources and
   shared-file risk permit. Avoid concurrent heavy builds/browser captures merely
   to keep every agent busy. Finish and checkpoint this wave before dispatching
   the next unless the user explicitly authorized sustained multi-wave execution.

## Required stages for every ticket

Use installed `/prep`, `/build`, `/review-suite`, `/resolve-review`, `/prove` and
`/create-commit` skills when available, reading their current instructions. If
unavailable, follow the equivalent contracts here; do not silently skip a stage.
Current user instructions override skill defaults and this guide.

| Stage | Required result |
| --- | --- |
| Prep | Inspect actual code/dependencies; write a concrete plan with acceptance checks, authoritative domain rules and enforcement responsibilities. Identify transaction, concurrency, retry, migration and historical-data requirements. Record decisions and genuine blockers. |
| Build | Prefer small vertical slices and test-first financial, authorization and persistence behavior. Implement the UI/API/domain/persistence scope together unless the issue explicitly bounds a prerequisite. Maintain progress and recovery checkpoints. |
| Review | Have a reviewer independent of the implementer inspect connected behavior and tests. Cover correctness, maintainability, security and ship hygiene as relevant. Record findings, scope and limitations; use strong review for financial/security changes. |
| Resolve | Validate findings, fix clear defects, record justified dismissals and policy questions. Repeat affected checks/review. Record a no-change resolution when there are no findings. |
| Prove | Obtain explicit orchestrator approval of a concrete capture plan before execution when the user delegates approval; otherwise obtain user approval. Freeze tests/harness and candidate snapshots first. Run identical checks on candidate and suitable base or isolated semantic mutation. Setup/import/dependency failures are not counterfactual evidence. Record exact revisions/digests and distinguish proven contrasts from regression-only checks. Do not modify candidate source or index during capture. |
| Commit and hand off | Review explicit staged paths and staged content, including generated files and task artifacts. Use Conventional Commits. Deliver the candidate SHA, review resolution, evidence summary, remaining limitations and next integration action. A checkpoint commit alone does not satisfy completion. |

Substantive fixes after proof invalidate the affected evidence; repeat the relevant
review and checks on the new candidate. Do not infer completion from test counts
alone, a claimed pass without artifacts, or an agent's confidence.

## Financial and interface requirements

- Services own authorization, orchestration and transactions. Pure financial rules
  use Decimal and agreed rounding independently of HTTP, persistence and the UI.
  DTOs and database models stay separate. Use narrow boundaries, not a rule engine.
- Enforce Entity access on reads, writes and retries. Persist financial effects,
  complete audit snapshots and retry outcomes atomically under the agreed locks.
  Test relevant races, stale revisions, rollback and access loss with real Postgres.
- Preserve immutable saved Plan inputs/results, stable identities and historical
  labels. New migrations must preserve existing synthetic histories; never repair
  a test setup by resetting a populated user database.
- Unknown actuals remain unknown. Category adjustments do not invent item-level
  completeness. Retain attempted input on failed writes and support deliberate
  reconciliation against current revisions without silently overwriting it.
- Production browser workflows use the same services as direct API and MCP. Include
  loading/error/empty states, accessible labels, keyboard use and 320–390px layouts.
  The standalone prototype is a preserved reference, not production authority.
- Matching policy remains explicitly blocked in MVP-021. Same-Plan workflows can
  proceed. Real identity-provider configuration and hosted MCP interoperability
  remain manual gates; local substitutes do not establish hosted compatibility.

## Recovery when using temporary worktrees

Temporary worktrees and scratch artifacts are allowed. They must not be the only
copy of completed work or the information needed to resume it.

- Make small recovery checkpoint commits on ticket branches at useful boundaries,
  before handing off, and before a planned stop. These may precede final review
  and proof; describe unfinished status honestly. Only reviewed and verified
  candidates may be integrated. Do not rewrite unrelated history for tidiness.
- Commit a concise sanitized handoff at `docs/technical/work/MVP-NNN.md` on the
  ticket branch: issue URL, base, completed steps, remaining work, decisions,
  candidate/checkpoint references, exact check commands/results, review findings,
  evidence digests/retention location, blockers and next action. Reference the
  source checkpoint rather than trying to embed the handoff commit's own SHA.
- Keep useful reproducible tests and harnesses in the repository when appropriate.
  Durable evidence summaries must disclose missing raw artifacts. Raw synthetic
  screenshots/videos stay outside the checkout unless explicitly approved for
  inclusion; retain them in approved durable storage when they support acceptance.
- Ignored `.agentic` notes are scratch, not the sole handoff. A local Git commit
  survives deletion of its worktree if the repository survives; it is not an
  off-machine backup. Push checkpoint branches only with user authorization.
- On resume, inspect actual refs/files and the issue claim before assigning a new
  writer. Reclaim an abandoned issue explicitly after checking for surviving work.
  Never treat an expired session or missing directory as completed implementation.

## Browser checks, privacy and publication

Use `agent-browser` for new interactive acceptance capture, in fresh isolated
sessions with deliberately synthetic data and local-only targets where supported.
Existing locked Playwright tests may remain. Do not attach to personal browsers,
copy browser storage, record real financial data, or install unapproved packages
or privileged browser dependencies. Inspect scripts before running them; do not
run external-service tests just because a broad gate includes them.

Before creating/updating issues, comments, PRs, commits or evidence, review the
exact content and its provenance. Use only synthetic requirements/examples, public
code references and sanitized verification summaries. Exclude personal records,
contact details, account identifiers, credentials, token values, exports, database
contents, raw logs and recordings. Pattern scans supplement manual review; they do
not establish provenance. Normal Git author/project metadata is distinct from
private financial data. Report the actual scope checked, not an exhaustive privacy
claim. Review packaging so only intended code/assets are included.

Issue creation, claiming by remote comment, pushes, PR creation, merges, deployment
and provider configuration each require authorization from the active task. A
request to prepare a push or merge does not itself execute it. The skill never
expands that authority. Do not automatically expose the whole HTTP API as MCP
or create an authorization server; use explicit FastMCP contracts over services.

## Integration and completion

The orchestrator integrates completed ticket commits in dependency order, resolves
schema parents and conflicts, then repeats affected review and verification. Run
appropriate combined formatting, lint, type, unit, real-DB and browser checks.
Inspect the final diff and tracked/untracked task artifacts for unintended scope.
Required CI must pass before merge; local checks alone are not that gate.

Keep issues open while implementation exists only on a ticket/integration branch.
Close through the actual merged implementation or an explicit verified completion
update. An issue's design-only or manual/provider-gated scope must not be silently
reclassified as delivered. The wave handoff lists integrated SHAs, remaining issues,
checks/proofs and limits, manual steps, branch/tree state and the next wave.

## Deferred scope

No tickets here implement annual Plans/Reviews, tax liability, automated bank
feeds/payments, split funding, credit-card settlement, independent withdrawals,
opening-history reconstruction, dedicated trash/restore, FIRE, AI, multiple-Entity
UI or sharing. Immediate undo is optional and absent until explicitly implemented
with the same domain checks. Prototype whole-workspace export/import/reset is not
a production requirement. Percentage defaults remain provisional; timings from
the prototype walkthrough are not acceptance gates.

## MVP issue index

Links below identify tickets; current status and scope live in GitHub Issues.

| Ticket | GitHub issue |
| --- | --- |
| MVP-001 | [Retire prototype and establish a fresh frontend shell](https://github.com/mattjmcnaughton/accanto/issues/1) |
| MVP-002 | [Share authenticated application access across API keys and sessions](https://github.com/mattjmcnaughton/accanto/issues/2) |
| MVP-003 | [Browser sign-in, session lifecycle and Entity discovery](https://github.com/mattjmcnaughton/accanto/issues/3) |
| MVP-004 | [Frontend API transport and recoverable writes](https://github.com/mattjmcnaughton/accanto/issues/4) |
| MVP-005 | [Production income/spending Plan → activity → Review loop](https://github.com/mattjmcnaughton/accanto/issues/5) |
| MVP-006 | [Entity settings and user-owned API key management](https://github.com/mattjmcnaughton/accanto/issues/6) |
| MVP-007 | [Copy Plans and compare saved scenarios](https://github.com/mattjmcnaughton/accanto/issues/7) |
| MVP-008 | [Review notes, annotations and same-Plan retargeting](https://github.com/mattjmcnaughton/accanto/issues/8) |
| MVP-009 | [Signed adjustments and known-total entry](https://github.com/mattjmcnaughton/accanto/issues/9) |
| MVP-010 | [Fixed-cost planning and activity](https://github.com/mattjmcnaughton/accanto/issues/10) |
| MVP-011 | [Independent multi-income estimates](https://github.com/mattjmcnaughton/accanto/issues/11) |
| MVP-012 | [Savings accounts, goals and conserved openings](https://github.com/mattjmcnaughton/accanto/issues/12) |
| MVP-013 | [Goal-backed contributions and savings-funded spending](https://github.com/mattjmcnaughton/accanto/issues/13) |
| MVP-014 | [Savings transfers, reassignments and reconciliation](https://github.com/mattjmcnaughton/accanto/issues/14) |
| MVP-015 | [Investment/giving destinations and contributions](https://github.com/mattjmcnaughton/accanto/issues/15) |
| MVP-016 | [Loan accounts, payments and balance observations](https://github.com/mattjmcnaughton/accanto/issues/16) |
| MVP-017 | [Complete Plan allocations and savings funding](https://github.com/mattjmcnaughton/accanto/issues/17) |
| MVP-018 | [Savings funding across outflows and linked refunds](https://github.com/mattjmcnaughton/accanto/issues/18) |
| MVP-019 | [Savings lifecycle, completion and returned refunds](https://github.com/mattjmcnaughton/accanto/issues/19) |
| MVP-020 | [Full monthly comparison and transparent metrics](https://github.com/mattjmcnaughton/accanto/issues/20) |
| MVP-021 | [Resolve minimum cross-Plan Review matching](https://github.com/mattjmcnaughton/accanto/issues/21) |
| MVP-022 | [Hosted MCP OAuth and explicit tool contracts](https://github.com/mattjmcnaughton/accanto/issues/22) |
| MVP-023 | [Production release evidence and operational readiness](https://github.com/mattjmcnaughton/accanto/issues/23) |
