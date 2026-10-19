# MVP-020 frontend execution handoff

Local isolated frontend branch `codex/mvp020-frontend-resume`, base merged
MVP-019 tip `763a9c7`. This is a build checkpoint; independent review, resolution,
proof and combined browser execution are owned by the ticket orchestrator.

Adds optional contracts and Review disclosures for selected saved identities,
unknown expected amounts, incomplete category subtotals, unplanned activity,
contributing entries and already-included adjustments. Spending contributors
reuse the same coherent Review entries. Displays same-month new saving, savings
used (including incomplete indication), net saving, total investment contributions
and income-funded contributions. Formula disclosures preserve separate planned
and actual bases, numerator/denominator amounts, components and unavailable
reasons. Plan results disclose their backend-produced planned metrics. No client
financial calculations, schema changes, financial writes or cross-Plan matching
were added. Older contracts omit the new disclosures without fabricating totals.
The existing required explicit saving-goal known-total selector is preserved.

Frontend validation: Biome formatting/lint (50 files), Vite build, forced TypeScript
build all pass; Vitest 64 tests across 15 files pass (2.18s). Three new component
checks cover formula/unknown/component presentation, identity/unplanned/adjustment
presentation and independent synthetic -$500 net saving / $2,000 total versus $0
income-funded investment examples, and optional-contract fallback. The later
incomplete-savings label change passes focused 3 tests, lint and forced types.

The existing full-month browser journey is extended after lifecycle operations to
inspect saved v1, retained annotation, source unknowns, unplanned investment/giving,
planned formula amounts, unavailable actual ratios, contributing adjustments,
reload persistence and 320px layout. All three MVP-019 lifecycle readiness waits
are unchanged. Ruff format/lint pass for the extension. Browser execution is
pending integration with the backend; this handoff does not claim that the new
browser assertions have run. MVP-019's unexplained savings-reload timeout remains
an evidence limitation; a successful retry cannot establish its resolution.

All new fixtures are deliberately synthetic requirement amounts and invented
labels. Task source/tests and generated dist HTML/assets were inspected; output
contains only frontend code/assets, with no database/browser storage or media.
No snapshots, exports, screenshots or recordings are captured. Installed frontend
dependencies are referenced through a local symlink excluded from staging. No
push, PR, issue change, merge, deployment or existing worktree cleanup occurred.
