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
