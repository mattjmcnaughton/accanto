"""Projections from explicit assumptions (TDD 07): loans, growth and FIRE.

A Projection is an illustrative result, never activity or an observation
(CONTEXT.md). Rates are annual percents. Loan interest is rounded half-even to
cents each month, as a statement does, and the final payment clears the balance
exactly. Growth carries full precision month to month and rounds only reported
amounts, half-even. The exception is an amount needed to reach a target (FIRE
target, coast amount, required contribution): it rounds up to the cent, so
following it reaches the target. Growth compounds monthly at the effective
rate (1 + R)^(1/12) - 1 with contributions at each month's end.
"""

from decimal import ROUND_CEILING, ROUND_HALF_EVEN, Decimal, localcontext

ZERO = Decimal("0.00")
CENT = Decimal("0.01")
MAX_MONTHS = 1200
PRECISION = 34


def cents(value: Decimal) -> Decimal:
    return value.quantize(CENT, rounding=ROUND_HALF_EVEN)


def needed(value: Decimal) -> Decimal:
    """An amount required to reach something rounds up, so it suffices."""
    return value.quantize(CENT, rounding=ROUND_CEILING)


def monthly_loan_rate(annual_percent: Decimal) -> Decimal:
    return annual_percent / 100 / 12


def monthly_growth_rate(annual_percent: Decimal) -> Decimal:
    with localcontext() as context:
        context.prec = PRECISION
        return (1 + annual_percent / 100) ** (Decimal(1) / 12) - 1


def loan_payment(principal: Decimal, annual_percent: Decimal, months: int) -> Decimal:
    """The level monthly payment that repays principal over months."""
    if not 1 <= months <= MAX_MONTHS:
        raise ValueError(f"A loan term is 1 to {MAX_MONTHS} months.")
    rate = monthly_loan_rate(annual_percent)
    with localcontext() as context:
        context.prec = PRECISION
        if rate == 0:
            return cents(principal / months)
        growth = (1 + rate) ** months
        return cents(principal * rate * growth / (growth - 1))


def amortize(
    principal: Decimal,
    annual_percent: Decimal,
    *,
    months: int | None = None,
    payment: Decimal | None = None,
    extra: Decimal = ZERO,
) -> dict:
    """Month-by-month schedule from a term or a payment, with an optional extra.

    With a term, the last scheduled payment also clears the cents left by
    rounding the level payment, so the loan ends on time.
    """
    if months is None and payment is None:
        raise ValueError("Give the term in months or the monthly payment.")
    if payment is None:
        payment = loan_payment(principal, annual_percent, months or 0)
    rate = monthly_loan_rate(annual_percent)
    balance, rows, interest_total = principal, [], ZERO
    while balance > 0:
        if len(rows) == MAX_MONTHS:
            raise ValueError(f"The loan is not repaid within {MAX_MONTHS} months.")
        interest = cents(balance * rate)
        due = payment + extra
        if due <= interest:
            raise ValueError("The payment does not cover the monthly interest.")
        last = months is not None and len(rows) + 1 == months
        paid = balance + interest if last else min(due, balance + interest)
        balance = balance + interest - paid
        interest_total += interest
        rows.append(
            {
                "month": len(rows) + 1,
                "payment": paid,
                "interest": interest,
                "principal": paid - interest,
                "balance": balance,
            }
        )
    return {
        "payment": payment,
        "months": len(rows),
        "total_interest": interest_total,
        "total_paid": principal + interest_total,
        "rows": rows,
    }


def compare_extra(
    principal: Decimal,
    annual_percent: Decimal,
    *,
    months: int | None = None,
    payment: Decimal | None = None,
    extra: Decimal = ZERO,
) -> dict:
    """The schedule with the extra payment, and what it saves against none."""
    base = amortize(principal, annual_percent, months=months, payment=payment)
    if not extra:
        return {**base, "interest_saved": ZERO, "months_saved": 0}
    faster = amortize(
        principal, annual_percent, months=months, payment=base["payment"], extra=extra
    )
    return {
        **faster,
        "interest_saved": base["total_interest"] - faster["total_interest"],
        "months_saved": base["months"] - faster["months"],
    }


def fire_target(annual_spending: Decimal, withdrawal_percent: Decimal) -> Decimal:
    """Assets needed to support annual spending at the withdrawal rate."""
    if not 0 < withdrawal_percent <= 100:
        raise ValueError("The withdrawal rate is a percent above 0 and up to 100.")
    with localcontext() as context:
        context.prec = PRECISION
        return needed(annual_spending / (withdrawal_percent / 100))


