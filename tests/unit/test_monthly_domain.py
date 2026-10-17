from decimal import Decimal

import pytest

from accanto.domains.monthly import money, monthly_actuals, plan_results


def test_exact_money_and_overallocated_plan():
    assert money("100.01") == Decimal("100.01")
    for invalid in ["1.001", "NaN", "1e2", "1000000000", "-0.01"]:
        with pytest.raises(ValueError):
            money(invalid)
    assert plan_results([money("4000"), money("1000")], money("5300")) == {
        "income": "5000.00",
        "spending": "5300.00",
        "tithe_target": "500.00",
        "unassigned": "-300.00",
    }
    assert plan_results([money("10.05")], money("0"))["tithe_target"] == "1.00"
    assert plan_results([money("10.15")], money("0"))["tithe_target"] == "1.02"


def test_unknown_zero_and_unplanned_income_are_distinct():
    actual = monthly_actuals(["salary", "bonus"], [("salary", money("4000"))], [])
    assert actual["income_recorded"] == "4000.00"
    assert actual["income_incomplete"] is True
    assert actual["spending_recorded"] is None
    actual = monthly_actuals(
        ["salary", "bonus"],
        [("salary", money("4000")), ("bonus", money("0")), (None, money("100"))],
        [money("0")],
    )
    assert actual["income_recorded"] == "4100.00"
    assert actual["income_incomplete"] is False
    assert actual["spending_recorded"] == "0.00"
