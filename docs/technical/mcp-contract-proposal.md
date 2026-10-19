# MVP-022 proposed local MCP contract

Status: pending user agreement; this document does not expose tools or establish
hosted compatibility. Current issue #22 governs scope. No provider configuration,
external resource, cost, publication or deployment is authorized.

## Pending decisions

1. Approve the four tools/data projection below, choose read-only delivery, or
   specify another surface. Recommendation: four tools, with only starting a
   Review as a write. That tests service parity, retries and audit attribution
   without adding activity or moving money.
2. Approve RS256 access-token validation plus uncached RFC 7662 introspection on
   every execution, with real provider selection/configuration left gated.
   Recommendation: require both signature/claims and current active status;
   signature-only JWT validation cannot detect provider revocation immediately.
   No generic provider framework or authorization/token-issuance endpoint.

## Proposed tools and released data

All identifiers are public UUIDs, never relational integers. All money and ratios
are decimal strings or null. Date-only month arguments must be the first day of
that month; no server-local date defaults. Reject unknown input fields. Typed
Pydantic output projections explicitly select fields, so future service additions
cannot silently expand external disclosure. No catch-all operation or API import.

| Tool | Input | Output | Service |
| --- | --- | --- | --- |
| list_entities | none | entities: id, name, time_zone, today | browser_auth.account_metadata |
| list_plan_versions | entity_id | saved versions only: plan_id, version_id, name, number, revision | monthly.read_plans |
| get_monthly_review | entity_id, month | month, selected version_id, categories, summary, metrics as specified below | monthly.read_review |
| select_review_version | entity_id, month, version_id, idempotency_key (1–120 chars) | review_id, month, version_id, revision | monthly.write(create_review) |

The last tool starts a Review only. It cannot retarget an existing Review;
conflicting existing selection returns the service's explicit rejection. A clearer
implementation name, start_monthly_review, can preserve this exact bounded meaning.
It does not save a Plan, create activity, annotate a Review, or move funds.

Each category output explicitly includes category (income, fixed_cost, spending,
saving, investing, giving), planned, recorded, incomplete, difference and expected
identity items (id, name, planned, recorded, difference). Raw entries, entry notes,
Review notes, audit history and credentials are excluded. Category totals include
unplanned activity once, as calculated by the shared service. Omitting raw entry
lists is an intentional scope limit; the browser/API retain contributor details.

Summary explicitly includes new_saving, savings_used, net_saving, total_investing,
income_funded_fixed_cost, income_funded_investing, savings_used_incomplete.
Metrics explicitly include key, basis, label, numerator_label, denominator_label,
numerator, denominator, percentage, unavailable_reason, components(name, amount).
Expected identity and component labels are financial data released by this scope.
Unknown/incomplete values remain null, including unavailable ratios. Do not
recalculate persisted Plan results or infer cross-Plan matching.

Return sanitized stable application error codes/messages as MCP tool errors;
invalid authentication must fail at the protocol boundary. Do not echo arbitrary
exceptions, SQL parameters, request payloads or token claims. Responses use no-store;
server/proxy telemetry excludes financial values/notes and all credentials.

## Proposed identity and transport contract

Run a separately configured FastMCP Streamable HTTP resource application, disabled
unless all required configuration validates. Keep browser/API routes unchanged;
no tailnet route changes. Stateless transport avoids process-local session authority.
Publish RFC 9728 protected-resource metadata and a Bearer challenge pointing to it.
Use exact public resource URL as audience and metadata resource identifier.
RemoteAuthProvider publishes the external authorization-server location.

Verify RS256 signature with configured issuer JWKS, exact issuer and audience,
required finite expiry, nbf when present, nonempty subject and required MCP scopes.
Reject other algorithms, missing/malformed claims, browser ID tokens/API keys and
wrong-resource tokens. Require verified allowlisted email and a provisioned exact
(issuer, subject); never link accounts using email equality or token Entity claims.
Do not store raw access/refresh tokens or mint application credentials from them.

