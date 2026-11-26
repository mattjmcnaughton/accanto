"""Exact decimal arithmetic for agents (TDD 07): an allowlisted expression evaluator.

Numbers are read from the expression's own text into Decimal, never through a
float. Only arithmetic and a few functions are allowed; there are no names,
attributes, strings or statements. Length, nesting and exponent caps bound the
work one expression can ask for. Error messages never repeat the expression.
"""

import ast
from collections.abc import Callable
from decimal import (
    ROUND_HALF_EVEN,
    Context,
    Decimal,
    DecimalException,
    localcontext,
)

MAX_LENGTH = 2000
MAX_DEPTH = 250  # a left-to-right sum of 200 numbers nests 200 deep
MAX_EXPONENT = 1200  # monthly compounding over 100 years
CENT = Decimal("0.01")
# 34 significant digits; results beyond ±10^30 overflow instead of growing.
CONTEXT = Context(prec=34, rounding=ROUND_HALF_EVEN, Emax=30, Emin=-30)
ALLOWED = "Use numbers, + - * / ** ( ) and abs, min, max, round, sqrt, sum."


def _round(value: Decimal, places: Decimal = Decimal(2)) -> Decimal:
    if places != places.to_integral_value() or not 0 <= places <= 10:
        raise ValueError("round takes 0 to 10 decimal places.")
    return value.quantize(Decimal(1).scaleb(-int(places)), rounding=ROUND_HALF_EVEN)


def _sqrt(value: Decimal) -> Decimal:
    if value < 0:
        raise ValueError("sqrt needs a value of zero or more.")
    return value.sqrt()


FUNCTIONS = {
    "abs": (abs, 1, 1),
    "min": (min, 1, 200),
    "max": (max, 1, 200),
    "sum": (lambda *values: sum(values, Decimal(0)), 1, 200),
    "round": (_round, 1, 2),
    "sqrt": (_sqrt, 1, 1),
}


def _power(base: Decimal, exponent: Decimal) -> Decimal:
    if abs(exponent) > MAX_EXPONENT:
        raise ValueError(f"Exponents are limited to ±{MAX_EXPONENT}.")
    integral = exponent == exponent.to_integral_value()
    if base < 0 and not integral:
        raise ValueError("A negative number has no real fractional power.")
    if base == 0 and exponent < 0:
        raise ValueError("Division by zero.")
    return base ** (exponent.to_integral_value() if integral else exponent)


OPERATORS: dict[type[ast.operator], Callable[[Decimal, Decimal], Decimal]] = {
    ast.Add: lambda a, b: a + b,
    ast.Sub: lambda a, b: a - b,
    ast.Mult: lambda a, b: a * b,
    ast.Div: lambda a, b: a / b,
    ast.Pow: _power,
}


def calculate(expression: str) -> Decimal:
    """The exact value of expression, at 34 significant digits, half-even."""
    # People and speech-to-text write ^ for powers. Rewriting it before parsing
    # keeps power precedence; Python's ^ binds more loosely than -.
    text = (
        expression.strip()
        .replace("×", "*")
        .replace("÷", "/")
        .replace("−", "-")
        .replace("^", "**")
    )
    if not text:
        raise ValueError("Write an expression to calculate.")
    if len(text) > MAX_LENGTH:
        raise ValueError(f"Expressions are limited to {MAX_LENGTH} characters.")
    try:
        tree = ast.parse(text, mode="eval")
    except SyntaxError:
        tree = None
    if tree is None or isinstance(tree.body, ast.Tuple) or "$" in text:
        raise ValueError(
            f"That is not a valid expression. {ALLOWED} Write numbers without $ "
            "or thousands separators, and percentages as a division by 100."
        )
    with localcontext(CONTEXT):
        try:
            # +x applies the context, so the result has at most 34 digits.
            return +_evaluate(tree.body, text, 0)
        except ZeroDivisionError:  # decimal's DivisionByZero and 0/0 included
            raise ValueError("Division by zero.") from None
        except DecimalException:
            raise ValueError("The result is too large or undefined.") from None


def _evaluate(node: ast.AST, text: str, depth: int) -> Decimal:
    if depth > MAX_DEPTH:
        raise ValueError(f"Expressions are limited to {MAX_DEPTH} levels of nesting.")
    if isinstance(node, ast.Constant):
        if type(node.value) not in (int, float):
            raise ValueError(ALLOWED)
        # The literal's own text, not the float Python parsed it into.
        literal = ast.get_source_segment(text, node) or ""
        return Decimal(literal.replace("_", ""))
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub | ast.UAdd):
        value = _evaluate(node.operand, text, depth + 1)
        return -value if isinstance(node.op, ast.USub) else +value
    if isinstance(node, ast.BinOp) and type(node.op) in OPERATORS:
        left = _evaluate(node.left, text, depth + 1)
        right = _evaluate(node.right, text, depth + 1)
        return OPERATORS[type(node.op)](left, right)
    if (
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id in FUNCTIONS
        and not node.keywords
    ):
        function, least, most = FUNCTIONS[node.func.id]
        if not least <= len(node.args) <= most:
            raise ValueError(f"{node.func.id} takes {least} to {most} values.")
        values = [_evaluate(arg, text, depth + 1) for arg in node.args]
        return function(*values)
    raise ValueError(ALLOWED)


def cents(value: Decimal) -> Decimal:
    """A monetary result: value rounded half-even to cents."""
    with localcontext(CONTEXT):
        return value.quantize(CENT, rounding=ROUND_HALF_EVEN)
