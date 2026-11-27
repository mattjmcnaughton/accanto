"""6p036 deletes waiting items whose source copy is uncleared and keeps the rest."""
# ruff: noqa: E501 -- Keep explicit synthetic SQL fixtures readable together.

import asyncio
import json
import os
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from tests.integration.test_release_upgrade import upgrade

URL = os.environ.get("ACCANTO_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="Requires isolated PostgreSQL")
# source_ref -> (status before, cleared in the latest source copy)
ITEMS = {
    "t-pending": ("waiting", False),
    "t-posted": ("waiting", True),
    "t-ignored": ("skipped", False),
    "t-gone": ("removed", False),
}


def test_uncleared_waiting_items_are_deleted_and_others_kept():
    asyncio.run(scenario())


async def statuses(connection):
    rows = await connection.execute(
        text("SELECT source_ref, status, proposal FROM staged_transaction")
    )
    return {ref: (status, proposal) for ref, status, proposal in rows}


async def scenario():
    assert URL and URL.rsplit("/", 1)[-1].endswith("_test")
    engine = create_async_engine(URL)
    schema = "uncleared_inbox_" + uuid4().hex
    async with engine.connect() as connection:
        transaction = await connection.begin()
        try:
            await connection.execute(text(f"CREATE SCHEMA {schema}"))
            await connection.execute(text(f"SET LOCAL search_path TO {schema}"))
            await connection.run_sync(upgrade, "6o035")
            for statement in (
                "INSERT INTO app_user(uuid,issuer,subject) VALUES (:u,'synthetic-issuer','synthetic-uncleared-user')",
                "INSERT INTO entity(uuid,owner_id,name,time_zone) VALUES (:e,1,'Synthetic Entity','UTC')",
                "INSERT INTO transaction_source(uuid,entity_id,kind,external_ref,name,secret_ciphertext,start_date) VALUES (:s,1,'ynab','plan-fixture','Fixture plan','synthetic-ciphertext','2026-11-01')",
            ):
                await connection.execute(
                    text(statement), {"u": uuid4(), "e": uuid4(), "s": uuid4()}
                )
            for ref, (status, cleared) in ITEMS.items():
                latest = {"source_ref": ref, "amount": "-12.00", "cleared": cleared}
                await connection.execute(
                    text(
                        "INSERT INTO staged_transaction(uuid,entity_id,source_id,source_ref,financial_date,latest,status,proposal)"
                        " VALUES (:id,1,1,:ref,'2026-11-10',CAST(:latest AS jsonb),:status,CAST(:proposal AS jsonb))"
                    ),
                    {
                        "id": uuid4(),
                        "ref": ref,
                        "latest": json.dumps(latest),
                        "status": status,
                        "proposal": json.dumps({"category": "spending"}),
                    },
                )

            await connection.run_sync(upgrade, "6p036")
            after = await statuses(connection)
            # Only the uncleared waiting item goes; the next sync stages it
            # once it clears.
            assert {ref: st for ref, (st, _) in after.items()} == {
                "t-posted": "waiting",
                "t-ignored": "skipped",
                "t-gone": "removed",
            }
        finally:
            await transaction.rollback()
    await engine.dispose()
