"""Fixture CLI rejects unsafe targets before attempting any database operation."""

import os
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "skills/managing-fixtures/scripts/fixtures.py"


@pytest.mark.parametrize(
    "target,confirm,expected",
    [
        ("127.0.0.1/production", True, "loopback asyncpg URL"),
        ("example.test/accanto_fixture_test", True, "loopback asyncpg URL"),
        (
            "127.0.0.1/accanto_fixture_test?host=example.test",
            True,
            "loopback asyncpg URL",
        ),
        ("127.0.0.1/accanto_fixture_test", False, "requires --confirm-reset"),
    ],
)
def test_fixture_reset_refuses_unsafe_target_without_disclosing_credentials(
    target, confirm, expected
):
    secret = "synthetic-secret-sentinel"
    result = subprocess.run(
        [
            sys.executable,
            str(SCRIPT),
            "reset",
            *(["--confirm-reset"] if confirm else []),
        ],
        env={
            **os.environ,
            "ACCANTO_FIXTURE_DATABASE_URL": f"postgresql+asyncpg://fixture:{secret}@{target}",
        },
        text=True,
        capture_output=True,
        timeout=10,
    )
    assert result.returncode == 1
    assert expected in result.stderr
    assert secret not in result.stdout + result.stderr


@pytest.mark.parametrize(
    "template",
    [
        # An unencoded "@" in the password makes parsing fail on a credential remainder.
        "postgresql+asyncpg://fixture:a@b:{secret}@127.0.0.1/accanto_fixture_test",
        "postgresql+asyncpg://fixture:{secret}@127.0.0.1:notaport/accanto_fixture_test",
        "not a url {secret}",
    ],
)
def test_malformed_database_url_error_does_not_disclose_credential_fragments(template):
    secret = "synthetic-secret-sentinel"
    result = subprocess.run(
        [sys.executable, str(SCRIPT), "inspect"],
        env={
            **os.environ,
            "ACCANTO_FIXTURE_DATABASE_URL": template.format(secret=secret),
        },
        text=True,
        capture_output=True,
        timeout=10,
    )
    assert result.returncode == 1
    assert "loopback asyncpg URL" in result.stderr
    assert secret not in result.stdout + result.stderr
    assert "127.0.0.1" not in result.stderr
