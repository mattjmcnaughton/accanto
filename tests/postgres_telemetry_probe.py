"""Opt-in local PostgreSQL diagnostic privacy check; no existing DB is attached.

Run with a unique container name. Creates/stops only that synthetic container and
never prints credentials, SQL inputs or server log contents. Requires cached image.
"""

import json
import os
import secrets
import subprocess
import sys
import time
from pathlib import Path


def main(root: Path, name: str) -> None:
    assert name.startswith("accanto-mvp023-telemetry-")
    existing = subprocess.check_output(
        ["docker", "ps", "-a", "--format", "{{.Names}}"], text=True
    ).splitlines()
    assert name not in existing, "Refuse to replace an existing container"
    config = json.loads(
        subprocess.check_output(
            [
                "docker",
                "compose",
                "-f",
                str(root / "docker-compose.yml"),
                "config",
                "--format",
                "json",
            ],
            text=True,
        )
    )["services"]["postgres"]
    env = {**os.environ, "POSTGRES_PASSWORD": secrets.token_hex(24)}
    subprocess.run(
        [
            "docker",
            "run",
            "--pull=never",
            "-d",
            "--name",
            name,
            "-e",
            "POSTGRES_PASSWORD",
            config["image"],
            *(config.get("command") or []),
        ],
        env=env,
        capture_output=True,
        text=True,
        check=True,
    )
    try:
        for _ in range(100):
            ready = subprocess.run(
                [
                    "docker",
                    "exec",
                    name,
                    "pg_isready",
                    "-h",
                    "127.0.0.1",
                    "-U",
                    "postgres",
                ],
                capture_output=True,
            )
            if ready.returncode == 0:
                break
            time.sleep(0.1)
        else:
            raise AssertionError("Synthetic database did not become ready")
        # Deliberately invented note/amount; provoke a real constraint failure.
        marker = "synthetic-financial-telemetry-marker"
        probe = subprocess.run(
            [
                "docker",
                "exec",
                "-i",
                name,
                "psql",
                "-U",
                "postgres",
                "-v",
                "ON_ERROR_STOP=1",
            ],
            input=(
                "CREATE TABLE privacy_probe(note text, "
                "amount numeric CHECK(amount>=0));\n"
                f"INSERT INTO privacy_probe VALUES ('{marker}',-98765.43);\n"
            ),
            capture_output=True,
            text=True,
        )
        assert probe.returncode != 0 and "violates check constraint" in probe.stderr
        logs = subprocess.run(
            ["docker", "logs", name], capture_output=True, text=True, check=True
        )
        captured = logs.stdout + logs.stderr
        assert marker not in captured, "PostgreSQL diagnostics retained financial input"
        assert "98765.43" not in captured, "PostgreSQL diagnostics retained amount"
        assert env["POSTGRES_PASSWORD"] not in captured
        print(
            "Real constraint rejection; PostgreSQL diagnostics exclude synthetic inputs"
        )
    finally:
        subprocess.run(
            ["docker", "stop", name], capture_output=True, check=True, text=True
        )


if __name__ == "__main__":
    main(Path(sys.argv[1]).resolve(), sys.argv[2])
