"""Independently worked, deliberately synthetic monthly comparison examples."""

from accanto.domains.monthly_comparison import (
    breakdown,
    compare_category,
    ratio,
    summary,
    with_estimates,
)


def entry(identity, amount, **extra):
    return {
        "uuid": amount + str(identity),
        "source_id": identity,
        "amount": amount,
        **extra,
    }


def test_missing_identity_is_not_completed_by_unplanned_or_adjustment():
    expected = [
        {"id": "a", "name": "Same", "planned": "100.00"},
        {"id": "b", "name": "Same", "planned": "200.00"},
    ]
    entries = [
        entry("a", "50.00"),
        entry("other", "25.00"),
        entry(None, "10.00", is_adjustment=True),
    ]
    result = compare_category(expected, entries, "source_id", "300.00")
    assert result["recorded"] == "85.00"
    assert result["incomplete"]
    assert result["difference"] is None
    assert result["items"][1]["recorded"] is None
    assert len(result["unplanned"]) == 2
    assert result["adjustments"] == [entries[-1]]
    completed = compare_category(
        expected, [*entries, entry("b", "0.00")], "source_id", "300.00"
    )
    assert not completed["incomplete"]
    assert completed["difference"] == "-215.00"


def test_spending_breakdown_groups_every_entry_once_and_adds_up_to_the_total():
    def spend(subcategory, amount, **extra):
        return {
            "spending_subcategory_id": subcategory,
            "spending_subcategory_name": {"b": "Books", "e": "Eating out"}.get(
                subcategory
            ),
            "amount": amount,
            **extra,
        }

    # A refund nets against its purchase's subcategory; an adjustment is Unassigned.
    entries = [
        spend("b", "18.40"),
        spend(None, "7.05"),
        spend("e", "62.10"),
        spend("b", "-18.40", is_refund=True),
        spend("e", "30.00"),
        spend(None, "-2.50", is_adjustment=True),
    ]
    lines = breakdown(entries, "spending_subcategory_id", "spending_subcategory_name")
    assert [(line["name"], line["recorded"]) for line in lines] == [
        ("Eating out", "92.10"),
        ("Books", "0.00"),
        (None, "4.55"),
    ]
    assert sum(len(line["entries"]) for line in lines) == len(entries)
    recorded = compare_category([], entries, "spending_subcategory_id", "500.00")
    assert recorded["recorded"] == "96.65" and recorded["items"] == []
    assert len(recorded["unplanned"]) == len(entries)

    # Optional estimates sit beside the groups without changing them. An estimated
    # subcategory with no entry joins before Unassigned; estimates need not add up.
    estimated, totals = with_estimates(
        lines,
        [
            {"id": "e", "name": "Eating out", "amount": "80.00"},
            {"id": "h", "name": "Hobbies", "amount": "45.50"},
        ],
        "500.00",
    )
    assert [(x["name"], x["recorded"], x["estimated"]) for x in estimated] == [
        ("Eating out", "92.10", "80.00"),
        ("Books", "0.00", None),
        ("Hobbies", None, "45.50"),
        (None, "4.55", None),
    ]
    assert totals == {"estimated": "125.50", "unestimated": "374.50"}
    _, over = with_estimates(
        lines, [{"id": "e", "name": "Eating out", "amount": "520.00"}], "500.00"
    )
    assert over == {"estimated": "520.00", "unestimated": "-20.00"}
    unchanged, none = with_estimates(lines, [], "500.00")
    assert none == {"estimated": None, "unestimated": None}
    assert [x["estimated"] for x in unchanged] == [None, None, None]


def test_net_saving_and_savings_funded_investing_are_distinct():
    comparisons = {
        category: {"recorded": amount, "incomplete": False}
        for category, amount in (
            ("saving", "500.00"),
            ("investing", "2000.00"),
            ("fixed_cost", "100.00"),
        )
    }
    entries = [
        {"category": "spending", "amount": "1000.00", "funding_origin": "savings"}
    ]
    result = summary(comparisons, entries)
    assert result["net_saving"] == "-500.00"
    entries = [
        {"category": "investing", "amount": "2000.00", "funding_origin": "savings"}
    ]
    result = summary(comparisons, entries)
    assert result["total_investing"] == "2000.00"
    assert result["income_funded_investing"] == "0.00"
    assert result["savings_used"] == "2000.00"


def test_ratio_discloses_distinct_bases_and_unavailable():
    assert (
        ratio("planned", "Fixed costs", "2500.00", "Net income", "4000.00")[
            "percentage"
        ]
        == "62.50"
    )
    assert (
        ratio("planned", "Fixed costs", "2500.00", "Total funding", "5000.00")[
            "percentage"
        ]
        == "50.00"
    )
    assert (
        ratio("actual", "Saving", None, "Net income", "4000.00")["percentage"] is None
    )
    assert ratio("actual", "Saving", "0.00", "Net income", "0.00")["percentage"] is None


def test_incomplete_expected_outflows_withhold_net_saving_but_keep_subtotal():
    comparisons = {
        "saving": {"recorded": "500.00", "incomplete": False},
        "investing": {
            "recorded": None,
            "incomplete": True,
            "items": [{"recorded": None}],
        },
        "fixed_cost": {"recorded": "0.00", "incomplete": False, "items": []},
        "giving": {"recorded": None, "incomplete": True, "items": []},
    }
    result = summary(
        comparisons,
        [{"category": "spending", "amount": "0.00", "funding_origin": "income"}],
    )
    assert result["new_saving"] == "500.00"
    assert result["savings_used"] == "0.00"
    assert result["savings_used_incomplete"]
    assert result["net_saving"] is None
    comparisons["investing"]["items"] = []
    assert (
        summary(comparisons, [{"category": "spending", "amount": "0.00"}])["net_saving"]
        == "500.00"
    )


def test_unknown_spending_withholds_net_saving_even_when_other_outflows_known():
    comparisons = {
        "saving": {"recorded": "500.00", "incomplete": False},
        "investing": {
            "recorded": "1000.00",
            "incomplete": False,
            "items": [{"recorded": "1000.00"}],
        },
        "fixed_cost": {"recorded": "0.00", "incomplete": False, "items": []},
        "giving": {"recorded": "0.00", "incomplete": False, "items": []},
        "spending": {"recorded": None, "incomplete": True},
    }
    entries = [
        {"category": "investing", "amount": "1000.00", "funding_origin": "savings"}
    ]
    unknown = summary(comparisons, entries)
    assert unknown["savings_used"] == "1000.00"
    assert unknown["savings_used_incomplete"]
    assert unknown["net_saving"] is None
    assert (
        ratio("actual", "Net saving", unknown["net_saving"], "net income", "4000.00")[
            "percentage"
        ]
        is None
    )
    comparisons["spending"] = {"recorded": "0.00", "incomplete": False}
    complete = summary(
        comparisons, [*entries, {"category": "spending", "amount": "0.00"}]
    )
    assert not complete["savings_used_incomplete"]
    assert complete["net_saving"] == "-500.00"
    assert (
        ratio("actual", "Net saving", complete["net_saving"], "net income", "4000.00")[
            "percentage"
        ]
        == "-12.50"
    )
