# MVP-017 backend handoff

- Issue: https://github.com/mattjmcnaughton/accanto/issues/17
- Base: `7bb10c46a0a39f80d3f2e41be7512f52bc686462` (`origin/main` verified by wave orchestrator).
- Worker branch: `codex/mvp-017-backend-20261018` in an isolated temporary worktree.
- Scope: Python domain, DTO, service, repository, schema, migration, API docs, and synthetic tests. Frontend is owned by a separate worker.

## Implemented

- Plan inputs and stored lines for savings account funding, saving goals, investments, and giving recipients. Loan-linked fixed costs now snapshot the Debt account name.
- Persisted cent-valued category rollups and total funding/allocation, with tithe calculated only from planned income. Negative unassigned remains saveable. Plan commands do not create actual activity.
- New and revised drafts use `monthly-allocation-2`; existing saved rule labels and results are retained.
- Draft replacement, copy, save, read, and Review retain line identities and historical labels. Inactive references can be retained or explicitly removed in a draft; selecting an inactive reference anew is rejected.
- Review exposes expected totals, category differences, and per-destination actual/difference. No matching entry is unknown. Legacy saved versions with null new rollups expose null expected values and null destination comparisons.
- Additive `5h017` migration. Existing saved income/fixed-cost tables and all four new saved line tables use the saved-line mutation guard.

## Checks before handoff

- Fresh migration chain through `5h017` on unique synthetic PostgreSQL database: PASS.
- Installed `ruff format --check .`: 127 files formatted; PASS.
- Installed `ruff check .`: PASS.
- Installed `ty check`: PASS.
- Installed `pytest tests/unit -q` with `PYTHONPATH=src` and loopback access: 56 passed, 2 dependency deprecation warnings.
- Installed `pytest tests/integration -q` with `PYTHONPATH=src` and an isolated migrated synthetic PostgreSQL database: 16 passed.
- Direct `just gate-be` could not sync an isolated `.venv` because the sandbox blocked PyPI; equivalent installed tools were used. Unescalated unit tests also hung at socket-dependent fixtures; the authorized loopback run passed.
- `git diff --check`: PASS. Only deliberately synthetic labels and amounts were added to tests/docs.

## Review and proof

Independent review, resolution, and counterfactual proof are coordinated by the wave orchestrator after this checkpoint. This handoff records implementation state; it does not claim those stages are complete.

## Next action

Review the checkpoint, resolve any findings, freeze candidate and proof harness, capture approved local proof, then integrate accepted commits locally. No push, PR, merge, issue change, deployment, or worktree cleanup is authorized.
