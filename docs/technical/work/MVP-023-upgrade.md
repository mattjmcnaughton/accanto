# MVP-023 populated-upgrade local checkpoint

> **Scope of this record.** Its checks ran on 2026-10-19 against the UI before the
> redesign and schema revision `5k019`. They are not evidence about the rebuilt UI;
> the redesign's own checks are its CI jobs (`gate`, `integration`, `e2e`) on the
> branch that merged it.

Scope: one new integration test; no production or migration changes. Branch
`codex/mvp-023-upgrade-20261019`, persistent ignored worktree
`.agentic/worktrees/mvp023-upgrade`, base merged MVP-022 tip
`602aec66aa64119d90a4e5a49b438a3fa58ce264`. Parent orchestrator owns preparation,
independent review, resolution, frozen proof and wave integration. This checkpoint
is build validation, not accepted proof or full MVP-023 completion.

`tests/integration/test_release_upgrade.py` creates a unique schema inside an
explicit transaction in a dedicated synthetic test database. Alembic's actual
revision graph and version table create historical 3a003, then upgrade the
populated schema to head (currently 5k019). Existing database schemas/records are
never reset or truncated; the test rolls its unique schema back even on failure.
It bypasses environment-owned connection creation to keep migrations inside this
transaction; a separate helper also executes normal CLI migration of a fresh DB.

Constructed fixtures cover stable User/Entity/Plan/source UUIDs, two immutable
saved versions with renamed income lines, active and revoked API-key hashes,
active and revoked browser-session hashes, live income and soft-deleted spending,
income assignment, a Review retaining its older saved-version target, API and
session audit snapshots, and a successful retry outcome. Every historical column
compares exactly after upgrade, including revocation dates, notes, monetary fields,
revision counters, hashes and JSON snapshots. New recording-order backfill is
checked explicitly. A second real Alembic upgrade-to-head preserves every row and
column across all tables at head, including new feature tables and version state.
Examples/identities/digests are deliberately synthetic, invented for this fixture;
no tokens, actual user records or usable credentials were retained.

## Exact build results

Dedicated loopback PostgreSQL 16 container supplied by parent; isolated unused
`mvp023_upgrade_test`, `mvp023_upgrade_v2_test` and `mvp023_upgrade_v3_test` DBs.
Runtime passwords/URLs stay in helper child environments and are redacted from
logs. Invocation from the repository's installed Python uses:

`python3 .agentic/mvp023-orchestration/db.py .agentic/worktrees/mvp023-upgrade mvp023_upgrade_v3_test tests/integration/test_release_upgrade.py`

- First: fresh CLI migration passed 2.02s; test failed 0.76s during fixture setup:
  SQLAlchemy interpreted JSON `:true` as a missing bind parameter. No upgrade
  preservation result established. Fixed by adding whitespace in synthetic JSON.
- Second: fresh CLI migration passed 1.37s; test failed 0.73s during fixture setup:
  asyncpg expected text for UUID-to-text binding. No upgrade preservation result
  established. Fixed by explicitly casting parameter to UUID before text.
- Third: fresh CLI migration passed 1.33s; corrected populated-upgrade test
  **1 passed in 1.26s** (1.50s wrapper).
- Ruff formatting and lint pass. An initial ty invocation lacked the worktree
  Python environment and produced six unresolved-import diagnostics; rerunning
  with explicit parent task `.venv/bin/python` passed. This was setup, not a
  source/type defect.

Sanitized diagnostic logs retained by parent in ignored
`.agentic/mvp023-orchestration/logs`. Passing checks do not establish provider
restoration, hosted OIDC/MCP compatibility, browser accessibility, restriction of
runtime permissions or comprehensive migration coverage of every possible
historical dataset. Existing grants/immutability tests remain separate evidence.
No destructive downgrade, database restore or custom recovery drill performed.
Provider backup windows/tier settings and recovery-point revocation handling need
actual future provider evidence; no window invented here.

Preserved MVP-020/022 limits: the earlier MVP-019 reload timeout and MVP-020
covered Reopen loan click remain unexplained; this test touches no browser waits.
MVP-022 merged local work does not establish hosted compatibility. MVP-021 remains
policy-blocked/design-only. No matching, new tools, AI/provider framework, remote
write, deployment, route modification or external resource change occurred.

## Parent local acceptance

Parent integrated7e5a721 asa937fba. Independent review accepted this test's bounded
history comparisons. Frozen snapshot60db93b passed, recording-order semantic mutant
failed0versus2 at direct assertion, restored passed; helper included fresh migration
each time. Full parent29integration passed21.00s. This proves that named backfill
necessity, not every possible historic dataset/provider recovery. See MVP-023.md
and wave handoff for final accepted local scope and outstanding provider gates.
