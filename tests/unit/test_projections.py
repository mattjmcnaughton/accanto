"""Loan, growth and FIRE projections (TDD 09), against independently known values."""

from datetime import date
from decimal import Decimal, localcontext

import pytest

from accanto.domains import projections as p
from accanto.domains.projections import (
    ZERO,
    cents,
    expected_return,
    project_entity,
    withdrawal_rate,
)


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


# Entity projections (TDD 14). Expected values use the closed-form future value
# FV = P(1+g)^n + c((1+g)^n - 1)/g with g = (1+R)^(1/12) - 1, not the monthly loop.

ENTITY_TODAY = date(2026, 11, 10)


def _investment(name, amount, rate=None, contribution=None, frequency="monthly", **kw):
    return {
        "id": name,
        "name": name,
        "active": kw.get("active", True),
        "latest": None if amount is None else {"date": "2026-11-01", "amount": amount},
        "expected_return_percent": rate,
        "expected_contribution": contribution,
        "expected_contribution_frequency": frequency,
    }


def _future_value(start, monthly, annual_percent, months):
    with localcontext() as context:
        context.prec = 34
        g = (1 + Decimal(annual_percent) / 100) ** (Decimal(1) / 12) - 1
        growth = (1 + g) ** months
        return Decimal(start) * growth + Decimal(monthly) * (growth - 1) / g


def _loan(name, amount, rate=None, payment=None, active=True):
    return {
        "id": name,
        "name": name,
        "active": active,
        "latest": {"date": "2026-11-01", "amount": amount},
        "interest_rate_percent": rate,
        "monthly_payment": payment,
    }


def _project(investments, **kw):
    return project_entity(
        investments,
        savings=kw.pop("savings", Decimal("15900.00")),
        loans=kw.pop("loans", [_loan("car", "20500.00")]),
        today=ENTITY_TODAY,
        years=kw.pop("years", 20),
        default_return=Decimal("6.00"),
        **kw,
    )


def test_each_investment_grows_at_its_own_or_the_default_return():
    result = _project(
        [
            _investment("own", "30900.00", "7.00", "800.00"),
            # An annual contribution adds a twelfth each month.
            _investment("default", "19250.00", None, "6000.00", "annual"),
        ]
    )
    own = _future_value("30900", "800", "7", 120)
    default = _future_value("19250", "500", "6", 120)
    ten = result["milestones"][1]
    assert ten["years"] == 10 and ten["date"] == "2036-11-10"
    assert ten["investments"] == str(cents(own + default))
    assert ten["net_worth"] == str(cents(own + default + 15900 - 20500))
    assert ten["contributed"] == "156000.00"
    lines = {line["investment_id"]: line for line in result["investments"]}
    assert lines["default"]["return_source"] == "default"
    assert lines["default"]["return_percent"] == "6.00"
    assert lines["default"]["monthly_contribution"] == "500.00"
    assert lines["own"]["milestones"][1]["amount"] == str(cents(own))
    assert result["today"]["net_worth"] == "45550.00"
    assert [row["years"] for row in result["timeline"]] == list(range(21))


def test_zero_return_adds_contributions_only():
    result = _project([_investment("flat", "1000.00", "0", "100.00")], loans=[])
    assert result["milestones"][0]["investments"] == "7000.00"


def test_an_unobserved_active_investment_makes_totals_unknown_not_zero():
    result = _project(
        [_investment("seen", "1000.00", "5"), _investment("unseen", None, "5")],
        annual_spending=Decimal("40000.00"),
    )
    assert result["today"]["net_worth"] is None
    assert result["today"]["investments"] is None
    assert all(row["net_worth"] is None for row in result["milestones"])
    assert result["fire"]["months_to_target"] is None
    assert result["fire"]["target"] is None
    assert result["fire"]["target_today"] == "1000000.00"
    unseen = result["investments"][1]
    assert unseen["status"] == "no_value"
    assert unseen["milestones"][0]["amount"] is None


