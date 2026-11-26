"""Loan, growth and FIRE projections (TDD 07), against independently known values."""

from decimal import Decimal

import pytest

from accanto.domains import projections as p


def test_a_published_mortgage_payment_and_a_schedule_that_ends_on_time():
    # $100,000 at 6% for 30 years: $599.55 a month (any mortgage table).
    schedule = p.amortize(Decimal("100000"), Decimal("6"), months=360)
    assert schedule["payment"] == Decimal("599.55")
    assert schedule["months"] == 360  # rounding the payment adds no 361st month
    rows = schedule["rows"]
    assert rows[-1]["balance"] == 0
    assert sum(r["principal"] for r in rows) == Decimal("100000")
    # First month: 100000 × 0.005 = 500.00 interest, 99.55 principal.
    assert (rows[0]["interest"], rows[0]["principal"]) == (
        Decimal("500.00"),
        Decimal("99.55"),
    )


def test_residual_cents_go_to_the_last_payment():
    rows = p.amortize(Decimal("1000"), Decimal("0"), months=3)["rows"]
    assert [r["payment"] for r in rows] == [
        Decimal("333.33"),
        Decimal("333.33"),
        Decimal("333.34"),
    ]


def test_an_extra_payment_shortens_the_loan_by_the_published_amount():
    # Adding $100 a month to that mortgage repays it in 21 years.
    result = p.compare_extra(
        Decimal("100000"), Decimal("6"), months=360, extra=Decimal("100")
    )
    assert result["months"] == 252
    assert result["months_saved"] == 108
    assert result["interest_saved"] > Decimal("39000")


def test_a_payment_that_does_not_cover_interest_is_refused():
    with pytest.raises(ValueError):
        p.amortize(Decimal("100000"), Decimal("6"), payment=Decimal("500.00"))


def test_fire_target():
    assert p.fire_target(Decimal("40000"), Decimal("4")) == Decimal("1000000.00")
    # 1,142,857.142857… rounds up: an amount needed must suffice.
    assert p.fire_target(Decimal("40000"), Decimal("3.5")) == Decimal("1142857.15")
    with pytest.raises(ValueError):
        p.fire_target(Decimal("40000"), Decimal("0"))


def test_growth_matches_the_closed_form():
    # 10,000 + 500/month at 7% a year for 10 years, monthly at (1.07)^(1/12) - 1:
    # 10000 × 1.07^10 + 500 × (1.07^10 - 1) / g = 105,197.38.
    result = p.grow(Decimal("10000"), Decimal("500"), Decimal("7"), months=120)
    assert p.cents(result["final"]) == Decimal("105197.38")
    assert result["contributed"] == Decimal("60000")


def test_months_to_a_target_with_growth():
    result = p.grow(
        Decimal("0"), Decimal("1000"), Decimal("0"), target=Decimal("12000")
    )
    assert result["months_to_target"] == 12
    already = p.grow(
        Decimal("50000"), Decimal("0"), Decimal("5"), target=Decimal("40000"), months=12
    )
    assert already["months_to_target"] == 0


def test_coast_amount_discounts_the_target():
    # 1,000,000 / 1.05^20 = 376,889.4829, rounded up to suffice.
    assert p.coast_amount(Decimal("1000000"), Decimal("5"), 240) == Decimal("376889.49")


def test_required_contribution_reaches_the_target_and_no_less():
    monthly = p.required_contribution(
        Decimal("100000"), Decimal("1000000"), Decimal("5"), 240
    )
    final = p.grow(Decimal("100000"), monthly, Decimal("5"), months=240)["final"]
    short = p.grow(
        Decimal("100000"), monthly - Decimal("0.01"), Decimal("5"), months=240
    )["final"]
    assert short < Decimal("1000000") <= final
    assert (
        p.required_contribution(
            Decimal("2000000"), Decimal("1000000"), Decimal("5"), 12
        )
        == 0
    )


def test_months_to_target_without_growth_rounds_up():
    assert p.months_to_target(Decimal("7500"), Decimal("500")) == 15
    assert p.months_to_target(Decimal("7500.01"), Decimal("500")) == 16
    assert p.months_to_target(Decimal("0"), Decimal("500")) == 0


def test_prepay_and_invest_tie_when_money_earns_nothing():
    # With 0% on both sides the same budget ends in the same net position.
    result = p.prepay_or_invest(
        Decimal("12000"), Decimal("0"), Decimal("500"), Decimal("0"), 48, months=24
    )
    assert result["difference"] == 0
    assert result["prepay"]["payoff_months"] == 12
    # Net position: 48 × 1,000 budget − 12,000 loan = 36,000 either way.
    assert result["invest"]["net_position"] == Decimal("36000.00")


def test_prepaying_wins_when_the_loan_costs_more_than_investments_earn():
    result = p.prepay_or_invest(
        Decimal("200000"), Decimal("7"), Decimal("500"), Decimal("3"), 360, months=360
    )
    assert result["difference"] < 0
