---
name: managing-fixtures
description: Creates, inspects, verifies, and resets Accanto's rich synthetic local-development workspace. Use for demo data, UI validation, fixture refreshes, and reproducing workflows without personal financial data.
---

# Managing synthetic fixtures

Use the real application APIs against an explicitly disposable local PostgreSQL
database. Never copy, anonymize, or derive fixtures from a person's finances.

## Safety and setup

- Read the repository's privacy guidance. Use only invented data in an isolated
  browser, including screenshots and recordings.
- The script accepts only a loopback `postgresql+asyncpg` URL whose database is
  exactly `accanto_fixture_test`, without URL query overrides. It creates the
  database and records an ownership marker; it refuses an existing unmarked DB.
- A loopback address does not prove the server is disposable: never forward a port
  (SSH, kubectl, a cloud SQL proxy) from a shared or real server to `localhost` and
  use it here. The script cannot detect forwarded ports; the user must not create them.
- Set `ACCANTO_FIXTURE_DATABASE_URL` through the local environment without printing
  credentials. It must use a local role with database-creation permission.
- Run from the repository root with its `uv` environment and PostgreSQL running.
  The script applies Alembic migrations itself. Do not point it at production,
  shared staging, a real-user database, or a production identity.
- `--issuer` and `--subject` provision a synthetic login identity; they do not
  configure or expose authentication. Defaults match this project's orb-only
  synthetic preview provider (`http://127.0.0.1:8104`, `synthetic-user`). Keep that
  provider loopback-only. Use the preview's sign-in, never paste session tokens.

## Commands

Run `uv run python skills/managing-fixtures/scripts/fixtures.py seed` to create the
workspace. It refuses a populated database instead of overwriting manual work.
After an interrupted seed, inspect it; do not assume partial seeding succeeded.

Run `uv run python skills/managing-fixtures/scripts/fixtures.py inspect` for a
current inventory, and `uv run python skills/managing-fixtures/scripts/fixtures.py
verify` to check the seeded financial expectations and workflow coverage. These
authenticate with an ephemeral API key, revoked on exit; no credentials are
printed or written to fixture files. Verification may legitimately fail after
manual edits; inspect those edits rather than changing expectations to match.

Pass `--agent read_only`, `--agent ask_first` or `--agent apply_directly` to
`seed` or `reset` to turn the
assistant on with that Agent mode and a short synthetic AGENT.md. The script uses
a fixture browser session for this, since agent settings are browser-only, and
revokes it before exiting. It never connects a transaction source: connect the
fake YNAB server (`tests/fakes/ynab_server.py`) through the inbox's connect form,
as `docs/development.md` describes, so tokens only travel through the real UI.

By default, dates span the current UTC month and the preceding two months, with
opening records one month earlier. Pass `--as-of YYYY-MM-DD` to `seed` or `reset`
for reproducible calendar scenarios. Creation, audit, and saved-version timestamps
remain actual creation times; the script does not fabricate historical saves.

Point a local app's `DATABASE_URL` at this dedicated database to browse it. Restart
that local app and sign in again when switching databases. Never modify a shared
service or identity configuration merely to view fixtures.

## Reset is deliberately destructive and explicit

Ask the user before resetting an interactive fixture workspace. Name the database
and explain that **all manual synthetic edits inside it will be lost**. Preserve
the current workspace if the user wants it; use another orb rather than widening
the allowed database target. A reset is not a general database cleanup tool.

After authorization, stop local services connected to this fixture DB, then run:

```sh
uv run python skills/managing-fixtures/scripts/fixtures.py reset --confirm-reset
```

Reset checks the database name, loopback host, and ownership marker, then recreates
only that database. It does not force-disconnect clients. Restart the preview and
sign in again afterward. Never drop or rewrite an unrelated database to resolve
a failed reset. Scratch databases created by the agent solely for verification
may be reset within that verification task.

## What to explore

- `Everyday balance`: two immutable versions and a balanced current draft; annual
  insurance `1440.18` smooths to `120.02` with half-even rounding. Monthly funding
  is `6800.00`, including `200.00` planned use of savings, not an account balance.
- `One cent over`: precisely `-0.01` unassigned for Home attention boundaries.
- `Travel season`: a different savings-funding mix and positive unassigned money.
- `Quiet month`: explicit zero funding; percentages must be unavailable, not 0%.
- Savings: reserve and travel accounts, unallocated cash, finite/ongoing goals,
  a completed goal, an archived account, contributions, and a reassignment.
- Investments/giving: active and inactive destinations, contribution targets,
  contributions, an investment opening, and observations distinct from activity.
- Loans: two openings, a linked fixed-cost payment, and dated observations.
- Three Reviews: oldest annotated as reviewed; middle month has an unknown income
  source; current month records that source as explicit zero. Insurance actuals
  remain unknown. Known totals must not imply all expected lines are complete.
- Income estimate: twice-monthly and monthly inputs, separate from Plan incomes.
- Settings: a synthetic UTC Entity and revoked fixture-tool credentials. Never
  change a real identity or expose credential values for a demo.

Use normal API/UI commands to introduce temporary scenarios (invalid unsaved
cells, stale writes, or overallocations). Unsaved edits belong in browser memory,
not database fixtures. Preserve immutable saved versions and audit history.
