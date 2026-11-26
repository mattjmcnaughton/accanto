"""Position snapshot and change between observations (TDD 07).

Savings are remaining saved, derived from recorded activity. Investments and
loans are their latest dated observations: an account without one is unknown,
so the net position is unknown too, never a total that treats it as zero. A
balance change between two observations is reported next to the payments or
contributions recorded between them; neither is inferred from the other
(CONTEXT.md, Debt balance observation).
"""

from datetime import date
from decimal import Decimal
from typing import Any

ZERO = Decimal("0.00")


def _latest(observations: list[dict], on: date) -> dict | None:
    dated = [o for o in observations if date.fromisoformat(o["financial_date"]) <= on]
    if not dated:
        return None
    return max(dated, key=lambda o: (o["financial_date"], not o["is_opening"]))


def _baseline(observations: list[dict], since: date) -> dict | None:
    """The last observation on or before since, else the earliest one."""
    before = _latest(observations, since)
    if before is not None:
        return before
    if not observations:
        return None
    return min(observations, key=lambda o: o["financial_date"])


def account_line(
    account: dict,
    observations: list[dict],
    recorded: list[dict],
    *,
    today: date,
    since: date | None,
    stale_after_days: int,
) -> dict:
    """One investment or loan: latest balance, staleness and optional change.

    recorded holds the account's dated entries (contributions or loan payments).
    """
    latest = _latest(observations, today)
    line: dict[str, Any] = {
        "id": account["id"],
        "name": account["name"],
        "active": account["active"],
        "balance": None,
        "observed_on": None,
        "days_old": None,
        "stale": True,
        "change": None,
    }
    if latest is None:
        return line
    balance = Decimal(latest["amount"])
    end = date.fromisoformat(latest["financial_date"])
    days_old = (today - end).days
    line |= {
        "balance": balance,
        "observed_on": end,
        "days_old": days_old,
        "stale": days_old > stale_after_days,
    }
    if since is not None:
        start = _baseline(observations, since)
        if start is not None and start["financial_date"] < latest["financial_date"]:
            begin = date.fromisoformat(start["financial_date"])
            in_between = [
                Decimal(e["amount"])
                for e in recorded
                if begin < date.fromisoformat(e["financial_date"]) <= end
            ]
            line["change"] = {
                "from_date": begin,
                "to_date": end,
                "from_balance": Decimal(start["amount"]),
                "to_balance": balance,
                "balance_change": balance - Decimal(start["amount"]),
                "recorded_total": sum(in_between, ZERO),
                "recorded_entries": len(in_between),
            }
    return line


def net_position(savings: Decimal, investments: list[dict], debts: list[dict]):
    """Savings + investments − loans; unknown when any active balance is.

    Inactive accounts count with their last balance (an inactive investment can
    still hold money); one never observed adds nothing it could be missing.
    """
    lines = investments + debts
    if any(line["active"] and line["balance"] is None for line in lines):
        return None
    invested = sum((i["balance"] or ZERO for i in investments), ZERO)
    owed = sum((d["balance"] or ZERO for d in debts), ZERO)
    return savings + invested - owed
