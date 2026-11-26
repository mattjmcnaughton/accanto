# Deployment, compatible rollback and recovery

The personal alpha runs on an Amp Box with Neon and Auth0; see
[Box operations](box-operations.md) for deploying and debugging it with Amp.
Fly.io plus Neon was the original hosting direction in the [MVP TDD](../tdds/01-mvp.md).
These instructions require a separate authorized release action. Local readiness
results are in [MVP-023](work/MVP-023.md), with the [PRD matrix](release-readiness.md).
No provider tier, backup window, recovery objective or hosted compatibility is
asserted here. Custom backup/recovery drills remain deferred.

## Release prerequisites and evidence

Before exposing a release, record the exact immutable candidate/image digest,
previous compatible image digest, schema revision and the required CI results for
that candidate (`gate`, `integration`, `e2e`). Local passes do not satisfy hosted CI.
Inspect code/assets inventories, synthetic-data provenance and the final build
context; never build from a checkout containing personal financial working data.
Images must contain no browser storage, financial exports, fixtures, databases,
task worktrees, credentials, frontend test sources or runtime dependency caches.

The operator must collect these concrete provider/configuration facts without
placing secrets, admitted private email addresses or private financial data in Git:

| Gate | Required evidence/configuration | Current status |
| --- | --- | --- |
| Neon persistence | Selected project/region/tier; encrypted connection/TLS settings and pooling compatibility for asyncpg; migration-owner versus restricted runtime credentials; configured retention and earliest/latest recoverable points, recovery granularity, restore procedure/target and limitations from actual account configuration | Awaiting provider evidence; no windows invented |
| Recovery expectation | Explicitly accepted data-loss/recovery-time expectations derived from the configured provider capabilities, owner and escalation path; how to obtain the last confirmed recovery point and preserve the old database during restore | Awaiting provider evidence; no promised RPO/RTO |
| Fly.io runtime | Selected app/region, image digest, private secret injection, database connectivity, HTTPS origin, health-check mapping/timeouts, logging redaction and release/migration orchestration | Awaiting configuration; no app/resources created |
| Database diagnostics | Provider settings/log destinations excluding SQL statements, parameters and financial failing-row details; verify synthetic rejection evidence before release | Default local PostgreSQL diagnostics exposed synthetic rows; supplied Compose suppresses ordinary SQL-error payload logs. Hosted evidence pending |
| Browser OIDC | Exact issuer/client/callback and verified-email admission; operator-bound issuer/subject; actual discovery/signature/nonce/S256 PKCE/code flow, redirect and cookie behavior, key rotation, denial and sign-out/session expiry/recovery evidence with synthetic identity | Local signed fixtures only; real compatibility unverified |
| Hosted MCP | Separately authorized listener/public `/mcp` resource; exact audience/issuer/JWKS, uncached RFC7662 active introspection and confidential credentials; required scopes/claims; metadata/challenge/registration/consent/PKCE plus synthetic ChatGPT/Claude connection, revocation and outage checks | MVP-022 local scope merged; hosted gate outstanding |
| Credential recovery | Protected post-recovery-point revocation/access-change reconciliation source and responsible operator; ability to deny access while reconciling restored state | Required procedure/evidence pending; never retain raw tokens in a ledger |

