"""Agent access journey in the production UI with AGENT_MODEL=stub.

Connects the seeded fake YNAB server through the inbox's connect form, syncs,
asks the assistant to categorize, records from the inbox, and applies a
receipt draft from an attached synthetic image. Everything is synthetic and
loopback-only; the stub model never reaches a network.
"""

import asyncio
import os
import subprocess
import sys
from datetime import UTC, datetime
from uuid import uuid4

from cryptography.fernet import Fernet
from PIL import Image
from sqlalchemy import insert
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine

from accanto.models.monthly import entities, users
from tests.e2e.test_browser import ROOT, free_port, wait_ready
from tests.fakes.ynab_server import FAKE_TOKEN

ENTITY = "Synthetic Agent Entity"


def test_agent_journey(tmp_path):
    url = os.environ.get("ACCANTO_E2E_DATABASE_URL")
    assert url, "Set ACCANTO_E2E_DATABASE_URL to a disposable migrated database"
    parsed = make_url(url)
    assert parsed.database and parsed.database.endswith("_test")
    assert parsed.host in {"127.0.0.1", "localhost"}, "Use local test services only"
    assert (ROOT / "src/accanto/web/frontend/dist/index.html").is_file()
    app_port, issuer_port, ynab_port = free_port(), free_port(), free_port()
    assert len({app_port, issuer_port, ynab_port}) == 3
    origin = f"http://127.0.0.1:{app_port}"
    issuer = f"http://127.0.0.1:{issuer_port}"
    # The fixture provider signs synthetic-user; this run's issuer is unique.
    subject = "synthetic-user"
    today = datetime.now(UTC).date().isoformat()

    async def seed():
        engine = create_async_engine(url)
        try:
            async with engine.begin() as connection:
                user = await connection.scalar(
                    insert(users)
                    .values(issuer=issuer, subject=subject)
                    .returning(users.c.id)
                )
                await connection.execute(
                    insert(entities).values(owner_id=user, name=ENTITY, time_zone="UTC")
                )
        finally:
            await engine.dispose()

    asyncio.run(seed())
    receipt = tmp_path / "synthetic-receipt.png"
    Image.new("RGB", (120, 200), (250, 250, 245)).save(receipt)
    env: dict[str, str] = {
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
        "YNAB_API_URL": f"http://127.0.0.1:{ynab_port}/v1",
        "SOURCE_SECRET_KEY": Fernet.generate_key().decode(),
        "AGENT_MODEL": "stub",
    }
    env.pop("OPENROUTER_API_KEY", None)
    config = tmp_path / "browser.json"
    config.write_text("{}")
    session = "accanto-agent-e2e-" + uuid4().hex
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
                "--args",
                "--no-sandbox",
                *args,
            ],
            env=browser_env,
            capture_output=True,
            text=True,
            timeout=45,
        )
        if check and result.returncode:
            state = browser("snapshot", "-i", check=False)
            raise AssertionError(
                f"Browser command failed: {args[0]} {args[1:]}\n"
                f"{result.stderr}\nSynthetic page state:\n{state}"
            )
        return result.stdout

    def value(expression):
        return browser("eval", expression).strip().strip('"')

    def until(expression):
        browser("wait", "--fn", expression)

    def idle():
        # No API request in flight: count fetches from the page's own code.
        until(
            "(() => { if (!window.__e2eFetches) { window.__e2eFetches = {n: 0};"
            " const f = window.fetch.bind(window); window.fetch = (...a) => {"
            " window.__e2eFetches.n++; return f(...a).finally(() =>"
            " { window.__e2eFetches.n--; }); }; } return window.__e2eFetches.n === 0;"
            " })()"
        )

    def button(name, within="body"):
        found = (
            f"Array.from(document.querySelector({within!r})?.querySelectorAll"
            "('button') ?? []).find(b => !b.disabled && "
            f"(b.getAttribute('aria-label') ?? b.textContent.trim()) === {name!r})"
        )
        until(f"!!{found}")
        idle()
        browser("find", "role", "button", "click", "--name", name, "--exact")

    def text(selector):
        return value(f"document.querySelector({selector!r})?.textContent ?? ''")

    def go(screen):
        until("!document.querySelector('dialog[open]')")
        browser("find", "role", "link", "click", "--name", screen, "--exact")
        until(f"document.title === {screen + ' · Accanto'!r}")

    def waiting():
        idle()
        return int(
            value(
                "(() => { const strip = document.querySelector('.ix-strip');"
                " const label = strip.textContent.replace("
                "strip.querySelector('b').textContent, '');"
                " return (label.match(/(\\d+) transactions? waiting/) ?? [0, 0])[1];"
                " })()"
            )
        )

    def last_reply():
        return value(
            "Array.from(document.querySelectorAll('.agent .agent-msg.agent'))"
            ".at(-1)?.textContent ?? ''"
        )

    def ask(message):
        browser("find", "label", "Message the assistant", "fill", message)
        button("Send", ".agent")
        until("!document.querySelector('.agent output')")
        until(
            "Array.from(document.querySelectorAll('.agent button'))"
            ".some(b => b.textContent.trim() === 'Send')"
        )
        idle()

    processes = []
    try:
        for command in (
            ["-m", "uvicorn", "tests.oidc_fixture:app", "--port", str(issuer_port)],
            ["-m", "tests.fakes.ynab_server", "--seed", "7", "--port", str(ynab_port)],
            ["-m", "uvicorn", "accanto.app:app", "--port", str(app_port)],
        ):
            served = ["--host", "127.0.0.1", "--no-access-log"]
            argv: list[str] = [
                sys.executable,
                *command,
                *(served if "uvicorn" in command else []),
            ]
            processes.append(
                subprocess.Popen(
                    argv,
                    cwd=ROOT,
                    env=env,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
            )
        wait_ready(issuer + "/.well-known/openid-configuration", processes[0])
        # Unauthenticated, the fake answers 401: any HTTP answer means it is up.
        wait_ready(f"http://127.0.0.1:{ynab_port}/fake/ready", processes[1])
        wait_ready(origin + "/readyz", processes[2])
        browser("set", "viewport", "1440", "900")
        browser("open", origin)
        browser("wait", "a[href='/api/auth/login']")
        browser("find", "role", "link", "click", "--name", "Sign in", "--exact")
        until(f"document.querySelector('.side-user span')?.textContent === {ENTITY!r}")

        # The assistant is off until the owner opts in, from Settings only.
        button("Assistant")
        until("!!document.querySelector('.agent .agent-off')")
        button("Open Settings", ".agent")
        until("document.title === 'Settings · Accanto'")
        until("!!document.querySelector('#agent-enabled')")
        idle()
        browser("click", "#agent-enabled")
        until("document.querySelector('#agent-enabled').checked")
        assert value("document.querySelector('input[value=propose]').checked") == "true"
        button("Save assistant settings")
        until("/Saved/.test(document.querySelector('.toast')?.textContent ?? '')")
        until("!!document.querySelector('.agent textarea')")

        # Connect the synthetic plan through the inbox's form; the token is
        # posted once and is not left in the page.
        go("Transactions inbox")
        until("!!document.querySelector('.ix-connect input[type=password]')")
        browser("find", "label", "YNAB access token", "fill", FAKE_TOKEN)
        button("Find plans")
        until("document.querySelector('.ix-connect select')?.options.length > 1")
        browser("select", ".ix-connect select", "Fixture household plan")
        button("Connect this plan")
        until("!!document.querySelector('.ix-accounts')")
        for name in ("Example Checking", "Sample Rewards Card"):
            browser("find", "label", name, "check")
        button("Import these accounts")
        button("Sync now")
        until("/Synced/.test(document.querySelector('.ix-toast')?.textContent ?? '')")
        assert FAKE_TOKEN not in browser("get", "html", "body")
        before = waiting()
        # The generator's month on checking: 3 groceries, coffee, a purchase
        # and its refund, payroll, 3 split lines, 3 transfers, rent, the
        # unapproved dinner, a bill and a duplicate = 17; on the card: dinner
        # and household goods = 2. Brokerage and savings are not imported.
        assert before == 19, before

        # Proposals record nothing: the waiting count does not move.
        ask("Please categorize my inbox")
        assert "I proposed categories for 19 inbox items" in last_reply()
        until("!/No proposal yet/.test(document.querySelector('#main').textContent)")
        assert waiting() == before

        # Recording from the inbox is the owner's action; the count drops by one.
        rent = value(
            "Array.from(document.querySelectorAll('[role=option]'))"
            ".find(o => o.textContent.includes('Example Property Co'))?.id"
        )
        row = f"[id='{rent}']"
        browser("click", row)
        until(
            f"document.querySelector({row!r})?.getAttribute('aria-selected') === 'true'"
        )
        until(
            "/Accept and record/"
            ".test(document.querySelector('.ix-do .btn.pri')?.textContent)"
        )
        idle()
        # The inbox is keyboard-first: Enter records the current item.
        browser("press", "Enter")
        until(
            "Array.from(document.querySelectorAll('[role=option]'))"
            ".every(o => !o.textContent.includes('Example Property Co'))"
        )
        assert waiting() == before - 1

        # A receipt image: in propose mode its draft card has no Apply in the
        # conversation; Pending changes applies it, and Activity shows it.
        browser("upload", ".agent-attach input", str(receipt))
        until("/1 image/.test(document.querySelector('.agent-attach').textContent)")
        ask(f"Here is a receipt from {today}")
        until("!!document.querySelector('.agent-msg .agent-card')")
        card = ".agent-msg .agent-card"
        assert "Apply" not in text(card)
        assert "SYNTHETIC STORE TOTAL 23.45" in browser("get", "html", card)
        assert "1 image(s) sent, not kept" in text(".agent-log")
        browser("find", "role", "button", "click", "--name", "Pending changes 1")
        button("Apply", ".agent")
        until("/No pending changes/.test(document.querySelector('.agent').textContent)")
        go("Activity")
        until(
            "/Synthetic receipt \\(stub draft\\)/.test("
            "document.querySelector('#main').textContent)"
        )
        assert "$23.45" in text("#main")
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
