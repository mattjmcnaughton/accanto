"""FastAPI application factory."""

from contextlib import asynccontextmanager

from fastapi import FastAPI

from accanto.logging import configure_logging
from accanto.routers import health
from accanto.web.serve import mount_frontend


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler."""
    configure_logging()
    yield


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
    app = FastAPI(
        title="accanto",
        description="A financial companion for planning a rich life.",
        version="0.1.0",
        lifespan=lifespan,
    )

    app.include_router(health.router)

    # Mount frontend static files (only serves if dist/ exists)
    mount_frontend(app)

    return app


app = create_app()
