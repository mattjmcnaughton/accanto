"""YNAB source adapter: a thin async client for the few endpoints the inbox needs,
and the mapping from YNAB payloads to StagedTransactionInput.

Never log tokens, amounts, payees, memos or category names (constitution §6).
"""

import time
from datetime import date
from decimal import Decimal
from typing import Literal

import httpx
import structlog

from accanto.domains.inbox import StagedTransactionInput

log = structlog.get_logger(__name__)
DEFAULT_URL = "https://api.ynab.com/v1"
CARD_TYPES = {"creditCard", "lineOfCredit"}
CENT = Decimal("0.01")


class SourceError(Exception):
    """A failed source request. Carries only safe codes and HTTP status."""

    def __init__(self, code: str, message: str, status: int | None = None):
        self.code, self.message, self.status = code, message, status
        super().__init__(message)


def cents(milliunits: int) -> Decimal:
    """Exact USD cents from YNAB milliunits; partial cents are rejected, not rounded."""
    if isinstance(milliunits, bool) or not isinstance(milliunits, int):
        raise SourceError("invalid_amount", "YNAB returned a non-integer amount.")
    amount = Decimal(milliunits) / 1000
    if amount != amount.quantize(CENT):
        raise SourceError(
            "partial_cents",
            "A YNAB amount is not a whole number of cents. Fix it in YNAB, then sync.",
        )
    return amount.quantize(CENT)


Kind = Literal["ordinary", "transfer_on_budget", "transfer_tracking", "card_payment"]


def transaction_kind(
    transfer_account_id: str | None, accounts: dict[str, dict]
) -> Kind:
    if not transfer_account_id:
        return "ordinary"
    other = accounts.get(transfer_account_id)
    if other and other["type"] in CARD_TYPES:
        return "card_payment"
    if other and not other["on_budget"]:
        return "transfer_tracking"
    return "transfer_on_budget"


def staged(tx, line, accounts, ref, parent, deleted) -> StagedTransactionInput:
    """line is the transaction itself, or one of its split lines."""
    account = accounts.get(tx["account_id"], {})
    category = (
        (line["category_id"], line.get("category_name") or "")
        if line.get("category_id")
        else None
    )
    return StagedTransactionInput(
        source_ref=ref,
        parent_ref=parent,
        account_ref=tx["account_id"],
        account_name=tx.get("account_name") or account.get("name", ""),
        financial_date=date.fromisoformat(tx["date"]),
        amount=cents(line["amount"]),
        payee=line.get("payee_name") or tx.get("payee_name") or "",
        kind=transaction_kind(line.get("transfer_account_id"), accounts),
        source_category=category,
        memo=line.get("memo") or tx.get("memo"),
        cleared=tx["cleared"] in {"cleared", "reconciled"},
        approved=bool(tx["approved"]),
        deleted=bool(deleted),
    )


def staged_inputs(
    transactions: list[dict], accounts: dict[str, dict]
) -> list[StagedTransactionInput]:
    """One input per transaction, or per split line under its parent."""
    result = []
    for tx in transactions:
        subs = tx.get("subtransactions") or []
        if not subs:
            result.append(staged(tx, tx, accounts, tx["id"], None, tx["deleted"]))
        for sub in subs:
            ref = f"{tx['id']}:{sub['id']}"
            deleted = bool(tx["deleted"] or sub["deleted"])
            result.append(staged(tx, sub, accounts, ref, tx["id"], deleted))
    return result


class YnabClient:
    """Plans, accounts and the transactions delta; nothing else is read or written."""

    def __init__(
        self,
        token: str,
        *,
        base_url: str = DEFAULT_URL,
        transport: httpx.AsyncBaseTransport | None = None,
    ):
        self._token = token
        self._base = base_url.rstrip("/")
        self._transport = transport

    async def _get(self, operation: str, path: str, params: dict | None = None):
        started = time.monotonic()
        try:
            async with httpx.AsyncClient(
                transport=self._transport, timeout=20, follow_redirects=False
            ) as client:
                response = await client.get(
                    self._base + path,
                    params=params,
                    headers={"Authorization": f"Bearer {self._token}"},
                )
        except httpx.HTTPError:
            log.warning("ynab_request_failed", operation=operation, error="transport")
            raise SourceError(
                "source_unavailable", "YNAB could not be reached. Nothing changed."
            ) from None
        log.info(
            "ynab_request",
            operation=operation,
            status=response.status_code,
            ms=round((time.monotonic() - started) * 1000),
        )
        if response.status_code == 401:
            raise SourceError(
                "source_unauthorized",
                "YNAB rejected the access token. Reconnect with a new token.",
                401,
            )
        if response.status_code == 404:
            raise SourceError("source_not_found", "YNAB could not find that plan.", 404)
        if response.status_code == 429:
            raise SourceError(
                "source_rate_limited",
                "YNAB's hourly request limit was reached. Try again later.",
                429,
            )
        if response.status_code != 200:
            raise SourceError(
                "source_unavailable",
                "YNAB returned an error. Nothing changed.",
                response.status_code,
            )
        try:
            return response.json()["data"]
        except (ValueError, KeyError):
            raise SourceError(
                "source_unavailable", "YNAB returned an unreadable response."
            ) from None

    async def plans(self) -> list[dict]:
        data = await self._get("plans", "/plans")
        return [
            {
                "id": plan["id"],
                "name": plan["name"],
                "currency": (plan.get("currency_format") or {}).get("iso_code"),
            }
            for plan in data["plans"]
        ]

    async def accounts(self, plan_id: str) -> list[dict]:
        data = await self._get("accounts", f"/plans/{plan_id}/accounts")
        return [account for account in data["accounts"] if not account["deleted"]]

    async def transactions(
        self, plan_id: str, *, since: date, knowledge: int | None
    ) -> tuple[list[dict], int]:
        params: dict = {"since_date": since.isoformat()}
        if knowledge is not None:
            params["last_knowledge_of_server"] = knowledge
        data = await self._get("transactions", f"/plans/{plan_id}/transactions", params)
        return data["transactions"], data["server_knowledge"]


class YnabSource:
    """TransactionSource for one connected YNAB plan."""

    def __init__(self, client: YnabClient, plan_id: str, start_date: date):
        self.client, self.plan_id, self.start_date = client, plan_id, start_date

    async def changes_since(
        self, cursor: str | None
    ) -> tuple[list[StagedTransactionInput], str]:
        accounts = {a["id"]: a for a in await self.client.accounts(self.plan_id)}
        transactions, knowledge = await self.client.transactions(
            self.plan_id,
            since=self.start_date,
            knowledge=int(cursor) if cursor is not None else None,
        )
        return staged_inputs(transactions, accounts), str(knowledge)