def test_inactive_investments_count_but_take_no_new_contributions():
    result = _project(
        [
            _investment("closed", "1000.00", "0", "100.00", active=False),
            _investment("closed-unseen", None, active=False),
        ],
        savings=ZERO,
        loans=[],
    )
    assert result["today"]["net_worth"] == "1000.00"
    assert result["milestones"][0]["net_worth"] == "1000.00"


def test_fire_date_is_the_first_month_investments_reach_the_target():
    result = _project(
        [_investment("fund", "100000.00", "7", "2000.00")],
        annual_spending=Decimal("60000.00"),
        withdrawal_percent=Decimal("4.00"),
    )
    fire = result["fire"]
    months = fire["months_to_target"]
    assert _future_value("100000", "2000", "7", months) >= 1500000
    assert _future_value("100000", "2000", "7", months - 1) < 1500000
    assert (
        fire["reached_on"]
        == date(2026 + (10 + months) // 12, (10 + months) % 12 + 1, 10).isoformat()
    )


def test_fire_already_reached_is_today_and_unreachable_is_none():
    rich = _project(
        [_investment("fund", "2000000.00", "5")], annual_spending=Decimal("40000")
    )
    assert rich["fire"]["months_to_target"] == 0
    assert rich["fire"]["reached_on"] == "2026-11-10"
    poor = _project(
        [_investment("fund", "10.00", "0")], annual_spending=Decimal("40000")
    )
    assert poor["fire"]["months_to_target"] is None


def test_projection_assumption_ranges():
    assert expected_return("-10") == Decimal("-10.00")
    assert expected_return("30") == Decimal("30.00")
    for bad in ("30.01", "-10.01", "6.005", "abc", "NaN"):
        with pytest.raises(ValueError):
            expected_return(bad)
    assert withdrawal_rate("10") == Decimal("10.00")
    for bad in ("0", "10.01", "-1"):
        with pytest.raises(ValueError):
            withdrawal_rate(bad)


# Payoff schedules and amortizing loans in projections (TDD 15).

AS_OF = date(2026, 11, 1)


def _closed_balance(principal, annual_percent, payment, months):
    r = Decimal(annual_percent) / 1200
    with localcontext() as context:
        context.prec = 34
        g = (1 + r) ** months
        return Decimal(principal) * g - Decimal(payment) * (g - 1) / r


def test_a_published_car_loan_schedule_from_the_latest_balance():
    # $10,000 at 6% for 5 years: $193.33 a month (any loan table).
    s = p.payoff_schedule(
        Decimal("10000.00"), AS_OF, Decimal("6.00"), Decimal("193.33")
    )
    assert s["status"] == "scheduled"
    assert s["months"] == 60
    assert s["payoff_date"] == "2031-11-01"
    rows = s["rows"]
    assert rows[0]["date"] == "2026-12-01"
    # First month: 10000 × 0.005 = 50.00 interest, 143.33 principal.
    assert (rows[0]["interest"], rows[0]["principal"]) == ("50.00", "143.33")
    assert rows[-1]["balance"] == "0.00"
    assert sum(Decimal(r["principal"]) for r in rows) == Decimal("10000.00")
    interest = sum(Decimal(r["interest"]) for r in rows)
    assert s["total_interest"] == str(interest)
    # 60 × 193.33 − 10,000 = 1,599.80, less the smaller last payment's cents.
    assert abs(interest - Decimal("1599.80")) < 1
    after_year = _closed_balance("10000", "6", "193.33", 12)
    assert abs(Decimal(rows[11]["balance"]) - after_year) < Decimal("0.05")


def test_a_payment_that_does_not_exceed_the_interest_is_flagged_not_endless():
    # $10,000 at 12%: interest is $100.00 a month.
    flat = p.payoff_schedule(
        Decimal("10000.00"), AS_OF, Decimal("12"), Decimal("100.00")
    )
    assert flat["status"] == "interest_not_covered"
    assert flat["monthly_interest"] == "100.00"
    assert flat["rows"] == [] and flat["payoff_date"] is None
    assert flat["total_interest"] is None
    # One cent more repays it, slowly: ln(10001) / ln(1.01) ≈ 926 months
    # unrounded; interest rounded to the cent each month (99.9999 → 100.00)
    # adds months while principal falls by cents, but it still ends.
    slow = p.payoff_schedule(
        Decimal("10000.00"), AS_OF, Decimal("12"), Decimal("100.01")
    )
    assert slow["status"] == "scheduled"
    assert 926 <= slow["months"] < p.MAX_MONTHS


def test_no_terms_paid_off_and_zero_rate():
    assert p.payoff_schedule(Decimal("500.00"), AS_OF, None, Decimal("50"))[
        "status"
    ] == ("no_terms")
    assert p.payoff_schedule(Decimal("500.00"), AS_OF, Decimal("5"), None)[
        "status"
    ] == ("no_terms")
    assert p.payoff_schedule(ZERO, AS_OF, Decimal("5"), Decimal("50"))["status"] == (
        "paid_off"
    )
    free = p.payoff_schedule(Decimal("1200.00"), AS_OF, Decimal("0"), Decimal("100"))
    assert (free["months"], free["total_interest"]) == (12, "0.00")


def test_debt_rate_range():
    assert p.debt_rate("0") == ZERO and p.debt_rate("40") == Decimal("40.00")
    for bad in ("-0.01", "40.01", "5.255", "x"):
        with pytest.raises(ValueError):
            p.debt_rate(bad)


def test_projected_loans_pay_down_and_loans_without_terms_stay_flat():
    fund = _investment("fund", "10000.00", "0", "100.00")
    car = _loan("car", "10000.00", "6.00", "193.33")
    flat = _loan("family", "2000.00")
    result = _project([fund], savings=ZERO, loans=[car, flat], years=5)
    alone = _project([fund], savings=ZERO, loans=[], years=5)
    # Investments are unchanged: the payment is not taken from contributions.
    assert result["timeline"][5]["investments"] == alone["timeline"][5]["investments"]
    year1 = result["timeline"][1]
    owed1 = _closed_balance("10000", "6", "193.33", 12) + 2000
    assert abs(Decimal(year1["loans"]) - owed1) < Decimal("0.05")
    # Repaid within 5 years: only the flat loan remains.
    assert result["timeline"][5]["loans"] == "2000.00"
    assert result["timeline"][5]["net_worth"] == str(Decimal("16000.00") - 2000)
    assert result["today"]["loans"] == "12000.00"
    lines = {line["debt_id"]: line for line in result["loans"]}
    assert lines["car"]["status"] == "amortizing"
    assert lines["car"]["payoff_date"] == "2031-11-10"
    assert lines["family"]["status"] == "no_terms"
    assert lines["family"]["milestones"][2]["amount"] == "2000.00"


def test_a_loan_whose_payment_misses_the_interest_stays_flat_in_projections():
    stuck = _loan("stuck", "10000.00", "12", "100.00")
    result = _project([], savings=ZERO, loans=[stuck], years=5)
    assert result["loans"][0]["status"] == "interest_not_covered"
    assert result["timeline"][5]["loans"] == "10000.00"


# Inflation (TDD 17) ---------------------------------------------------------


def _price(percent, months):
    """1.03^(months/12) computed independently of the module."""
    with localcontext() as context:
        context.prec = 34
        return (1 + Decimal(percent) / 100) ** (Decimal(months) / 12)


def test_todays_dollars_divide_by_inflation_at_each_date():
    fund = _investment("fund", "30900.00", "7.00", "800.00")
    args = dict(loans=[_loan("car", "20500.00")], inflation_percent=Decimal("3.00"))
    real = _project([fund], dollars="today", **args)
    nominal = _project([fund], dollars="future", **args)
    ten = real["milestones"][1]
    grown = _future_value("30900", "800", "7", 120)
    with localcontext() as context:
        context.prec = 34
        deflate = _price("3", 120)
        assert ten["investments"] == str(cents(grown / deflate))
        assert ten["loans"] == str(cents(Decimal("20500") / deflate))
        # Each month's $800 is deflated at its own month: a geometric series.
        q = 1 / _price("3", 1)
        assert ten["contributed"] == str(cents(800 * q * (1 - q**120) / (1 - q)))
    assert nominal["milestones"][1]["investments"] == str(cents(grown))
    assert nominal["milestones"][1]["contributed"] == "96000.00"
    assert real["today"] == nominal["today"]
    assert real["dollars"] == "today" and real["inflation_percent"] == "3.00"


def test_fire_target_rises_with_inflation_except_costs_fixed_in_dollars():
    # $60,000 a year at 4%, $12,000 of it a fixed-rate mortgage, 3% inflation.
    assert p.fire_target_at(
        Decimal("60000"), Decimal("12000"), Decimal("4"), Decimal("3"), 0
    ) == p.fire_target(Decimal("60000"), Decimal("4"))
    with localcontext() as context:
        context.prec = 34
        expected = (48000 * _price("3", 240) + 12000) / Decimal("0.04")
    assert p.fire_target_at(
        Decimal("60000"), Decimal("12000"), Decimal("4"), Decimal("3"), 240
    ) == p.needed(expected)
    # A steady part above annual spending is capped: the target never falls.
    assert p.fire_target_at(
        Decimal("60000"), Decimal("90000"), Decimal("4"), Decimal("3"), 240
    ) == Decimal("1500000.00")


def test_fire_date_with_inflation_is_the_same_in_either_dollars():
    fund = _investment("fund", "100000.00", "7", "2000.00")
    args = dict(
        annual_spending=Decimal("60000.00"),
        withdrawal_percent=Decimal("4.00"),
        inflation_percent=Decimal("3.00"),
        steady_spending=Decimal("12000.00"),
    )
    real = _project([fund], dollars="today", **args)["fire"]
    nominal = _project([fund], dollars="future", **args)["fire"]
    months = real["months_to_target"]
    assert months == nominal["months_to_target"]
    assert real["reached_on"] == nominal["reached_on"]

    def target(m):
        with localcontext() as context:
            context.prec = 34
            return (48000 * _price("3", m) + 12000) / Decimal("0.04")

    assert _future_value("100000", "2000", "7", months) >= target(months)
    assert _future_value("100000", "2000", "7", months - 1) < target(months - 1)
    # Later than without inflation, and the steady mortgage brings it closer.
    flat = _project([fund], annual_spending=Decimal("60000.00"))["fire"]
    rising = _project(
        [fund], **{**args, "steady_spending": Decimal("0")}, dollars="today"
    )["fire"]
    assert flat["months_to_target"] < months < rising["months_to_target"]
    assert nominal["target"] == str(p.needed(target(months)))
    with localcontext() as context:
        context.prec = 34
        today_target = (48000 + 12000 / _price("3", months)) / Decimal("0.04")
    assert real["target"] == str(p.needed(today_target))
    assert real["target_today"] == "1500000.00"
    assert real["steady_spending"] == "12000.00"


def test_zero_inflation_reads_the_same_in_either_dollars():
    fund = _investment("fund", "5000.00", "6", "100.00")
    args = dict(annual_spending=Decimal("40000"), inflation_percent=Decimal("0"))
    real = _project([fund], dollars="today", **args)
    nominal = _project([fund], dollars="future", **args)
    assert {**real, "dollars": "future"} == nominal


def test_inflation_range():
    assert p.inflation_rate("3") == Decimal("3.00")
    assert p.inflation_rate("0") == Decimal("0.00")
    for bad in ("-0.5", "15.01", "3.001", "x"):
        with pytest.raises(ValueError):
            p.inflation_rate(bad)
