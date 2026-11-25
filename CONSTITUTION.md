# Accanto constitution

Agreed principles, recorded 2026-10-12.

These principles guide product decisions, implementation, and review. Production
API, authentication, and persistence requirements apply when those components
are introduced; they do not authorize building beyond the agreed product scope.
Financial honesty and preservation of user-entered data apply to prototypes too.

## 1. Represent finances honestly

Use the shared meanings in [CONTEXT.md](CONTEXT.md) consistently in code, tests,
and UI copy. Keep Plans, estimates, recorded activity, and observed balances
distinct. Unknown actuals must not become zero. Make calculation assumptions and
explicit overrides visible so users can make deliberate choices.

Saved Plan versions preserve their inputs, assumptions, and results. Later edits
or calculation-rule changes must not silently rewrite historical comparisons.
Reviews and actual entries remain editable under the domain rules. Use soft
deletion for deletable financial records; exclude deleted activity from current
financial totals while preserving its stored record. Preserve every saved
financial change in a separate append-only audit history with complete
before/after snapshots, actor, time, and interface. The change and its audit
record succeed or fail together. Ordinary application operations cannot rewrite
or remove audit history. Audit records are not financial activity and never
contribute to totals. Storage, retention, and restoration details belong in the TDD.

The initial product is USD-only. Authoritative monetary calculations use Python
`Decimal` and API monetary values use decimal strings. Distinguish calculation
precision, recorded monetary amounts, and display rounding:

- Preserve original inputs. Recorded USD activity uses the exact cents entered.
- Carry extra decimal precision through calculations and round only at explicit
  monetary-result boundaries. Never reconstruct authoritative inputs from
  rounded displays.
- Use round-half-even by default. A calculation-specific exception must have an
  explicit rule and rationale.
- Monthly Plan lines establish cent-valued results; totals sum those results so
  the displayed allocation reconciles. Preserve annual inputs separately from
  their smoothed monthly estimates.
- When splitting an exact amount, distribute residual cents explicitly so the
  parts equal the original total. A displayed smoothed estimate is not itself
  an exact allocation schedule.

Detailed precision limits and rounding boundaries belong in technical design
and require independently worked examples.

Store timestamps in UTC and convert them only for display. Financial calendar
dates remain date-only: their selected date determines their Review Period,
independently of when the entry was recorded. Use the Entity time zone
consistently for defaults such as today across all interfaces; changing a time
zone must not move existing financial activity between dates or Periods.

## 2. Support both UI and API operation

Every core financial workflow must be available through a documented,
authenticated API from the first usable production version. The UI uses that
API; the user must also be able to operate Accanto through their own API calls.
Direct API access uses user-owned, individually revocable API keys, shown once
at creation and stored only as hashes. MCP clients may authenticate with those
user-owned API keys; hosted MCP access for clients that cannot hold a key
(claude.ai, mobile connectors) uses OAuth in a later phase.

A data model change reaches every interface in the same change: the database
and migration, domain rules and services, the documented API, the agent tool
catalog and MCP, the UI, and CONTEXT.md for any new or changed domain meaning.
A field or record that only some interfaces can read or set is an incomplete
change. Leaving an interface out requires an explicit decision recorded in the
technical design.

All interfaces use the same application behavior and authorization rules.
Authentication establishes the User; authorization enforces access to the
Entity and its records on every request, including retries. Credentials must
not preserve access after the User loses the corresponding Entity permissions.
Financial totals must never combine Entities implicitly.
Provider selection and browser/script credential flows belong in technical design.

## 3. Keep domain behavior independently testable

Keep domain behavior independent of delivery mechanisms and external systems.
Introduce narrow interfaces where they provide a useful testing or integration
boundary; avoid abstractions created solely to satisfy an architectural pattern.

Keep financial calculations independent of HTTP, persistence, and browser state,
with explicit inputs and results. Follow the existing router, service, and
repository boundaries; API DTOs remain separate from database models. The backend
enforces domain rules regardless of frontend validation.

Make domain rules explicit and name them in the ubiquitous language. Express
financial decisions as independently testable domain functions or objects with
explicit inputs, outcomes, and rejection reasons. Keep these rules free of HTTP,
ORM, UI, and external-service dependencies. Reuse the same rules for every
supported command that can affect an invariant, including corrections and any
supported deletion or restoration; frontend validation is not authoritative.

Application services coordinate authorization, load the facts needed by domain
rules, and own transaction boundaries. Persistence enforces structural constraints
and the concurrency guarantees needed to preserve invariants. A pure balance
check alone does not protect against concurrent spending: validation and the
resulting write must be protected together. Domain rejection leaves no partial
financial effects and provides an actionable explanation to the caller.

Every technical design must call out the domain rules it affects, their source
in CONTEXT.md, the commands that enforce them, enforcement responsibilities,
atomicity/concurrency requirements, and verification examples. Explicitly mark
unresolved behavior; do not silently choose a financial policy in implementation.
For a design with no domain impact, state that and explain why. Use the
[TDD template](docs/tdds/template.md), scaling detail to the change.

These principles do not require a rules engine, event sourcing, messaging,
repository wrappers, or a class per rule. Named domain events describe successful
outcomes; introduce infrastructure only for a concrete workflow need.

External providers adapt to Accanto's domain through small, explicit interfaces.
Core behavior must be testable without hosted providers. Use Aleph as a reference
for applicable patterns, examining whether each choice fits Accanto rather than
copying its architecture indiscriminately.

## 4. Test at the lowest level that provides confidence

Prefer focused unit tests for calculations and domain behavior, integration tests
where correctness depends on components working together, and browser tests where
confidence requires the UI. API workflow coverage is important, but a smaller
test should be used when it establishes the needed behavior. Avoid duplicating
coverage across levels without a concrete reason.

