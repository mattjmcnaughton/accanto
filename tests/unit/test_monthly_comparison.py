"""Independently worked, deliberately synthetic monthly comparison examples."""

from accanto.domains.monthly_comparison import compare_category, ratio, summary


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
