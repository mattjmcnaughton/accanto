# MVP-022 MCP tools checkpoint

The user accepted four bounded tools and per-call signed-token validation plus
uncached introspection. This checkpoint adds explicit typed disclosure DTOs and a
standalone stateless FastMCP resource-server factory. Financial reads and Review
creation delegate to current shared application services. Each tool resolves the
OAuth actor in a short transaction, then services revalidate inside their normal
transaction before authorization and retry outcomes. The callback retains the
required tool scope. Root integration supplies that OAuth actor boundary.

The surface is exactly `list_entities`, `list_plan_versions`,
`get_monthly_review`, and create-only `start_monthly_review`. Saved versions only;
no raw entries, notes, audit history, internal integer identifiers or draft Plan
inputs. Unknown financial values remain null and all money/ratios are decimal
strings. Schema annotations state read/write intent and retry safety. Unexpected
errors are replaced before framework error logging; no-store applies to all HTTP
responses. The separate ASGI factory leaves application/browser routes unchanged.

Validation here: focused projection tests 2 passed, ruff formatting/lint passed,
DTO typecheck passed using integration virtualenv. Server imports/types depend on
root's in-flight config and auth changes and require combined verification.
No protocol/database/provider/hosted claim is established by this checkpoint.
Projection tests use deliberately synthetic fixture names, UUIDs and amounts,
created from scratch. Reviewed the four new task files in full, including task
notes; no external data, secrets, media or browser state were used or included.
No migration, provider configuration, external resource, push, issue mutation,
application frontend change or tailnet-route change occurred here.
