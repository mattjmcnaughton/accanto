# MVP wave: fixed costs and savings movements

## Baseline and ownership

- Verified `origin/main` at `834ede4964c6dc582370505847baa51d60a419cd`, the PR #26 merge, before branching. The primary checkout's local `main` remains unchanged.
- Integration branch: `codex/mvp-wave-20261017-third` at `/tmp/accanto-mvp-wave-20261017-third`, based on that revision.
- MVP-010, GitHub issue #10: run `20261017-third/mvp010`, branch `codex/mvp-010-next`, worktree `/tmp/accanto-mvp-010-next`, base `834ede4`. One writer. Next: implement fixed-cost Plan and activity workflow; review, prove, then hand off an accepted commit.
- MVP-014, GitHub issue #14: run `20261017-third/mvp014`, branch `codex/mvp-014-next`, worktree `/tmp/accanto-mvp-014-next`, base `834ede4`. One writer. Next: implement savings movements and reconciliation; review, prove, then hand off an accepted commit.

Both issues were open, unassigned, and without comments or active claims at selection. MVP-009 and MVP-013 behavior is present on the verified baseline. Issue comments and other remote writes are outside this local wave.

## Integration order and limits

Integrate accepted MVP-010 then MVP-014 commits, reconcile migration ancestry and shared activity code, and repeat affected checks. MVP-016 then becomes eligible. Preserve existing branches, worktrees, proof metadata, unrelated changes, and tailnet demo routes. No push, PR, merge, issue mutation, deployment or worktree cleanup is included in this local handoff.

Proof capture requires user approval of a concrete plan; no capture is assumed by this record. Use only deliberately synthetic fixtures and isolated test infrastructure.

## Checkpoint (2026-10-17)

- MVP-010 candidate `187e3f9` on its ticket branch is clean. Independent review found and the implementer resolved shared fixed-cost identity on Plan copies and assigning payments to costs retained only in saved versions. Follow-up review found no new concrete issue. The implementer reports Ruff, ty, Biome, TypeScript, 52 backend and 51 frontend unit tests, an isolated Postgres API integration test, a Vite build, and a synthetic browser journey passing. `just gate` could not bootstrap offline; installed-tool equivalents were run. Proof capture is pending user approval.
- MVP-014 candidate `6b61f65` on its ticket branch is clean. Independent review found stale API documentation and a retained inactive-goal correction edge case; both were resolved and a UI interaction test was added. The implementer reports Ruff, ty, Biome, TypeScript, 53 backend and 50 frontend unit tests, three isolated Postgres movement integration tests, migration, and Vite build passing. Proof capture is pending user approval.
- A separate local Postgres 16 container was started on loopback port 5437. Distinct synthetic test databases were created for each ticket and integration; existing containers and databases were not changed. No proof database has been created or proof capture started.
- Merge preview shows shared edits in `docs/api.md` and `src/accanto/services/monthly.py`. Migration `5f014` must follow `5f010` after integration. No ticket candidate has been integrated yet, and no remote write has been made.

## Local integration result

The user approved both proof capture plans. Ticket proof handoffs are `baba182` (MVP-010, behavior at `187e3f9`) and `8234478` (MVP-014, behavior at `6b61f65`). The integration branch cherry-picked MVP-010 as `8926017`, `3e039c8`, `7e442d4`, followed by MVP-014 as `3916af9`, `4f615e6`, `bf47ce1`. No cherry-pick content conflict occurred. Integration changed `5f014.down_revision` to `5f010`, corrected the combined API introduction, and preserved an empty `fixed_costs` default for direct service callers. The latter fixed two authenticated-actor integration failures; focused rerun passed.

Combined checks on the integration branch:

- Alembic upgraded fresh isolated synthetic Postgres databases through the single `5e015 → 5f010 → 5f014` path.
- Ruff format/check, ty, Biome format/lint, TypeScript, Vite production build, 54 backend unit tests and 52 frontend tests passed. The first backend unit attempt stalled at sandboxed FastAPI TestClient local socket setup; the same full suite passed with local socket permission. Direct installed tools were used because temporary-worktree `just gate` dependency bootstrap was unavailable offline.
- All 14 Postgres integration tests passed after the direct-service compatibility fix. One combined synthetic browser E2E test passed on its own migrated database. No external-service tests or hosted-provider checks were run.
- An independent read-only integration review found no concrete cross-ticket issue. It did not rerun database or browser tests. MVP-014 race, retry-audit and rollback assertions passed on the candidate but were not reached by its approved semantic mutations, so that counterfactual remains unproven. MVP-010 browser evidence is regression-only without a browser counterfactual.

Privacy and handoff scope: ticket writers reviewed explicit staged paths and deliberately synthetic fixtures; the orchestrator reviewed the integration diff, tracked/untracked inventory, and generated frontend `dist/` file list. The generated bundle contains the app index, CSS and JS; no database export, browser storage, screenshot or recording was staged. This was a repository/worktree review, not a check of external storage or all Git history. Normal project and Git author metadata are outside the private-financial-data check. Raw synthetic proof logs remain outside the checkout at the temporary paths in the ticket handoffs and are not off-machine backups.

The integration branch remains local. Issues #10 and #14 stay open until their implementation is merged; no issue status, push, PR, merge, deployment or worktree cleanup occurred. The primary checkout's local `main` remains stale and untouched. MVP-016 becomes the next ready implementation ticket after this branch is merged; MVP-021 remains policy blocked.
