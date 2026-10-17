# MVP baseline and workflow migration handoff

## Candidate and scope

Application candidate: `21e313019395af297d26a0aa2e7ce2376ba19c15` on
`codex/mvp-implementation`. Completed local implementation covers MVP-001–007 and
MVP-011; this is a partial MVP, not a production release. The subsequent workflow
commit adds the shared wave guide/skill, issue index and this handoff without
changing application behavior. GitHub Issues now own ticket status and scope;
see the [common guide and index](../tickets/01-mvp.md).

Read-only comparison with fetched origin/main found 22 commits ahead and zero
behind at the application candidate. Local main was not modified. Preserve the
existing implementation commits; do not reset to a historical remote baseline.

## Fresh verification (2026-10-17)

- `just gate`: passed formatting, lint, type checks, production frontend build,
  38 backend unit tests and 43 frontend tests.
- Apply migrations through `4a004` to a fresh isolated PostgreSQL 16 database.
  Set `ACCANTO_TEST_DATABASE_URL` to its URL (database name ending `_test`), then
  run `just test-integration`: all 10 tests passed, none skipped.
- `pytest tests/e2e`: no tests collected, exit 5. Therefore `just gate-expensive`
  is not fully passing. No new browser acceptance capture was performed.
- Local Python was 3.13.15; CI selects 3.12. Required CI has not run on a proposed
  PR. Current CI runs the fast gate, not database integration or browser checks.
- Previous temporary browser/proof artifacts are unavailable. Historical pass
  reports are not presented as fresh or retained counterfactual evidence.

The disposable database container was stopped. No existing development database,
real identity provider or personal browser was used. Initial cache-access and
incorrect disposable-database-name failures were setup issues; corrected checks
above were run in full and are the reported results.

## Review and publication limits

The readiness auditor inspected the 96-file application diff and 22 commit
subjects against fetched origin/main, dependency/package configuration, current
untracked inventory and relevant synthetic-fixture provenance. No high-confidence
credential or private financial artifact was found within that scope; this is not
an exhaustive history audit. Normal Git author/project metadata remains.

The preserved standalone HTML has an empty bundled initial workspace and SHA256
`823252413f97896341cbccddd4b893080899173edb4a6eb424de77248083ca7f`.
Its existing minified line 23 produces a whitespace warning; it was not regenerated.
Packaging inspection found intended code/assets, not browser storage or database
contents. No container image build or hosted interoperability check was repeated.

All 23 issue bodies were reviewed against the committed ticket source for scope
and privacy before publication. Monetary examples came from deliberately synthetic
requirements. Completed tickets remain open pending merge; interrupted MVP-008,
MVP-009 and MVP-012 explicitly require recovery/reimplementation. MVP-021 remains
policy blocked; real-provider completion of MVP-022 remains gated. The inclusive
MVP-023 dependency range includes every ticket from 006 through 020.

Independent workflow review found and resolved ambiguous proof-plan approval:
only explicit user delegation lets the orchestrator approve capture. Skill
frontmatter and relative discovery links were validated; fresh-session discovery
in both products remains unverified.

## Next action

Review and publish the integration branch only when authorized, open a PR against
main, obtain required CI and review approval, and merge only with authorization.
Do not close incomplete/manual-gated tickets or call this full MVP completion.
After the baseline is integrated, use a bounded wave for MVP-008, MVP-009 and
MVP-012 with explicit claims and checkpoint handoffs. Temporary worktrees remain
allowed; uncommitted files and ignored notes must not be the sole recovery copy.