Extend the application actor boundary deliberately: revalidate external credential
and resolve the current provisioned User within the existing service transaction,
then retain the Entity lock/current-owner check before reads, writes and outcomes.
Every tool execution, including repeated requests and already successful retries,
must revalidate. The external introspection response must be active=true and agree
with signed issuer/subject/audience and required scope. Network errors, inactive
status and malformed responses fail closed; no active-status cache. Validate again
following waits before entering the financial operation; document unavoidable
remote revocation concurrency limits instead of claiming distributed atomicity.
MCP writes retain actor/interface attribution without pretending to be API keys
or browser sessions. Existing audit rows remain unchanged. Inspect whether an
additive migration is actually needed for attribution before reserving one.

## Concrete future configuration instructions

These are proposed variable names, not implemented settings yet:

- MCP_RESOURCE_URL: exact HTTPS resource URL (including /mcp when applicable).
- MCP_ISSUER: exact external issuer, including required path/trailing slash.
- MCP_JWKS_URI: trusted HTTPS JWKS endpoint; never read a URL from token headers.
- MCP_INTROSPECTION_URL: trusted HTTPS RFC 7662 endpoint.
- MCP_INTROSPECTION_CLIENT_ID / MCP_INTROSPECTION_CLIENT_SECRET: resource-server
  confidential introspection credential, supplied only through secret management.
- MCP_ALLOWED_EMAILS: JSON array of admitted verified email addresses.
- Proposed scopes: accanto:read for reads, accanto:review for starting a Review.

Only loopback fixture URLs may use HTTP. Pin standalone fastmcp==4.1.0 and use the
project lockfile. Provision the exact existing User issuer/subject independently;
matching email does not create/link a User. Configure provider issuance for the
resource audience, RS256, exp, sub, verified email and requested scopes. Confirm
RFC 8707 resource behavior and the provider's RFC 7662 revocation semantics.
Never pass browser ID tokens or user API keys as MCP access tokens.

Before hosted completion, an approved provider must supply authorization-code/S256
PKCE, discovery and client registration compatible with the intended clients,
consent for this precise data surface, resource-specific access tokens, JWKS key
rotation and authenticated introspection with immediate inactive responses after
revocation. Provider support for dynamic registration or pre-registered client
IDs remains unverified. Do not add an OAuth proxy that issues its own tokens to
bridge an unsupported provider under this ticket's resource-server scope.

With separate approval, configure only synthetic admitted identities/Entities on
an approved public HTTPS endpoint, then opt in separately to ChatGPT and Claude
connection tests. Check discovery/challenge, authorization/consent, tool schemas,
read projection, Review write/retry, denial after access loss and provider
revocation. No such hosted checks have run. Record client/provider versions and
limits; local signed fixtures never establish hosted support.

## Verification planned after agreement

Use a synthetic local signed issuer and introspection fixture with generated keys,
no provider accounts. Test discovery metadata and challenge; signature/issuer/
audience/algorithm/expiry/malformed-claim failures; admission; scope separation;
revocation on an existing connection; and outage/malformed introspection denial.
Real-Postgres tests exercise HTTP/MCP projection equality over the same saved
version, replay equivalence and key-reuse conflict, foreign Entity/version denial,
loss of Entity ownership before replay, audit count/attribution and atomic rejection.
Keep existing Plan/savings/refund/lifecycle tests and browser readiness waits.

Freeze source revision, harness, tests, fixture and digests before local capture.
Approve a concrete local-only capture plan under delegated authority. Use separate
immutable candidate and semantic-mutation worktrees; isolate Python bytecode caches
with unique absent PYTHONPYCACHEPREFIX, PYTHONDONTWRITEBYTECODE=1 and Python -B.
Mutants must fail behavioral assertions, not imports/setup. Candidate/index stay
untouched throughout capture. Repeat affected review/proof following source fixes.

Official preparation references (checked 2026-10-19):
https://gofastmcp.com/servers/auth/remote-oauth,
https://gofastmcp.com/servers/auth/token-verification,
https://pypi.org/pypi/fastmcp/json . Installed 4.1.0 signatures/source were inspected
because current documentation may describe later releases. Keep validation/error
telemetry under application control; upstream debug logs may include claim/body
values and cannot be enabled for these sensitive flows.
