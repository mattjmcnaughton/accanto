"""Adapt coherent stored snapshots to pure monthly comparison rules."""

from accanto.domains.monthly_comparison import actual_metrics, compare_category, summary


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
            "destination_id",
            "destination_name",
            "amount",
            "investing_total",
        ),
        (
            "giving",
            "giving",
            "destination_id",
            "destination_name",
            "amount",
            "giving_total",
        ),
    )
    comparisons = {}
    for category, collection, identity, label, amount, total_key in specification:
        source_key = "goal_id" if category == "saving" else identity
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
    comparisons["spending"] = compare_category(
        [],
        [e for e in entries if e["category"] == "spending"],
        None,
        version["spending"],
    )
    amounts = summary(comparisons, entries)
    return {
        "comparison": comparisons,
        "summary": amounts,
        "metrics": [*version["planned_metrics"], *actual_metrics(comparisons, amounts)],
    }
