"""Production UI smoke journey against isolated PostgreSQL and local signed OIDC."""

import asyncio
import os
import socket
import subprocess
import sys
import time
from pathlib import Path
from uuid import uuid4

import httpx
from sqlalchemy import insert
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine

from accanto.models.monthly import entities, users

ROOT = Path(__file__).resolve().parents[2]


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def wait_ready(url, process):
    for _ in range(100):
        assert process.poll() is None, "Test server exited before readiness"
        try:
            if httpx.get(url).status_code == 200:
                return
        except httpx.TransportError:
            pass
        time.sleep(0.1)
    raise AssertionError("Test server did not become ready")


def test_signed_in_workspace(tmp_path):
    url = os.environ.get("ACCANTO_E2E_DATABASE_URL")
    assert url, "Set ACCANTO_E2E_DATABASE_URL to a disposable migrated database"
    parsed = make_url(url)
    assert parsed.database and parsed.database.endswith("_test")
    assert parsed.host in {"127.0.0.1", "localhost"}, "Use local test services only"
    assert (ROOT / "src/accanto/web/frontend/dist/index.html").is_file(), (
        "Build the production frontend before E2E"
    )
    app_port, issuer_port = free_port(), free_port()
    assert app_port != issuer_port
    origin = f"http://127.0.0.1:{app_port}"
    issuer = f"http://127.0.0.1:{issuer_port}"

    async def seed():
        engine = create_async_engine(url)
        try:
            async with engine.begin() as connection:
                user = await connection.scalar(
                    insert(users)
                    .values(issuer=issuer, subject="synthetic-user")
                    .returning(users.c.id)
                )
                await connection.execute(
                    insert(entities).values(
                        owner_id=user, name="Synthetic E2E Entity", time_zone="UTC"
                    )
                )
        finally:
            await engine.dispose()

    asyncio.run(seed())
    env = {
        **os.environ,
        "DATABASE_URL": url,
        "BROWSER_ORIGIN": origin,
        "BROWSER_CSRF_SECRET": "synthetic-e2e-csrf-secret-not-for-production",
        "OIDC_ISSUER": issuer,
        "OIDC_CLIENT_ID": "synthetic-client",
        "OIDC_CLIENT_SECRET": "synthetic-client-secret",
        "OIDC_ALLOWED_EMAILS": '["synthetic@example.test"]',
        "ACCANTO_TEST_OIDC_ISSUER": issuer,
        "ACCANTO_TEST_BROWSER_ORIGIN": origin,
    }
    config = tmp_path / "browser.json"
    config.write_text("{}")
    session = "accanto-e2e-" + uuid4().hex
    # Do not inherit personal browser profiles, plugins, proxy or session settings.
    browser_env = {
        key: value
        for key, value in os.environ.items()
        if key in {"PATH", "HOME", "TMPDIR", "XDG_CACHE_HOME"}
    }
    browser_env["AGENT_BROWSER_DEFAULT_TIMEOUT"] = "15000"

    def browser(*args, check=True):
        result = subprocess.run(
            [
                "agent-browser",
                "--config",
                str(config),
                "--session",
                session,
                "--allowed-domains",
                "127.0.0.1",
                # Ephemeral CI runners may disable unprivileged user namespaces.
                "--args",
                "--no-sandbox",
                *args,
            ],
            env=browser_env,
            capture_output=True,
            text=True,
            timeout=45,
        )
        if check:
            assert result.returncode == 0, f"Browser command failed: {args[0]}"
        return result.stdout

    processes = []
    try:
        for module, port in (
            ("tests.oidc_fixture:app", issuer_port),
            ("accanto.app:app", app_port),
        ):
            processes.append(
                subprocess.Popen(
                    [
                        sys.executable,
                        "-m",
                        "uvicorn",
                        module,
                        "--host",
                        "127.0.0.1",
                        "--port",
                        str(port),
                        "--no-access-log",
                    ],
                    cwd=ROOT,
                    env=env,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
            )
        wait_ready(issuer + "/.well-known/openid-configuration", processes[0])
        wait_ready(origin + "/readyz", processes[1])
        browser("open", origin)
        # The session request completes after navigation; find does not wait.
        browser("wait", "a[href='/api/auth/login']")
        browser("find", "role", "link", "click", "--name", "Sign in", "--exact")
        browser("wait", "--text", "Synthetic E2E Entity")
        assert "Sign out" in browser("snapshot", "-i")
        browser("reload")
        browser("wait", "--text", "Synthetic E2E Entity")
        browser("find", "role", "button", "click", "--name", "Sign out", "--exact")
        browser("wait", "--text", "Sign in")
        assert "Synthetic E2E Entity" not in browser("get", "text", "body")
    finally:
        try:
            browser("close", check=False)
        finally:
            for process in processes:
                process.terminate()
            for process in processes:
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=10)
