"""Agent access journey in the production UI with AGENT_MODEL=stub.

Saves the fake YNAB token in Settings, connects a plan from the inbox (which syncs),
runs the background proposal run, asks the assistant to categorize, records
from the inbox, works through a flow pass (accept, later, ignore, undo), applies a
receipt draft from an attached synthetic image, then runs the AGENT.md interview
and applies the AGENT.md it drafts, and the FIRE number interview from
Projections, applying the FIRE assumptions it drafts. Everything is synthetic
and loopback-only; the stub model never reaches a network. Set
ACCANTO_E2E_RECORDING to a .webm path to record the browser.
"""

import asyncio
import json
import os
import subprocess
import sys
from datetime import UTC, datetime
from uuid import uuid4

import httpx
from cryptography.fernet import Fernet
from PIL import Image
from sqlalchemy import insert
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from accanto.models.monthly import entities, users
from accanto.services.api_keys import issue_key
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
                entity = await connection.scalar(
                    insert(entities)
                    .values(owner_id=user, name=ENTITY, time_zone="UTC")
                    .returning(entities.c.uuid)
                )
                # Seeds the saved Plan the FIRE number interview starts from.
                async with AsyncSession(bind=connection) as session:
                    key = await issue_key(session, user, "Synthetic e2e key")
                return entity, key["key"]
        finally:
            await engine.dispose()

    entity, api_key = asyncio.run(seed())
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
        "JOB_RECONCILER_INTERVAL": "0.2",
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
                " if (!strip) return 0;"
                " const label = strip.textContent.replace("
                "strip.querySelector('b').textContent, '');"
                " return (label.match(/(\\d+) transactions? waiting/) ?? [0, 0])[1];"
                " })()"
            )
        )

    def last_reply():
        return value(
            "Array.from(document.querySelectorAll('.agent .agent-msg.reply'))"
            ".at(-1)?.textContent ?? ''"
        )

    def ask(message):
        browser("find", "label", "Message the assistant", "fill", message)
        button("Send", ".agent")
        until("!document.querySelector('.agent-log[aria-busy=true]')")
        until(
            "Array.from(document.querySelectorAll('.agent button'))"
            ".some(b => b.getAttribute('aria-label') === 'Send')"
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
        recording = os.environ.get("ACCANTO_E2E_RECORDING")
        if recording:
            browser("record", "start", recording)
        browser("open", origin)
        browser("wait", "a[href^='/api/auth/login']")
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
        assert (
            value("document.querySelector('input[value=ask_first]').checked") == "true"
        )
        button("Save assistant settings")
        until("/Saved/.test(document.querySelector('.toast')?.textContent ?? '')")
        until("!!document.querySelector('.agent textarea')")

        # The token is saved once in Settings and is not left in the page.
        # Settings refreshes its reads after the save; select once the form is back.
        until("!!document.querySelector('#provider-kind')")
        browser("select", "#provider-kind", "YNAB")
        browser("find", "label", "YNAB personal access token", "fill", FAKE_TOKEN)
        button("Save token")
        until("/token saved/.test(document.querySelector('#main').textContent)")
        assert FAKE_TOKEN not in browser("get", "html", "body")

        # Connect the synthetic plan from the inbox; choosing accounts syncs.
        button("Open Transactions inbox")
        until("document.querySelector('.ix-connect select')?.options.length > 1")
        browser("select", ".ix-connect select", "Fixture household plan")
        button("Connect this plan")
        until("!!document.querySelector('.ix-accounts')")
        for name in ("Example Checking", "Sample Rewards Card"):
            browser("find", "label", name, "check")
        button("Import these accounts and sync")
        until("/Synced/.test(document.querySelector('.ix-toast')?.textContent ?? '')")
        assert FAKE_TOKEN not in browser("get", "html", "body")
        before = waiting()
        # The generator's month on checking: 3 groceries, coffee, a purchase
        # and its refund, payroll, 3 split lines, 3 transfers, rent, a bill and
        # a duplicate = 16; on the card: dinner and household goods = 2. The
        # uncleared dinner is held until it clears (F6). Brokerage and savings
        # are not imported.
        assert before == 18, before

        # The background proposal run proposes for every waiting item, in steps
        # on the server, and records nothing.
        button("Propose with agent")
        until(
            "/Proposals ready/.test(document.querySelector('.ix-ready')?.textContent)"
        )
        until("!/No proposal yet/.test(document.querySelector('#main').textContent)")
        assert waiting() == before

        # Proposals record nothing: the waiting count does not move.
        ask("Please categorize my inbox")
        assert f"I proposed categories for {before} inbox items" in last_reply()
        until("!/No proposal yet/.test(document.querySelector('#main').textContent)")
        assert waiting() == before

        # Search: / focuses the box and the list narrows as you type; Select all
        # then takes only the matching rows. Enter returns the keys to the list with
        # the search kept; in the box, Esc clears it, then a second Esc leaves.
        rows = "Array.from(document.querySelectorAll('[role=option]'))"
        browser("press", "/")
        until(
            "document.activeElement?.getAttribute('aria-label') === 'Search the inbox'"
        )
        browser("keyboard", "type", "property")
        until(f"{rows}.length === 1")
        assert "Example Property Co" in text("[role=option]")
        browser("press", "Enter")
        until("document.activeElement?.tagName !== 'INPUT'")
        browser("press", "X")
        until(
            "/1 of 1 selected/.test(document.querySelector('.ix-selbar').textContent)"
        )
        browser("press", "Escape")
        browser("press", "/")
        browser("press", "Escape")
        until(f"{rows}.length === {before}")
        browser("press", "Escape")
        until("document.activeElement?.tagName !== 'INPUT'")
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

        # Flow: one item at a time. Enter accepts, l leaves one for later
        # (nothing saved), s ignores, z undoes the ignore, Esc leaves.
        def flow_title():
            until("!!document.querySelector('.ix-card .ix-d-t')")
            return text(".ix-card .ix-d-t")

        def done():
            return int(text(".ix-progress b").split("/")[0])

        browser("press", "F")
        first = flow_title()
        browser("press", "Enter")
        # Accepted: recorded, or ignored when the proposal was to ignore it.
        until(f"document.querySelector('.ix-card .ix-d-t')?.textContent !== {first!r}")
        assert done() == 1
        second = flow_title()
        browser("press", "l")
        until(f"document.querySelector('.ix-card .ix-d-t')?.textContent !== {second!r}")
        assert "1 later" in text(".ix-progress") and done() == 1
        third = flow_title()
        browser("press", "s")
        until("document.querySelector('.ix-progress b').textContent.startsWith('2 /')")
        browser("press", "z")
        until("document.querySelector('.ix-progress b').textContent.startsWith('1 /')")
        assert flow_title() == third
        browser("press", "Escape")
        until("!document.querySelector('.ix-card')")
        # One item left waiting in flow; Later and the undone ignore saved nothing.
        assert waiting() == before - 2

        # Two receipt images in Ask first: their drafts wait as cards and
        # nothing is recorded; Pending changes applies both at once after a
        # confirmation, and Activity shows them.
        for drafted in (1, 2):
            browser("upload", ".agent-attach input", str(receipt))
            until("document.querySelectorAll('.agent-thumb').length === 1")
            ask(f"Here is a receipt from {today}")
            until(
                "document.querySelectorAll('.agent-msg .agent-card').length"
                f" === {drafted}"
            )
        card = ".agent-msg .agent-card"
        assert "Ask first" in text(".agent-mode")
        assert "Apply" in text(card)
        assert "SYNTHETIC STORE TOTAL 23.45" in browser("get", "html", card)
        assert "1 image(s) sent, not kept" in text(".agent-log")
        browser("find", "role", "button", "click", "--name", "Pending changes 2")
        button("Apply all", ".agent")
        until(
            "/Apply all 2 changes to/"
            ".test(document.querySelector('.agent').textContent)"
        )
        button("Apply 2 changes", ".agent")
        until(
            "/Applied all 2 changes/.test(document.querySelector('.agent').textContent)"
        )
        until("/No pending changes/.test(document.querySelector('.agent').textContent)")
        go("Activity")
        until(
            "document.querySelector('#main').textContent"
            ".split('Synthetic receipt (stub draft)').length === 3"
        )
        assert "$23.45" in text("#main")
        # Activity search: / focuses it, every word must match (a number is the
        # exact amount), and it reaches all months. Esc clears it.
        entries = "document.querySelectorAll('#main [role=row]').length"
        shown = int(value(entries))
        browser("press", "/")
        until(
            "document.activeElement?.getAttribute('aria-label') === 'Search activity'"
        )
        browser("keyboard", "type", "receipt 23.45")
        until(f"{entries} === 2")
        assert "2 entries in all months" in text("#main")
        browser("keyboard", "type", "1")
        until(f"{entries} === 0")
        browser("press", "Escape")
        until(f"{entries} === {shown}")

        # AGENT.md interview: one question per reply, the proposed text, and a
        # Pending change only after the owner says yes. The stub keeps the
        # existing AGENT.md (empty here) and adds one section per answer.
        button("New conversation", ".agent")
        button("Interview me for AGENT.md", ".agent")
        until("!document.querySelector('.agent-log[aria-busy=true]')")
        idle()
        assert "categorize your recurring payees" in last_reply()
        ask("Example Grocer is groceries; skip transfers between my accounts.")
        assert "name saving goals" in last_reply()
        # From the keyboard: Alt+Enter starts a new line and Shift+Enter sends.
        compose = ".agent textarea"
        browser("focus", compose)
        browser("keyboard", "type", "Goals are named after the purchase,")
        browser("press", "Alt+Enter")
        browser("keyboard", "type", "like Laptop.")
        typed = "Goals are named after the purchase,\nlike Laptop."
        until(f"document.querySelector({compose!r}).value === {typed!r}")
        browser("press", "Shift+Enter")
        until(f"document.querySelector({compose!r}).value === ''")
        until("!document.querySelector('.agent-log[aria-busy=true]')")
        idle()
        ask("Ask before drafting anything over $500.")
        assert "Shall I save it?" in last_reply()
        assert "Example Grocer is groceries" in last_reply()
        assert not value(
            "document.querySelector('.agent-msg .agent-card') ? 'card' : ''"
        )
        ask("Yes, save it")
        until("!!document.querySelector('.agent-msg .agent-card')")
        assert "Update AGENT.md" in text(".agent-msg .agent-card")
        browser("find", "role", "button", "click", "--name", "Pending changes 1")
        button("Apply", ".agent")
        until("/No pending changes/.test(document.querySelector('.agent').textContent)")
        go("Settings")
        until("/Laptop/.test(document.querySelector('#agent-md')?.value ?? '')")
        agent_md = browser("eval", "document.querySelector('#agent-md').value")
        assert "## Approvals" in agent_md
        # The answer sent with Shift+Enter kept its line break (JSON-escaped here).
        assert "purchase,\\nlike Laptop." in agent_md

        # FIRE number interview from Projections: the assistant starts from the
        # saved Plan version's fixed costs, 1850.00 + 240.00 + 1440.00 / 12 =
        # 2210.00 a month, and with 1790.00 discretionary drafts (2210.00 +
        # 1790.00) x 12 = 48000.00 a year; at 4% the FIRE number is 1200000.00.
        def keyed(path, body=None):
            response = httpx.request(
                "GET" if body is None else "POST",
                f"{origin}/api/entities/{entity}{path}",
                content=None if body is None else json.dumps(body),
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Idempotency-Key": str(uuid4()),
                    "Content-Type": "application/json",
                },
            )
            assert response.status_code == 200, response.text
            return response.json()

        plan = keyed(
            "/plans",
            {
                "name": "Synthetic FIRE Plan",
                "incomes": [{"name": "Synthetic pay", "amount": "6000.00"}],
                "spending": "900.00",
                "fixed_costs": [
                    {"name": name, "amount": amount, "frequency": frequency}
                    for name, amount, frequency in (
                        ("Synthetic mortgage", "1850.00", "monthly"),
                        ("Synthetic utilities", "240.00", "monthly"),
                        ("Synthetic insurance", "1440.00", "annual"),
                    )
                ],
            },
        )
        keyed(f"/plans/{plan['plan_id']}/versions", {"expected_revision": 1})
        button("New conversation", ".agent")
        go("Projections")
        button("Interview me for my FIRE number")
        until("!document.querySelector('.agent-log[aria-busy=true]')")
        idle()
        assert "1 of 4" in last_reply() and "2210.00 a month" in last_reply()
        ask("Yes, all correct.")
        ask("Nothing changes.")
        ask("Synthetic mortgage is fixed rate.")
        assert "4 of 4" in last_reply()
        ask("$1,790 a month.")
        assert "1200000.00" in last_reply() and "Shall I save it?" in last_reply()
        assert not value(
            "document.querySelector('.agent-msg .agent-card') ? 'card' : ''"
        )
        ask("Yes, save it")
        until("!!document.querySelector('.agent-msg .agent-card')")
        card = text(".agent-msg .agent-card")
        assert "Update FIRE assumptions: spending 48000.00" in card
        assert "1 fixed cost does not rise with inflation" in card
        assert "Synthetic mortgage" in card
        browser("find", "role", "button", "click", "--name", "Pending changes 1")
        button("Apply", ".agent")
        until("/No pending changes/.test(document.querySelector('.agent').textContent)")
        # With no investments Projections shows no target or form; the saved
        # spending, which the target is derived from, is read over the API.
        assert keyed("/fire-assumptions")["annual_spending"] == "48000.00"

        def choose_mode(mode, label):
            go("Settings")
            until(f"!!document.querySelector('input[value={mode}]')")
            idle()
            browser("check", f"input[value={mode}]")
            until(f"document.querySelector('input[value={mode}]').checked")
            button("Save assistant settings")
            until(f"/{label}/.test(document.querySelector('.agent-mode')?.textContent)")

        # Apply directly: the same receipt request records, with no card. A new
        # conversation, so the stub does not read it as an interview answer.
        choose_mode("apply_directly", "Apply directly")
        button("New conversation", ".agent")
        cards = int(value("document.querySelectorAll('.agent-card').length"))
        ask(f"Here is a receipt from {today}")
        assert "I recorded a 23.45 spending entry" in last_reply()
        assert int(value("document.querySelectorAll('.agent-card').length")) == cards
        go("Activity")
        until(
            "document.querySelector('#main').textContent.split('$23.45').length === 4"
        )

        # Read only: the agent's proposals are refused; the inbox is unchanged.
        choose_mode("read_only", "Read only")
        assert "Agent mode: Read only" in text(".agent-mode")
        go("Transactions inbox")
        before = waiting()
        ask("Please categorize my inbox")
        assert "Read only" in last_reply()
        assert waiting() == before

        # Inbox zero: ignore everything still waiting from the selection bar.
        # The inbox says it is all done, counts only this visit's decisions and
        # opens this month's Review.
        browser("click", ".ix-selbar .ix-pick")
        until("/ selected/.test(document.querySelector('.ix-selbar').textContent)")
        left = int(text(".ix-selbar > span").split(" ")[0])
        button(f"Ignore {left}")
        zero = "[aria-label='Inbox zero']"
        until(f"!!document.querySelector({zero!r})")
        assert f"{left} cleared this session · 0 recorded · {left} ignored" in text(
            zero
        )
        assert waiting() == 0
        month = datetime.strptime(today, "%Y-%m-%d").strftime("%B %Y")
        button(f"Open {month} Review")
        until("document.title === 'Review · Accanto'")

        # On a phone the sheet fits the visual viewport, which an on-screen
        # keyboard shrinks (simulated here as iOS reports it): the header stays
        # at the top, the composer and the latest reply stay above the keyboard,
        # and the page behind does not scroll. Esc closes the sheet.
        browser("set", "viewport", "390", "844")
        keyboard = 456
        browser(
            "eval",
            "(() => { const v = window.visualViewport;"
            f" Object.defineProperty(v, 'height', {{ get: () => {keyboard} }});"
            " v.dispatchEvent(new Event('resize'));"
            " document.querySelector('.agent textarea').focus(); return 1; })()",
        )
        ask("Please categorize my inbox")
        box = (
            "(s) => { const r = document.querySelector(s).getBoundingClientRect();"
            " return [r.top, r.bottom]; }"
        )
        until(
            f"(({box})('.agent')[1] === {keyboard}) && "
            f"(({box})('.agent-compose')[1] <= {keyboard})"
        )
        assert value(f"String(({box})('.agent-h')[0] >= 0)") == "true"
        assert value("String(document.scrollingElement.scrollTop)") == "0"
        until(
            f"({box})('.agent .agent-msg.reply:last-child')[1]"
            f" <= ({box})('.agent-log')[1] + 1"
        )
        browser("eval", "document.querySelector('.agent textarea').focus()")
        browser("press", "Escape")
        until("!document.querySelector('.agent')")
        if recording:
            browser("record", "stop")
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
