"""Add estimates to a populated 3a003 schema without rewriting old records."""

import asyncio
import os
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import create_async_engine

from tests.integration.test_session_migration import migrate

URL = os.environ.get("ACCANTO_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="Requires isolated Postgres")


def test_estimate_migration_preserves_history():
    asyncio.run(scenario())


async def scenario():
    assert URL and URL.rsplit("/", 1)[-1].endswith("_test")
    engine = create_async_engine(URL)
    schema = "estimate_migration_test_" + uuid4().hex
    async with engine.connect() as connection:
        transaction = await connection.begin()
        try:
            await connection.execute(text(f"CREATE SCHEMA {schema}"))
            await connection.execute(text(f"SET LOCAL search_path TO {schema}"))
            for filename in (
                "191e70341645_monthly_core_records.py",
                "2a002_authenticated_sessions.py",
                "3a003_browser_login.py",
            ):
                await connection.run_sync(migrate, filename)

            identifiers = [uuid4() for _ in range(12)]
            statements = (
                "INSERT INTO app_user(uuid,issuer,subject) "
                "VALUES (:u,'synthetic-issuer','historical-user')",
                "INSERT INTO api_key(uuid,user_id,digest,name) "
                "VALUES (:k,1,'synthetic-old-digest','old key')",
                "INSERT INTO browser_session(uuid,user_id,digest,expires_at) "
                "VALUES (:s,1,'synthetic-session-digest',now() + interval '1 day')",
                "INSERT INTO entity(uuid,owner_id,name,time_zone) "
                "VALUES (:e,1,'Synthetic Entity','UTC')",
                "INSERT INTO plan(uuid,entity_id) VALUES (:p,1)",
                "INSERT INTO income_source(uuid,plan_id,entity_id) VALUES (:i,1,1)",
                "INSERT INTO plan_revision(uuid,plan_id,entity_id,name,number,saved,"
                "spending,income,tithe_target,unassigned) "
                "VALUES (:v,1,1,'Historical Plan',1,false,100,1000,100,900)",
                "INSERT INTO plan_income_line(uuid,plan_revision_id,plan_id,"
                "income_source_id,name,amount) VALUES (:l,1,1,1,'Income',1000)",
                "UPDATE plan_revision SET saved=true WHERE id=1",
                "INSERT INTO actual_entry(uuid,entity_id,financial_date,category,"
                "amount,note) VALUES (:a,1,'2026-09-15','income',1000,'synthetic')",
                "INSERT INTO entry_income_source(uuid,actual_entry_id,income_source_id,"
                "entity_id) VALUES (:x,1,1,1)",
                "INSERT INTO monthly_review(uuid,entity_id,month,plan_revision_id) "
                "VALUES (:r,1,'2026-09-01',1)",
                "INSERT INTO audit_log(uuid,entity_id,actor_id,api_key_uuid,"
                "interface,operation_uuid,record_type,record_uuid,action,after) "
                "VALUES (:h,1,1,:k,'direct_api',:h,'plan_revision',:v,'save',"
                "CAST(:snapshot AS jsonb))",
            )
            params: dict[str, object] = dict(
                zip(
                    "uksepivlaxrh",
                    identifiers,
                    strict=True,
                )
            )
            params["snapshot"] = '{"synthetic":true}'
            for statement in statements:
                await connection.execute(text(statement), params)
            tables = (
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
            )
            before = {
                table: (
                    (await connection.execute(text(f"SELECT * FROM {table}")))
                    .mappings()
                    .all()
                )
                for table in tables
            }
            await connection.run_sync(migrate, "4a004_income_estimates.py")
            for table in tables:
                after = (
                    (await connection.execute(text(f"SELECT * FROM {table}")))
                    .mappings()
                    .all()
                )
                assert after == before[table], table
            assert (
                await connection.scalar(text("SELECT count(*) FROM income_estimate"))
                == 0
            )
            assert (
                await connection.scalar(
                    text("SELECT count(*) FROM income_estimate_line")
                )
                == 0
            )

            await connection.execute(
                text(
                    "INSERT INTO income_estimate(uuid,entity_id,name,monthly_total) "
                    "VALUES (:id,1,'New scenario',0)"
                ),
                {"id": uuid4()},
            )
            with pytest.raises(IntegrityError):
                async with connection.begin_nested():
                    await connection.execute(
                        text(
                            "INSERT INTO income_estimate_line "
                            "(uuid,estimate_id,entity_id,position,name,gross,withholding,"
                            "payroll,frequency,paid_days,monthly_net) "
                            "VALUES (:id,1,1,0,'Invalid',1,0,0,'daily',NULL,0)"
                        ),
                        {"id": uuid4()},
                    )
        finally:
            await transaction.rollback()
    await engine.dispose()
