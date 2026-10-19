"""Upgrade synthetic historical data through the actual Alembic revision graph."""
# ruff: noqa: E501 -- Keep explicit synthetic SQL fixtures readable together.

import asyncio
import os
from pathlib import Path
from uuid import uuid4

import pytest
from alembic.config import Config
from alembic.runtime.environment import EnvironmentContext
from alembic.script import ScriptDirectory
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

URL = os.environ.get("ACCANTO_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="Requires isolated PostgreSQL")
ROOT = Path(__file__).parents[2]
TABLES = (
    "app_user",
    "api_key",
    "browser_session",
    "entity",
    "plan",
    "income_source",
    "plan_revision",
    "plan_income_line",
    "actual_entry",
    "entry_income_source",
    "monthly_review",
    "audit_log",
    "idempotency_outcome",
)


def upgrade(connection, target):
    """Use Alembic's graph and version table on our transaction-owned connection."""
    config = Config()
    config.set_main_option("script_location", str(ROOT / "alembic"))
    script = ScriptDirectory.from_config(config)
    # Follow declared dependencies rather than assuming filename ordering.
    # Alembic selects only unapplied steps, including none at an existing head.
    with EnvironmentContext(
        config,
        script,
        fn=lambda current, _context: script._upgrade_revs(target, current),
    ) as environment:
        environment.configure(connection=connection)
        environment.run_migrations()


def test_release_upgrade_preserves_populated_history_and_repeated_head():
    asyncio.run(scenario())


async def scenario():
    assert URL and URL.rsplit("/", 1)[-1].endswith("_test")
    engine = create_async_engine(URL)
    schema = "release_upgrade_" + uuid4().hex
    try:
        async with engine.connect() as connection:
            transaction = await connection.begin()
            try:
                await connection.execute(text(f"CREATE SCHEMA {schema}"))
                await connection.execute(text(f"SET LOCAL search_path TO {schema}"))
                await connection.run_sync(upgrade, "3a003")
                assert (
                    await connection.scalar(
                        text("SELECT version_num FROM alembic_version")
                    )
                    == "3a003"
                )
                identifiers = {
                    key: uuid4()
                    for key in (
                        "user",
                        "entity",
                        "plan",
                        "source",
                        "version1",
                        "version2",
                        "key",
                        "revoked_key",
                        "session",
                        "revoked_session",
                        "operation",
                    )
                }
                statements = (
                    "INSERT INTO app_user(uuid,issuer,subject) VALUES (:user,'synthetic-upgrade-issuer','synthetic-historical-user')",
                    "INSERT INTO api_key(uuid,user_id,digest,name) VALUES (:key,1,'synthetic-upgrade-active-digest','Synthetic active key')",
                    "INSERT INTO api_key(uuid,user_id,digest,name,revoked_at) VALUES (:revoked_key,1,'synthetic-upgrade-revoked-digest','Synthetic revoked key','2026-09-20T12:00:00Z')",
                    "INSERT INTO browser_session(uuid,user_id,digest,expires_at) VALUES (:session,1,'synthetic-upgrade-session-digest','2026-10-20T00:00:00Z')",
                    "INSERT INTO browser_session(uuid,user_id,digest,expires_at,revoked_at) VALUES (:revoked_session,1,'synthetic-upgrade-revoked-session','2026-10-20T00:00:00Z','2026-09-20T12:00:00Z')",
                    "INSERT INTO entity(uuid,owner_id,name,time_zone) VALUES (:entity,1,'Synthetic historical Entity','UTC')",
                    "INSERT INTO plan(uuid,entity_id) VALUES (:plan,1)",
                    "INSERT INTO income_source(uuid,plan_id,entity_id) VALUES (:source,1,1)",
                    "INSERT INTO plan_revision(uuid,plan_id,entity_id,name,number,spending,income,tithe_target,unassigned) VALUES (:version1,1,1,'Synthetic saved Plan',1,100,1000,100,900)",
                    "INSERT INTO plan_income_line(uuid,plan_revision_id,plan_id,income_source_id,name,amount) VALUES (:row,1,1,1,'Synthetic income',1000)",
                    "UPDATE plan_revision SET saved=true,saved_at='2026-09-01T12:00:00Z' WHERE id=1",
                    "INSERT INTO plan_revision(uuid,plan_id,entity_id,name,number,spending,income,tithe_target,unassigned) VALUES (:version2,1,1,'Synthetic revised Plan',2,120,1100,110,980)",
                    "INSERT INTO plan_income_line(uuid,plan_revision_id,plan_id,income_source_id,name,amount) VALUES (:row,2,1,1,'Synthetic income renamed',1100)",
                    "UPDATE plan_revision SET saved=true,saved_at='2026-09-02T12:00:00Z' WHERE id=2",
                    "INSERT INTO actual_entry(uuid,entity_id,financial_date,category,amount,note) VALUES (:row,1,'2026-09-15','income',1000,'Synthetic income received')",
                    "INSERT INTO entry_income_source(uuid,actual_entry_id,income_source_id,entity_id) VALUES (:row,1,1,1)",
                    "INSERT INTO actual_entry(uuid,entity_id,financial_date,category,amount,note,deleted_at,revision) VALUES (:row,1,'2026-09-16','spending',25,'Synthetic deleted purchase','2026-09-17T12:00:00Z',2)",
                    "INSERT INTO monthly_review(uuid,entity_id,month,plan_revision_id,note) VALUES (:row,1,'2026-09-01',1,'Synthetic retained Review')",
                    "INSERT INTO audit_log(uuid,entity_id,actor_id,api_key_uuid,interface,operation_uuid,record_type,record_uuid,action,before,after) VALUES (:row,1,1,:revoked_key,'direct_api',:operation,'plan_revision',:version1,'save',NULL,'{\"synthetic\": true,\"income\":\"1000.00\"}')",
                    "INSERT INTO audit_log(uuid,entity_id,actor_id,session_uuid,interface,operation_uuid,record_type,record_uuid,action,before,after) VALUES (:row,1,1,:revoked_session,'browser',:operation,'plan_revision',:version2,'save','{\"income\":\"1000.00\"}','{\"income\":\"1100.00\"}')",
                    "INSERT INTO idempotency_outcome(uuid,entity_id,user_id,operation,request_key,request_hash,response) VALUES (:row,1,1,'save_plan_version','synthetic-historical-request','synthetic-historical-request-hash',jsonb_build_object('version_uuid',CAST(CAST(:version1 AS uuid) AS text),'number',1))",
                )
                for statement in statements:
                    await connection.execute(
                        text(statement), {**identifiers, "row": uuid4()}
                    )
                await connection.execute(text("SET CONSTRAINTS ALL IMMEDIATE"))
                before = {
                    table: (
                        await connection.execute(
                            text(f"SELECT * FROM {table} ORDER BY id")
                        )
                    )
                    .mappings()
                    .all()
                    for table in TABLES
                }
                await connection.run_sync(upgrade, "head")
                for table in TABLES:
                    after = (
                        (
                            await connection.execute(
                                text(f"SELECT * FROM {table} ORDER BY id")
                            )
                        )
                        .mappings()
                        .all()
                    )
                    # New additive fields are checked separately; every historical
                    # field, including UUIDs and JSON snapshots, must match exactly.
                    assert [
                        {key: row[key] for key in before[table][0]} for row in after
                    ] == before[table], table
                assert (
                    await connection.scalar(
                        text(
                            "SELECT count(*) FROM actual_entry WHERE recording_order=id"
                        )
                    )
                    == 2
                )
                assert (
                    await connection.scalar(text("SELECT count(*) FROM audit_log")) == 2
                )
                config = Config()
                config.set_main_option("script_location", str(ROOT / "alembic"))
                head = ScriptDirectory.from_config(config).get_current_head()
                assert (
                    await connection.scalar(
                        text("SELECT version_num FROM alembic_version")
                    )
                    == head
                )
                # Snapshot every table and column, including new empty feature
                # tables, before an actual repeated Alembic upgrade-to-head.
                tables = (
                    (
                        await connection.execute(
                            text(
                                "SELECT tablename FROM pg_tables WHERE schemaname=:schema ORDER BY tablename"
                            ),
                            {"schema": schema},
                        )
                    )
                    .scalars()
                    .all()
                )
                at_head = {
                    table: (
                        await connection.execute(
                            text(
                                f'SELECT to_jsonb(t) FROM "{table}" t ORDER BY to_jsonb(t)::text'
                            )
                        )
                    )
                    .scalars()
                    .all()
                    for table in tables
                }
                await connection.run_sync(upgrade, "head")
                for table in tables:
                    assert (
                        await connection.execute(
                            text(
                                f'SELECT to_jsonb(t) FROM "{table}" t ORDER BY to_jsonb(t)::text'
                            )
                        )
                    ).scalars().all() == at_head[table], table
            finally:
                await transaction.rollback()
    finally:
        await engine.dispose()
