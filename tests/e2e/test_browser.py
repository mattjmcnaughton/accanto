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

    def browser(*args, check=True):
        opens_activity_form = args[:5] == (
            "find",
            "role",
            "button",
            "click",
            "--name",
        ) and args[5] in {
            "Record activity",
            "Enter known total",
            "Record refund from this purchase",
        }
        if opens_activity_form:
            # The save callback closes the old form before the workspace clears
            # its busy state. Do not click an opener that is still disabled.
            browser(
                "wait",
                "--fn",
                "Array.from(document.querySelectorAll('.activity-screen button'))"
                f".some(button => button.textContent.trim() === {args[5]!r}"
                " && !button.disabled)",
            )
        if args[:5] == ("find", "role", "button", "click", "--name") and args[5] in {
            "Save activity",
            "Save adjustment",
            "Save refund",
        }:
            # The Activity sidebar scrolls independently too. Center its submit
            # button before pointer input instead of clicking beneath a sticky edge.
            args = ("click", "#activity-record button[type='submit']")
        elif args[:5] == ("find", "role", "button", "click", "--name") and args[5] in {
            "Save loan",
            "Save observation",
            "Save destination",
            "Save contribution",
        }:
            # Record sidebars also scroll independently at narrow widths.
            args = ("click", ".records aside button.primary")
        elif args == (
            "find",
            "role",
            "button",
            "click",
            "--name",
            "Record activity",
            "--exact",
        ):
            args = ("click", ".activity-screen .toolbar-actions button:first-child")
        if args[0] == "click":
            # A newly created Plan is rendered before the save's finally block
            # enables its enclosing fieldset. Visible is not yet actionable.
            browser(
                "wait",
                "--fn",
                "document.querySelector(" + repr(args[1]) + ")"
                "?.matches(':not(:disabled)')",
            )
            # Center targets inside the worksheet's nested scrolling region
            # before native pointer input; its sticky header can cover an edge.
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
        if opens_activity_form:
            # New activity, known totals and refunds all schedule date-field
            # focus on the next frame. Wait for that handoff before typing.
            browser(
                "wait",
                "--fn",
                "document.activeElement === "
                "document.querySelector('#activity-record input[type=date]')",
            )
        return result.stdout

    def set_date(selector, value):
        # Native setter triggers React's delegated handlers on date controls.
        expression = (
            "(() => { const input = document.querySelector("
            + repr(selector)
            + "); const setter = Object.getOwnPropertyDescriptor("
            "HTMLInputElement.prototype, 'value').set; "
            + "setter.call(input, "
            + repr(value)
            + "); "
            "input.dispatchEvent(new Event('input', {bubbles: true})); "
            "input.dispatchEvent(new Event('change', {bubbles: true})); "
            "return input.value; })()"
        )
        assert browser("eval", expression).strip().strip('"') == value

    def record_cell(grid, column, expected):
        selector = (
            f'table[aria-label="{grid}"] tbody tr:first-child td:nth-child({column})'
        )
        expect_cell(selector, expected)

    def expect_cell(selector, expected):
        # Assert in one browser evaluation: save-triggered reloads can remove
        # a matching cell between a separate wait and get-text command.
        browser(
            "wait",
            "--fn",
            f"document.querySelector({selector!r})?.textContent === {expected!r}",
        )

    def activity_details(text):
        cell_id = (
            browser(
                "eval",
                "Array.from(document.querySelectorAll('.activity-grid tbody tr'))"
                ".find(row => Array.from(row.cells)"
                f".some(cell => cell.textContent === {text!r}))"
                ".lastElementChild.id",
            )
            .strip()
            .strip('"')
        )
        browser("click", f"#{cell_id} button")
        browser(
            "wait",
            "--fn",
            "document.activeElement === document.querySelector("
            "'#activity-details input, #activity-details select, "
            "#activity-details textarea, #activity-details button')",
        )

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
        browser("wait", "--fn", "!document.querySelector('#activity-record')")
        browser("wait", "--text", "$210.00")
        browser(
            "find", "role", "button", "click", "--name", "Enter known total", "--exact"
        )
        browser("find", "label", "Known total (USD)", "fill", "250")
        assert (
            browser(
                "get", "value", "#activity-record input[inputmode='decimal']"
            ).strip()
            == "250"
        )
        browser(
            "find", "role", "button", "click", "--name", "Save adjustment", "--exact"
        )
        browser("wait", "--fn", "!document.querySelector('#activity-record')")
        browser("wait", "--text", "$40.00")
        assert "Adjustment" in browser("get", "text", "body")
        browser("reload")
        browser("wait", "--text", "Synthetic E2E Entity")
        browser("find", "role", "button", "click", "--name", "Activity", "--exact")
        browser("wait", "--text", "$40.00")
        browser("find", "role", "button", "click", "--name", "Plans", "--exact")
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
        browser("click", "button[aria-label='Details for Guilt-free spending']")
        browser("wait", "#detail-amount")
        browser("fill", "#detail-amount", "800")
        browser("click", "#close-details")
        browser("click", "button[aria-label='Add Fixed costs line']")
        browser("wait", "#detail-name")
        browser("fill", "#detail-name", "Synthetic annual service")
        browser("fill", "#detail-amount", "100.00")
        browser("select", "#detail-frequency", "Annual")
        browser("click", "#save-draft")
        browser("wait", "--text", "$8.33")
        browser(
            "wait",
            "--fn",
            "!document.querySelector('#save-version').matches(':disabled') "
            "&& document.querySelector('#save-state').textContent === 'Draft saved'",
        )
        browser("click", "#save-version")
        browser(
            "wait",
            "--fn",
            "!!document.querySelector('#plan-version option[value=\"0\"]')",
        )
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
        browser("wait", "aside[aria-label='Review details'] textarea")
        browser("find", "label", "Review note", "fill", "Synthetic takeaway")
        browser("find", "label", "Mark reviewed", "check")
        browser("find", "role", "button", "click", "--name", "Save Review", "--exact")
        expect_cell(".review-screen .data-toolbar .badge:last-child", "Reviewed")
        expect_cell("#review-g-income-2", "Unknown")
        expect_cell("#review-g-fixed_cost-2", "Unknown")
        browser("find", "role", "button", "click", "--name", "Activity", "--exact")
        browser(
            "find", "role", "button", "click", "--name", "Record activity", "--exact"
        )
        browser("select", "#activity-record select", "fixed_cost")
        browser(
            "wait",
            "--fn",
            "Array.from(document.querySelector("
            "'select[name=\"fixed-cost\"]')?.options ?? [])"
            ".some(option => option.textContent.includes('Synthetic annual service'))",
        )
        fixed_option = (
            browser(
                "eval",
                "Array.from(document.querySelector('select[name=\"fixed-cost\"]').options)"
                ".find(option => option.textContent.includes("
                "'Synthetic annual service')).value",
            )
            .strip()
            .strip('"')
        )
        browser("select", "select[name='fixed-cost']", fixed_option)
        browser("find", "label", "Amount (USD)", "fill", "8.33")
        browser("find", "role", "button", "click", "--name", "Save activity", "--exact")
        browser("wait", "--fn", "!document.querySelector('#activity-record')")
        browser("wait", "--text", "Synthetic annual service")
        browser(
            "find", "role", "button", "click", "--name", "Monthly Review", "--exact"
        )
        browser("wait", "--text", "$8.33")
        expect_cell("#review-g-fixed_cost-2", "$8.33")
        expect_cell("#review-g-fixed_cost-4", "")
        browser("find", "role", "button", "click", "--name", "Activity", "--exact")
        browser(
            "find", "role", "button", "click", "--name", "Record activity", "--exact"
        )
        browser("find", "label", "Amount (USD)", "fill", "25")
        browser("find", "role", "button", "click", "--name", "Save activity", "--exact")
        browser("wait", "--fn", "!document.querySelector('#activity-record')")
        browser("wait", "--text", "$25.00")
        browser(
            "find", "role", "button", "click", "--name", "Monthly Review", "--exact"
        )
        browser("wait", "--text", "Changed since review")
        assert (
            browser(
                "eval", "document.querySelector('input[type=checkbox]').checked"
            ).strip()
            == "true"
        )
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
        assert "Remaining saved" in page, page
        assert "Unallocated" in page and "$4000.00" in page
        expect_cell("td[aria-label='Laptop, Contributions']", "$0.00")
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
        browser(
            "wait",
            "--fn",
            "Array.from(document.querySelector('select[name=\"saving-goal\"]').options)"
            ".some(option => option.textContent.includes('Laptop'))",
        )
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
            "get", "value", "#activity-record input[inputmode='decimal']"
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
        browser("select", "#activity-record select", "saving")
        browser("find", "label", "Amount (USD)", "fill", "200.00")
        browser("select", "select[name='saving-goal']", goal_option)
        browser("find", "role", "button", "click", "--name", "Save activity", "--exact")
        browser("wait", "--fn", "!document.querySelector('#activity-record')")
        browser("wait", "--text", "$200.00")
        browser(
            "find", "role", "button", "click", "--name", "Record activity", "--exact"
        )
        browser("find", "label", "Amount (USD)", "fill", "1200.00")
        browser("select", "select[name='funding-origin']", "savings")
        browser("select", "select[name='saving-goal']", goal_option)
        browser("find", "role", "button", "click", "--name", "Save activity", "--exact")
        browser("wait", "--fn", "!document.querySelector('#activity-record')")
        browser("wait", "--text", "$1200.00")
        # The refund starts from its purchase and retains that purchase's origin.
        activity_details("$1200.00")
        browser(
            "find",
            "role",
            "button",
            "click",
            "--name",
            "Record refund from this purchase",
            "--exact",
        )
        browser("wait", "--text", "Refund date")
        set_date(
            "#activity-record input[type='date']", datetime.now(UTC).date().isoformat()
        )
        browser("find", "label", "Refund amount (USD)", "fill", "300.00")
        browser("find", "role", "button", "click", "--name", "Save refund", "--exact")
        browser("wait", "--fn", "!document.querySelector('#activity-record')")
        browser("wait", "--text", "$-300.00")
        assert "Refund of" in browser("get", "text", "body")
        activity_details("$1200.00")
        assert "Remaining refundable: $900.00" in browser("get", "text", "body")
        browser("find", "role", "button", "click", "--name", "Savings", "--exact")
        expect_cell("td[aria-label='Laptop, Contributions']", "$200.00")
        browser(
            "find", "role", "button", "click", "--name", "Monthly Review", "--exact"
        )
        browser("wait", "--text", "Outflows funded from savings")
        browser("click", "#review-c-spending-0 button")
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
        browser("wait", "--text", "No investments yet. Press a to add one.")
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
        record_cell("Investments", 2, "Active")
        record_cell("Investments", 3, "$0.00")
        record_cell("Investments", 5, "$25000.00")
        record_cell("Investment value observations", 3, "$25000.00")
        record_cell("Investment value observations", 4, "Opening")
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
                "document.querySelector('select[name=contribution-destination]')"
                ".options[1].value",
            )
            .strip()
            .strip('"')
        )
        browser(
            "select",
            "aside select[name='contribution-destination']",
            investment_option,
        )
        browser(
            "find", "role", "button", "click", "--name", "Save contribution", "--exact"
        )
        record_cell("Investments", 2, "Active")
        record_cell("Investments", 3, "$1000.00")
        browser("find", "role", "button", "click", "--name", "Activity", "--exact")
        browser(
            "wait",
            "--fn",
            "Array.from(document.querySelectorAll('.activity-grid tbody tr'))"
            ".some(row => row.textContent.includes('Investment contribution'))",
        )
        investment_activity = browser(
            "eval",
            "Array.from(document.querySelectorAll('.activity-grid tbody tr'))"
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
        browser("wait", "--text", "No recipients yet. Press a to add one.")
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
                "document.querySelector('select[name=contribution-destination]')"
                ".options[1].value",
            )
            .strip()
            .strip('"')
        )
        browser(
            "select",
            "aside select[name='contribution-destination']",
            giving_option,
        )
        browser(
            "find", "role", "button", "click", "--name", "Save contribution", "--exact"
        )
        record_cell("Giving recipients", 2, "Active")
        record_cell("Giving recipients", 3, "$100.00")
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
        browser(
            "select",
            "aside select[name='contribution-destination']",
            giving_option,
        )
        browser(
            "find", "role", "button", "click", "--name", "Save contribution", "--exact"
        )
        record_cell("Giving recipients", 2, "Active")
        record_cell("Giving recipients", 3, "$75.00")
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
        record_cell("Investments", 2, "Active")
        record_cell("Investments", 3, "$1000.00")
        record_cell("Investments", 5, "$25000.00")
        record_cell("Investment value observations", 3, "$25000.00")
        record_cell("Investment value observations", 4, "Opening")
        assert (
            browser(
                "eval", "document.documentElement.scrollWidth <= innerWidth"
            ).strip()
            == "true"
        )
        # Loan payoff: the payment is one fixed-cost outflow and leaves the
        # dated amount owed unchanged until an independent zero observation.
        browser(
            "find", "role", "button", "click", "--name", "Loans and balances", "--exact"
        )
        browser("find", "role", "button", "click", "--name", "Add loan", "--exact")
        browser("find", "label", "Name", "fill", "Synthetic loan")
        set_date('aside input[type="date"]', "2026-10-01")
        browser("find", "label", "Opening amount owed (USD)", "fill", "300")
        browser("find", "role", "button", "click", "--name", "Save loan", "--exact")
        record_cell("Loans", 5, "$300.00")
        record_cell("Loans", 4, "2026-10-01")
        browser("find", "role", "button", "click", "--name", "Activity", "--exact")
        browser(
            "find", "role", "button", "click", "--name", "Record activity", "--exact"
        )
        browser("select", "#activity-record select", "fixed_cost")
        browser(
            "wait",
            "--fn",
            "Array.from(document.querySelector("
            "'select[name=\"loan-account\"]')?.options ?? [])"
            ".some(option => option.textContent === 'Synthetic loan')",
        )
        loan_option = (
            browser(
                "eval",
                "Array.from(document.querySelector('select[name=\"loan-account\"]').options)"
                ".find(option => option.textContent === 'Synthetic loan').value",
            )
            .strip()
            .strip('"')
        )
        browser("select", "select[name='loan-account']", loan_option)
        browser("find", "label", "Amount (USD)", "fill", "300")
        browser("find", "role", "button", "click", "--name", "Save activity", "--exact")
        browser("wait", "--fn", "!document.querySelector('#activity-record')")
        browser("wait", "--text", "Loan: Synthetic loan")
        browser(
            "find", "role", "button", "click", "--name", "Loans and balances", "--exact"
        )
        record_cell("Loans", 5, "$300.00")
        record_cell("Loans", 7, "1")
        browser("click", "table[aria-label='Loans'] td[data-cell='0-0']")
        browser("press", "Enter")
        record_cell("Payments for Synthetic loan", 3, "$300.00")
        browser("find", "role", "button", "click", "--name", "Close", "--exact")
        browser(
            "find", "role", "button", "click", "--name", "Record observation", "--exact"
        )
        set_date('aside input[type="date"]', "2026-10-01")
        browser("find", "label", "Amount owed (USD)", "fill", "0")
        browser(
            "find", "role", "button", "click", "--name", "Save observation", "--exact"
        )
        record_cell("Loans", 5, "$0.00")
        record_cell("Loans", 6, "2026-10-01")
        browser("click", "table[aria-label='Loans'] td[data-cell='0-0']")
        browser("press", "Enter")
        browser("find", "role", "button", "click", "--name", "Archive loan", "--exact")
        browser("wait", "dialog[open]")
        browser("click", "dialog[open] button.danger")
        record_cell("Loans", 1, "Synthetic loan")
        record_cell("Loans", 2, "Archived")
        browser("click", "table[aria-label='Loans'] td[data-cell='0-0']")
        browser("press", "Enter")
        # The archived label alone does not establish that the next control is
        # enabled and unobstructed after the asynchronous view update.
        browser(
            "wait",
            "--fn",
            "(() => { const button = Array.from(document.querySelectorAll('button'))"
            ".find(b => b.textContent.trim() === 'Reopen loan'); "
            "if (!button || button.disabled) return false; "
            "button.scrollIntoView({block: 'center', inline: 'nearest'}); "
            "const r = button.getBoundingClientRect(); "
            "const hit = document.elementFromPoint(r.x + r.width / 2, "
            "r.y + r.height / 2); "
            "return hit === button || button.contains(hit); })()",
        )
        browser("find", "role", "button", "click", "--name", "Reopen loan", "--exact")
        record_cell("Loans", 2, "Active")
        browser("click", "table[aria-label='Loans'] td[data-cell='0-0']")
        browser("press", "Enter")
        browser("wait", "--text", "Archive loan")
        # MVP-019: one isolated synthetic lifecycle journey through production UI.
        browser("find", "role", "button", "click", "--name", "Savings", "--exact")
        browser(
            "find",
            "role",
            "button",
            "click",
            "--name",
            "New savings account",
            "--exact",
        )
        browser("find", "label", "Name", "fill", "Synthetic lifecycle cash")
        browser("find", "label", "Opening amount", "fill", "100.00")
        browser(
            "find", "role", "button", "click", "--name", "Add opening goal", "--exact"
        )
        browser("find", "label", "Goal name", "fill", "Lifecycle purpose")
        browser("find", "label", "Target (required)", "fill", "100.00")
        browser("find", "label", "Opening designation", "fill", "100.00")
        browser("find", "role", "button", "click", "--name", "Save", "--exact")
        browser("wait", "--text", "Synthetic lifecycle cash")
        browser("find", "role", "button", "click", "--name", "Activity", "--exact")
        browser(
            "find", "role", "button", "click", "--name", "Record activity", "--exact"
        )
        browser("select", "select[name='funding-origin']", "savings")
        browser(
            "wait",
            "--fn",
            "Array.from(document.querySelector('select[name=\"saving-goal\"]').options)"
            ".some(o => o.textContent.includes('Lifecycle purpose'))",
        )
        lifecycle_goal = (
            browser(
                "eval",
                "Array.from(document.querySelector('select[name=\"saving-goal\"]').options)"
                ".find(o => o.textContent.includes('Lifecycle purpose')).value",
            )
            .strip()
            .strip('"')
        )
        browser("select", "select[name='saving-goal']", lifecycle_goal)
        browser("find", "label", "Amount (USD)", "fill", "90.00")
        browser("find", "label", "Note", "fill", "Synthetic lifecycle purchase")
        browser("find", "role", "button", "click", "--name", "Save activity", "--exact")
        browser("wait", "--fn", "!document.querySelector('#activity-record')")
        browser("wait", "--text", "Synthetic lifecycle purchase")
        browser("find", "role", "button", "click", "--name", "Savings", "--exact")
        browser("wait", "button[aria-label='Details for Lifecycle purpose']")
        browser("click", "button[aria-label='Details for Lifecycle purpose']")
        browser(
            "find",
            "role",
            "button",
            "click",
            "--name",
            "Complete Lifecycle purpose…",
            "--exact",
        )
        browser(
            "wait",
            "--text",
            "Returns $10.00 to Unallocated · account total unchanged"
            " · no new contributions",
        )
        browser(
            "find", "role", "button", "click", "--name", "Confirm complete", "--exact"
        )
        browser(
            "wait",
            "--fn",
            "document.body.textContent.includes('Completed') && "
            "!document.body.textContent.includes('Confirm complete')",
        )
        browser("find", "role", "button", "click", "--name", "Activity", "--exact")
        browser("wait", "--text", "Synthetic lifecycle purchase")
        activity_details("Synthetic lifecycle purchase")
        browser(
            "find",
            "role",
            "button",
            "click",
            "--name",
            "Record refund from this purchase",
            "--exact",
        )
        browser("wait", "--text", "Refund date")
        browser("find", "label", "Refund amount (USD)", "fill", "20.00")
        browser("find", "role", "button", "click", "--name", "Save refund", "--exact")
        browser("wait", "--fn", "!document.querySelector('#activity-record')")
        browser("wait", "--text", "$-20.00")
        activity_details("Synthetic lifecycle purchase")
        browser("wait", "--text", "Remaining refundable: $70.00")
        browser("find", "role", "button", "click", "--name", "Savings", "--exact")
        browser("wait", "button[aria-label='Details for Lifecycle purpose']")
        browser("click", "button[aria-label='Details for Lifecycle purpose']")
        browser(
            "find",
            "role",
            "button",
            "click",
            "--name",
            "Return Lifecycle purpose to Unallocated…",
            "--exact",
        )
        browser(
            "wait",
            "--text",
            "Returns $20.00 to Unallocated · goal stays completed",
        )
        browser(
            "find", "role", "button", "click", "--name", "Confirm return", "--exact"
        )
        browser("wait", "--fn", "!document.body.textContent.includes('Confirm return')")
        browser("find", "role", "button", "click", "--name", "Activity", "--exact")
        browser(
            "find", "role", "button", "click", "--name", "Record activity", "--exact"
        )
        browser("select", "select[name='funding-origin']", "savings")
        browser(
            "wait",
            "--fn",
            "Array.from(document.querySelector('select[name=\"saving-goal\"]').options)"
            ".some(o => o.textContent.includes('Synthetic lifecycle cash') "
            "&& o.textContent.includes('Unallocated'))",
        )
        lifecycle_unallocated = (
            browser(
                "eval",
                "Array.from(document.querySelector('select[name=\"saving-goal\"]').options)"
                ".find(o => o.textContent.includes('Synthetic lifecycle cash') "
                "&& o.textContent.includes('Unallocated')).value",
            )
            .strip()
            .strip('"')
        )
        browser("select", "select[name='saving-goal']", lifecycle_unallocated)
        browser("find", "label", "Amount (USD)", "fill", "30.00")
        browser("find", "label", "Note", "fill", "Synthetic final use")
        browser("find", "role", "button", "click", "--name", "Save activity", "--exact")
        browser("wait", "--fn", "!document.querySelector('#activity-record')")
        browser("wait", "--text", "Synthetic final use")
        browser("find", "role", "button", "click", "--name", "Savings", "--exact")
        browser("wait", "button[aria-label='Details for Synthetic lifecycle cash']")
        browser("click", "button[aria-label='Details for Synthetic lifecycle cash']")
        browser(
            "find",
            "role",
            "button",
            "click",
            "--name",
            "Archive Synthetic lifecycle cash…",
            "--exact",
        )
        browser(
            "find", "role", "button", "click", "--name", "Confirm archive", "--exact"
        )
        browser("wait", "--text", "Reopen Synthetic lifecycle cash…")
        browser(
            "find", "role", "button", "click", "--name", "Show archived (1)", "--exact"
        )
        assert "Archived" in browser(
            "get", "text", "td[aria-label='Synthetic lifecycle cash, Status']"
        )
        browser(
            "find",
            "role",
            "button",
            "click",
            "--name",
            "Reopen Synthetic lifecycle cash…",
            "--exact",
        )
        browser(
            "find", "role", "button", "click", "--name", "Confirm reopen", "--exact"
        )
        browser("wait", "--text", "Archive Synthetic lifecycle cash…")
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
        browser(
            "find", "role", "button", "click", "--name", "Monthly Review", "--exact"
        )
        browser("wait", "table[aria-label='Comparison by category and saved identity']")
        browser("wait", "--text", "Planned and actual metrics")
        review_text = browser("get", "text", "body")
        assert "Synthetic month · v1" in review_text
        assert "Changed since review" in review_text
        assert (
            browser(
                "eval", "document.querySelector('input[type=checkbox]').checked"
            ).strip()
            == "true"
        )
        assert "Synthetic takeaway" in browser("get", "value", "textarea")
        expect_cell("#review-g-income-2", "Unknown")
        assert "Unplanned activity (1)" in browser(
            "get", "text", "#review-u-investing-0"
        )
        assert "Unplanned activity (2)" in browser("get", "text", "#review-u-giving-0")
        assert "Income-funded investing" in review_text
        # Exact activity totals exclude the $25000 investment observation,
        # loan observations and savings lifecycle reassignments.
        expect_cell("#review-g-fixed_cost-2", "$308.33")
        expect_cell("#review-g-spending-2", "$1275.00")
        expect_cell("#review-g-saving-2", "$200.00")
        expect_cell("#review-g-investing-2", "$1000.00")
        expect_cell("#review-g-giving-2", "$75.00")
        browser(
            "click",
            "section[aria-label='Planned and actual metrics'] "
            "tbody tr:nth-child(1) summary",
        )
        assert "All fixed costs ÷ net income × 100" in browser("get", "text", "body")
        assert "$8.33 ÷ $4000.00 × 100" in browser("get", "text", "body")
        browser(
            "click",
            "section[aria-label='Planned and actual metrics'] "
            "tbody tr:nth-child(7) summary",
        )
        assert "Required amount is unknown or incomplete." in browser(
            "get", "text", "body"
        )
        browser(
            "click",
            "#review-a-spending-0 button",
        )
        expect_cell("td[id^='review-a-spending/e-'][id$='-2']", "$40.00")
        browser("reload")
        browser("wait", "--text", "Synthetic E2E Entity")
        browser(
            "find", "role", "button", "click", "--name", "Monthly Review", "--exact"
        )
        browser("wait", "table[aria-label='Comparison by category and saved identity']")
        assert "Synthetic month · v1" in browser("get", "text", "body")
        browser("set", "viewport", "320", "760")
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
