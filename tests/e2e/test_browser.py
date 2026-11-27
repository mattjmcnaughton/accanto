"""Production UI smoke journey against isolated PostgreSQL and local signed OIDC."""

import asyncio
import os
import socket
import subprocess
import sys
import time
from datetime import UTC, datetime
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

    def settle(target):
        # agent-browser clicks at coordinates it measured a moment earlier. A
        # load or a post-save reload that lands in between moves the target (a
        # subtitle or a card's actions render), and the press hits the space
        # beside it. Click only once no API request is in flight and the target
        # has held its position for 150 ms.
        browser(
            "wait",
            "--fn",
            "(() => {"
            " if (!window.__e2eFetches) {"
            "  window.__e2eFetches = {n: 0}; const f = window.fetch.bind(window);"
            "  window.fetch = (...a) => { window.__e2eFetches.n++;"
            "   return f(...a).finally(() => { window.__e2eFetches.n--; }); }; }"
            f" const el = {target}; if (!el) return false;"
            " const r = el.getBoundingClientRect();"
            " const at = [r.x, r.y, r.width, r.height].join();"
            " const now = performance.now(); const s = window.__e2eSettle;"
            " if (window.__e2eFetches.n || !s || s.at !== at || s.el !== el) {"
            "  window.__e2eSettle = {at, el, since: now}; return false; }"
            " return now - s.since >= 150; })()",
        )

    def browser(*args, check=True):
        if args[0] == "click":
            # A control inside a dialog or form is rendered before a pending save
            # re-enables its fieldset. Visible is not yet actionable.
            browser(
                "wait",
                "--fn",
                "document.querySelector(" + repr(args[1]) + ")"
                "?.matches(':not(:disabled)')",
            )
            settle("document.querySelector(" + repr(args[1]) + ")")
            # Center targets inside scrolling dialogs and the worksheet before
            # native pointer input; a sticky header or footer can cover an edge.
            browser(
                "eval",
                "document.querySelector(" + repr(args[1]) + ")"
                ".scrollIntoView({block:'center',behavior:'instant'});"
                "new Promise(r => requestAnimationFrame("
                "() => requestAnimationFrame(r)))",
            )
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

    def button(name):
        # find does not wait: screens and dialogs render their controls after
        # their reads, and a pending save disables them.
        until(
            "Array.from(document.querySelectorAll('button')).some(b => !b.disabled"
            f" && (b.getAttribute('aria-label') ?? b.textContent.trim()) === {name!r})"
        )
        settle(
            "Array.from(document.querySelectorAll('button')).find(b => !b.disabled"
            f" && (b.getAttribute('aria-label') ?? b.textContent.trim()) === {name!r})"
        )
        browser("find", "role", "button", "click", "--name", name, "--exact")

    def go(screen):
        # Screens are links: the sidebar at desktop widths; below 760 px the
        # phone tabs, with More listing the screens that have no tab.
        until("!document.querySelector('dialog[open]')")
        wide = value("innerWidth > 760") == "true"
        if not wide and screen not in {"Home", "Activity"}:
            browser("find", "role", "link", "click", "--name", "More", "--exact")
            until("document.title === 'More · Accanto'")
        browser("find", "role", "link", "click", "--name", screen, "--exact")
        until(f"document.title === {screen + ' · Accanto'!r}")

    def close_dialog():
        browser("click", "dialog[open] .dlg-h button[aria-label='Close']")
        until("!document.querySelector('dialog[open]')")

    def record_activity():
        # The Activity screen's own opener; Add activity in the top bar and the
        # N key open the same dialog from any screen.
        until(
            "Array.from(document.querySelectorAll('#main button'))"
            ".some(b => b.textContent.trim() === 'Record activity' && !b.disabled)"
        )
        button("Record activity")
        until("!!document.querySelector('dialog[open] #activity-record')")

    def save_activity():
        browser("click", "#activity-record button[type='submit']")
        until("!document.querySelector('#activity-record')")

    def save_record(name):
        # Investments, Giving and Loans save from the dialog's primary button.
        button(name)
        until("!document.querySelector('dialog[open]')")

    def set_date(selector, date):
        # Native setter triggers React's delegated handlers on date controls.
        expression = (
            "(() => { const input = document.querySelector("
            + repr(selector)
            + "); const setter = Object.getOwnPropertyDescriptor("
            "HTMLInputElement.prototype, 'value').set; "
            + "setter.call(input, "
            + repr(date)
            + "); "
            "input.dispatchEvent(new Event('input', {bubbles: true})); "
            "input.dispatchEvent(new Event('change', {bubbles: true})); "
            "return input.value; })()"
        )
        assert value(expression) == date

    def option(select, text, *also):
        # Waits for the option, then returns its value.
        found = (
            f"Array.from(document.querySelector({select!r})?.options ?? [])"
            f".find(o => o.textContent.includes({text!r})"
            + "".join(f" && o.textContent.includes({more!r})" for more in also)
            + ")"
        )
        until(f"!!{found}")
        return value(f"{found}.value")

    def combo(selector, typed, chosen):
        # A filtering picker: type, wait for the row, then Enter chooses the
        # first row, as a keyboard user would.
        browser("fill", selector, typed)
        until(
            "Array.from(document.querySelectorAll('[role=option]'))"
            f".some(o => o.textContent.startsWith({chosen!r}))"
        )
        until(
            "document.querySelector('[role=option][aria-selected=true]')"
            f"?.textContent.startsWith({chosen!r})"
        )
        browser("press", "Enter")

    def record_cell(grid, column, expected):
        selector = (
            f'table[aria-label="{grid}"] tbody tr:first-child td:nth-child({column})'
        )
        expect_cell(selector, expected)

    def expect_cell(selector, expected):
        # Assert in one browser evaluation: save-triggered reloads can remove
        # a matching cell between a separate wait and get-text command.
        until(f"document.querySelector({selector!r})?.textContent === {expected!r}")

    def section(name):
        # A Review section's recorded total, then "of" its planned amount.
        return f"section.step[aria-label={name!r}] .amt-col"

    def expect_section(name, recorded):
        until(
            f"document.querySelector({section(name)!r})?.firstChild?.textContent"
            f" === {recorded!r}"
        )

    def expand_section(category):
        browser("click", f"#review-step-{category}")
        until(
            f"document.querySelector('#review-step-{category}')?.textContent"
            " === 'Hide lines'"
        )

    def activity_details(text):
        # Opens the entry whose row has a cell with exactly this text.
        cell_id = value(
            "Array.from(document.querySelectorAll('#main [role=row]'))"
            ".find(row => Array.from(row.querySelectorAll('[role=gridcell]'))"
            f".some(cell => cell.textContent === {text!r}"
            " || cell.querySelector('.ar-title')?.firstChild?.textContent"
            f" === {text!r}))"
            "?.querySelector('[role=gridcell]').id"
        )
        browser("click", f"#{cell_id}")
        until("!!document.querySelector('dialog[open]')")

    def view(name):
        # Record screens show cards or a table, never both; each screen keeps
        # its choice in this browser.
        button(name)
        until(
            "Array.from(document.querySelectorAll('#main [aria-label=View] button'))"
            f".some(b => b.textContent === {name!r}"
            " && b.getAttribute('aria-pressed') === 'true')"
        )

    def open_loan():
        # The loan table's details button opens the loan's dialog with
        # payments, archive and reopen.
        button("Details for Synthetic loan")
        until("!!document.querySelector('dialog[open]')")

    def tab_to_button(name):
        # Verify reachability through native sequential keyboard navigation.
        for _ in range(80):
            if (
                value(
                    "document.activeElement.tagName === 'BUTTON' && "
                    "document.activeElement.textContent.trim() === " + repr(name)
                )
                == "true"
            ):
                return
            browser("press", "Tab")
        raise AssertionError("Keyboard could not reach " + name)

    def signed_in():
        # The Entity's name is in the sidebar, which phone widths hide.
        until(
            "document.querySelector('.side-user span')?.textContent"
            " === 'Synthetic E2E Entity'"
        )

    def fits():
        return value("document.documentElement.scrollWidth <= innerWidth") == "true"

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
        signed_in()
        assert "Sign out" in browser("snapshot", "-i")
        go("Activity")
        record_activity()
        browser("find", "label", "Amount (USD)", "fill", "210")
        # Mobile keyboard recovery uses the real UI/API, with a deliberate local
        # network failure before the request can reach the service. No storage or
        # response-body export is retained.
        browser("set", "viewport", "390", "760")
        browser("network", "route", "**/api/entities/*/activity", "--abort")
        tab_to_button("Record")
        browser("press", "Enter")
        browser("wait", "--text", "Save was not confirmed. Your input is still here.")
        # The notice is inside the modal dialog, next to the retained input.
        until("!!document.querySelector('dialog[open] .recovery-notice')")
        assert (
            browser("get", "value", "#activity-record input[inputmode='decimal']")
            .strip()
            .strip('"')
            == "210"
        )
        assert fits()
        browser("network", "unroute", "**/api/entities/*/activity")
        tab_to_button("Retry save")
        assert value("document.activeElement.textContent") == "Retry save"
        browser("press", "Enter")
        until("!document.querySelector('#activity-record')")
        browser("wait", "--text", "$210.00")
        # A failed reload must be explicit rather than an empty financial workspace.
        go("Plans")
        browser("network", "route", "**/api/entities/*/activity*", "--abort")
        go("Activity")
        browser("wait", "--text", "Could not load this workspace.")
        assert "Nothing is recorded in" not in browser("get", "text", "#main")
        browser("network", "unroute", "**/api/entities/*/activity*")
        tab_to_button("Try loading again")
        browser("press", "Enter")
        browser("wait", "--text", "$210.00")
        browser("set", "viewport", "1280", "900")
        button("Enter known total")
        until("!!document.querySelector('dialog[open] #activity-record')")
        browser("find", "label", "Known total (USD)", "fill", "250")
        assert (
            browser(
                "get", "value", "#activity-record input[inputmode='decimal']"
            ).strip()
            == "250"
        )
        save_activity()
        browser("wait", "--text", "$40.00")
        assert "Adjustment" in browser("get", "text", "#main")
        browser("reload")
        signed_in()
        go("Activity")
        browser("wait", "--text", "$40.00")
        go("Plans")
        # A reviewed month can contain unknown actuals. Later activity leaves the
        # annotation set and displays an informational checkpoint mismatch.
        browser("click", "#new-plan")
        browser("find", "label", "Plan name", "fill", "Synthetic month")
        browser("click", "#create-plan")
        browser("wait", "#rename-plan")
        browser("click", "button[aria-label='Details for Net income']")
        browser("wait", "#detail-name")
        browser("fill", "#detail-name", "Synthetic source")
        browser("fill", "#detail-amount", "4000")
        browser("click", "#close-details")
        # A monthly amount edits in place: Enter keeps it, Escape discards.
        spending = "td[aria-label='Guilt-free spending, Monthly amount']"
        spending_input = "input[aria-label='Monthly amount for Guilt-free spending']"
        browser("click", spending)
        browser("fill", spending_input, "800")
        browser("press", "Enter")
        expect_cell(spending, "$800.00")
        browser("click", spending)
        browser("fill", spending_input, "999")
        browser("press", "Escape")
        expect_cell(spending, "$800.00")
        browser("click", "button[aria-label='Add Fixed costs line']")
        browser("wait", "#detail-name")
        browser("fill", "#detail-name", "Synthetic annual service")
        browser("fill", "#detail-amount", "100.00")
        browser("select", "#detail-frequency", "Annual")
        browser("click", "#save-draft")
        browser("wait", "--text", "$8.33")
        until(
            "!document.querySelector('#save-version').matches(':disabled') "
            "&& document.querySelector('#save-state').textContent"
            ".startsWith('Draft saved')"
        )
        browser("click", "#save-version")
        until("!!document.querySelector('#plan-version option[value=\"0\"]')")
        go("Review")
        until(
            "Array.from(document.querySelectorAll('#main button'))"
            ".some(b => b.textContent.trim() === 'Start Review')"
        )
        choice = value("document.querySelector('#main select').options[1].value")
        browser("select", "#main select", choice)
        button("Start Review")
        browser("wait", "form[aria-label='Close the month'] textarea")
        browser("find", "label", "Review note", "fill", "Synthetic takeaway")
        # Marking the month reviewed saves the note with it.
        browser("click", "form[aria-label='Close the month'] button.pri")
        expect_cell("#main .head .chip", "Reviewed")
        expect_section("Net income", "Unknown")
        expect_section("Fixed costs", "Unknown")
        go("Activity")
        record_activity()
        browser("select", "#activity-record select", "fixed_cost")
        combo(
            "input[name='fixed-cost']",
            "annual service",
            "Synthetic annual service",
        )
        until(
            "document.querySelector(\"input[name='fixed-cost']\").value"
            " === 'Synthetic annual service'"
        )
        browser("find", "label", "Amount (USD)", "fill", "8.33")
        save_activity()
        browser("wait", "--text", "Synthetic annual service")
        go("Review")
        expect_section("Fixed costs", "$8.33")
        until(
            f"document.querySelector({section('Fixed costs')!r})"
            ".textContent.includes('of $8.33, on plan')"
        )
        go("Activity")
        record_activity()
        browser("find", "label", "Amount (USD)", "fill", "25")
        # Inline create: a name no subcategory or tag has becomes one, saved by
        # its own command, and is chosen on the entry before the entry saves.
        combo(
            "input[name='spending-subcategory']",
            "Synthetic hobbies",
            "Create “Synthetic hobbies”",
        )
        until(
            "document.querySelector(\"input[name='spending-subcategory']\")"
            ".value === 'Synthetic hobbies'"
        )
        combo(
            "input[aria-label='Add a tag (Tags)']",
            "Synthetic trip",
            "Create “Synthetic trip”",
        )
        until(
            "Array.from(document.querySelectorAll('#activity-record .tag-chip'))"
            ".some(c => c.textContent.includes('Synthetic trip'))"
        )
        save_activity()
        browser("wait", "--text", "$25.00")
        until(
            "document.querySelector('#main').textContent.includes('Synthetic hobbies')"
        )
        until("document.querySelector('#main').textContent.includes('Synthetic trip')")
        go("Review")
        browser("wait", "--text", "Changed since review")
        assert "Reviewed. Clear the mark" in browser(
            "get", "text", "form[aria-label='Close the month']"
        )
        go("Savings")
        browser("wait", "--text", "No savings accounts yet")
        button("New account")
        browser("find", "label", "Account name", "fill", "Synthetic savings")
        browser("find", "label", "Holds today (USD)", "fill", "10000.00")
        button("Add opening goal")
        browser("find", "label", "Goal name", "fill", "Emergency")
        browser("find", "label", "Target (required)", "fill", "8000.00")
        browser("find", "label", "Opening designation", "fill", "5000.00")
        button("Add opening goal")
        second = "dialog[open] .dlg-b > fieldset:nth-of-type(2)"
        browser("fill", f"{second} > label:nth-of-type(1) input", "Laptop")
        browser("fill", f"{second} .two label:nth-of-type(2) input", "1000.00")
        browser("fill", f"{second} > label:nth-of-type(2) input", "1000.00")
        browser("click", "dialog[open] .dlg-f button.pri")
        # A saved account opens its details in the same dialog.
        browser("wait", "--text", "Remaining saved")
        close_dialog()
        page = browser("snapshot")
        assert "Synthetic savings" in page, page
        assert "Unallocated" in page and "$4,000.00" in page
        assert "Not yet funded" in page and "Funded" in page
        view("Table")
        expect_cell("td[aria-label='Laptop, Contributions']", "$0.00")
        browser("reload")
        signed_in()
        go("Savings")
        browser("wait", "--text", "Synthetic savings")
        browser("set", "viewport", "375", "760")
        assert "Unallocated" in browser("snapshot")
        go("Activity")
        record_activity()
        browser("find", "label", "Amount (USD)", "fill", "1200.00")
        # Paid from names the goal the saved money comes from.
        laptop = option("select[name='funding-origin']", "Laptop")
        browser("select", "select[name='funding-origin']", laptop)
        save_button = "#activity-record button[type='submit']"
        browser("click", save_button)
        # The failed save's notice appears inside the open dialog, with the
        # attempted input still in the form.
        browser(
            "wait", "--text", "The input needs correction. Your entries are still here."
        )
        until(
            "!!document.querySelector('dialog[open] .recovery-notice')"
            " && !!document.querySelector('dialog[open] #activity-record')"
        )
        assert "1200.00" in browser(
            "get", "value", "#activity-record input[inputmode='decimal']"
        )
        button("Discard pending save")
        browser("select", "#activity-record select", "saving")
        browser("find", "label", "Amount (USD)", "fill", "200.00")
        combo("input[name='saving-goal']", "Laptop", "Synthetic savings · Laptop")
        save_activity()
        browser("wait", "--text", "$200.00")
        record_activity()
        browser("find", "label", "Amount (USD)", "fill", "1200.00")
        browser("select", "select[name='funding-origin']", laptop)
        save_activity()
        browser("wait", "--text", "$1,200.00")
        # The refund starts from its purchase and retains that purchase's origin.
        activity_details("$1,200.00")
        button("Record a refund")
        browser("wait", "--text", "Refund date")
        set_date(
            "#activity-record input[type='date']", datetime.now(UTC).date().isoformat()
        )
        browser("find", "label", "Refund amount (USD)", "fill", "300.00")
        save_activity()
        browser("wait", "--text", "−$300.00")
        assert "Refund:" in browser("get", "text", "#main")
        activity_details("$1,200.00")
        assert "Remaining refundable: $900.00" in browser("get", "text", "dialog[open]")
        close_dialog()
        go("Savings")
        expect_cell("td[aria-label='Laptop, Contributions']", "$200.00")
        go("Review")
        browser("wait", "--text", "Outflows funded from savings")
        expand_section("spending")
        review_text = browser("get", "text", "#main")
        assert "New saving" in review_text and "$200.00" in review_text
        assert "$1,200.00" in review_text
        go("Investments")
        browser("wait", "--text", "No investments yet")
        button("Add investment")
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
        save_record("Save investment")
        view("Table")
        record_cell("Investments", 2, "Active")
        record_cell("Investments", 3, "$0.00")
        record_cell("Investments", 5, "$25,000.00")
        record_cell("Investment value observations", 3, "$25,000.00")
        record_cell("Investment value observations", 4, "Opening")
        button("Record contribution")
        fund = value(
            "document.querySelector('select[name=investment-destination]')"
            ".options[1].value"
        )
        browser("select", "select[name='investment-destination']", fund)
        browser("find", "label", "Amount (USD)", "fill", "1000.00")
        assert "1000.00" in browser("get", "value", "dialog[open] input[inputmode]")
        save_record("Save contribution")
        record_cell("Investments", 2, "Active")
        record_cell("Investments", 3, "$1,000.00")
        go("Activity")
        until(
            "Array.from(document.querySelectorAll('#main [role=row]'))"
            ".some(row => row.textContent.includes('Investing')"
            " && row.textContent.includes('Example fund'))"
        )
        # The fund's name renders once destinations load; before that the row
        # reads "Historical investment".
        investment_activity = value(
            "Array.from(document.querySelectorAll('#main [role=row]'))"
            ".find(row => row.textContent.includes('Investing')).textContent"
        )
        assert (
            "Example fund" in investment_activity
            and "Unassigned" not in investment_activity
        )
        # Giving is its own screen with its own address.
        go("Giving")
        assert value("location.hash") == "#/giving"
        browser("wait", "--text", "No recipients yet")
        button("Add recipient")
        browser("find", "label", "Name", "fill", "Example recipient")
        browser(
            "find",
            "label",
            "Cumulative contribution target (USD, optional)",
            "fill",
            "500.00",
        )
        save_record("Save recipient")
        browser("wait", "--text", "Example recipient")
        view("Table")
        button("Record donation")
        browser("find", "label", "Amount (USD)", "fill", "100.00")
        recipient = value(
            "document.querySelector('select[name=giving-destination]').options[1].value"
        )
        browser("select", "select[name='giving-destination']", recipient)
        save_record("Save donation")
        record_cell("Giving recipients", 2, "Active")
        record_cell("Giving recipients", 3, "$100.00")
        button("Record donation")
        browser("find", "label", "Adjustment to recorded total", "check")
        browser("find", "label", "Amount (USD)", "fill", "-25.00")
        browser("select", "select[name='giving-destination']", recipient)
        save_record("Save donation")
        record_cell("Giving recipients", 2, "Active")
        record_cell("Giving recipients", 3, "$75.00")
        browser("set", "viewport", "360", "780")
        browser("reload")
        signed_in()
        go("Investments")
        record_cell("Investments", 2, "Active")
        record_cell("Investments", 3, "$1,000.00")
        record_cell("Investments", 5, "$25,000.00")
        record_cell("Investment value observations", 3, "$25,000.00")
        record_cell("Investment value observations", 4, "Opening")
        assert fits()
        # Loan payoff: the payment is one fixed-cost outflow and leaves the
        # dated amount owed unchanged until an independent zero observation.
        go("Loans")
        browser("wait", "--text", "No loans yet")
        browser("click", "#main .empty button.pri")
        browser("find", "label", "Name", "fill", "Synthetic loan")
        set_date('dialog[open] input[type="date"]', "2026-10-01")
        browser("find", "label", "Opening amount owed (USD)", "fill", "300")
        save_record("Save loan")
        view("Table")
        record_cell("Loans", 5, "$300.00")
        record_cell("Loans", 4, "Oct 1, 2026")
        # Add activity in the top bar opens the entry dialog from any screen.
        button("Add activity")
        until("!!document.querySelector('dialog[open] #activity-record')")
        assert value("location.hash").startswith("#/activity")
        browser("select", "#activity-record select", "fixed_cost")
        loan = option("select[name='loan-account']", "Synthetic loan")
        browser("select", "select[name='loan-account']", loan)
        browser("find", "label", "Amount (USD)", "fill", "300")
        save_activity()
        browser("wait", "--text", "Loan: Synthetic loan")
        go("Loans")
        record_cell("Loans", 5, "$300.00")
        record_cell("Loans", 7, "1")
        open_loan()
        record_cell("Payments for Synthetic loan", 3, "$300.00")
        close_dialog()
        button("Record observation")
        set_date('dialog[open] input[type="date"]', "2026-10-01")
        browser("find", "label", "Amount owed (USD)", "fill", "0")
        save_record("Save observation")
        record_cell("Loans", 5, "$0.00")
        record_cell("Loans", 6, "Oct 1, 2026")
        open_loan()
        button("Archive loan")
        browser("wait", "dialog[aria-label='Archive Synthetic loan?']")
        browser("click", "dialog[aria-label='Archive Synthetic loan?'] button.danger")
        record_cell("Loans", 1, "Synthetic loan")
        record_cell("Loans", 2, "Archived")
        until("!document.querySelector('dialog[open]')")
        open_loan()
        until(
            "Array.from(document.querySelectorAll('dialog[open] button'))"
            ".some(b => b.textContent.trim() === 'Reopen loan' && !b.disabled)"
        )
        button("Reopen loan")
        record_cell("Loans", 2, "Active")
        until("!document.querySelector('dialog[open]')")
        open_loan()
        browser("wait", "--text", "Archive loan")
        close_dialog()
        # MVP-019: one isolated synthetic lifecycle journey through production UI.
        go("Savings")
        button("New account")
        browser("find", "label", "Account name", "fill", "Synthetic lifecycle cash")
        browser("find", "label", "Holds today (USD)", "fill", "100.00")
        button("Add opening goal")
        browser("find", "label", "Goal name", "fill", "Lifecycle purpose")
        browser("find", "label", "Target (required)", "fill", "100.00")
        browser("find", "label", "Opening designation", "fill", "100.00")
        browser("click", "dialog[open] .dlg-f button.pri")
        browser("wait", "--text", "Remaining saved")
        close_dialog()
        browser("wait", "--text", "Synthetic lifecycle cash")
        go("Activity")
        record_activity()
        purpose = option("select[name='funding-origin']", "Lifecycle purpose")
        browser("select", "select[name='funding-origin']", purpose)
        browser("find", "label", "Amount (USD)", "fill", "90.00")
        browser("find", "label", "What was it?", "fill", "Synthetic lifecycle purchase")
        save_activity()
        browser("wait", "--text", "Synthetic lifecycle purchase")
        go("Savings")
        browser("click", "button[aria-label='Details for Lifecycle purpose']")
        button("Complete Lifecycle purpose…")
        browser(
            "wait",
            "--text",
            "Returns $10.00 to Unallocated · account total unchanged"
            " · no new contributions",
        )
        button("Confirm complete")
        until(
            "document.body.textContent.includes('Completed') && "
            "!document.body.textContent.includes('Confirm complete')"
        )
        close_dialog()
        go("Activity")
        browser("wait", "--text", "Synthetic lifecycle purchase")
        activity_details("Synthetic lifecycle purchase")
        button("Record a refund")
        browser("wait", "--text", "Refund date")
        browser("find", "label", "Refund amount (USD)", "fill", "20.00")
        save_activity()
        browser("wait", "--text", "−$20.00")
        activity_details("Synthetic lifecycle purchase")
        browser("wait", "--text", "Remaining refundable: $70.00")
        close_dialog()
        go("Savings")
        browser("click", "button[aria-label='Details for Lifecycle purpose']")
        button("Return Lifecycle purpose to Unallocated…")
        browser(
            "wait",
            "--text",
            "Returns $20.00 to Unallocated · goal stays completed",
        )
        button("Confirm return")
        until("!document.body.textContent.includes('Confirm return')")
        close_dialog()
        go("Activity")
        record_activity()
        unallocated = option(
            "select[name='funding-origin']", "Synthetic lifecycle cash", "Unallocated"
        )
        browser("select", "select[name='funding-origin']", unallocated)
        browser("find", "label", "Amount (USD)", "fill", "30.00")
        browser("find", "label", "What was it?", "fill", "Synthetic final use")
        save_activity()
        browser("wait", "--text", "Synthetic final use")
        go("Savings")
        browser("click", "button[aria-label='Details for Synthetic lifecycle cash']")
        button("Archive Synthetic lifecycle cash…")
        button("Confirm archive")
        browser("wait", "--text", "Reopen Synthetic lifecycle cash…")
        close_dialog()
        button("Show archived (1)")
        assert "Archived" in browser(
            "get", "text", "td[aria-label='Synthetic lifecycle cash, Status']"
        )
        browser("click", "button[aria-label='Details for Synthetic lifecycle cash']")
        button("Reopen Synthetic lifecycle cash…")
        button("Confirm reopen")
        browser("wait", "--text", "Archive Synthetic lifecycle cash…")
        close_dialog()
        assert "Active" in browser(
            "get", "text", "td[aria-label='Synthetic lifecycle cash, Status']"
        )
        assert "Completed" in browser(
            "get", "text", "td[aria-label='Lifecycle purpose, Status']"
        )
        expect_cell(
            "td[aria-label='Synthetic lifecycle cash, Remaining saved']", "$0.00"
        )
        expect_cell("td[aria-label='Lifecycle purpose, Contributions']", "$0.00")
        # The same month's Review explains all delivered activity without
        # promoting observations, transfers or an unassigned income into receipts.
        go("Review")
        browser("wait", "section[aria-label='Planned and actual metrics']")
        review_text = browser("get", "text", "#main")
        assert "Synthetic month v1" in review_text
        assert "Changed since review" in review_text
        assert "Reviewed. Clear the mark" in review_text
        assert "Synthetic takeaway" in browser(
            "get", "value", "form[aria-label='Close the month'] textarea"
        )
        expect_section("Net income", "Unknown")
        expand_section("investing")
        assert "Unplanned activity (1)" in browser(
            "get", "text", "section.step[aria-label='Investing'] table"
        )
        expand_section("giving")
        assert "Unplanned activity (2)" in browser(
            "get", "text", "section.step[aria-label='Giving'] table"
        )
        assert "Income-funded investing" in review_text
        # Exact activity totals exclude the $25,000 investment observation,
        # loan observations and savings lifecycle reassignments.
        expect_section("Fixed costs", "$308.33")
        expect_section("Guilt-free spending", "$1,275.00")
        expect_section("Saving", "$200.00")
        expect_section("Investing", "$1,000.00")
        expect_section("Giving", "$75.00")
        fixed_ratio = "article[aria-label='All fixed costs ÷ actual net income']"
        browser("click", f"{fixed_ratio} summary")
        ratio_text = browser("get", "text", fixed_ratio)
        assert "÷" in ratio_text and "× 100" in ratio_text, ratio_text
        assert "$8.33 ÷ $4,000.00" in ratio_text, ratio_text
        button("All ratios")
        browser("wait", "--text", "Required amount is unknown or incomplete.")
        expand_section("spending")
        spending = browser(
            "get", "text", "section.step[aria-label='Guilt-free spending']"
        )
        assert "Adjustments, already included (1)" in spending and "$40.00" in spending
        # An entry under a section opens Activity's dialog; saving it refreshes the
        # Review in place, with the section still open and its total unchanged.
        browser(
            "click", "section.step[aria-label='Guilt-free spending'] .ar-entry-open"
        )
        until("!!document.querySelector('dialog[open] #activity-record')")
        browser("find", "label", "What was it?", "fill", "Synthetic review edit")
        save_activity()
        until(
            "document.querySelector(\"section.step[aria-label='Guilt-free spending']\")"
            "?.textContent.includes('Synthetic review edit')"
        )
        expect_cell("#review-step-spending", "Hide lines")
        expect_section("Guilt-free spending", "$1,275.00")
        browser("reload")
        signed_in()
        go("Review")
        browser("wait", "section[aria-label='Planned and actual metrics']")
        assert "Synthetic month v1" in browser("get", "text", "#main")
        # Routines (TDD 13): create one due today; Home lists it in Needs you and
        # opens it. Tick its step by hand, and Home then shows nothing for it.
        weekday = datetime.now(UTC).strftime("%A")
        go("Routines")
        button("New routine")
        browser("find", "label", "Name", "fill", "Synthetic routine", "--exact")
        if weekday != "Saturday":
            button(weekday)
            button("Saturday")
        browser("find", "label", "Step 1", "fill", "Synthetic step", "--exact")
        button("Create routine")
        browser("wait", "--text", "Due today. 0 of 1 step done.")
        go("Home")
        browser("wait", "--text", "Synthetic routine is due today")
        browser(
            "find",
            "role",
            "button",
            "click",
            "--name",
            "Synthetic routine is due today Open",
            "--exact",
        )
        browser("wait", "--text", "0 of 1 step done")
        button("Synthetic step")
        browser("wait", "--text", "1 of 1 step done")
        until(
            "document.querySelector('.rt-check')"
            "?.getAttribute('aria-pressed') === 'true'"
        )
        go("Home")
        until(
            "!document.querySelector('#main').textContent.includes('Synthetic routine')"
        )
        browser("set", "viewport", "320", "760")
        assert fits()
        # Below 760 px the sidebar is hidden; More holds Sign out.
        browser("find", "role", "link", "click", "--name", "More", "--exact")
        browser("click", "#main .more-user button")
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
