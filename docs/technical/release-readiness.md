# MVP local release readiness

This matrix maps the agreed [PRD](../prd/01-mvp.md) to production source and
reproducible checks at merged base `602aec6` plus the MVP-023 local branch.
It replaces no PRD requirement. Execution results, immutable candidates, proof
contrasts and failures belong in [MVP-023.md](work/MVP-023.md).
Local checks do not establish required hosted CI or provider compatibility.

Legend: **local regression** means exercised behavior, not a claim that this wave
introduced or independently falsified every rule. **Gate** requires future concrete
evidence; **excluded** means deliberately outside delivered scope.

| PRD | Production implementation | Local checks and bounds | Remaining gate or exclusion |
| --- | --- | --- | --- |
| MVP-01 Plans/versions | `services/monthly.py`, `domains/monthly.py`, `features/workspace/Plans.tsx` | `test_monthly_api.py`, `test_plan_copy.py`, `test_plan_allocations.py`; Decimal annual line rounding, independent copies, preserved saved identities/results, allocations and savings funding; real browser save/version loop. Planning creates no activity or reservation. | Local regression; no automatic carryover or name-based matching. |
| MVP-02 estimates | `domains/income_estimates.py`, `services/income_estimates.py`, `features/estimates/IncomeEstimates.tsx` | Unit `test_income_estimates.py`, matching integration test and frontend estimate tests cover independent duplicate/edit, inputs/results, explicit paid days and manual handoff. | Tax liability and synchronization excluded. |
| MVP-03 accounts/goals/openings | `domains/savings.py`, `services/savings.py`, Savings UI | Unit/integration `test_savings.py`; real browser synthetic opening designations conserve total, mandatory Unallocated, target types and opening boundaries. | No legacy-label inference, dedicated opening-history reconstruction or user-data import. |
| MVP-04 activity/funding | `services/monthly.py`, `services/savings.py`, `domains/savings.py`, Activity UI | `test_monthly_api.py`, `test_savings_activity.py`, `test_destinations.py`, `test_balances.py`; real-DB rejection, correction, audit rollback and goal funding; browser category/funding loop. | Bank/payment execution and split funding excluded. |
| MVP-05 movements/history | `services/savings.py`, `domains/savings.py`, Savings UI | `test_savings_movements.py`, pure history tests, browser transfer/reassignment/reconciliation; date/order replay and unchanged openings/contribution totals. | Sampled histories/races, not exhaustive schedules; dedicated restoration excluded. |
| MVP-06 refunds/lifecycle | `domains/refunds.py`, `services/monthly.py`, `services/savings.py` | `test_refunds.py`, `test_savings_lifecycle.py`, migration test and browser completed-goal refund/return/archive/reopen loop; caps, original origin and atomic rejection. | MVP-019 reload timeout and MVP-020 covered loan reopen click remain unexplained. Every existing browser readiness/actionability wait retained. |
| MVP-07 destinations/observations | `services/destinations.py`, `services/balances.py`, destination/balance UI | `test_destinations.py`, `test_balances.py`, browser donations/investment/loan payment and separate observation; progress is not market value and payments do not infer debt balance. | Returns/performance, tax eligibility and payment settlement excluded. |
| MVP-08 Review/metrics | `domains/monthly_comparison.py`, `services/monthly_comparison.py`, `services/monthly.py`, ReviewDetails UI | `test_monthly_comparison.py`, monthly API/allocations/known-total tests and browser full comparison; stable saved identity, null unknowns, explicit zero, once-only unplanned values, checkpoint, formulas and incompleteness. | MVP-021 cross-Plan matching/retarget policy blocked, design-only; same-Plan operation only. Provisional percentages remain disclosed. |
| MVP-09 access/API/retry | `services/access.py`, browser auth/API-key services, documented routers and API transport | `test_authenticated_actors.py`, `test_browser_auth.py`, `test_oidc.py`, settings and monthly API tests cover current ownership/revocation on replay, exact identity, CSRF, atomic audit/outcome and conflicts. Local signed OIDC fixture only. | Actual provider discovery/admission/rotation/logout compatibility remains a release gate. |
| MVP-09 storage/upgrades | Alembic graph through `5k019`, SQL constraints/triggers and restricted role | `test_release_upgrade.py` compares every old column in populated `3a003`→head, two saved versions, stable identities, live/deleted activity, Review, API/session audit, active/revoked credential hashes and outcome; repeat head preserves all tables. Existing session/estimate/lifecycle migration tests cover other populated boundaries. `test_monthly_api.py` asserts permission/trigger-specific immutability failures. | Constructed synthetic histories, not every historic database; provider backup/restore remains a separate gate. No downgrade/reset. |
| MVP-09 errors/keyboard/mobile | RecoverableWrite/RecoveryNotice and API-backed UI | Frontend recovery tests cover uncertain responses, exact payload/key, expiry, popup failure/cancel, changed User and conflicts. Browser uses native Tab/Enter to submit/retry a network-blocked save and reload failed activity at390px, retaining input; complete delivered financial loop plus320/360px checks. | Browser abort happens before commit; frontend/DB tests cover uncertain committed retries. Not a full accessibility/device audit or actual-provider expiry proof. |
| MVP-09 packaging/operation/privacy | Dockerfile, Hatch wheel, app/health/serve, safe error mapping | Actual non-root local image migration/startup and SPA probes, invalid/empty schema refusal, wheel/image inventories, Docker context exclusion contrast; callback-query log test and real-server validation/storage error telemetry test. | Readiness checks schema revision/connectivity only; provider reachability, grants, assets and routing require separate checks. Proxy/provider telemetry configuration remains manual. |
| Hosted MCP (MVP-022) | Separate four-tool Streamable HTTP resource; `mcp_auth.py`, `mcp_server.py` |35signed admission/auth unit cases, protocol metadata/challenge, projection checks and3real-Postgres MCP tests; exact issuer/subject, uncached active introspection, current Entity ownership before retry and after lock wait. Prior frozen proof boundaries retained in MVP-022 handoff. | Actual OAuth registration/consent/PKCE/introspection and ChatGPT/Claude interoperability unverified. No local test establishes hosted support; no added tools or authorization server. |

Dependency source/tests006–020 are present on the verified merged baseline and
exercise the delivered increments; a closed GitHub issue alone was not used as
implementation evidence. Current issue23 is open/unassigned/unclaimed at wave start;
this wave records ownership only in local Git. The full integration/browser checks
are still required on the final candidate; passing historical handoffs is insufficient.

The MVP-020 first vacuous subtraction capture, incomplete browser capture and later
isolated-cache recapture retain their original meanings. MVP-022's incomplete ninth
capture and corrected remaining capture likewise remain separate. New green tests
do not retroactively repair those artifacts or explain old intermittencies.

See [deployment and recovery](deployment.md) for the agreed Fly.io/Neon direction,
pending provider evidence and compatible rollback requirements. Custom recovery
drills and prototype import/export/reset are excluded. Financial examples used in
this wave are deliberately invented fixtures; no personal database/browser is used.

Telemetry boundary: real-server tests cover application validation/storage errors
and callback-query redaction. Default local PostgreSQL diagnostics separately
exposed synthetic failing-row details/statements. The supplied Compose command now
suppresses these ordinary SQL-error payload logs; the opt-in
`tests/postgres_telemetry_probe.py` exercises a real constraint rejection in a new
synthetic container without attaching existing databases or exporting logs. Actual
provider database/proxy logging controls and log destinations remain release gates.
