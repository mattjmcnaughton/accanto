"""Upgrade populated synthetic 5j018 history without rewriting existing records."""
# ruff: noqa: E501 -- SQL fixtures keep their explicit synthetic fields together.

import asyncio
import os
from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from tests.integration.test_session_migration import migrate

URL = os.environ.get("ACCANTO_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="Requires isolated PostgreSQL")


def test_savings_lifecycle_migration_preserves_populated_base():
    asyncio.run(scenario())


async def scenario():
    assert URL and URL.rsplit("/", 1)[-1].endswith("_test")
    engine = create_async_engine(URL)
    schema = "saving_lifecycle_migration_" + uuid4().hex
    async with engine.connect() as connection:
        transaction = await connection.begin()
        try:
            await connection.execute(text(f"CREATE SCHEMA {schema}"))
            await connection.execute(text(f"SET LOCAL search_path TO {schema}"))
            for filename in sorted(
                (Path(__file__).parents[2] / "alembic/versions").glob("*.py")
            ):
                if filename.name.startswith("5k019"):
                    break
                await connection.run_sync(migrate, filename.name)
            for sql in (
                "INSERT INTO app_user(uuid,issuer,subject) VALUES (:id,'synthetic-migration','old')",
                "INSERT INTO api_key(uuid,user_id,digest,name) VALUES (:id,1,'synthetic-only-hash','Synthetic historical key')",
                "INSERT INTO entity(uuid,owner_id,name,time_zone) VALUES (:id,1,'Synthetic historical Entity','UTC')",
                "INSERT INTO plan(uuid,entity_id) VALUES (:id,1)",
                "INSERT INTO plan_revision(uuid,plan_id,entity_id,name,number,saved,spending,income,tithe_target,unassigned) VALUES (:id,1,1,'Synthetic saved Plan',1,true,100,1000,100,900)",
                "INSERT INTO saving_account(uuid,entity_id,name,opening_date,opening_amount) VALUES (:id,1,'Synthetic historical cash','2026-10-01',1000)",
                "INSERT INTO saving_goal(uuid,entity_id,account_id,name,role,kind,target,opening_amount) VALUES (:id,1,1,'Unallocated','unallocated','ongoing',NULL,900)",
                "INSERT INTO saving_goal(uuid,entity_id,account_id,name,role,kind,target,opening_amount) VALUES (:id,1,1,'Synthetic finite','ordinary','finite',100,100)",
                "INSERT INTO actual_entry(uuid,entity_id,financial_date,category,amount,note) VALUES (:id,1,'2026-10-02','spending',20,'Synthetic historical purchase')",
                "INSERT INTO saving_linked_activity(uuid,entity_id,account_id,goal_id,financial_date,actual_entry_id,recording_order) SELECT :id,1,1,2,'2026-10-02',id,recording_order FROM actual_entry",
                "INSERT INTO savings_reassignment(uuid,entity_id,financial_date,from_goal_id,to_goal_id,amount,note) VALUES (:id,1,'2026-10-03',2,1,10,'Synthetic historical move')",
                "INSERT INTO audit_log(uuid,entity_id,actor_id,api_key_uuid,interface,operation_uuid,record_type,record_uuid,action,after) VALUES (:id,1,1,(SELECT uuid FROM api_key LIMIT 1),'direct_api',:id,'actual_entry',:id,'create_entry','{\"amount\":\"20.00\",\"note\":\"Synthetic historical purchase\"}')",
            ):
                await connection.execute(text(sql), {"id": uuid4()})
            await connection.execute(text("SET CONSTRAINTS ALL IMMEDIATE"))
            tables = (
                "app_user",
                "api_key",
                "entity",
                "plan",
                "plan_revision",
                "saving_account",
                "saving_goal",
                "actual_entry",
                "saving_linked_activity",
                "savings_reassignment",
                "audit_log",
            )
            before = {
                table: (
                    await connection.execute(text(f"SELECT * FROM {table} ORDER BY id"))
                )
                .mappings()
                .all()
                for table in tables
            }
            await connection.run_sync(migrate, "5k019_savings_lifecycle.py")
            for table in tables:
                after = (
                    (
                        await connection.execute(
                            text(f"SELECT * FROM {table} ORDER BY id")
                        )
                    )
                    .mappings()
                    .all()
                )
                for row in after:
                    if table == "saving_goal":
                        assert (
                            row["completed"] is False
                            and row["archived_by_account"] is False
                        )
                    if table == "savings_reassignment":
                        assert row["completion_goal_id"] is None
                assert [
                    {key: row[key] for key in before[table][0]} for row in after
                ] == before[table]
        finally:
            await transaction.rollback()
    await engine.dispose()
