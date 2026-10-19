# MVP-022 local integration-test handoff

Synthetic fixtures only. This branch owns tests/integration/test_mcp.py; the root
supplies shared tests/mcp_fixture.py and production modules. The test exercises
Streamable HTTP JSON-RPC initialization, exact tool inventory, saved-version
projection, shared HTTP/MCP Review results, strict data exclusions, unknown actuals,
write/replay safety, current Entity authorization, revocation and expiry on the
same HTTP client, audit attribution and unchanged database counts on rejection.

Initial checkpoint is intentionally ahead of production implementation. Formatting
and lint passed; execution awaits root implementation and shared provider fixture.
No hosted provider, ChatGPT or Claude interoperability is established. All DB
access requires ACCANTO_TEST_DATABASE_URL naming an isolated synthetic test DB.
No browser or external provider configuration is changed.
