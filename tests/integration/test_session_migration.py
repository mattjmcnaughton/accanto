"""Upgrade a populated old schema, preserving historical identity and snapshots."""

import asyncio
import importlib.util
import os
from pathlib import Path
from uuid import uuid4

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

URL = os.environ.get("ACCANTO_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="Requires isolated Postgres")


def migrate(connection, filename):
    path = Path(__file__).parents[2] / "alembic" / "versions" / filename
    spec = importlib.util.spec_from_file_location("migration_under_test", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.__dict__["op"] = Operations(MigrationContext.configure(connection))
    module.upgrade()


def test_session_migration_preserves_old_records():
    asyncio.run(scenario())


async def scenario():
    assert URL and "test" in URL.rsplit("/", 1)[-1]
    engine = create_async_engine(URL)
    schema = "migration_test_" + uuid4().hex
    async with engine.connect() as connection:
        transaction = await connection.begin()
        try:
            await connection.execute(text(f"CREATE SCHEMA {schema}"))
            await connection.execute(text(f"SET LOCAL search_path TO {schema}"))
            await connection.run_sync(migrate, "191e70341645_monthly_core_records.py")
            for sql in (
                "INSERT INTO app_user(uuid,issuer,subject) VALUES (:id,'test','old')",
                "INSERT INTO api_key(uuid,user_id,digest,name) "
                "VALUES (:id,1,'synthetic-old-hash','old key')",
                "INSERT INTO entity(uuid,owner_id,name,time_zone) "
                "VALUES (:id,1,'Synthetic historical Entity','UTC')",
                "INSERT INTO plan(uuid,entity_id) VALUES (:id,1)",
                "INSERT INTO plan_revision(uuid,plan_id,entity_id,name,number,saved,"
                "spending,income,tithe_target,unassigned) "
                "VALUES (:id,1,1,'Historical Plan',1,true,100,1000,100,900)",
                "INSERT INTO audit_log(uuid,entity_id,actor_id,api_key_uuid,interface,"
                "operation_uuid,record_type,record_uuid,action,after) "
                "VALUES (:id,1,1,:id,'direct_api',:id,'plan_revision',:id,'save','{}')",
            ):
                await connection.execute(text(sql), {"id": uuid4()})
            tables = ("app_user", "api_key", "plan_revision", "audit_log")
            before = {
                table: (await connection.execute(text(f"SELECT * FROM {table}")))
                .mappings()
                .all()
                for table in tables
            }
            await connection.run_sync(migrate, "2a002_authenticated_sessions.py")
            for table in tables:
                after = (
                    (await connection.execute(text(f"SELECT * FROM {table}")))
                    .mappings()
                    .all()
                )
                if table == "audit_log":
                    assert after[0]["session_uuid"] is None
                    after = [
                        {
                            key: value
                            for key, value in row.items()
                            if key != "session_uuid"
                        }
                        for row in after
                    ]
                assert after == before[table]
            assert (
                await connection.scalar(text("SELECT count(*) FROM browser_session"))
                == 0
            )
        finally:
            await transaction.rollback()
    await engine.dispose()