Prefer small fakes over mocks of internal collaborators. Assert observable
behavior through stable interfaces rather than internal call sequences. Verify
fakes against the contracts they represent; use real dependencies when substitutes
cannot establish confidence. Live-provider tests are explicitly opt-in.

Prefer test-first development for new behavior and bug fixes, especially financial
rules, authorization, persistence, and integrations. TDD is a useful default, not
a rigid requirement. Exploratory and presentation work may proceed without a
failing test first; production behavior still requires appropriate verification.
Financial expectations must come from independently worked examples or agreed
requirements rather than repeating the implementation's formula.

## 5. Add complexity for concrete requirements

Prefer the existing stack and standard library. Add dependencies and abstractions
when they simplify an agreed requirement. Create interfaces at meaningful
boundaries rather than wrapping every component for hypothetical flexibility.
Do not build a generic provider framework ahead of a concrete integration need.

Routine dependency additions may use engineering judgment with a brief rationale.
Discuss new services, operating costs, and substantial architectural commitments
with the user before adopting them.

## 6. Keep financial data out of operational telemetry

Logs, traces, and analytics must exclude financial values, free-text financial
notes, credentials, and tokens, including during local development. Diagnose
failures using operation names, timings, error codes, and identifiers.

Financial transaction information may be stored in the application database,
including in audit records with appropriate access controls. This does
not permit credentials or tokens in diagnostic records, or turn database-backed
operational logs into an exception. Any external service receiving financial data
requires an explicit design decision about purpose and data scope.
[PRD 02 — Agent access](docs/prd/02-agent-access.md) (AG-09) is that decision for
model providers reached by the built-in agent and by MCP clients: what agent
tools return may be sent; credentials, tokens, audit history and other Entities
never are.

## 7. Make failures explicit and preserve data

Never represent a failed load as an empty workspace or a failed calculation as
zero. Report a save as successful only after it is durably accepted. Preserve
entered values when a save fails and provide a useful path to retry or recover.
Operations that must succeed together must not leave partial financial changes.
Reject stale edits explicitly rather than silently overwriting newer changes;
check for conflicts atomically with the write and preserve attempted input for
reconciliation. Retrying a financial operation with the same request identity
and input must return its recorded outcome without duplicating the change or
its audit history, within a defined retention window. Reusing that identity with
different input is a conflict. Persist the successful outcome atomically with
the financial change. Detailed transaction, retry, retention, and concurrency
mechanisms belong in the TDD.

## 8. Verify locally with judgment; require CI for merging

Run the local checks needed to establish confidence in the change, using
engineering judgment. Local verification complements CI and should target risks
specific to the change. Required CI checks are the merge gate.

## Governance and document ownership

When proposed work conflicts with these principles, surface and resolve the
conflict explicitly. Discuss changes to a principle's meaning with the user
before amending it. Record a brief rationale and reconcile affected guidance.
Routine clarifications that preserve meaning may proceed without an amendment
discussion. Review changes against the applicable principles and report material
verification gaps.

- This constitution owns shared principles.
- [CONTEXT.md](CONTEXT.md) owns domain meanings and invariants.
- The [product brief](docs/product/brief.md) and [MVP PRD](docs/prd/01-mvp.md)
  own product direction and scope.
- The [MVP TDD](docs/tdds/01-mvp.md) owns concrete design exploration, currently
  including audit logging and the data model.
- [Architecture](docs/architecture.md) and [development guidance](docs/development.md)
  own implementation conventions, tools, and commands.

### Amendment notes

- 2026-11-25: §2 requires a data model change to reach every interface (database,
  domain and services, API, agent tool catalog and MCP, UI, CONTEXT.md) in the
  same change, unless the technical design records an explicit exclusion.
  Rationale: the owner operates Accanto through the UI, the API, and agents, so a
  field that one interface cannot reach silently diverges the others.
- 2026-11-23: §2 allows MCP clients to authenticate with user-owned API keys;
  hosted MCP OAuth follows later. §6 names PRD 02 as the explicit decision for
  sending financial data to model providers. Rationale: let CLI agents (Claude
  Code, Codex, Amp) and the built-in agent operate Accanto now, within an
  enforced tool catalog and Agent mode.
- 2026-10-16: Made domain rules an explicit architectural obligation: shared,
  independently testable financial rules; application-owned orchestration;
  persistence-backed atomicity/concurrency; and rule-to-verification coverage in
  each TDD. Financial meanings remain in CONTEXT.md; each TDD specifies how its
  implementation enforces them. No generic rule framework is required.

- 2026-10-14: Promoted agreed TDD invariants: UTC timestamps and stable financial
  dates, soft deletion and atomic append-only audit history, stale-edit
  rejection and retry safety, hashed API-key storage, and authorization against
  current Entity access. These preserve the agreed behavior across future
  implementations; provider choices, initial permission tiers, retention, and
  deferred interfaces remain technical-design decisions.
- 2026-10-14: Clarified monetary precision and adopted half-even as the default:
  preserve original inputs, round at explicit result boundaries, reconcile
  cent-valued Plan lines, and conserve totals when splitting exact amounts.
  Reconciled the audit reference with the agreed TDD design.
- 2026-10-14: Replaced the signed-JWT requirement for direct API access with
  API keys, supporting CLI/curl and unattended scripts without a refresh-token
  flow. Hosted MCP retains OAuth for ChatGPT and Claude connections.
- 2026-10-12: Clarified independent domain boundaries to capture the useful part
  of hexagonal architecture without requiring a formal ports-and-adapters layout.
