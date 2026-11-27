"""Adapt coherent stored snapshots to pure monthly comparison rules."""

from accanto.domains.monthly_comparison import (
    actual_metrics,
    breakdown,
    compare_category,
    summary,
    with_estimates,
)


def explain_review(version, entries):
    specification = (
        ("income", "incomes", "source_id", "name", "amount", "income"),
        (
            "fixed_cost",
            "fixed_costs",
            "fixed_cost_id",
            "name",
            "monthly_amount",
            "fixed_cost_total",
        ),
        (
            "saving",
            "saving_goals",
            "saving_goal_id",
            "goal_name",
            "amount",
            "saving_total",
        ),
        (
            "investing",
            "investments",
            "investment_id",
            "destination_name",
            "amount",
            "investing_total",
        ),
        (
            "giving",
            "giving",
            "giving_recipient_id",
            "destination_name",
            "amount",
            "giving_total",
        ),
    )
    comparisons = {}
    destinations = {} if version["saving_total"] is not None else None
    for category, collection, identity, label, amount, total_key in specification:
        source_key = {
            "saving": "goal_id",
            "investing": "destination_id",
            "giving": "destination_id",
        }.get(category, identity)
        expected = [
            {
                "id": str(line[source_key]),
                "name": line[label],
                "planned": str(line[amount]),
            }
            for line in version[collection]
        ]
        comparisons[category] = compare_category(
            expected,
            [e for e in entries if e["category"] == category],
            identity,
            version[total_key],
        )
        if destinations is not None and category in {"saving", "investing", "giving"}:
            destinations[collection] = [
                {
                    **line,
                    **{key: item[key] for key in ("planned", "recorded", "difference")},
                }
                for line, item in zip(
                    version[collection], comparisons[category]["items"], strict=True
                )
            ]
    # Spending subcategories have no planned lines (TDD 07): every spending entry
    # is unplanned, grouped by subcategory in a breakdown that sums to the total.
    # Optional estimates sit beside the groups and never change the comparison.
    spending = [e for e in entries if e["category"] == "spending"]
    lines, estimate_totals = with_estimates(
        breakdown(spending, "spending_subcategory_id", "spending_subcategory_name"),
        [
            {
                "id": line["spending_subcategory_id"],
                "name": line["spending_subcategory_name"],
                "amount": line["amount"],
            }
            for line in version.get("spending_estimates", [])
        ],
        version["spending"],
    )
    comparisons["spending"] = {
        **compare_category(
            [], spending, "spending_subcategory_id", version["spending"]
        ),
        "breakdown": lines,
        **estimate_totals,
    }
    amounts = summary(comparisons, entries)
    return {
        "comparison": comparisons,
        "destination_comparisons": destinations,
        "summary": amounts,
        "metrics": [*version["planned_metrics"], *actual_metrics(comparisons, amounts)],
    }
