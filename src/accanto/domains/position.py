"""Position snapshot and change between observations (TDD 07).

Savings are remaining saved, derived from recorded activity. Investments and
loans are their latest dated observations: an account without one is unknown,
so the net position is unknown too, never a total that treats it as zero. A
balance change between two observations is reported next to the payments or
contributions recorded between them; neither is inferred from the other
(CONTEXT.md, Debt balance observation).
"""

from datetime import date
from decimal import ROUND_HALF_EVEN, Decimal, localcontext
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
    returns: bool = False,
) -> dict:
    """One investment or loan: latest balance, staleness and optional change.

    recorded holds the account's dated entries (contributions or loan payments).
    With returns, the change also carries the money-weighted annual return of
    the start balance, the contributions and the end balance.
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
            dated = [
                (date.fromisoformat(e["financial_date"]), Decimal(e["amount"]))
                for e in recorded
                if begin < date.fromisoformat(e["financial_date"]) <= end
            ]
            in_between = [amount for _, amount in dated]
            flows = [(begin, -Decimal(start["amount"]))]
            flows += [(day, -amount) for day, amount in dated] + [(end, balance)]
            line["change"] = {
                "from_date": begin,
                "to_date": end,
                "from_balance": Decimal(start["amount"]),
                "to_balance": balance,
                "balance_change": balance - Decimal(start["amount"]),
                "recorded_total": sum(in_between, ZERO),
                "recorded_entries": len(in_between),
                "money_weighted_return_percent": money_weighted_return(flows)
                if returns
                else None,
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


def money_weighted_return(flows: list[tuple[date, Decimal]]) -> Decimal | None:
    """Annual rate x (as a percent, 2 places) where the dated flows net to zero.

    flows are from the holder's side: money in is negative, the final balance
    positive. Solved by bisection between -99% and 1000%; None when the flows
    have no sign change or no root in that range.
    """
    if len(flows) < 2 or not (
        any(a < 0 for _, a in flows) and any(a > 0 for _, a in flows)
    ):
        return None
    first = min(day for day, _ in flows)
    with localcontext() as context:
        context.prec = 34

        def value(rate: Decimal) -> Decimal:
            return sum(
                (
                    amount / (1 + rate) ** (Decimal((day - first).days) / 365)
                    for day, amount in flows
                ),
                Decimal(0),
            )

        low, high = Decimal("-0.99"), Decimal("10")
        if value(low) * value(high) > 0:
            return None
        for _ in range(200):
            middle = (low + high) / 2
            if value(low) * value(middle) <= 0:
                high = middle
            else:
                low = middle
            if high - low < Decimal("1e-10"):
                break
        return ((low + high) / 2 * 100).quantize(
            Decimal("0.01"), rounding=ROUND_HALF_EVEN
        )
