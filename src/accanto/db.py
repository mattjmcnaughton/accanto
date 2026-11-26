"""Database engine and session configuration."""

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from accanto.config import settings


class Base(DeclarativeBase):
    """Shared metadata for application models and migrations."""


engine = create_async_engine(settings.database_url, hide_parameters=True)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


@asynccontextmanager
async def read_snapshot(session: AsyncSession):
    """Use one snapshot for credential, ownership and data without row locks."""
    async with session.begin():
        await session.execute(
            text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
        )
        yield


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    """Yield a database session (use as a FastAPI dependency)."""
    async with async_session() as session:
        yield session
