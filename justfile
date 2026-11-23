fe_dir := "src/accanto/web/frontend"

# Check formatting (backend + frontend)
fmt: fmt-be fmt-fe

# Check backend formatting
fmt-be:
    uv run ruff format --check .

# Check frontend formatting
fmt-fe:
    cd {{fe_dir}} && pnpm run fmt

# Fix formatting (backend + frontend)
fmt-fix: fmt-fix-be fmt-fix-fe

# Fix backend formatting
fmt-fix-be:
    uv run ruff format .

# Fix frontend formatting
fmt-fix-fe:
    cd {{fe_dir}} && pnpm run fmt-fix

# Check linting (backend + frontend)
lint: lint-be lint-fe

# Check backend linting
lint-be:
    uv run ruff check .

# Check frontend linting
lint-fe:
    cd {{fe_dir}} && pnpm run lint

# Fix linting (backend + frontend)
lint-fix: lint-fix-be lint-fix-fe

# Fix backend linting
lint-fix-be:
    uv run ruff check --fix .

# Fix frontend linting
lint-fix-fe:
    cd {{fe_dir}} && pnpm run lint-fix

# Run type checker (backend + frontend)
typecheck: typecheck-be typecheck-fe

# Run backend type checker
typecheck-be:
    uv run ty check

# Run frontend type checker
typecheck-fe:
    cd {{fe_dir}} && pnpm run typecheck

# Run all tests
test-all: test-unit test-integration test-e2e

# Run unit tests (backend + frontend)
test-unit: test-unit-be test-unit-fe

# Run backend unit tests
test-unit-be:
    uv run pytest tests/unit

# Run frontend unit tests
test-unit-fe:
    cd {{fe_dir}} && pnpm run test

# Run integration tests
test-integration:
    uv run pytest tests/integration

# Run e2e tests
test-e2e:
    uv run pytest tests/e2e

# Run tests that hit external services
test-external:
    uv run pytest -m external

# Live built-in agent evals (needs OPENROUTER_API_KEY and ACCANTO_TEST_DATABASE_URL)
eval-agent:
    uv run pytest tests/external/test_agent_evals.py -m external -s -q

# Serve the seeded synthetic YNAB plan on loopback for local development and demos
fake-ynab seed="7" port="8105":
    uv run python -m tests.fakes.ynab_server --seed {{seed}} --port {{port}}

# Fast pre-push check (backend + frontend)
gate: gate-be gate-fe

# Backend gate
gate-be: fmt-be lint-be typecheck-be test-unit-be

# Frontend gate
gate-fe: fmt-fe lint-fe typecheck-fe test-unit-fe

# Full check
gate-expensive: gate test-integration test-e2e

# Everything including external
gate-external: gate-expensive test-external

# Start backend dev server
dev-be:
    uv run uvicorn accanto.app:app --reload --no-access-log

# Start frontend dev server
dev-fe:
    cd {{fe_dir}} && pnpm run dev

# Start Storybook on mocked API responses (no backend needed)
storybook-fe:
    cd {{fe_dir}} && pnpm run storybook

# Build static Storybook into the frontend's storybook-static/
build-storybook-fe:
    cd {{fe_dir}} && pnpm run build-storybook

# Start both dev servers
dev:
    #!/usr/bin/env bash
    set -euo pipefail
    just dev-be &
    backend_pid=$!
    just dev-fe &
    frontend_pid=$!
    trap 'kill "$backend_pid" "$frontend_pid" 2>/dev/null || true' EXIT
    trap 'exit 130' INT TERM
    wait -n "$backend_pid" "$frontend_pid"
