"""Pure identity comparisons and transparent same-period financial metrics."""

from decimal import ROUND_HALF_EVEN, Decimal

ZERO = Decimal("0.00")
OUTFLOWS = {"spending", "fixed_cost", "investing", "giving"}


def total(entries):
    return sum((Decimal(e["amount"]) for e in entries), ZERO)


def compare_category(expected, entries, identity_key, planned):
    """Unplanned amounts count once without filling missing expected identities."""
    identities = {line["id"] for line in expected}
    items = []
    for line in expected:
        matches = [e for e in entries if e.get(identity_key) == line["id"]]
        recorded = total(matches) if matches else None
        items.append(
            {
                **line,
                "recorded": recorded,
                "difference": None
                if recorded is None
                else recorded - Decimal(line["planned"]),
                "entries": matches,
            }
        )
    incomplete = not entries or any(line["recorded"] is None for line in items)
    recorded = total(entries) if entries else None
    return {
        "planned": planned,
        "recorded": str(recorded) if recorded is not None else None,
        "incomplete": incomplete,
        "difference": str(recorded - Decimal(planned))
        if recorded is not None and not incomplete and planned is not None
        else None,
        "items": items,
        "unplanned": [
            e
            for e in entries
            if identity_key is not None and e.get(identity_key) not in identities
        ],
        "adjustments": [e for e in entries if e.get("is_adjustment")],
    }


def summary(comparisons, entries):
    def known(category):
        value = comparisons[category]
        return Decimal(value["recorded"]) if not value["incomplete"] else None

    saving = known("saving")
    outflows = [e for e in entries if e["category"] in OUTFLOWS]
    used = (
        total([e for e in outflows if e.get("funding_origin") == "savings"])
        if outflows
        else None
    )
    missing_outflows = any(
        item["recorded"] is None
        for category in ("fixed_cost", "investing", "giving")
        for item in comparisons.get(category, {}).get("items", [])
    )
    result = {
        "new_saving": saving,
        "savings_used": used,
        "net_saving": saving - used
        if saving is not None and used is not None and not missing_outflows
        else None,
        "total_investing": known("investing"),
    }
    for category in ("fixed_cost", "investing"):
        result[f"income_funded_{category}"] = (
            total(
                [
                    e
                    for e in entries
                    if e["category"] == category
                    and e.get("funding_origin") != "savings"
                ]
            )
            if known(category) is not None
            else None
        )
    return {
        **{
            key: str(value) if value is not None else None
            for key, value in result.items()
        },
        "savings_used_incomplete": missing_outflows or not outflows,
    }


def ratio(
    basis, numerator_label, numerator, denominator_label, denominator, components=None
):
    reason = (
        "Required amount is unknown or incomplete."
        if numerator is None or denominator is None
        else "Denominator is zero."
        if Decimal(denominator) == 0
        else None
    )
    return {
        "key": f"{basis}:{numerator_label}:{denominator_label}",
        "basis": basis,
        "label": f"{numerator_label} ÷ {basis} {denominator_label}",
        "numerator_label": numerator_label,
        "denominator_label": denominator_label,
        "numerator": numerator,
        "denominator": denominator,
        "percentage": str(
            (Decimal(numerator) / Decimal(denominator) * 100).quantize(
                Decimal("0.01"), rounding=ROUND_HALF_EVEN
            )
        )
        if reason is None
        else None,
        "unavailable_reason": reason,
        "components": components or [],
    }


def planned_metrics(plan):
    income = plan["income"]
    funding = plan["funding_total"]
    components = [
        {"name": "Planned net income", "amount": income},
        *[
            {
                "name": f"Selected savings: {line['account_name']}",
                "amount": line["amount"],
            }
            for line in plan["savings_funding"]
        ],
    ]
    metrics = []
    for name, numerator in (
        ("All fixed costs", plan["fixed_cost_total"]),
        ("New saving", plan["saving_total"]),
        ("All investment contributions", plan["investing_total"]),
    ):
        metrics.append(
            ratio(
                "planned",
                name,
                numerator,
                "net income",
                income,
                [{"name": "Planned net income", "amount": income}],
            )
        )
        metrics.append(
            ratio("planned", name, numerator, "total funding", funding, components)
        )
    return metrics


def actual_metrics(comparisons, amounts):
    income = (
        comparisons["income"]["recorded"]
        if not comparisons["income"]["incomplete"]
        else None
    )
    fixed = (
        comparisons["fixed_cost"]["recorded"]
        if not comparisons["fixed_cost"]["incomplete"]
        else None
    )
    return [
        ratio(
            "actual",
            label,
            amount,
            "net income",
            income,
            [{"name": "Recorded same-month net income", "amount": income}],
        )
        for label, amount in (
            ("All fixed costs", fixed),
            ("Income-funded fixed costs", amounts["income_funded_fixed_cost"]),
            ("New saving", amounts["new_saving"]),
            ("Net saving", amounts["net_saving"]),
            ("All investment contributions", amounts["total_investing"]),
            (
                "Income-funded investment contributions",
                amounts["income_funded_investing"],
            ),
        )
    ]
