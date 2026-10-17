"""Actual uvicorn access logging must not retain callback codes or state."""

import os
import socket
import subprocess
import sys
import time
from pathlib import Path

import httpx


def test_callback_query_is_not_in_uvicorn_access_log(tmp_path):
    with socket.socket() as available:
        available.bind(("127.0.0.1", 0))
        port = available.getsockname()[1]
    log = tmp_path / "synthetic-uvicorn.log"
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
            ],
            cwd=Path(__file__).parents[2],
            env=os.environ.copy(),
            stdout=output,
            stderr=subprocess.STDOUT,
        )
        try:
            with httpx.Client(
                base_url=f"http://127.0.0.1:{port}", trust_env=False
            ) as client:
                for _ in range(100):
                    try:
                        response = client.get("/healthz")
                        if response.status_code == 200:
                            break
                    except httpx.ConnectError:
                        pass
                    time.sleep(0.03)
                else:
                    raise AssertionError("Local uvicorn did not start")
                response = client.get(
                    "/api/auth/callback?code=synthetic-secret-code&state=synthetic-secret-state"
                )
                assert response.status_code == 401
        finally:
            process.terminate()
            process.wait(timeout=10)
    captured = log.read_text()
    assert "GET /api/auth/callback HTTP/1.1" in captured
    assert "synthetic-secret-code" not in captured
    assert "synthetic-secret-state" not in captured
