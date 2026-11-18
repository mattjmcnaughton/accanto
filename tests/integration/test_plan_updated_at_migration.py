"""Plan update metadata keeps historical rows unknown and saved versions immutable."""
# ruff: noqa: E501 -- SQL fixtures keep their explicit synthetic fields together.

import asyncio
import importlib.util
import os
from pathlib import Path
from uuid import uuid4

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import create_async_engine

from tests.integration.test_session_migration import migrate

URL = os.environ.get("ACCANTO_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="Requires isolated PostgreSQL")
VERSIONS = Path(__file__).parents[2] / "alembic" / "versions"
MIGRATION = "5l020_plan_updated_at.py"


def downgrade(connection):
    spec = importlib.util.spec_from_file_location(
        "migration_under_test", VERSIONS / MIGRATION
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.__dict__["op"] = Operations(MigrationContext.configure(connection))
    module.downgrade()


def test_plan_updated_at_migration_keeps_history_unknown_and_saved_versions_immutable():
    asyncio.run(scenario())


async def scalar(connection, sql, **values):
    return await connection.scalar(text(sql), values)


async def update_triggers(connection, schema):
    return await scalar(
        connection,
        "SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = :schema AND t.tgname LIKE '%\\_updated'",
        schema=schema,
    )


async def rejected(connection, sql, message):
    savepoint = await connection.begin_nested()
    with pytest.raises(DBAPIError, match=message):
        await connection.execute(text(sql))
    await savepoint.rollback()


async def scenario():
    assert URL and URL.rsplit("/", 1)[-1].endswith("_test")
    engine = create_async_engine(URL)
    schema = "plan_updated_at_migration_" + uuid4().hex
    async with engine.connect() as connection:
        transaction = await connection.begin()
        try:
            await connection.execute(text(f"CREATE SCHEMA {schema}"))
            await connection.execute(text(f"SET LOCAL search_path TO {schema}"))
            for filename in sorted(VERSIONS.glob("*.py")):
                if filename.name.startswith("5l020"):
                    break
                await connection.run_sync(migrate, filename.name)
            # Historical Plan: a saved version and an editable draft, each with an income line.
            for sql in (
                "INSERT INTO app_user(uuid,issuer,subject) VALUES (:id,'synthetic-migration','old')",
                "INSERT INTO entity(uuid,owner_id,name,time_zone) VALUES (:id,1,'Synthetic historical Entity','UTC')",
                "INSERT INTO plan(uuid,entity_id) VALUES (:id,1)",
                "INSERT INTO income_source(uuid,plan_id,entity_id) VALUES (:id,1,1)",
                "INSERT INTO plan_revision(uuid,plan_id,entity_id,name,number,saved,spending,income,tithe_target,unassigned) VALUES (:id,1,1,'Synthetic version',1,false,100,1000,100,900)",
                "INSERT INTO plan_income_line(uuid,plan_revision_id,plan_id,income_source_id,name,amount) VALUES (:id,1,1,1,'Synthetic salary',1000)",
                "UPDATE plan_revision SET saved=true, saved_at=now() WHERE id=1",
                "INSERT INTO plan_revision(uuid,plan_id,entity_id,name,number,saved,spending,income,tithe_target,unassigned) VALUES (:id,1,1,'Synthetic draft',2,false,100,1000,100,900)",
                "INSERT INTO plan_income_line(uuid,plan_revision_id,plan_id,income_source_id,name,amount) VALUES (:id,2,1,1,'Synthetic salary',1000)",
            ):
                await connection.execute(text(sql), {"id": uuid4()})
            before = (
                (
                    await connection.execute(
                        text(
                            "SELECT id,uuid,name,saved,saved_at,revision,spending FROM plan_revision ORDER BY id"
                        )
                    )
                )
                .mappings()
                .all()
            )
            await connection.run_sync(migrate, MIGRATION)

            # Existing rows stay unknown; the migration time is not an edit time.
            rows = (
                (
                    await connection.execute(
                        text("SELECT * FROM plan_revision ORDER BY id")
                    )
                )
                .mappings()
                .all()
            )
            assert [row["updated_at"] for row in rows] == [None, None]
            assert [{key: row[key] for key in before[0]} for row in rows] == [
                dict(row) for row in before
            ]

            # A draft revision edit and every line change stamp its own revision only.
            await connection.execute(
                text("UPDATE plan_revision SET name='Renamed draft' WHERE id=2")
            )
            await connection.execute(
                text(
                    "INSERT INTO income_source(uuid,plan_id,entity_id) VALUES (gen_random_uuid(),1,1)"
                )
            )
            stamps = [
                await scalar(
                    connection, "SELECT updated_at FROM plan_revision WHERE id=2"
                )
            ]
            assert stamps[0] is not None
            for sql in (
                "UPDATE plan_income_line SET amount=900 WHERE id=2",
                "INSERT INTO plan_income_line(uuid,plan_revision_id,plan_id,income_source_id,name,amount) VALUES (gen_random_uuid(),2,1,2,'Synthetic bonus',10)",
                "DELETE FROM plan_income_line WHERE plan_revision_id=2 AND income_source_id=2",
            ):
                await connection.execute(text(sql))
                stamps.append(
                    await scalar(
                        connection, "SELECT updated_at FROM plan_revision WHERE id=2"
                    )
                )
                assert stamps[-1] > stamps[-2], sql
            assert (
                await scalar(
                    connection, "SELECT updated_at FROM plan_revision WHERE id=1"
                )
                is None
            )

            # Saving the draft in place is allowed; afterwards neither version nor its lines change.
            await connection.execute(
                text(
                    "UPDATE plan_revision SET saved=true, saved_at=now(), revision=revision+1 WHERE id=2"
                )
            )
            saved_stamp = await scalar(
                connection, "SELECT updated_at FROM plan_revision WHERE id=2"
            )
            assert saved_stamp > stamps[-1]
            for revision in (1, 2):
                await rejected(
                    connection,
                    f"UPDATE plan_revision SET name='Tampered' WHERE id={revision}",
                    "saved Plan version is immutable",
                )
                await rejected(
                    connection,
                    f"UPDATE plan_income_line SET amount=1 WHERE plan_revision_id={revision}",
                    "saved Plan line is immutable",
                )
                await rejected(
                    connection,
                    f"DELETE FROM plan_income_line WHERE plan_revision_id={revision}",
                    "saved Plan line is immutable",
                )
            assert (
                await scalar(
                    connection, "SELECT updated_at FROM plan_revision WHERE id=1"
                )
                is None
            )
            assert (
                await scalar(
                    connection, "SELECT updated_at FROM plan_revision WHERE id=2"
                )
                == saved_stamp
            )

            assert await update_triggers(connection, schema) == 7
            # Downgrade removes only the metadata and its triggers; history and protection remain.
            await connection.run_sync(downgrade)
            assert (
                await scalar(
                    connection,
                    "SELECT count(*) FROM information_schema.columns WHERE table_schema=:schema AND table_name='plan_revision' AND column_name='updated_at'",
                    schema=schema,
                )
                == 0
            )
            assert await update_triggers(connection, schema) == 0
            assert await scalar(connection, "SELECT count(*) FROM plan_revision") == 2
            await rejected(
                connection,
                "UPDATE plan_revision SET name='Tampered' WHERE id=1",
                "saved Plan version is immutable",
            )

            # Upgrading again returns every revision to unknown.
            await connection.run_sync(migrate, MIGRATION)
            assert (
                await scalar(
                    connection,
                    "SELECT count(*) FROM plan_revision WHERE updated_at IS NOT NULL",
                )
                == 0
            )
        finally:
            await transaction.rollback()
    await engine.dispose()
