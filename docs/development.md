# Development

See [the README](../README.md) for the complete setup and runtime commands.

The frontend lives in `src/accanto/web/frontend`. Vite proxies `/api`,
`/healthz`, and `/readyz` to the backend on port 8000. Postgres runs on 5433.

Run `just gate` before committing. The backend unit tests need no database.
The frontend typecheck target builds the app first to generate its route tree.
No frontend, integration, or E2E tests are implemented yet.

To create the first migration after adding a SQLAlchemy model:

```sh
uv run alembic revision --autogenerate -m "create initial models"
uv run alembic upgrade head
```

Import application models in `accanto.models` so Alembic sees `Base.metadata`.
Migration files must be committed; they are not ignored.
