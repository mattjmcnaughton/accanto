# <Number> — <Design title>

Status: Draft / Agreed / Implemented
Updated: YYYY-MM-DD

## Purpose and scope

Describe the concrete problem and resulting behavior. Link the relevant PRD,
[constitution](../../CONSTITUTION.md), [domain context](../../CONTEXT.md), and
[architecture](../architecture.md). State exclusions. Keep this design as small
as the change permits; mark nonapplicable sections with a reason.

## Workflows and domain rules

Describe the actor, command, required inputs, successful outcome/event, and
rejection/correction paths. Reference existing domain meanings rather than
creating competing definitions here. If there is no domain impact, explain why.

| Rule (domain name) | Authoritative source | Commands affected | Enforcement | Verification |
| --- | --- | --- | --- | --- |
| <Invariant or policy> | <CONTEXT.md section link; constitution when applicable> | <Create/edit/correct/delete/restore only where supported> | <Pure rule; service orchestration; DB constraint/transaction> | <Concrete success and rejection example; test layer> |

For each rule, identify required facts and the boundary over which it must hold
(one record, account history, both transfer accounts, etc.). Specify what remains
unchanged on failure and the actionable rejection returned. Record unresolved
financial decisions under Open decisions instead of inventing defaults.

## Implementation and data

Describe the smallest suitable domain functions/objects, service operations,
persistence records/relationships, and API/UI changes. For a data model change,
cover every interface: migration, domain and services, API and `docs/api.md`,
agent tool catalog and MCP, UI, and CONTEXT.md; record any interface left out
and why (constitution §2). Identify stored facts
versus derived values and historical snapshots. Specify relevant money rounding,
financial dates, and same-day ordering. Use existing structure and dependencies.
No generic rules engine or event infrastructure is implied by this template.

## Atomicity, concurrency, and retries

List changes that commit together, including audit and idempotency outcomes.
Explain how validation stays valid through the write under concurrent requests;
name the actual locking/version/constraint mechanism or mark it unresolved.
Describe stale edits, duplicate retries, rollback, and authorization boundaries.

## Verification

Use independently worked amounts and observable outcomes. Link each affected
rule above to the cheapest sufficient evidence: pure unit tests for financial
logic, database integration tests for constraints/rollback/concurrency, and UI
checks for user interactions. Include relevant correction and failure cases.
Do not claim a fake database establishes transactional guarantees. Every
example, fixture and screenshot is synthetic, never taken from a real workspace.

## Alternatives and tradeoffs

Record material alternatives and why the proposed approach fits. Note scope
reductions and their concrete limitations; avoid speculative infrastructure.

## Delivery and compatibility

Describe any migration, compatibility, rollout, and recovery work actually needed.
Preserve saved financial history and inputs. State acceptance criteria and any
remaining implementation or verification gaps.

## Open decisions

Separate unresolved financial policies (requiring domain agreement) from technical
implementation choices. Mark blocking decisions explicitly. Record decisions and
rationale as they are resolved; do not label proposals as agreed.
