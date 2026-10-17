"""Independently worked examples for optional income estimates."""

import pytest

from accanto.domains.income_estimates import estimate


def line(
    name, gross, withholding="0", payroll="0", frequency="monthly", paid_days=None
):
    return {
        "name": name,
        "gross": gross,
        "withholding": withholding,
        "payroll": payroll,
        "frequency": frequency,
        "paid_days": paid_days,
    }


def test_multiple_incomes_have_independent_monthly_results():
    result = estimate(
        [
            line("Role A", "6000", "1200", "300"),
            line("Role B", "4000", "800", "200"),
        ]
    )
    assert [entry["monthly_net"] for entry in result["lines"]] == [
        "4500.00",
        "3000.00",
    ]
    assert result["monthly_total"] == "7500.00"


@pytest.mark.parametrize(
    ("frequency", "paid_days", "expected"),
    [
        ("annual", None, "10.00"),
        ("monthly", None, "120.00"),
        ("twice_monthly", None, "240.00"),
        ("weekly", None, "520.00"),
        ("daily", 3, "30.00"),
        ("daily", 0, "0.00"),
    ],
)
def test_payment_frequency_factors(frequency, paid_days, expected):
    result = estimate(
        [line("Consulting", "120", frequency=frequency, paid_days=paid_days)]
    )
    assert result["monthly_total"] == expected


def test_rounds_each_line_half_even_before_summing():
    result = estimate([line(str(i), "0.10", frequency="annual") for i in range(3)])
    assert [entry["monthly_net"] for entry in result["lines"]] == ["0.01"] * 3
    assert result["monthly_total"] == "0.03"
    assert (
        estimate([line("tie down", "0.06", frequency="annual")])["monthly_total"]
        == "0.00"
    )
    assert (
        estimate([line("tie up", "0.18", frequency="annual")])["monthly_total"]
        == "0.02"
    )


def test_ambiguous_workdays_and_deduction_excess_are_not_inferred_or_clamped():
    with pytest.raises(ValueError):
        estimate([line("Daily", "100", frequency="daily")])
    assert (
        estimate([line("Daily", "100", frequency="daily", paid_days=0)])[
            "monthly_total"
        ]
        == "0.00"
    )
    assert estimate([line("Assumption", "10", "20")])["monthly_total"] == "-10.00"


def test_rejects_excess_input_precision_and_derived_column_overflow():
    with pytest.raises(ValueError):
        estimate([line("Too precise", "1.005")])
    with pytest.raises(ValueError):
        estimate(
            [
                line(str(i), "999999999.99", frequency="daily", paid_days=1000)
                for i in range(20)
            ]
        )
    with pytest.raises(ValueError, match="Monthly estimate exceeds"):
        estimate(
            [
                line(
                    "Huge daily scenario",
                    "999999999.99",
                    frequency="daily",
                    paid_days=2**63 - 1,
                )
            ]
        )


def test_does_not_mutate_entered_lines():
    input_lines = [line("Job", "100", "10")]
    estimate(input_lines)
    assert input_lines[0] == line("Job", "100", "10")
