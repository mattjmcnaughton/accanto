"""Real server storage/validation errors must not emit synthetic private inputs."""

import asyncio
import os
import subprocess
import sys
from pathlib import Path
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import insert, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from accanto.models import monthly as m
from accanto.services.api_keys import issue_key
from tests.e2e.test_browser import free_port, wait_ready

URL = os.environ.get("ACCANTO_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="Requires isolated PostgreSQL")


def test_real_server_errors_exclude_financial_inputs(tmp_path):
    asyncio.run(scenario(tmp_path))


async def scenario(tmp_path):
    assert URL and URL.rsplit("/", 1)[-1].endswith("_test")
    engine = create_async_engine(URL, hide_parameters=True)
    sessions = async_sessionmaker(engine)
    suffix = uuid4().hex
    trigger = "telemetry_failure_" + suffix
    marker = "synthetic-private-input-" + suffix
    amount = "98765.43"  # Deliberately invented test value, unrelated to user data.
    process = None
    try:
        async with sessions() as session, session.begin():
            user = await session.scalar(
                insert(m.users)
                .values(issuer="synthetic-telemetry", subject=suffix)
                .returning(m.users.c.id)
            )
            entity = (
                (
                    await session.execute(
                        insert(m.entities)
                        .values(
                            owner_id=user, name="Synthetic telemetry", time_zone="UTC"
                        )
                        .returning(m.entities)
                    )
                )
                .mappings()
                .one()
            )
            key = await issue_key(session, user, "Synthetic telemetry")
        async with engine.begin() as connection:
            # Simulate a failure that itself contains a sensitive financial value.
            await connection.execute(
                text(
                    f"CREATE FUNCTION {trigger}() RETURNS trigger "
                    "LANGUAGE plpgsql AS $$ "
                    f"BEGIN IF NEW.entity_id={entity['id']} THEN "
                    f"RAISE EXCEPTION '{marker} {amount}'; END IF; RETURN NEW; END $$"
                )
            )
            await connection.execute(
                text(
                    f"CREATE TRIGGER {trigger} BEFORE INSERT ON audit_log "
                    f"FOR EACH ROW EXECUTE FUNCTION {trigger}()"
                )
            )
        port = free_port()
        log = tmp_path / "synthetic-server.log"
        with log.open("w") as output:
            process = subprocess.Popen(
                [
                    sys.executable,
                    "-m",
                    "uvicorn",
                    "accanto.app:app",
                    "--host",
                    "127.0.0.1",
                    "--port",
                    str(port),
                    "--no-access-log",
                ],
                cwd=Path(__file__).parents[2],
                env={**os.environ, "DATABASE_URL": URL},
                stdout=output,
                stderr=subprocess.STDOUT,
            )
            origin = f"http://127.0.0.1:{port}"
            wait_ready(origin + "/readyz", process)
            with httpx.Client(base_url=origin, trust_env=False) as client:
                endpoint = f"/api/entities/{entity['uuid']}/plans"
                headers = {
                    "Authorization": f"Bearer {key['key']}",
                    "Idempotency-Key": suffix,
                }
                body = {
                    "name": marker,
                    "incomes": [{"name": marker, "amount": amount}],
                    "spending": "0",
                }
                invalid = client.post(
                    endpoint, headers=headers, json={**body, "spending": marker}
                )
                assert invalid.status_code == 422
                failed = client.post(endpoint, headers=headers, json=body)
                assert failed.status_code == 503
                assert failed.json()["detail"]["code"] == "storage_unavailable"
                assert marker not in failed.text and amount not in failed.text
        process.terminate()
        process.wait(timeout=10)
        captured = log.read_text()
        for private in (marker, amount, key["key"], URL):
            assert private not in captured
        assert "Application startup complete" in captured
    finally:
        if process and process.poll() is None:
            process.terminate()
            process.wait(timeout=10)
        async with engine.begin() as connection:
            await connection.execute(
                text(f"DROP TRIGGER IF EXISTS {trigger} ON audit_log")
            )
            await connection.execute(text(f"DROP FUNCTION IF EXISTS {trigger}()"))
        await engine.dispose()
