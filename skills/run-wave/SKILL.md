---
name: run-wave
description: Coordinate a bounded wave of Accanto GitHub tickets with isolated implementers, independent review, acceptance evidence, and local integration. Use when asked to run or resume a ticket wave or delegate a batch of ready tickets.
---

# Run a ticket wave

Read the repository's [ticket execution guide](../../docs/technical/tickets/01-mvp.md)
from the repository root, resolving this link against the real skill directory if
loaded through a symlink. The guide defines the required stages and completion
criteria. Read `AGENTS.md` / `CLAUDE.md`, `CONSTITUTION.md`, and the authoritative
product/domain/design documents relevant to the selected issues. Current code and
those documents take precedence over old agent notes.

## Select and claim

Inspect branch, worktrees, working-tree changes, and existing handoffs before
changing anything. Preserve unrelated work. Read the actual GitHub issue bodies,
dependencies, and current ownership; use issues for ticket scope and execution
status. Do not infer completed implementation from a closed issue or a stale
handoff: verify the implementing revision and dependency behavior.

Select one bounded wave whose dependencies are satisfied on the integration
branch. Match concurrency to available memory and agent slots. Prefer fewer
workers when shared services, schema migrations, or expensive checks would make
parallel work conflict. Serialize shared-schema changes and integration.

One orchestrator assigns and releases claims. Record ticket, agent/run identity,
absolute worktree, branch, base revision, and next action. GitHub comments and
labels are coordination records, not atomic locks. Do not take a conflicting
claim or assume a stale claim is abandoned; resolve it with the orchestrator.
Issue writes, pushes, PRs, merges, and deployment require current user authority;
invoking this skill does not grant it. Prepare local claim/status changes when
remote writes are not authorized.

## Execute

Give each implementer its exact ticket and acceptance criteria, absolute worktree
and base revision, allowed scope, authoritative documents, restrictions, and
handoff requirements. Assign one writer per worktree. Use separate test databases,
ports, browser sessions, and generated artifacts. Never reset a development
database or attach to a personal browser session. Use deliberately synthetic data:
the repository is public, and only synthetic financial data may be committed
(AGENTS.md, "Privacy and committing"). Pass that rule to every implementer.

For every ticket, perform **prep → build → review-suite → resolve-review → prove
→ create-commit**, following the stage contracts in the common guide. Load the
current installed stage skills when available. If they are unavailable, execute
the guide's full contracts directly; do not silently omit review or proof.

Use independent reviewers where practical, especially for financial correctness
and authorization. The orchestrator approves a concrete capture plan before
proof only when the user delegates that approval; otherwise obtain user approval.
Freeze the proof harness and record immutable candidate/counterfactual revisions; setup failures do not establish behavioral evidence. Address findings
and repeat affected verification after meaningful fixes. Policy uncertainty stays
explicitly blocked while independent work continues.

## Preserve and integrate

Temporary worktrees are permitted. Do not leave recoverable work solely in their
uncommitted files. Create authorized local checkpoint commits on ticket branches
and maintain a sanitized tracked handoff at `docs/technical/work/{ticket}.md`.
Checkpoint commits preserve progress; they do not imply review, proof, integration
eligibility, or permission to push. Before handoff or a resource stop, save the
latest checkpoint and handoff in the repository's retained Git history. If that
cannot be done, report exactly what remains at risk before stopping.

Record the base and checkpoint revisions, stage status, unresolved findings,
commands/results, reproducible evidence summaries, limitations, and the next
specific action. Keep raw synthetic screenshots/videos outside the checkout;
never record credentials, browser storage, database exports, or private financial
data in handoffs, issues, commits, or evidence. Local artifact paths alone are not
durable evidence. Review artifact provenance as well as patterns before staging
explicit paths.

Integrate accepted ticket commits locally in dependency order. Review conflict
resolutions and rerun affected checks; a ticket's isolated checks do not establish
integration correctness. Update issue status only within authorized scope. End
with integrated revisions, verification results and limitations, remaining policy
blocks/manual tasks, branch state, and the next ready wave. Do not describe a
checkpoint or interrupted implementation as complete.
