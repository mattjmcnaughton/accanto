# Architecture

## Overview

accanto is a Python web application using FastAPI for the backend and a separately-scaffolded frontend.

Read the [constitution](../CONSTITUTION.md) for governing principles and
[CONTEXT.md](../CONTEXT.md) for domain meanings. This document owns code placement
and dependency guidance. Concrete MVP data-model and audit-log decisions belong
in the [TDD](tdds/01-mvp.md).

## Project Structure

```
src/accanto/
  app.py               # FastAPI app factory
  config.py            # Pydantic-settings config from env vars
  logging.py           # structlog setup
  routers/             # HTTP endpoint definitions
    health.py          # /healthz, /readyz
  services/            # Business logic
  dtos/                # Pydantic request/response models
  web/                 # Frontend integration
    serve.py           # Static file serving for production
    frontend/          # Frontend app (scaffolded separately)
  db.py                # Async engine/session factory
  models/              # SQLAlchemy async models
  repositories/        # Data access layer
tests/
  unit/                # Fast, isolated unit tests
  integration/         # Tests with real dependencies
  e2e/                 # End-to-end tests
```

## Layering

```
routers (HTTP endpoints, parse requests into DTOs)
  -> services (business logic and orchestration)
    -> repositories (data access, return SQLAlchemy models)
      -> models (SQLAlchemy)
```

DTOs (Pydantic models) are used at the router level for API I/O. They are always separate from database models.

## Where new behavior belongs

Use the existing structure, with independent domain logic and narrow external
boundaries where needed. A formal ports-and-adapters directory layout is not
required.

| Location | Responsibility |
| --- | --- |
| `routers/` | HTTP parsing, authentication dependencies, API DTOs, and response/error mapping. Delegate financial behavior to services or domain functions. |
| `services/` | Application workflows: coordinate authorization, domain calculations, persistence, and external calls. Define transaction boundaries for operations that must succeed together. |
| `domains/` (when needed) | Pure financial calculations and domain rules with explicit inputs/results. No FastAPI, SQLAlchemy, network, browser, configuration loading, or implicit clock access. Create modules for concrete behavior, not an empty framework. |
| `repositories/` and `models/` | Database queries, persistence, relationships, and constraints. Repositories may return SQLAlchemy models to services; services pass plain values into pure calculations. |
| `dtos/` | Pydantic API contracts, separate from database models. |
| `web/frontend/src/routes/` | Route composition and navigation. |
| `web/frontend/src/features/` | Feature UI, interactions, and presentation state as production workflows are added. |
| `web/frontend/src/lib/api.ts` | Same-origin session transport, normalized API errors and load states. |
| `web/frontend/src/lib/monthly.ts` | Typed request and result contracts for the implemented monthly API. |
| `web/frontend/src/lib/recoverableWrite.ts` | In-memory pending write identity, retry and reauthentication coordination; financial rules remain on the backend. |

Follow the constitution's explicit domain-rule requirements. Each TDD uses
[the template](tdds/template.md) to identify affected rules, all supported commands
that can change their facts, enforcement boundaries, and verification. Services
must protect rule evaluation and persistence in the same transaction/concurrency
boundary; a pure preflight check is insufficient for competing balance changes.

Pure domain modules must not import routers, services, repositories, or ORM models.
Services may depend on domain functions and persistence; keep HTTP request and
response objects at the router boundary. Do not introduce duplicate domain types
or repository interfaces merely to hide every SQLAlchemy dependency.

When a real external integration is added, keep its provider-specific transport
and payload mapping in a dedicated module. Place a small interface near the
application code that consumes it and supply the implementation at composition
time. A Python `Protocol` is appropriate when structural typing helps a real
client and a fake satisfy the same contract. Choose the module location in that
integration's design; do not scaffold a generic provider framework now.

## AI framework

Use Pydantic AI for approved Accanto-owned AI features, following applicable
Aleph patterns for runtime model injection, typed outputs, and deterministic
model substitutes in tests. Services retain persistence and authorization;
financial calculations stay independent of the model. See the
[TDD framework decision](tdds/01-mvp.md#ai-framework) for rationale and scope.

## Testing boundaries

- Put pure calculations and service behavior that can use small fakes in
  `tests/unit/`.
- Put real database, API, and authentication interactions in `tests/integration/`.
  Test persistence guarantees with the database rather than assuming an in-memory
  fake reproduces constraints or transactions.
- Keep frontend unit tests alongside the feature under the frontend's test
  configuration. Production browser journeys will be added with the workflows
  they exercise.
- Keep provider compatibility checks separate from fake-backed application tests;
  mark live external-service tests `external` and run them explicitly.

Select the lowest level that establishes the behavior. Fakes belong at useful
dependency boundaries, not around every internal function. The preserved
standalone prototype contains browser-local calculations and storage for design
exploration; it is not the production authority or persistence model.

## Frontend

The frontend is scaffolded separately into `src/accanto/web/frontend/` using the `frontend-react` Copier template. In development, the frontend dev server runs independently with API proxying. In production, built static files are served by FastAPI via `web/serve.py`.

## Toolchain

| Tool | Purpose |
| ---- | ------- |
| uv | Package management, virtual environments |
| hatchling | Build backend |
| ruff | Formatting and linting |
| ty | Type checking |
| pytest | Testing |
| FastAPI | Async web framework |
| uvicorn | ASGI server |
| structlog | Structured logging |
| pydantic-settings | Configuration |
| pnpm | Frontend package management |
| SQLAlchemy | Async ORM |
| Alembic | Database migrations |

## Conventions

- Python tool configuration is in `pyproject.toml`; frontend config is local to the frontend.
- Version is the single source of truth in `pyproject.toml`, read via `importlib.metadata`.
- `py.typed` marker enables downstream type checking (PEP 561).
- Health endpoints are always available at `/healthz` and `/readyz`.
- Just targets have `-be`/`-fe` variants for backend/frontend (e.g. `just fmt-be`, `just fmt-fe`).
