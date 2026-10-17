# Monthly core implementation

Source: reconciled PRD/TDD, the reconciled prototype baseline. Existing main checkout is
intentional; no parallel worktree attachment exists. Preserve earlier .agentic
notes and historical standalone experiments outside this task's commits.

## Goal and slice

An admitted owner can use an authenticated API to create/save a monthly Plan
with multiple direct net-income sources and guilt-free spending, record dated
income/spending and review a month. This is incremental production code, not the
full MVP or a replacement for the browser prototype yet.

## Acceptance and verification

- Decimal string money, exact cents, explicit zero versus unknown; pure unit tests.
- Typed relational Plan/source/revision/line, activity, Review and auth records.
- API keys hashed, revocable, current Entity access checked on reads and retries.
- Entity row lock plus revisions; one transaction for data, audit and retry outcome.
- Immutable saved versions/audit enforced in Postgres; real DB tests, including
  concurrent duplicate writes, rollback and stale corrections.
- Document usable API requests and operator bootstrap for an already-admitted
  identity. No public self-registration or browser API-key persistence.

## Steps

1. [x] Pure rules and DTO validation with independently worked examples.
2. [x] Relational schema/migration, scoped repository queries, transaction services.
3. [x] Authenticated create/edit/save Plan; create/edit/delete activity; create/read Review.
4. [x] Real Postgres API workflow and failure/concurrency tests; document results.
5. [ ] Next slice: browser OIDC/session setup and API-backed UI, then fixed costs and
   account/destination commands. Cross-Plan matching policy is not invented.

Use the existing stack. No new service/provider cost, push, merge or deployment.
