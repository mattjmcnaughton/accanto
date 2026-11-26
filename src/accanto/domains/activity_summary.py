"""Totals, monthly averages and savings rates over recorded activity (TDD 07).

Entries arrive filtered by the caller's filters; dates outside the range are
ignored here. A
month with no entries in a category is unknown for that category, never zero:
averages use only complete months that have entries, and say how many. A month
cut by the range or still in progress is partial and is not averaged.
"""

from datetime import date, timedelta
from decimal import ROUND_HALF_EVEN, Decimal
from typing import Any

ZERO = Decimal("0.00")
CENT = Decimal("0.01")
CATEGORIES = ("income", "fixed_cost", "spending", "saving", "investing", "giving")


def months_between(start: date, end: date) -> list[date]:
    month, months = start.replace(day=1), []
    while month <= end:
        months.append(month)
        month = (month + timedelta(days=32)).replace(day=1)
    return months


def _month_end(month: date) -> date:
    return (month + timedelta(days=32)).replace(day=1) - timedelta(days=1)


def _rate(numerator: Decimal | None, denominator: Decimal | None) -> dict:
    percent = (
        (numerator / denominator * 100).quantize(CENT, rounding=ROUND_HALF_EVEN)
        if numerator is not None and denominator
        else None
    )
    return {
        "numerator": numerator,
        "denominator": denominator,
        "percent": percent,
    }


def summarize(entries: list[dict], start: date, end: date, today: date) -> dict:
    months = months_between(start, end)
    complete = {
        month
        for month in months
        if start <= month and _month_end(month) <= min(end, today)
    }
    by_month: dict[date, dict[str, Decimal]] = {month: {} for month in months}
    counts: dict[str, int] = {}
    entries = [
        e
        for e in entries
        if start <= date.fromisoformat(str(e["financial_date"])) <= end
    ]
    for entry in entries:
        month = date.fromisoformat(str(entry["financial_date"])).replace(day=1)
        category = entry["category"]
        totals = by_month[month]
        totals[category] = totals.get(category, ZERO) + Decimal(entry["amount"])
        counts[category] = counts.get(category, 0) + 1

    categories: list[dict[str, Any]] = []
    for category in CATEGORIES:
        if category not in counts:
            continue
        known = [m for m in months if category in by_month[m]]
        averaged = [m for m in known if m in complete]
        categories.append(
            {
                "category": category,
                "total": sum((by_month[m][category] for m in known), ZERO),
                "entries": counts[category],
                "monthly_average": (
                    sum((by_month[m][category] for m in averaged), ZERO) / len(averaged)
                ).quantize(CENT, rounding=ROUND_HALF_EVEN)
                if averaged
                else None,
                "months_averaged": len(averaged),
                "months_without_entries": [m for m in months if m not in known],
            }
        )

    totals: dict[str, Decimal] = {c["category"]: c["total"] for c in categories}
    income = totals.get("income")
    saving = totals.get("saving")
    income_funded_investing = sum(
        (
            Decimal(e["amount"])
            for e in entries
            if e["category"] == "investing" and e.get("funding_origin") != "savings"
        ),
        ZERO,
    )
    return {
        "entries": len(entries),
        "months": months,
        "partial_months": [m for m in months if m not in complete],
        "categories": categories,
        "by_month": [
            {"month": month, "totals": dict(by_month[month])} for month in months
        ],
        "saving_rate": _rate(saving, income),
        "saving_and_investing_rate": _rate(
            (saving or ZERO) + income_funded_investing
            if saving is not None or "investing" in totals
            else None,
            income,
        ),
    }
