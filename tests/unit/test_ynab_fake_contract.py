"""The fake YNAB server must stay parseable by YNAB's official SDK.

This runs the fake on loopback and points the `ynab` package (dev dependency
only) at it. Each SDK call deserializes into the SDK's generated models, so a
fake response that drifts from YNAB's real schema fails here, not in production.
"""

import json
import socket
import threading
import time

import pytest
import uvicorn
import ynab
from ynab import exceptions

from tests.fakes import ynab_server as fake_module


@pytest.fixture(scope="module")
def server():
    fake = fake_module.FakeYnab()
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
    yield fake, f"http://127.0.0.1:{port}/v1"
    runner.should_exit = True
    thread.join(5)


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
