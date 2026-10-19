"""Readiness rejects reachable databases without the supported schema."""

import asyncio
import os
from uuid import uuid4

import httpx
import pytest
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from accanto import db
from accanto.app import create_app
from accanto.routers.health import SCHEMA_REVISION

URL = os.environ.get("ACCANTO_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="Requires isolated PostgreSQL")


def test_readiness_tracks_supported_schema(monkeypatch):
    asyncio.run(scenario(monkeypatch))


async def scenario(monkeypatch):
    assert URL and URL.rsplit("/", 1)[-1].endswith("_test")
    assert ScriptDirectory.from_config(Config("alembic.ini")).get_heads() == [
        SCHEMA_REVISION
    ], "Review readiness and application rollback compatibility for every migration"
    engine = create_async_engine(URL, hide_parameters=True)
    try:
        async with engine.connect() as connection, connection.begin():
            # Entire synthetic scratch schema rolls back; no populated DB resets.
            schema = "readiness_" + uuid4().hex
            await connection.execute(text(f"CREATE SCHEMA {schema}"))
            await connection.execute(text(f"SET LOCAL search_path TO {schema}"))
            monkeypatch.setattr(
                db,
                "async_session",
                async_sessionmaker(
                    bind=connection, join_transaction_mode="create_savepoint"
                ),
            )
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=create_app()), base_url="http://test"
            ) as client:
                assert (await client.get("/healthz")).status_code == 200
                assert (await client.get("/readyz")).status_code == 503
                await connection.execute(
                    text("CREATE TABLE alembic_version (version_num varchar(32))")
                )
                assert (await client.get("/readyz")).status_code == 503
                await connection.execute(
                    text("INSERT INTO alembic_version VALUES ('3a003')")
                )
                assert (await client.get("/readyz")).status_code == 503
                await connection.execute(
                    text("UPDATE alembic_version SET version_num=:head"),
                    {"head": SCHEMA_REVISION},
                )
                await connection.execute(
                    text("INSERT INTO alembic_version VALUES ('unexpected-branch')")
                )
                assert (await client.get("/readyz")).status_code == 503
            # Roll back synthetic schema before checking the genuinely migrated DB.
            await connection.rollback()
        monkeypatch.setattr(db, "async_session", async_sessionmaker(engine))
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=create_app()), base_url="http://test"
        ) as client:
            response = await client.get("/readyz")
            assert response.status_code == 200
            assert response.json() == {"status": "ready"}
    finally:
        await engine.dispose()