def grow(
    start: Decimal,
    monthly_contribution: Decimal,
    annual_percent: Decimal,
    *,
    months: int | None = None,
    target: Decimal | None = None,
) -> dict:
    """Balances month by month, until months pass or target is reached."""
    if months is None and target is None:
        raise ValueError("Give a number of months, a target, or both.")
    if months is not None and not 1 <= months <= MAX_MONTHS:
        raise ValueError(f"Projections cover 1 to {MAX_MONTHS} months.")
    limit = months or MAX_MONTHS
    rate = monthly_growth_rate(annual_percent)
    balance, balances, reached = start, [], None
    if target is not None and start >= target:
        reached = 0
    with localcontext() as context:
        context.prec = PRECISION
        for month in range(1, limit + 1):
            balance = balance * (1 + rate) + monthly_contribution
            balances.append(balance)
            if reached is None and target is not None and balance >= target:
                reached = month
                if months is None:
                    break
    contributed = monthly_contribution * len(balances)
    final = balances[-1] if balances else start
    return {
        "monthly_rate": rate,
        "balances": balances,
        "final": final,
        "contributed": contributed,
        "growth": final - start - contributed,
        "months_to_target": reached,
    }


def coast_amount(target: Decimal, annual_percent: Decimal, months: int) -> Decimal:
    """Assets needed now to reach target in months with no more contributions."""
    if not 1 <= months <= MAX_MONTHS:
        raise ValueError(f"Projections cover 1 to {MAX_MONTHS} months.")
    with localcontext() as context:
        context.prec = PRECISION
        return needed(target / (1 + monthly_growth_rate(annual_percent)) ** months)


def required_contribution(
    start: Decimal, target: Decimal, annual_percent: Decimal, months: int
) -> Decimal:
    """Level monthly contribution that reaches target in months (zero if none)."""
    if not 1 <= months <= MAX_MONTHS:
        raise ValueError(f"Projections cover 1 to {MAX_MONTHS} months.")
    rate = monthly_growth_rate(annual_percent)
    with localcontext() as context:
        context.prec = PRECISION
        growth = (1 + rate) ** months
        shortfall = target - start * growth
        if shortfall <= 0:
            return ZERO
        if rate == 0:
            return needed(shortfall / months)
        return needed(shortfall * rate / (growth - 1))


def months_to_target(remaining: Decimal, monthly_amount: Decimal) -> int:
    """Whole months of a level amount, without growth, to cover remaining."""
    if monthly_amount <= 0:
        raise ValueError("The monthly amount must be above zero.")
    if remaining <= 0:
        return 0
    months = int((remaining / monthly_amount).to_integral_value(ROUND_CEILING))
    if months > MAX_MONTHS:
        raise ValueError(f"The target is not reached within {MAX_MONTHS} months.")
    return months


def prepay_or_invest(
    principal: Decimal,
    loan_percent: Decimal,
    extra: Decimal,
    return_percent: Decimal,
    horizon: int,
    *,
    months: int | None = None,
    payment: Decimal | None = None,
) -> dict:
    """The same monthly budget two ways, compared at the horizon.

    Prepay adds extra to the loan; invest puts extra in investments. In both,
    once the loan is repaid its whole payment budget is invested monthly.
    Net position at the horizon is investments less the loan balance.
    """
    if not 1 <= horizon <= MAX_MONTHS:
        raise ValueError(f"The horizon is 1 to {MAX_MONTHS} months.")
    base = amortize(principal, loan_percent, months=months, payment=payment)
    budget = base["payment"] + extra
    rate = monthly_growth_rate(return_percent)

    def scenario(loan_extra: Decimal, invested: Decimal) -> dict:
        rows = amortize(
            principal,
            loan_percent,
            months=months,
            payment=base["payment"],
            extra=loan_extra,
        )["rows"]
        assets = ZERO
        with localcontext() as context:
            context.prec = PRECISION
            for month in range(1, horizon + 1):
                contribution = invested if month <= len(rows) else budget
                if month == len(rows):  # the final payment may be smaller
                    contribution += budget - rows[-1]["payment"] - invested
                assets = assets * (1 + rate) + contribution
        balance = rows[horizon - 1]["balance"] if horizon <= len(rows) else ZERO
        return {
            "payoff_months": len(rows),
            "investments": cents(assets),
            "loan_balance": balance,
            "net_position": cents(assets) - balance,
        }

    prepay = scenario(extra, ZERO)
    invest = scenario(ZERO, extra)
    return {
        "payment": base["payment"],
        "prepay": prepay,
        "invest": invest,
        "difference": invest["net_position"] - prepay["net_position"],
    }
