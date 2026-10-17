# Implementation diary

- 2026-10-16: Began after prototype/documentation reconciliation. Selected the
  direct-API income/spending monthly loop; browser UI/OIDC and remaining financial
  command families remain explicit subsequent increments. All slice writes must
  include the constitution's audit, concurrency, revision and retry guarantees.
- Implemented pure Decimal money/Plan/actual rules; typed relational models and
  initial migration; authenticated Plan create/edit/save, activity create/edit/
  soft-delete, and Review create/read. Added reload endpoints and key issue/revoke.
- All financial writes serialize on Entity, reject stale revisions and commit
  full before/after audit with a durable request outcome. Saved snapshots and
  audit have DB protections; current access is checked before replay. Database
  failure responses omit financial SQL parameters.
- Used existing local Compose PostgreSQL and a separate `accanto_core_test`
  database; no user database migration, deployment or external provider setup.
- Validation: repository gate passed (7 backend units, 30 prototype units, build,
  formatting/lint/types). Real Postgres API scenario passed, including concurrent
  two-key retry, competing edits, authorization loss, key revocation, audit-write
  failure rollback, correction/deletion and protected immutable history. Prototype
  commit also passed all 4 Chromium browser journeys and mobile overflow checks.
- Documentation now describes operator admission/bootstrap, restricted runtime
  role, exact API commands, test setup and explicit partial-delivery boundaries.
- Next: browser OIDC/session and API-backed Plan/activity/Review UI; then Review
  editing/notes and fixed costs before savings/accounts/refunds. No cross-Plan
  matching policy was inferred. No production restoration endpoint is exposed.
