"""The fake YNAB server must stay parseable by YNAB's official SDK.

This runs the fake on loopback and points the `ynab` package (dev dependency
only) at it. Each SDK call deserializes into the SDK's generated models, so a
fake response that drifts from YNAB's real schema fails here, not in production.
"""

import contextlib
import json
import socket
import threading
import time
from datetime import date

import pytest
import uvicorn
import ynab
from ynab import exceptions

from accanto.integrations.ynab import staged_inputs
from tests.fakes import ynab_server as fake_module


@contextlib.contextmanager
def serve(fake):
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    config = uvicorn.Config(fake.app, host="127.0.0.1", port=port, log_level="error")
    runner = uvicorn.Server(config)
    thread = threading.Thread(target=runner.run, daemon=True)
    thread.start()
    for _ in range(100):
        if runner.started:
            break
        time.sleep(0.05)
    try:
        yield f"http://127.0.0.1:{port}/v1"
    finally:
        runner.should_exit = True
        thread.join(5)


@pytest.fixture(scope="module")
def server():
    fake = fake_module.FakeYnab()
    with serve(fake) as host:
        yield fake, host


def sdk(host, token=fake_module.FAKE_TOKEN):
    return ynab.ApiClient(ynab.Configuration(host=host, access_token=token))


def test_sdk_parses_every_success_response(server):
    fake, host = server
    with sdk(host) as client:
        plans = ynab.PlansApi(client).get_plans().data.plans
        assert {str(p.id) for p in plans} == {fake_module.PLAN, fake_module.EURO_PLAN}
        assert {p.currency_format and p.currency_format.iso_code for p in plans} == {
            "USD",
            "EUR",
        }

        accounts = ynab.AccountsApi(client).get_accounts(fake_module.PLAN).data
        assert {a.type.value for a in accounts.accounts} >= {"checking", "creditCard"}

        api = ynab.TransactionsApi(client)
        full = api.get_transactions(fake_module.PLAN).data
        split = next(t for t in full.transactions if t.subtransactions)
        assert len(split.subtransactions) == 3
        assert any(t.transfer_account_id for t in full.transactions)
        assert all(not t.deleted for t in full.transactions)

        # Delta: a change and a deletion appear, and only they appear.
        fake.change("tx-0004", amount=-7250)
        fake.delete("tx-0002")
        delta = api.get_transactions(
            fake_module.PLAN, last_knowledge_of_server=full.server_knowledge
        ).data
        assert {t.id: t.deleted for t in delta.transactions} == {
            "tx-0002": True,
            "tx-0004": False,
        }
        assert delta.server_knowledge == full.server_knowledge + 2

        empty = api.get_transactions(
            fake_module.PLAN, last_knowledge_of_server=delta.server_knowledge
        ).data
        assert empty.transactions == []


@pytest.mark.parametrize(
    ("failure", "token", "plan", "exception", "status"),
    [
        (
            None,
            "wrong-token-value",
            fake_module.PLAN,
            exceptions.UnauthorizedException,
            401,
        ),
        (
            None,
            fake_module.FAKE_TOKEN,
            "missing-plan",
            exceptions.NotFoundException,
            404,
        ),
        (429, fake_module.FAKE_TOKEN, fake_module.PLAN, exceptions.ApiException, 429),
        (
            500,
            fake_module.FAKE_TOKEN,
            fake_module.PLAN,
            exceptions.ServiceException,
            500,
        ),
    ],
)
def test_sdk_parses_error_responses(server, failure, token, plan, exception, status):
    fake, host = server
    fake.failure = failure
    try:
        with sdk(host, token) as client, pytest.raises(exception) as raised:
            ynab.TransactionsApi(client).get_transactions(plan)
    finally:
        fake.failure = None
    assert raised.value.status == status
    ynab.ErrorResponse.from_dict(json.loads(raised.value.body))


@pytest.fixture(scope="module")
def generated():
    fake = fake_module.FakeYnab(seed=11, today=date(2026, 11, 20), hostile=True)
    with serve(fake) as host:
        yield fake, host


def test_generator_is_seeded_and_dated_in_the_month():
    day = date(2026, 11, 20)
    first = fake_module.generate(7, day)
    assert first == fake_module.generate(7, day)
    assert first != fake_module.generate(8, day)
    assert all("2026-11-01" <= tx["date"] <= "2026-11-20" for tx in first)
    # Early in a month every date is still on or before today.
    assert {tx["date"] for tx in fake_module.generate(7, date(2026, 12, 1))} == {
        "2026-12-01"
    }


def test_sdk_parses_the_generated_plan_and_its_second_batch(generated):
    fake, host = generated
    with sdk(host) as client:
        accounts = {
            str(a.id): a.to_dict()
            for a in ynab.AccountsApi(client)
            .get_accounts(fake_module.PLAN)
            .data.accounts
        }
        for account in accounts.values():
            account["type"] = getattr(account["type"], "value", account["type"])
        api = ynab.TransactionsApi(client)
        full = api.get_transactions(fake_module.PLAN).data
        rows = [json.loads(t.to_json()) for t in full.transactions]
        inputs = staged_inputs(rows, accounts)
        assert {i.kind for i in inputs} == {
            "ordinary",
            "transfer_on_budget",
            "transfer_tracking",
            "card_payment",
        }
        (split,) = [t for t in full.transactions if t.subtransactions]
        assert sum(s.amount for s in split.subtransactions) == split.amount
        assert len([i for i in inputs if i.parent_ref == split.id]) == 3
        # The refund is half its purchase, rounded to the cent.
        outfitters = sorted(
            t.amount for t in full.transactions if t.payee_name == "Example Outfitters"
        )
        assert outfitters[1] > 0 and outfitters[1] == round(-outfitters[0] / 20) * 10
        assert any(i.amount > 0 and i.payee == "Demo Payroll Co" for i in inputs)
        assert any(not i.approved and not i.cleared for i in inputs)
        assert any(
            i.account_ref == fake_module.CARD for i in inputs if i.kind == "ordinary"
        )
        assert any(i.payee == fake_module.HOSTILE_PAYEE for i in inputs)

        assert fake.advance() is True
        assert fake.advance() is False
        delta = api.get_transactions(
            fake_module.PLAN, last_knowledge_of_server=full.server_knowledge
        ).data
        changed = {t.id: t for t in delta.transactions}
        assert changed["gen11-dup"].deleted is True
        assert changed["gen11-bill"].memo == "Final bill"
        assert {"gen11-late1", "gen11-late2"} <= set(changed)
        assert sum(t.approved and not t.deleted for t in changed.values()) == 4
