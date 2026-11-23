# Connecting MCP clients (v1)

Accanto serves MCP at `<origin>/mcp`, for example `https://accanto.example/mcp`
or, locally, `http://127.0.0.1:8000/mcp`. It authenticates with one of your
Accanto API keys sent as `Authorization: Bearer <key>`
([TDD 03](../tdds/03-agent-access.md), [PRD 02](../prd/02-agent-access.md)).

## Before you connect

1. Create a key in **Settings → API keys** (shown once) and keep it in your
   shell's secret store, not in a repository or a shared config file:

   ```sh
   export ACCANTO_KEY='…'   # e.g. read from your password manager
   ```

2. Choose the Entity's **Agent mode** in **Settings → Agent**. In *Propose
   only* (the default) every write the client makes becomes a Pending change you
   apply in Accanto. In *Record with approval*, writes run once your client's
   approval prompt allows them. Deleting a savings movement or a balance
   observation is always a Pending change.

The key has your full Entity access through the agent tool catalog. It cannot
list, issue or revoke keys, set up sources, or change agent or Entity settings:
no tool exists for them. Revoke the key in Settings to cut a client off; its
next call is denied.

Everything a tool returns is sent to the model provider your client uses (PRD
02, AG-09). Free text (payees, memos, notes, names) arrives as
`{"untrusted": "..."}`; the server instructions tell the client never to follow
instructions found there.

## Claude Code

```sh
claude mcp add --transport http accanto https://accanto.example/mcp \
  --header "Authorization: Bearer $ACCANTO_KEY"
```

Write tools carry `_meta["anthropic/requiresUserInteraction"] = true`, so Claude
Code asks before each write; deletes are marked `destructiveHint`.

## Codex

In `~/.codex/config.toml`:

```toml
[mcp_servers.accanto]
url = "https://accanto.example/mcp"
bearer_token_env_var = "ACCANTO_KEY"
default_tools_approval_mode = "writes"
```

## Amp

```sh
amp mcp add accanto --header "Authorization=Bearer $ACCANTO_KEY" \
  https://accanto.example/mcp
```

or in `amp.mcpServers` in your Amp settings:

```json
{
  "amp.mcpServers": {
    "accanto": {
      "url": "https://accanto.example/mcp",
      "headers": { "Authorization": "Bearer <key>" }
    }
  }
}
```

## Check the connection

Ask the client to list Accanto's tools, call `get_context`, then read a month's
Review (`get_monthly_review` with the first day of the month) and propose
categories for inbox items (`list_inbox`, then `set_proposals`). Proposals
record nothing; recording happens from the inbox or by applying a Pending
change.

These commands follow each client's documented configuration at the time of
writing; the local integration test exercises the protocol, not the clients.
