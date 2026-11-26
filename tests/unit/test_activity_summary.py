"""Activity summaries and target gaps (TDD 07), with hand-worked amounts."""

from datetime import date
from decimal import Decimal

from accanto.domains.activity_summary import summarize
from accanto.domains.targets import target_gap


def entry(day, category, amount, funding="income"):
    return {
        "financial_date": day,
        "category": category,
        "amount": amount,
        "funding_origin": funding,
    }


ENTRIES = [
    entry("2026-01-05", "income", "4000.00"),
    entry("2026-01-09", "spending", "1200.40"),
    entry("2026-01-20", "saving", "500.00"),
    entry("2026-02-05", "income", "4000.00"),
    entry("2026-02-11", "spending", "999.60"),
    entry("2026-02-12", "spending", "-100.00"),  # a linked refund
    entry("2026-02-25", "investing", "300.00"),
    entry("2026-02-26", "investing", "200.00", funding="savings"),
    # March has no entries at all: unknown, not zero.
    entry("2026-04-02", "spending", "75.25"),  # April is still in progress
]


def by_category(result):
    return {c["category"]: c for c in result["categories"]}


def test_averages_use_only_complete_months_with_entries():
    result = summarize(ENTRIES, date(2026, 1, 1), date(2026, 4, 30), date(2026, 4, 15))
    spending = by_category(result)["spending"]
    # Total includes April: 1200.40 + 999.60 - 100.00 + 75.25 = 2175.25.
    assert spending["total"] == Decimal("2175.25")
    assert spending["entries"] == 4
    # Average over January and February only: (1200.40 + 899.60) / 2 = 1050.00.
    # Counting empty March as zero would give 700.00; including April 725.08.
    assert spending["monthly_average"] == Decimal("1050.00")
    assert spending["months_averaged"] == 2
    assert spending["months_without_entries"] == [date(2026, 3, 1)]
    assert result["partial_months"] == [date(2026, 4, 1)]


def test_saving_rates_disclose_numerator_and_denominator():
    result = summarize(ENTRIES, date(2026, 1, 1), date(2026, 2, 28), date(2026, 4, 15))
    # 500 saved of 8000 income is 6.25%; adding only the income-funded 300
    # invested gives 800 / 8000 = 10.00% (the savings-funded 200 is not new).
    assert result["saving_rate"] == {
        "numerator": Decimal("500.00"),
        "denominator": Decimal("8000.00"),
        "percent": Decimal("6.25"),
    }
    assert result["saving_and_investing_rate"]["numerator"] == Decimal("800.00")
    assert result["saving_and_investing_rate"]["percent"] == Decimal("10.00")


def test_no_income_means_an_unknown_rate_not_zero():
    result = summarize(
        [entry("2026-03-03", "saving", "50.00")],
        date(2026, 3, 1),
        date(2026, 3, 31),
        date(2026, 4, 15),
    )
    assert result["saving_rate"]["percent"] is None
    assert result["saving_rate"]["denominator"] is None
    assert "income" not in by_category(result)


def test_a_range_starting_mid_month_does_not_average_that_month():
    result = summarize(
        [
            entry("2026-01-20", "spending", "10.00"),
            entry("2026-02-03", "spending", "30.00"),
        ],
        date(2026, 1, 15),
        date(2026, 2, 28),
        date(2026, 4, 15),
    )
    spending = by_category(result)["spending"]
    assert spending["monthly_average"] == Decimal("30.00")
    assert result["partial_months"] == [date(2026, 1, 1)]


def test_target_gap():
    assert target_gap("10000.00", "2500.00") == (Decimal("7500.00"), Decimal("25.00"))
    # Past the target nothing remains, and the percent says by how much.
    assert target_gap("1000.00", "1250.00") == (Decimal("0.00"), Decimal("125.00"))
    assert target_gap("3.00", "1.00") == (Decimal("2.00"), Decimal("33.33"))
    assert target_gap(None, "40.00") == (None, None)
