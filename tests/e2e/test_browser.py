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
    app_port = int(os.environ.get("ACCANTO_E2E_APP_PORT", free_port()))
    issuer_port = int(os.environ.get("ACCANTO_E2E_ISSUER_PORT", free_port()))
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
        browser("find", "role", "button", "click", "--name", "Activity", "--exact")
        browser("wait", "--text", "Record activity")
        browser(
            "find", "role", "button", "click", "--name", "Record activity", "--exact"
        )
        browser("find", "label", "Amount (USD)", "fill", "210")
        browser("find", "role", "button", "click", "--name", "Save activity", "--exact")
        browser("wait", "--text", "$210.00")
        browser(
            "find", "role", "button", "click", "--name", "Enter known total", "--exact"
        )
        browser("find", "label", "Known total (USD)", "fill", "250")
        browser(
            "find", "role", "button", "click", "--name", "Save adjustment", "--exact"
        )
        browser("wait", "--text", "$40.00")
        assert "Adjustment" in browser("get", "text", "body")
        browser("reload")
        browser("wait", "--text", "Synthetic E2E Entity")
        browser("find", "role", "button", "click", "--name", "Activity", "--exact")
        browser("wait", "--text", "$40.00")
        browser("find", "role", "button", "click", "--name", "Plans", "--exact")
        # A reviewed month can contain unknown actuals. Later activity leaves the
        # annotation set and displays an informational checkpoint mismatch.
        browser("find", "role", "button", "click", "--name", "New Plan", "--exact")
        browser("find", "label", "Plan name", "fill", "Synthetic month")
        browser("find", "label", "Income source 1", "fill", "Synthetic source")
        browser("find", "label", "Net amount 1", "fill", "4000")
        browser("find", "label", "Monthly guilt-free spending", "fill", "800")
        browser("find", "role", "button", "click", "--name", "Save draft", "--exact")
        browser(
            "wait",
            "--fn",
            "Array.from(document.querySelectorAll('button'))"
            ".some(b => b.textContent.trim() === 'Save version')",
        )
        browser("find", "role", "button", "click", "--name", "Save version", "--exact")
        browser("wait", "--text", "View Synthetic month v1")
        browser(
            "find", "role", "button", "click", "--name", "Monthly Review", "--exact"
        )
        browser("wait", "--text", "Start this month's Review")
        choice = (
            browser("eval", "document.querySelector('select').options[1].value")
            .strip()
            .strip('"')
        )
        browser("select", "select", choice)
        browser("find", "role", "button", "click", "--name", "Create Review", "--exact")
        browser("wait", "--text", "Review notes and checkpoint")
        browser("find", "label", "Review note", "fill", "Synthetic takeaway")
        browser("find", "label", "Mark reviewed", "check")
        browser("find", "role", "button", "click", "--name", "Save Review", "--exact")
        browser("wait", "--text", "Marked reviewed.")
        assert "Unknown" in browser("get", "text", "body")
        browser("find", "role", "button", "click", "--name", "Activity", "--exact")
        browser(
            "find", "role", "button", "click", "--name", "Record activity", "--exact"
        )
        browser("find", "label", "Amount (USD)", "fill", "25")
        browser("find", "role", "button", "click", "--name", "Save activity", "--exact")
        browser("wait", "--text", "$25.00")
        browser(
            "find", "role", "button", "click", "--name", "Monthly Review", "--exact"
        )
        browser("wait", "--text", "Changed since review. Your annotation remains set.")
        browser("find", "role", "button", "click", "--name", "Savings", "--exact")
        browser("wait", "--text", "No savings accounts yet.")
        browser(
            "find",
            "role",
            "button",
            "click",
            "--name",
            "New savings account",
            "--exact",
        )
        browser("find", "label", "Name", "fill", "Synthetic savings")
        browser("find", "label", "Opening amount", "fill", "10000.00")
        browser(
            "find", "role", "button", "click", "--name", "Add opening goal", "--exact"
        )
        browser("find", "label", "Goal name", "fill", "Emergency")
        browser("find", "label", "Target (required)", "fill", "8000.00")
        browser("find", "label", "Opening designation", "fill", "5000.00")
        browser(
            "find", "role", "button", "click", "--name", "Add opening goal", "--exact"
        )
        browser("fill", "fieldset:nth-of-type(2) label:nth-of-type(1) input", "Laptop")
        browser("fill", "fieldset:nth-of-type(2) label:nth-of-type(3) input", "1000.00")
        browser("fill", "fieldset:nth-of-type(2) label:nth-of-type(4) input", "1000.00")
        browser("find", "role", "button", "click", "--name", "Save", "--exact")
        browser("wait", "--text", "Synthetic savings")
        page = browser("snapshot")
        assert "Current saved" in page, page
        assert "Unallocated" in page and "$4000.00" in page
        assert "Contribution progress $0.00" in page
        assert "Not yet funded" in page and "Funded" in page
        browser("reload")
        browser("wait", "--text", "Synthetic E2E Entity")
        browser("find", "role", "button", "click", "--name", "Savings", "--exact")
        browser("wait", "--text", "Synthetic savings")
        browser("set", "viewport", "375", "760")
        assert "Unallocated" in browser("snapshot")
        browser("find", "role", "button", "click", "--name", "Activity", "--exact")
        browser("wait", "--text", "Record activity")
        browser(
            "find", "role", "button", "click", "--name", "Record activity", "--exact"
        )
        browser("find", "label", "Amount (USD)", "fill", "1200.00")
        browser("select", "select[name='funding-origin']", "savings")
        goal_option = (
            browser(
                "eval",
                "Array.from(document.querySelector('select[name=\"saving-goal\"]').options)"
                ".find(option => option.textContent.includes('Laptop')).value",
            )
            .strip()
            .strip('"')
        )
        browser("select", "select[name='saving-goal']", goal_option)
        browser("find", "role", "button", "click", "--name", "Save activity", "--exact")
        browser(
            "wait", "--text", "The input needs correction. Your entries are still here."
        )
        assert "1200.00" in browser(
            "get", "value", "form.editor input[inputmode='decimal']"
        )
        browser(
            "find",
            "role",
            "button",
            "click",
            "--name",
            "Discard pending save",
            "--exact",
        )
        browser("select", "form.editor select", "saving")
        browser("find", "label", "Amount (USD)", "fill", "200.00")
        browser("select", "select[name='saving-goal']", goal_option)
        browser("find", "role", "button", "click", "--name", "Save activity", "--exact")
        browser("wait", "--text", "$200.00")
        browser(
            "find", "role", "button", "click", "--name", "Record activity", "--exact"
        )
        browser("find", "label", "Amount (USD)", "fill", "1200.00")
        browser("select", "select[name='funding-origin']", "savings")
        browser("select", "select[name='saving-goal']", goal_option)
        browser("find", "role", "button", "click", "--name", "Save activity", "--exact")
        browser("wait", "--text", "$1200.00")
        browser("find", "role", "button", "click", "--name", "Savings", "--exact")
        browser("wait", "--text", "Contribution progress $200.00")
        browser(
            "find", "role", "button", "click", "--name", "Monthly Review", "--exact"
        )
        browser("wait", "--text", "Spending funded from previously saved money")
        review_text = browser("get", "text", "body")
        assert "New saving" in review_text and "$200.00" in review_text
        assert "$1200.00" in review_text
        browser(
            "find",
            "role",
            "button",
            "click",
            "--name",
            "Investments and giving",
            "--exact",
        )
        browser("wait", "--text", "No investment destinations yet.")
        browser(
            "find", "role", "button", "click", "--name", "Add investment", "--exact"
        )
        browser("find", "label", "Name", "fill", "Example fund")
        browser(
            "find",
            "label",
            "Cumulative contribution target (USD, optional)",
            "fill",
            "2000.00",
        )
        browser(
            "find",
            "label",
            "Opening observed value (USD, optional)",
            "fill",
            "25000.00",
        )
        browser(
            "find", "role", "button", "click", "--name", "Save destination", "--exact"
        )
        browser("wait", "--text", "Opening observed value $25000.00")
        assert "Active · Contributions $0.00" in browser("get", "text", "body")
        browser(
            "find",
            "role",
            "button",
            "click",
            "--name",
            "Record contribution",
            "--exact",
        )
        browser("find", "label", "Amount (USD)", "fill", "1000.00")
        investment_option = (
            browser(
                "eval",
                "Array.from(document.querySelector('form.editor select').options)"
                ".find(option => option.textContent === 'Example fund').value",
            )
            .strip()
            .strip('"')
        )
        browser("select", "form.editor select", investment_option)
        browser(
            "find", "role", "button", "click", "--name", "Save contribution", "--exact"
        )
        browser("wait", "--text", "Active · Contributions $1000.00")
        browser("find", "role", "button", "click", "--name", "Activity", "--exact")
        browser("wait", "--text", "Investment contribution")
        investment_activity = browser(
            "eval",
            "Array.from(document.querySelectorAll('.record-list article'))"
            ".find(article => article.textContent"
            ".includes('Investment contribution')).textContent",
        )
        assert (
            "Example fund" in investment_activity
            and "Unassigned" not in investment_activity
        )
        browser(
            "find",
            "role",
            "button",
            "click",
            "--name",
            "Investments and giving",
            "--exact",
        )
        browser(
            "find", "role", "button", "click", "--name", "Giving recipients", "--exact"
        )
        browser("wait", "--text", "No giving destinations yet.")
        browser("find", "role", "button", "click", "--name", "Add recipient", "--exact")
        browser("find", "label", "Name", "fill", "Example recipient")
        browser(
            "find",
            "label",
            "Cumulative contribution target (USD, optional)",
            "fill",
            "500.00",
        )
        browser(
            "find", "role", "button", "click", "--name", "Save destination", "--exact"
        )
        browser("wait", "--text", "Example recipient")
        browser(
            "find",
            "role",
            "button",
            "click",
            "--name",
            "Record contribution",
            "--exact",
        )
        browser("find", "label", "Amount (USD)", "fill", "100.00")
        giving_option = (
            browser(
                "eval",
                "Array.from(document.querySelector('form.editor select').options)"
                ".find(option => option.textContent === 'Example recipient').value",
            )
            .strip()
            .strip('"')
        )
        browser("select", "form.editor select", giving_option)
        browser(
            "find", "role", "button", "click", "--name", "Save contribution", "--exact"
        )
        browser("wait", "--text", "Active · Contributions $100.00")
        browser(
            "find",
            "role",
            "button",
            "click",
            "--name",
            "Record contribution",
            "--exact",
        )
        browser("find", "label", "Adjustment to recorded total", "check")
        browser("find", "label", "Amount (USD)", "fill", "-25.00")
        browser("select", "form.editor select", giving_option)
        browser(
            "find", "role", "button", "click", "--name", "Save contribution", "--exact"
        )
        browser("wait", "--text", "Active · Contributions $75.00")
        browser("set", "viewport", "360", "780")
        browser("reload")
        browser("wait", "--text", "Synthetic E2E Entity")
        browser(
            "find",
            "role",
            "button",
            "click",
            "--name",
            "Investments and giving",
            "--exact",
        )
        browser("wait", "--text", "Opening observed value $25000.00")
        assert "Active · Contributions $1000.00" in browser("get", "text", "body")
        assert (
            browser(
                "eval", "document.documentElement.scrollWidth <= innerWidth"
            ).strip()
            == "true"
        )
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
