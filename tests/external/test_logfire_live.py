"""The trace privacy scenario against real Logfire, read back through its API.

Sends synthetic data only, to a Logfire project with environment `live-test`.
Needs ACCANTO_TEST_DATABASE_URL plus a write token and a read token for that
project (LOGFIRE_LIVE_WRITE_TOKEN, LOGFIRE_LIVE_READ_TOKEN); see
docs/technical/telemetry.md. Run with `just test-logfire-live`.
"""

import asyncio
import json
import os
import time
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from logfire.query_client import LogfireQueryClient

from tests.integration.test_trace_privacy import URL, check, drive, server

WRITE = os.environ.get("LOGFIRE_LIVE_WRITE_TOKEN")
READ = os.environ.get("LOGFIRE_LIVE_READ_TOKEN")
pytestmark = [
    pytest.mark.external,
    pytest.mark.skipif(
        not (URL and WRITE and READ),
        reason="Needs ACCANTO_TEST_DATABASE_URL and live Logfire tokens",
    ),
]
EXPECTED = {"invoke_agent agent", "inbox.sync_counts", "tools/call list_activity"}


def stored(run, since):
    """Every record and metric of this run, once ingestion has settled."""
    assert READ
    rows, deadline = [], time.monotonic() + 120
    with LogfireQueryClient(read_token=READ) as client:

        def query(table):
            sql = f"SELECT * FROM {table} WHERE service_version = '{run}'"
            return client.query_json_rows(sql=sql, min_timestamp=since, limit=10000)[
                "rows"
            ]

        while time.monotonic() < deadline:
            time.sleep(5)
            latest = query("records")
            names = {row["span_name"] for row in latest}
            if names >= EXPECTED and len(latest) == len(rows):
                metrics = query("metrics")
                assert metrics, "Logfire stored no metrics for this run"
                return latest, metrics
            rows = latest
    raise AssertionError(f"Logfire returned {len(rows)} records without {EXPECTED}")


def test_live_logfire_records_exclude_financial_data(tmp_path):
    assert URL and URL.rsplit("/", 1)[-1].endswith("_test")
    run = f"live-test-{uuid4().hex[:12]}"  # tags only this run's records
    since = datetime.now(UTC) - timedelta(minutes=1)
    telemetry = {
        "LOGFIRE_TOKEN": WRITE,
        "LOGFIRE_ENVIRONMENT": "live-test",
        "LOGFIRE_SERVICE_VERSION": run,
    }
    with server(tmp_path, telemetry) as (origin, secrets):
        private = asyncio.run(drive(origin, secrets, uuid4().hex[:12]))
    rows, metrics = stored(run, since)
    found = [(row["span_name"], row["attributes"] or {}) for row in rows]
    keys = {k for row in rows + metrics for k in row.get("attributes") or {}}
    keys |= {k for row in rows for k in row.get("otel_resource_attributes") or {}}
    documents = [json.dumps(row, default=str) for row in rows + metrics]
    check(found, documents, keys, [*private, WRITE, READ, URL])
