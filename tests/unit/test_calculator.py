"""The agents' exact decimal calculator (TDD 07)."""

from decimal import Decimal

import pytest

from accanto.domains.calculator import calculate, cents


@pytest.mark.parametrize(
    ("expression", "expected"),
    [
        ("0.1 + 0.2", "0.3"),  # a float would give 0.30000000000000004
        ("1000.10 * 3 - 0.30", "3000.00"),
        ("(84.30 - 12) * 40 / 100", "28.92"),
        ("2 ** 10 - 2 ^ 3", "1016"),
        ("-2 ** 2", "-4"),
        ("max(12.50, 3, 7.25) - min(4, 1.5)", "11.00"),
        ("1_234.56 + 0.44", "1235.00"),
        ("1e3 / 8", "125"),
    ],
)
def test_arithmetic_is_exact(expression, expected):
    assert calculate(expression) == Decimal(expected)


def test_rounding_is_half_even():
    assert calculate("round(2.665, 2)") == Decimal("2.66")
    assert calculate("round(2.675)") == Decimal("2.68")
    assert calculate("round(12.5, 0)") == Decimal("12")
    assert cents(calculate("0.125 + 0.25")) == Decimal("0.38")
    assert cents(calculate("10 / 3")) == Decimal("3.33")


def test_a_mortgage_payment_formula_matches_the_published_value():
    # $100,000 at 6% for 30 years pays $599.55 a month.
    payment = calculate("100000 * 0.005 / (1 - (1 + 0.005) ** -360)")
    assert cents(payment) == Decimal("599.55")
    assert cents(calculate("(1 + 0.07) ** (1 / 12)")) == Decimal("1.01")


@pytest.mark.parametrize(
    "expression",
    [
        "__import__('os').system('true')",
        "(1).__class__",
        "open('/etc/passwd')",
        "x + 1",
        "null + 5",
        "True + 1",
        "'1' + '2'",
        "1 if 1 else 2",
        "[1, 2]",
        "5 % 3",
        "15%",
        "$12.50",
        "1,234.56",
        "1 < 2",
        "lambda: 1",
        "1j",
        "",
    ],
)
def test_anything_but_arithmetic_is_refused(expression):
    with pytest.raises(ValueError):
        calculate(expression)


@pytest.mark.parametrize(
    "expression",
    [
        "9 ** 9 ** 9",
        "2 ** 1201",
        "10 ** 31",
        "1" + " + 1" * 300,
        "1" * 2001,
        f"sum({', '.join(['1'] * 201)})",
    ],
)
def test_work_and_size_are_bounded(expression):
    with pytest.raises(ValueError):
        calculate(expression)


def test_long_sums_are_allowed():
    assert calculate(" + ".join(["2.50"] * 120)) == Decimal("300.00")
    assert calculate(f"sum({', '.join(['0.01'] * 200)})") == Decimal("2.00")


def test_errors_never_repeat_the_figures():
    for expression in ["4821.37 / 0", "4821.37 + secret", "(-4821.37) ** 0.5"]:
        with pytest.raises(ValueError) as error:
            calculate(expression)
        assert "4821" not in str(error.value)
