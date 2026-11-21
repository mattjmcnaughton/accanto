# CLAUDE.md

A financial companion for planning a rich life.

Read [CONSTITUTION.md](CONSTITUTION.md) for the agreed product and engineering
principles before planning, implementation, or review.

Read [CONTEXT.md](CONTEXT.md) before domain or product work. Use its ubiquitous
language consistently in code, tests, and UI copy; update it when domain meanings
change.

Python web application using FastAPI, uvicorn, uv, ruff, ty, and pytest. Frontend lives in `src/accanto/web/frontend/`.

## Quick Reference

| Command | Purpose |
| ------- | ------- |
| `just fmt` | Check formatting (backend + frontend) |
| `just fmt-fix` | Fix formatting (backend + frontend) |
| `just lint` | Check linting (backend + frontend) |
| `just lint-fix` | Fix linting (backend + frontend) |
| `just typecheck` | Run type checker (backend + frontend) |
| `just test-unit` | Run unit tests (backend + frontend) |
| `just test-integration` | Run integration tests |
| `just test-e2e` | Run e2e tests |
| `just test-all` | Run all tests |
| `just test-external` | Run tests hitting external services |
| `just gate` | Fast pre-push check (fmt + lint + typecheck + test-unit) |
| `just gate-expensive` | Full check (gate + integration + e2e) |
| `just gate-external` | Everything (gate-expensive + external) |
| `just dev` | Start backend and frontend dev servers |
| `just dev-be` | Start backend dev server only |
| `just dev-fe` | Start frontend dev server only |

All formatting, linting, typecheck, test-unit, and gate targets have `-be` and `-fe` variants (e.g. `just fmt-be`, `just fmt-fe`).

## Project Structure

```
src/accanto/
  app.py                    # FastAPI app factory
  config.py                 # Pydantic-settings based config
  logging.py                # structlog setup
  routers/                  # HTTP endpoint definitions
    health.py               # /healthz, /readyz
  services/                 # Business logic
  dtos/                     # Pydantic request/response models
  web/                      # Frontend integration
    serve.py                # Static file serving for production
    frontend/               # Frontend application (scaffolded separately)
  db.py                     # Async engine/session setup
  models/                   # SQLAlchemy models
  repositories/             # Data access layer
tests/
  unit/                     # Unit tests
  integration/              # Integration tests
  e2e/                      # End-to-end tests
```

## Key Conventions

- Source code lives in `src/accanto/` (src layout).
- **Layering:** routers -> services -> repositories.
- **Placement:** read `docs/architecture.md` before adding modules. Keep pure financial rules independent of HTTP and persistence; introduce narrow interfaces only at useful testing or integration boundaries.
- **DTOs** are Pydantic models for API I/O, always separate from DB models.
- **Frontend** is composed into `src/accanto/web/frontend/` using the `frontend-react` template.
- Tests are organized by type in `tests/unit/`, `tests/integration/`, `tests/e2e/`.
- Use `@pytest.mark.external` for tests that hit external services.
- Python tool config is in `pyproject.toml`; frontend tools have their own config.
- Backend: `just dev-be`. Frontend: `just dev-fe`. Both: `just dev`.

## More Information

- `docs/product/brief.md` — current product direction
- `CONTEXT.md` — shared financial domain language
- `docs/architecture.md` — read before adding new modules or changing project structure
- `docs/development.md` — read for environment setup, debugging, or common tasks
- `docs/api.md` — API endpoint reference
- `docs/technical/box-operations.md` — read before deploying or debugging the live Amp Box deployment

## Privacy and committing

- Never put personal financial records, identifying financial examples, exports,
  screenshots of real data, or credentials in source, docs, fixtures, task notes,
  generated artifacts, or commit messages. Use deliberately synthetic examples.
- Do not derive examples from the user's finances, even with names changed.
  Exclude private contact details, account identifiers, statement references,
  and identifying employer, bank, income, expense or balance combinations.
- Record demos, screenshots and videos only in an isolated browser populated
  with synthetic data. Never capture the user's existing workspace. Keep media
  outside the checkout unless explicitly requested for inclusion and reviewed.
- Keep private working data outside the checkout. Git ignores are a secondary
  safeguard; local tool snapshots can retain even untracked files.
- Stage explicit paths and inspect the staged diff before committing. Check
  generated standalone HTML as well as its source. Do not blindly stage all work.
- Privacy checks must cover tracked and untracked task artifacts, generated
  files and staged changes. Confirm that packaging bundles code/assets only,
  never browser storage, exports or database contents. Pattern scans alone do
  not establish that financial examples are synthetic; review their provenance.
- Report exactly what was checked. Do not promise that the repository contains
  "no personal information": normal author names/emails may remain in Git and
  project metadata. Distinguish that metadata from private financial/user data,
  and do not expand a repository check to external storage without authorization.
- A deletion commit does not remove old sensitive data. If found, stop publication
  and inspect branches, tags, tool refs, reflogs and unreachable objects; obtain
  authorization before destructive history cleanup. Never push automatically.
