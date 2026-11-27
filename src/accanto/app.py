"""FastAPI application factory."""

import asyncio
import contextvars
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError

from accanto import db, telemetry
from accanto.config import settings
from accanto.logging import configure_logging
from accanto.oidc import OIDCProvider
from accanto.routers import (
    agent,
    api_keys,
    balances,
    browser_auth,
    destinations,
    entities,
    entity_members,
    health,
    inbox,
    monthly,
    notifications,
    projections,
    routines,
    savings,
    schedules,
    sources,
    spending_subcategories,
    tags,
)
from accanto.services import inbox_proposals
from accanto.services.access import RejectionError
from accanto.services.jobs import HANDLERS, JobRunner
from accanto.web.serve import mount_frontend


class LazyMCP:
    """Builds the MCP app on the first /mcp request and runs its session manager
    until the application's lifespan ends.

    fastmcp and mcp take seconds of CPU to import on the Box, longer than a
    deploy waits for the port, so startup does not load them.
    """

    def __init__(self, state):
        self.state = state
        self._ready: asyncio.Future | None = None
        self._runner: asyncio.Task | None = None
        self._stop: asyncio.Event | None = None

    @asynccontextmanager
    async def serving(self):
        self._stop = asyncio.Event()
        try:
            yield
        finally:
            self._stop.set()
            if self._runner is not None:
                await self._runner
            self._ready = self._runner = self._stop = None

    async def app(self):
        if self._stop is None:
            raise RuntimeError("The MCP app runs only within the app lifespan.")
        if self._ready is None:
            self._ready = asyncio.get_running_loop().create_future()
            # A fresh context, as in the lifespan: not the first request's span.
            self._runner = asyncio.create_task(
                self._run(self._ready, self._stop), context=contextvars.Context()
            )
        # Shielded: a cancelled first request must not fail the requests after it.
        return await asyncio.shield(self._ready)

    async def _run(self, ready: asyncio.Future, stop: asyncio.Event):
        try:
            from accanto.mcp_server import create_mcp_app

            mcp = create_mcp_app(self.state)
            async with mcp.router.lifespan_context(mcp):
                ready.set_result(mcp)
                await stop.wait()
        except Exception as error:
            if ready.done():
                raise
            ready.set_exception(error)
        finally:
            if not ready.done():
                ready.cancel()


class MountMCP:
    """ASGI middleware sending exactly /mcp to the MCP app, before any route.

    Keeps the SPA fallback and API middleware away from MCP requests.
    """

    def __init__(self, app, mcp: LazyMCP):
        self.app, self.mcp = app, mcp

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and scope["path"] == "/mcp":
            await (await self.mcp.app())(scope, receive, send)
            return
        await self.app(scope, receive, send)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler; runs the MCP app's session manager too."""
    configure_logging()
    # Background job runs (TDD 11): claims leased runs until shutdown.
    handlers = {
        **HANDLERS,
        inbox_proposals.KIND: inbox_proposals.proposal_step(
            app.state.auth_settings, db.async_session
        ),
    }
    runner = JobRunner(settings, db.async_session, handlers)
    await runner.start()
    app.state.job_runner = runner
    try:
        async with app.state.mcp.serving():
            yield
    finally:
        await runner.stop()


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
    app = FastAPI(
        title="accanto",
        description="A financial companion for planning a rich life.",
        version="0.1.0",
        lifespan=lifespan,
    )

    app.state.auth_settings = settings
    app.state.oidc_provider = OIDCProvider(settings)

    @app.middleware("http")
    async def private_api_responses(request, call_next):
        response = await call_next(request)
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
            response.headers["Referrer-Policy"] = "no-referrer"
        return response

    @app.exception_handler(RejectionError)
    async def rejected(_request, error):
        return JSONResponse(
            status_code=error.status,
            content={"detail": {"code": error.code, "message": error.message}},
            headers={"Cache-Control": "no-store"},
        )

    @app.exception_handler(SQLAlchemyError)
    async def database_failure(_request, _error):
        # SQLAlchemy exceptions can contain financial bind parameters. Never log them.
        return JSONResponse(
            status_code=503,
            content={
                "detail": {
                    "code": "storage_unavailable",
                    "message": (
                        "Save was not confirmed. Retry with the same request identity."
                    ),
                }
            },
        )

    app.include_router(entities.collection)
    app.include_router(entities.router)
    app.include_router(entity_members.router)
    app.include_router(browser_auth.router)
    app.include_router(health.router)
    app.include_router(monthly.router)
    app.include_router(routines.router)
    app.include_router(schedules.router)
    app.include_router(projections.router)
    app.include_router(savings.router)
    app.include_router(destinations.router)
    app.include_router(tags.router)
    app.include_router(spending_subcategories.router)
    app.include_router(balances.router)
    app.include_router(api_keys.router)
    app.include_router(notifications.router)
    app.include_router(inbox.router)
    app.include_router(sources.router)
    app.include_router(sources.provider_router)
    app.include_router(agent.router)

    # MCP v1 at /mcp (TDD 03), dispatched before routing so the SPA never
    # answers it. API keys only; see docs/technical/mcp-clients.md.
    app.state.mcp = LazyMCP(app.state)
    app.add_middleware(MountMCP, mcp=app.state.mcp)

    # Mount frontend static files (only serves if dist/ exists)
    mount_frontend(app)

    telemetry.instrument(app)

    return app


app = create_app()
