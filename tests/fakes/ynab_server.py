"""A small fake of the YNAB API endpoints the inbox adapter reads.

Serves plans, accounts and the transactions delta (`last_knowledge_of_server`)
from handwritten synthetic fixtures, with deletions, splits, transfers and error
responses. tests/unit/test_ynab_fake_contract.py checks every response it
returns against YNAB's official Python SDK models, so drift from YNAB's real
schema fails a test.

In tests, pass `httpx.ASGITransport(app=fake.app)` to the client. For local
development run it on loopback:

    uv run uvicorn tests.fakes.ynab_server:app --port 8105

and set YNAB_API_URL=http://127.0.0.1:8105/v1 with token FAKE_TOKEN below.
Every name and amount here is invented.
"""

import copy
from datetime import date

from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

FAKE_TOKEN = "synthetic-ynab-token-not-real"
PLAN = "5a1f0c3e-0000-4000-8000-000000000001"
EURO_PLAN = "5a1f0c3e-0000-4000-8000-000000000002"
CHECKING = "acc0c3e0-0000-4000-8000-000000000001"
CARD = "acc0c3e0-0000-4000-8000-000000000002"
SAVINGS = "acc0c3e0-0000-4000-8000-000000000003"
BROKERAGE = "acc0c3e0-0000-4000-8000-000000000004"
CATEGORY = {
    name: f"ca7e0000-0000-4000-8000-{index:012d}"
    for index, name in enumerate(
        (
            "Groceries",
            "Home Maintenance",
            "Dining Out",
            "Clothing",
            "Inflow: Ready to Assign",
            "Household Goods",
            "Charity",
            "Rent",
            "Vacation",
        ),
        start=1,
    )
}


def usd(iso_code="USD"):
    return {
        "iso_code": iso_code,
        "example_format": "123,456.78",
        "decimal_digits": 2,
        "decimal_separator": ".",
        "symbol_first": True,
        "group_separator": ",",
        "currency_symbol": "$" if iso_code == "USD" else "€",
        "display_symbol": True,
    }


def account(id_, name, type_, on_budget):
    return {
        "id": id_,
        "name": name,
        "type": type_,
        "on_budget": on_budget,
        "closed": False,
        "note": None,
        "balance": 0,
        "cleared_balance": 0,
        "uncleared_balance": 0,
        "transfer_payee_id": id_.replace("acc0", "fee0"),
        "direct_import_linked": True,
        "direct_import_in_error": False,
        "last_reconciled_at": None,
        "debt_original_balance": None,
        "deleted": False,
    }


def transaction(
    id_,
    day,
    milliunits,
    payee,
    category=None,
    *,
    acct=CHECKING,
    memo=None,
    transfer=None,
    approved=True,
    cleared="cleared",
    subtransactions=(),
):
    names = {
        CHECKING: "Example Checking",
        CARD: "Sample Rewards Card",
        SAVINGS: "Example Savings",
        BROKERAGE: "Sample Brokerage",
    }
    return {
        "id": id_,
        "date": day,
        "amount": milliunits,
        "memo": memo,
        "cleared": cleared,
        "approved": approved,
        "flag_color": None,
        "flag_name": None,
        "account_id": acct,
        "payee_id": None,
        "category_id": CATEGORY.get(category) if category else None,
        "transfer_account_id": transfer,
        "transfer_transaction_id": None,
        "matched_transaction_id": None,
        "import_id": None,
        "import_payee_name": None,
        "import_payee_name_original": None,
        "debt_transaction_type": None,
        "deleted": False,
        "account_name": names[acct],
        "payee_name": payee,
        "category_name": "Split" if subtransactions else category,
        "subtransactions": list(subtransactions),
    }


def sub(id_, parent, milliunits, category, memo=None):
    return {
        "id": id_,
        "transaction_id": parent,
        "amount": milliunits,
        "memo": memo,
        "payee_id": None,
        "payee_name": None,
        "category_id": CATEGORY[category],
        "category_name": category,
        "transfer_account_id": None,
        "transfer_transaction_id": None,
        "deleted": False,
    }


def seed_transactions():
    """The mockup's kinds of transaction, all invented. Outflows are negative."""
    split = "tx-split-0001"
    return [
        transaction(
            "tx-0001", "2026-11-02", -84370, "Sample Street Market", "Groceries"
        ),
        transaction(
            "tx-0002", "2026-11-03", -37150, "Placeholder Hardware", "Home Maintenance"
        ),
        transaction("tx-0003", "2026-11-03", -129000, "Example Outfitters", "Clothing"),
        transaction(
            "tx-0004", "2026-11-04", -6500, "Example Coffee Cart", "Dining Out"
        ),
        transaction(
            "tx-0005",
            "2026-11-09",
            48000,
            "Example Outfitters",
            "Clothing",
            memo="Store return",
        ),
        transaction(
            "tx-0006",
            "2026-11-13",
            3100000,
            "Demo Payroll Co",
            "Inflow: Ready to Assign",
        ),
        transaction(
            split,
            "2026-11-14",
            -212400,
            "Sample Warehouse Club",
            subtransactions=[
                sub("sub-0001", split, -150400, "Groceries"),
                sub("sub-0002", split, -32000, "Household Goods"),
                sub("sub-0003", split, -30000, "Charity", memo="Register round-up"),
            ],
        ),
        transaction(
            "tx-0007",
            "2026-11-15",
            -500000,
            "Transfer : Example Savings",
            transfer=SAVINGS,
            memo="Example Checking to Example Savings",
        ),
        transaction(
            "tx-0008",
            "2026-11-16",
            -1240180,
            "Transfer : Sample Rewards Card",
            transfer=CARD,
        ),
        transaction(
            "tx-0009",
            "2026-11-17",
            -400000,
            "Transfer : Sample Brokerage",
            transfer=BROKERAGE,
        ),
        transaction("tx-0010", "2026-11-19", -2100000, "Example Property Co", "Rent"),
        transaction(
            "tx-0011",
            "2026-11-20",
            -58200,
            "Example Bistro",
            "Dining Out",
            approved=False,
            cleared="uncleared",
        ),
        # Not selected for import in most scenarios.
        transaction(
            "tx-0012", "2026-11-05", -386400, "Mock Air Tickets", "Vacation", acct=CARD
        ),
    ]


