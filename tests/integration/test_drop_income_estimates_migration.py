"""6l032 drops saved income estimates and keeps every other record and audit row."""
# ruff: noqa: E501 -- Keep explicit synthetic SQL fixtures readable together.

import asyncio
import importlib.util
import os
from pathlib import Path
from uuid import uuid4

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import create_async_engine

from tests.integration.test_release_upgrade import upgrade

URL = os.environ.get("ACCANTO_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="Requires isolated PostgreSQL")
MIGRATION = (
    Path(__file__).parents[2]
    / "alembic"
    / "versions"
    / "6l032_drop_income_estimates.py"
)
KEPT = ("app_user", "entity", "audit_log")


def downgrade(connection):
    spec = importlib.util.spec_from_file_location("migration_under_test", MIGRATION)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.__dict__["op"] = Operations(MigrationContext.configure(connection))
    module.downgrade()


def test_drop_income_estimates_keeps_other_records_and_audit_history():
    asyncio.run(scenario())


async def exists(connection, table):
    return await connection.scalar(text(f"SELECT to_regclass('{table}') IS NOT NULL"))


async def snapshot(connection):
    return {
        table: (await connection.execute(text(f"SELECT * FROM {table} ORDER BY id")))
        .mappings()
        .all()
        for table in KEPT
    }


async def scenario():
    assert URL and URL.rsplit("/", 1)[-1].endswith("_test")
    engine = create_async_engine(URL)
    schema = "drop_estimates_" + uuid4().hex
    async with engine.connect() as connection:
        transaction = await connection.begin()
        try:
            await connection.execute(text(f"CREATE SCHEMA {schema}"))
            await connection.execute(text(f"SET LOCAL search_path TO {schema}"))
            await connection.run_sync(upgrade, "6k031")
            ids = {k: uuid4() for k in ("user", "entity", "estimate", "line", "audit")}
            for statement in (
                "INSERT INTO app_user(uuid,issuer,subject) VALUES (:user,'synthetic-issuer','synthetic-estimate-user')",
                "INSERT INTO entity(uuid,owner_id,name,time_zone) VALUES (:entity,1,'Synthetic Entity','UTC')",
                "INSERT INTO income_estimate(uuid,entity_id,name,monthly_total) VALUES (:estimate,1,'Synthetic scenario',4500)",
                "INSERT INTO income_estimate_line(uuid,estimate_id,entity_id,position,name,gross,withholding,payroll,frequency,monthly_net) VALUES (:line,1,1,0,'Synthetic role',6000,1200,300,'monthly',4500)",
                "INSERT INTO audit_log(uuid,entity_id,actor_id,interface,operation_uuid,record_type,record_uuid,action,after) VALUES (:audit,1,1,'browser',:audit,'income_estimate',:estimate,'create','{\"synthetic\": true}')",
            ):
                await connection.execute(text(statement), ids)
            before = await snapshot(connection)

            await connection.run_sync(upgrade, "head")
            assert not await exists(connection, "income_estimate_line")
            assert not await exists(connection, "income_estimate")
            # Other records and the estimate's audit history are untouched.
            assert await snapshot(connection) == before

            # Downgrade restores the empty tables with their constraints.
            await connection.run_sync(downgrade)
            assert (
                await connection.scalar(text("SELECT count(*) FROM income_estimate"))
                == 0
            )
            await connection.execute(
                text(
                    "INSERT INTO income_estimate(uuid,entity_id,name,monthly_total) VALUES (:id,1,'Recreated',0)"
                ),
                {"id": uuid4()},
            )
            with pytest.raises(IntegrityError):
                async with connection.begin_nested():
                    await connection.execute(
                        text(
                            "INSERT INTO income_estimate_line(uuid,estimate_id,entity_id,position,name,gross,withholding,payroll,frequency,paid_days,monthly_net) "
                            "VALUES (:id,1,1,0,'Daily without paid days',1,0,0,'daily',NULL,0)"
                        ),
                        {"id": uuid4()},
                    )
        finally:
            await transaction.rollback()
    await engine.dispose()
