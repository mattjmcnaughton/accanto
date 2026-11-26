"""FastAPI application factory."""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError

from accanto.config import settings
from accanto.logging import configure_logging
from accanto.mcp_server import MountMCP, create_mcp_app
from accanto.oidc import OIDCProvider
from accanto.routers import (
    agent,
    api_keys,
    balances,
    browser_auth,
    destinations,
    entities,
    health,
    inbox,
    income_estimates,
    monthly,
    savings,
    sources,
    tags,
)
from accanto.services.access import RejectionError
from accanto.web.serve import mount_frontend


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler; runs the MCP app's session manager too."""
    configure_logging()
    mcp = app.state.mcp_app
    async with mcp.router.lifespan_context(mcp):
        yield


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
    app.include_router(browser_auth.router)
    app.include_router(health.router)
    app.include_router(monthly.router)
    app.include_router(income_estimates.router)
    app.include_router(savings.router)
    app.include_router(destinations.router)
    app.include_router(tags.router)
    app.include_router(balances.router)
    app.include_router(api_keys.router)
    app.include_router(inbox.router)
    app.include_router(sources.router)
    app.include_router(sources.provider_router)
    app.include_router(agent.router)

    # MCP v1 at /mcp (TDD 03), dispatched before routing so the SPA never
    # answers it. API keys only; see docs/technical/mcp-clients.md.
    app.state.mcp_app = create_mcp_app(app.state)
    app.add_middleware(MountMCP, mcp=app.state.mcp_app)

    # Mount frontend static files (only serves if dist/ exists)
    mount_frontend(app)

    return app


app = create_app()