def error(status, id_, name, detail):
    return JSONResponse(
        {"error": {"id": id_, "name": name, "detail": detail}}, status_code=status
    )


class FakeYnab:
    """State lives on the instance; tests change it through the helper methods."""

    def __init__(self, transactions=None):
        self.token = FAKE_TOKEN
        self.knowledge = 100
        self.failure: int | None = None
        self.requests: list[str] = []
        self.plans = [
            {
                "id": PLAN,
                "name": "Fixture household plan",
                "last_modified_on": "2026-11-20T12:00:00+00:00",
                "first_month": "2026-01-01",
                "last_month": "2026-12-01",
                "date_format": {"format": "YYYY-MM-DD"},
                "currency_format": usd(),
            },
            {
                "id": EURO_PLAN,
                "name": "Fixture euro plan",
                "last_modified_on": "2026-11-20T12:00:00+00:00",
                "first_month": "2026-01-01",
                "last_month": "2026-12-01",
                "date_format": {"format": "DD.MM.YYYY"},
                "currency_format": usd("EUR"),
            },
        ]
        self.accounts = [
            account(CHECKING, "Example Checking", "checking", True),
            account(CARD, "Sample Rewards Card", "creditCard", True),
            account(SAVINGS, "Example Savings", "savings", True),
            account(BROKERAGE, "Sample Brokerage", "otherAsset", False),
        ]
        # source id -> (knowledge when last changed, transaction)
        self.transactions = {
            tx["id"]: (self.knowledge, tx)
            for tx in (seed_transactions() if transactions is None else transactions)
        }
        self.app = Starlette(
            routes=[
                Route("/v1/plans", self.list_plans),
                Route("/v1/plans/{plan_id}/accounts", self.list_accounts),
                Route("/v1/plans/{plan_id}/transactions", self.list_transactions),
            ]
        )

    # Scenario helpers ------------------------------------------------------

    def _bump(self):
        self.knowledge += 1
        return self.knowledge

    def put(self, tx):
        self.transactions[tx["id"]] = (self._bump(), copy.deepcopy(tx))

    def change(self, id_, **fields):
        tx = copy.deepcopy(self.transactions[id_][1])
        tx.update(fields)
        self.put(tx)

    def delete(self, id_):
        self.change(id_, deleted=True)

    # Routes ----------------------------------------------------------------

    def _check(self, request: Request, plan_id: str | None = None):
        self.requests.append(request.url.path)
        if request.headers.get("authorization") != f"Bearer {self.token}":
            return error(401, "401", "unauthorized", "Unauthorized")
        if self.failure == 429:
            return error(429, "429", "too_many_requests", "Too many requests")
        if self.failure:
            return error(
                self.failure, str(self.failure), "internal_server_error", "Error"
            )
        if plan_id is not None and plan_id not in {p["id"] for p in self.plans}:
            return error(404, "404.2", "resource_not_found", "Resource not found")
        return None

    async def list_plans(self, request: Request):
        if failed := self._check(request):
            return failed
        return JSONResponse({"data": {"plans": self.plans, "default_plan": None}})

    async def list_accounts(self, request: Request):
        if failed := self._check(request, request.path_params["plan_id"]):
            return failed
        return JSONResponse(
            {"data": {"accounts": self.accounts, "server_knowledge": self.knowledge}}
        )

    async def list_transactions(self, request: Request):
        plan_id = request.path_params["plan_id"]
        if failed := self._check(request, plan_id):
            return failed
        if plan_id != PLAN:
            return JSONResponse(
                {"data": {"transactions": [], "server_knowledge": self.knowledge}}
            )
        try:
            since = request.query_params.get("since_date")
            since_date = date.fromisoformat(since) if since else None
            known = request.query_params.get("last_knowledge_of_server")
            known = int(known) if known is not None else None
        except ValueError:
            return error(400, "400", "bad_request", "Bad request")
        rows = []
        for changed, tx in self.transactions.values():
            if known is not None and changed <= known:
                continue
            # Like YNAB, deleted transactions appear only in delta requests.
            if tx["deleted"] and known is None:
                continue
            if since_date and date.fromisoformat(tx["date"]) < since_date:
                continue
            rows.append(tx)
        rows.sort(key=lambda tx: (tx["date"], tx["id"]))
        return JSONResponse(
            {"data": {"transactions": rows, "server_knowledge": self.knowledge}}
        )


fake = FakeYnab()
app = fake.app