Use the concrete [browser settings](../development.md#browser-identity-setup-manual-provider-configuration)
and [MCP contract](mcp-contract-proposal.md). Do not substitute local auto-approving
fixtures for real registration, change cookie protections, infer account access
from email or expose fixture providers. The existing tailnet demo route is outside
this work and must remain unchanged. MCP is a separate listener; no proxy/resource
configuration is implicitly authorized by the local implementation.

## Install and start after authorization

1. Build from the reviewed revision using the locked dependencies and Dockerfile:
   `docker build -t accanto:<reviewed-revision> .`. Record image digest and inventory.
   Do not bake runtime credentials into image layers, arguments or build context.
2. Connect a migration job using the database owner credential supplied by private
   secret management. Record current Alembic revision, candidate target and provider
   recovery-point/retention evidence. For a new empty database, use `alembic upgrade
   head`; for an existing database, use the same additive upgrade path. Do not
   reset, recreate, truncate or downgrade a populated database to repair startup.
   Serialize migrations and hold traffic if compatibility is uncertain. The current
   supported revision is `6h028`.
3. Create/configure a distinct runtime login through the provider's approved secret
   path. It must own no tables/schema, have no superuser/BYPASSRLS/role administration,
   and have no inherited privileged roles or ability to disable triggers. Apply the
   [runtime grant recipe](../api.md#local-setup-and-credentials), including audit
   SELECT/INSERT only, no TRUNCATE, and revocation of public schema CREATE. Review
   effective role memberships and reapply narrowly after additive migrations.
4. Inject runtime `DATABASE_URL` with verified provider TLS configuration, browser
   settings and CSRF secret. Never run the web/MCP process with migration ownership.
   Provision an already verified issuer/subject using the trusted bootstrap terminal;
   its one-time API-key output is a secret and must not enter release logs.
5. Start the image's supplied non-root Uvicorn command with access logging disabled.
   It serves the built SPA and authenticated API on8000. Configure trusted HTTPS
   routing without logging bodies, query strings, cookies or Authorization headers.
   Do not enable HTTP-client/SQL debug logging, request tracing/analytics or MCP
   argument/error capture. Secret-manager/audit operational records must exclude
   secret values; financial audit snapshots belong only in the protected database.
   Apply privacy controls to database diagnostics too: PostgreSQL defaults can
   retain statements and failing-row details even when application logs are safe.
   The local Compose command suppresses ordinary SQL error messages, statements,
   duration and parameter logging; safe application error codes remain. This
   intentionally sacrifices raw database-error diagnostics. Confirm actual provider
   controls/log sinks with synthetic failures; application redaction alone is
   insufficient. Do not assume a hosted tier supports these settings unchanged.
6. Probe `/healthz` (process liveness) and `/readyz` (DB reachable with exactly the
   supported Alembic revision). A503 must stop admission; liveness does not establish
   readiness. These probes do not verify runtime grants, OIDC/MCP availability or
   assets. Separately verify a deep link serves the SPA, missing assets/API remain404,
   private responses are no-store, and a synthetic sign-in/financial loop succeeds.
   No production financial fixture should populate an ordinary user's workspace.
7. Start/expose the separate MCP listener only after its separately approved provider
   configuration and interoperability gates pass. Keep financial tools bounded to
   the accepted four-tool contract. Plan/Review operations never move money.

## Compatible application rollback

Stop admission/writes first if data integrity is uncertain. Retain current image,
schema revision and diagnostic operation/error identifiers without payloads.
Select the recorded previous image only when its code can read the current schema
and safely preserve all newer rows, flags, categories, saved snapshots, nullable
session/MCP audit attribution, retry outcomes and revocation state. Demonstrate
compatibility against synthetic populated current-schema data before switching.
`5l020` only adds the nullable `plan_revision.updated_at` column and the triggers
that maintain it; application code from `5k019` ignores the column, so it can run on
a `5l020` database without a downgrade. `6a021` only adds the Transactions inbox
tables (`transaction_source`, `source_account_selection`, `staged_transaction`);
`5l020` code never reads them, and entries recorded from the inbox are ordinary
`actual_entry` rows that older code soft-deletes, so the new foreign key never
blocks it. Grant the runtime role access to the three new tables after upgrading.
`6b022` only adds the agent tables (`agent_settings`, `pending_change`,
`agent_conversation`, `agent_message`); `6a021` code never reads them. Grant the
runtime role access to these four tables after upgrading.
`6c023` adds `transaction_provider` and moves each Entity's newest connected YNAB
token into it, emptying `transaction_source.secret_ciphertext` (which keeps a `''`
default). `6b022` code still starts and serves everything except syncing, which
asks the person to reconnect the source. Grant the runtime role access to the new
table after upgrading.
`6d024` only adds `tag` and `entry_tag`; `6c023` code never reads them. Entries
are only soft-deleted, so the `entry_tag` foreign key never blocks older code, and
older code leaves an entry's tags unchanged when it edits that entry. Grant the
runtime role access to the two new tables after upgrading.
`6e025` only widens the `plan_fixed_cost_line` frequency check to add `weekly`,
`biweekly` and `quarterly`; stored lines and monthly amounts are unchanged and no
grants change. `6d024` code still reads such lines, but its UI shows them as
Monthly (and resends them as monthly when the draft is edited), its draft API
rejects them and copying a Plan with one fails, so roll back only before anyone
uses a new frequency. The downgrade fails once a
line uses one, because saved lines are immutable.
`6f026` only adds `spending_subcategory` and `entry_spending_subcategory`; `6e025`
code never reads them, and entries are only soft-deleted, so the link's foreign
key never blocks it. Older code keeps an entry's subcategory when it edits that
entry, but does not copy it to a new refund and does not clear it when it changes
an entry's category from guilt-free spending. The next edit under `6f026` clears
such a stale link. Grant the runtime role access to the two new tables after upgrading.
`6g027` drops the one-conversation-per-Entity constraint on `agent_conversation`
and adds `archived_at` ([TDD 08](../tdds/08-assistant-conversation-history.md)).
`6f026` code reads one conversation per Entity and ignores `archived_at`, so after
anyone starts a second conversation it shows an arbitrary one and its Clear deletes
only that one; roll back before relying on history. The downgrade keeps only each
User and Entity's latest conversation. No new table, so the grants are unchanged.
`6h028` renames the stored Agent modes (`propose` → `ask_first`, `record` →
`apply_directly`) and adds `read_only` ([TDD 03](../tdds/03-agent-access.md)).
`6g027` code treats any mode other than `propose` as `record`, so running it on
`6h028` data would let agents write directly in Ask first and Read only. Downgrade
to `6g027` before rolling the app back; the downgrade maps `apply_directly` back
to `record` and both other modes to `propose`. No grant changes.
These are compatibility prerequisites, not
proof every older app is safe. An earlier image's `/readyz` either accepts any
revision or pins `5k019` and refuses `5l020`; neither answer is the compatibility
decision.

Do not run `alembic downgrade` for an application rollback. The initial downgrade
drops tables, and older session/audit or lifecycle implementations can destroy or
misinterpret history. If compatibility is unverified, keep writes stopped and use
a reviewed forward repair. A previous image's permissive `/readyz` must not be
used as the compatibility decision. Preserve request identities during uncertain
responses; do not tell clients to resubmit with new identities.

## Provider restoration and access reconciliation

When separately authorized, follow the configured provider's documented restore
procedure and actual available recovery points; preserve the original database
and point-in-time evidence. Do not invent provider windows or perform a custom
recovery drill under this local wave. Keep application/public access disabled
while validating the restored target. Confirm schema, immutable versions/lines,
stable UUIDs, audit, activity/deletion/funding relationships and retry outcomes
before selecting a compatible application revision. Restoration can lose changes
after its recovery point; a replay outcome lost with that data cannot safely be
assumed to have survived. Reconcile uncertain operations explicitly before retry.

A restored DB may resurrect revoked API keys, browser sessions or old ownership.
Reconcile post-point revocations/access changes from the protected operator source
before reopening access. If reliable reconciliation is unavailable, invalidate all
restored API keys and browser sessions using separately authorized operator actions,
reissue keys deliberately and require fresh sign-in; invalidate restored pending
OIDC login transactions too. Rotating only the CSRF secret does not revoke sessions
or API keys. Credential invalidation cannot repair restored ownership: independently
reconstruct and explicitly reauthorize current User-to-Entity access before allowing
any fresh sign-in/API/MCP use. If that authorization state cannot be established,
keep access closed even after invalidating credentials. Do not rewrite append-only
financial audit to simulate revocations.
Preserve and audit/document the authorized credential actions without raw secrets.

For MCP, verify current provider revocation/introspection and exact restored
issuer/subject/Entity ownership independently; uncached introspection cannot repair
restored local ownership changes. Provider outages fail closed, and revocation
after the last successful check can still race an in-flight commit. Reopen traffic
only after the operator accepts the restored recovery point, data reconciliation,
effective runtime grants and access checks. These are requirements awaiting provider
evidence, not an executed recovery claim.
