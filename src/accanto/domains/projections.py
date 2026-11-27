"""Projections from explicit assumptions (TDD 09): loans, growth and FIRE.

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


# Entity projections (TDD 14): net worth and FIRE from each investment's
# expected return and contribution. Inflation (TDD 17): future dollars are
# nominal; today's dollars divide an amount m months out by inflation_factor.

MILESTONES = (5, 10, 20)
INFLATION_RANGE = (Decimal("0"), Decimal("15"))
DOLLARS = ("today", "future")
RETURN_RANGE = (Decimal("-10"), Decimal("30"))
WITHDRAWAL_RANGE = (Decimal("0"), Decimal("10"))
DEBT_RATE_RANGE = (Decimal("0"), Decimal("40"))


def percent(value: str, low: Decimal, high: Decimal, *, low_open=False) -> Decimal:
    """An annual percent with up to two decimals, within its range."""
    try:
        result = Decimal(str(value).strip())
    except ArithmeticError:
        raise ValueError("Enter a percent with up to two decimals.") from None
    if not result.is_finite() or result != result.quantize(CENT):
        raise ValueError("Enter a percent with up to two decimals.")
    if result > high or result < low or (low_open and result == low):
        raise ValueError(f"Enter a percent from {low} to {high}.")
    return result.quantize(CENT)


def expected_return(value: str) -> Decimal:
    return percent(value, *RETURN_RANGE)


def withdrawal_rate(value: str) -> Decimal:
    return percent(value, *WITHDRAWAL_RANGE, low_open=True)


def inflation_rate(value: str) -> Decimal:
    """Average annual inflation, a percent from 0 to 15 (TDD 17)."""
    return percent(value, *INFLATION_RANGE)


def inflation_factor(inflation_percent: Decimal, months: int) -> Decimal:
    """(1 + I)^(months / 12): what a dollar of today costs months from now.

    Prices compound at the same effective monthly rate as growth does.
    """
    with localcontext() as context:
        context.prec = PRECISION
        return (1 + Decimal(inflation_percent) / 100) ** (Decimal(months) / 12)


def steady_part(annual_spending: Decimal, steady_spending: Decimal) -> Decimal:
    """The level part of annual spending: costs fixed in dollars, at most all of it."""
    return min(max(steady_spending, ZERO), annual_spending)


def fire_target_at(
    annual_spending: Decimal,
    steady_spending: Decimal,
    withdrawal_percent: Decimal,
    inflation_percent: Decimal,
    months: int,
) -> Decimal:
    """The FIRE target months from now, in that date's (nominal) dollars.

    annual_spending is in today's dollars. The steady part (the year's planned
    fixed costs that do not rise with inflation, such as a fixed-rate mortgage
    payment) stays level; the rest rises with inflation. The target is that
    spending ÷ the withdrawal rate, rounded up as fire_target is. At zero
    inflation or zero months it equals fire_target(annual_spending, ...).
    """
    steady = steady_part(annual_spending, steady_spending)
    with localcontext() as context:
        context.prec = PRECISION
        spending = (annual_spending - steady) * inflation_factor(
            inflation_percent, months
        ) + steady
    return fire_target(spending, withdrawal_percent)


def debt_rate(value: str) -> Decimal:
    """A Debt account's fixed annual interest rate (TDD 15)."""
    return percent(value, *DEBT_RATE_RANGE)


# Payoff schedules (TDD 15): a Debt account at a fixed annual rate, paid a level
# monthly payment from its latest recorded balance. Interest rounds half-even to
# cents each month as in amortize; the last payment clears the balance exactly.


def debt_status(
    balance: Decimal, annual_percent: Decimal | None, payment: Decimal | None
) -> str | None:
    """Why a debt has no schedule, or None when it amortizes."""
    if balance <= 0:
        return "paid_off"
    if annual_percent is None or payment is None:
        return "no_terms"
    if payment <= cents(balance * monthly_loan_rate(annual_percent)):
        return "interest_not_covered"
    return None


def _payoff_rows(
    balance: Decimal, annual_percent: Decimal, payment: Decimal, limit: int
) -> list[dict]:
    """Months of payments until repaid or limit months; the payment covers interest."""
    rate = monthly_loan_rate(annual_percent)
    rows = []
    while balance > 0 and len(rows) < limit:
        interest = cents(balance * rate)
        paid = min(payment, balance + interest)
        balance = balance + interest - paid
        rows.append(
            {
                "month": len(rows) + 1,
                "payment": paid,
                "interest": interest,
                "principal": paid - interest,
                "balance": balance,
            }
        )
    return rows


def payoff_schedule(
    balance: Decimal,
    as_of,
    annual_percent: Decimal | None,
    payment: Decimal | None,
) -> dict:
    """The schedule from a latest recorded balance, its payoff date and interest.

    The first payment falls one month after the balance's date. Status is
    scheduled, or why there is no schedule: paid_off, no_terms (no rate or no
    payment), interest_not_covered (the payment does not exceed the first
    month's interest, so the balance never falls) or beyond_limit (not repaid
    within 100 years). Only a scheduled debt has rows and totals.
    """
    status = debt_status(balance, annual_percent, payment)
    rows = []
    if status is None:
        assert annual_percent is not None and payment is not None
        rows = _payoff_rows(balance, annual_percent, payment, MAX_MONTHS)
        status = "scheduled" if rows[-1]["balance"] == 0 else "beyond_limit"
        if status != "scheduled":
            rows = []
    interest = sum((r["interest"] for r in rows), ZERO)
    return {
        "status": status,
        "as_of": as_of.isoformat(),
        "balance": str(balance),
        "interest_rate_percent": None
        if annual_percent is None
        else str(annual_percent),
        "monthly_payment": None if payment is None else str(payment),
        "monthly_interest": None
        if annual_percent is None
        else str(cents(balance * monthly_loan_rate(annual_percent))),
        "months": len(rows) if rows else None,
        "payoff_date": _add_months(as_of, len(rows)).isoformat() if rows else None,
        "total_interest": str(interest) if rows else None,
        "total_paid": str(balance + interest) if rows else None,
        "rows": [
            {
                **{k: str(v) for k, v in r.items() if k != "month"},
                "month": r["month"],
                "date": _add_months(as_of, r["month"]).isoformat(),
            }
            for r in rows
        ],
    }


def payoff_summary(schedule: dict) -> dict:
    return {k: v for k, v in schedule.items() if k != "rows"}


def _add_months(day, months: int):
    import calendar

    year, month = divmod(day.month - 1 + months, 12)
    year += day.year
    return day.replace(
        year=year,
        month=month + 1,
        day=min(day.day, calendar.monthrange(year, month + 1)[1]),
    )


def project_entity(
    investments: list[dict],
    *,
    savings: Decimal,
    loans: list[dict],
    today,
    years: int,
    default_return: Decimal,
    annual_spending: Decimal | None = None,
    withdrawal_percent: Decimal = Decimal("4.00"),
    inflation_percent: Decimal = ZERO,
    steady_spending: Decimal = ZERO,
    dollars: str = "future",
) -> dict:
    """Projected investments and net worth by year, milestones and FIRE.

    Each investment dict has id, name, active, latest ({date, amount} or None),
    expected_return_percent, expected_contribution and
    expected_contribution_frequency. From today, each observed investment
    compounds monthly at its own expected return, or default_return without
    one, plus its expected contribution at each month's end (an annual amount
    is a twelfth each month; inactive investments take no new contributions).
    Savings stay at today's amount. Each loan dict has id, name, active, latest
    ({date, amount}), interest_rate_percent and monthly_payment: from today, a
    loan with both terms whose payment covers its interest is paid down month by
    month (TDD 15); any other loan stays at its latest amount. Payments are not
    taken from investment contributions, which are entered net of the budget
    that pays them, and a repaid loan's payment is not invested. An active
    investment without an observed value makes every total unknown (None):
    unknown is never projected from zero.

    Inflation (TDD 17): the projection runs in nominal dollars. With dollars
    "today", every reported amount m months out is divided by
    inflation_factor(inflation_percent, m); contributions so reported are each
    deflated at their own month. Contributions stay level in nominal dollars.
    The FIRE target rises with inflation except steady_spending (fire_target_at),
    and the FIRE date, the first month nominal investments reach the nominal
    target, is the same in either dollars.
    """
    if not 1 <= years <= 100:
        raise ValueError("Projections cover 1 to 100 years.")
    if dollars not in DOLLARS:
        raise ValueError("Dollars are today or future.")
    span = max(years, *MILESTONES) * 12
    fire = annual_spending is not None
    if fire:
        span = MAX_MONTHS
    today_dollars = dollars == "today"
    factors = [
        inflation_factor(inflation_percent, m) if today_dollars else Decimal(1)
        for m in range(span + 1)
    ]

    def show(value: Decimal, month: int) -> Decimal:
        """An amount month months out, in the requested dollars, at full precision."""
        if not today_dollars:
            return value
        with localcontext() as context:
            context.prec = PRECISION
            return value / factors[month]

    with localcontext() as context:
        context.prec = PRECISION
        # Sum of 1 / factor over months 1..m: a level monthly amount, deflated.
        deflated_months = [Decimal(0)]
        for m in range(1, span + 1):
            deflated_months.append(deflated_months[-1] + 1 / factors[m])
    lines, series = [], []
    for inv in investments:
        own = inv["expected_return_percent"]
        rate_percent = default_return if own is None else Decimal(own)
        entered = inv["expected_contribution"]
        frequency = inv["expected_contribution_frequency"]
        monthly = ZERO
        if entered is not None and inv["active"]:
            monthly = (
                Decimal(entered) / 12 if frequency == "annual" else Decimal(entered)
            )
        balances = None
        if inv["latest"] is not None:
            balances = grow(
                Decimal(inv["latest"]["amount"]),
                monthly,
                rate_percent,
                months=span,
            )["balances"]
            balances = [Decimal(inv["latest"]["amount"]), *balances]
            series.append((balances, monthly))
        lines.append(
            {
                "investment_id": inv["id"],
                "name": inv["name"],
                "status": "projected" if balances is not None else "no_value",
                "latest": inv["latest"],
                "expected_return_percent": own,
                "return_percent": str(rate_percent.quantize(CENT)),
                "return_source": "default" if own is None else "investment",
                "expected_contribution": entered,
                "expected_contribution_frequency": frequency,
                "monthly_contribution": str(cents(monthly)),
                "milestones": [
                    {
                        "years": y,
                        "amount": None
                        if balances is None
                        else str(cents(show(balances[y * 12], y * 12))),
                    }
                    for y in MILESTONES
                ],
            }
        )
    known = all(
        line["status"] == "projected"
        for line, inv in zip(lines, investments, strict=True)
        if inv["active"]
    )

    loan_lines, owed_by_month = [], [ZERO] * (span + 1)
    for loan in loans:
        amount = Decimal(loan["latest"]["amount"])
        rate = loan["interest_rate_percent"]
        payment = loan["monthly_payment"]
        rate = None if rate is None else Decimal(rate)
        payment = None if payment is None else Decimal(payment)
        status = debt_status(amount, rate, payment)
        owed = [amount] * (span + 1)
        paid_in = None
        if status is None:
            assert rate is not None and payment is not None
            rows = _payoff_rows(amount, rate, payment, span)
            owed = [amount, *(r["balance"] for r in rows)]
            owed += [ZERO] * (span + 1 - len(owed))
            status = "amortizing"
            if rows[-1]["balance"] == 0:
                paid_in = len(rows)
        for month, value in enumerate(owed):
            owed_by_month[month] += value
        loan_lines.append(
            {
                "debt_id": loan["id"],
                "name": loan["name"],
                "active": loan["active"],
                "status": status,
                "latest": loan["latest"],
                "interest_rate_percent": loan["interest_rate_percent"],
                "monthly_payment": loan["monthly_payment"],
                "payoff_date": None
                if paid_in is None
                else _add_months(today, paid_in).isoformat(),
                "milestones": [
                    {"years": y, "amount": str(cents(show(owed[y * 12], y * 12)))}
                    for y in MILESTONES
                ],
            }
        )

    def invested(month: int) -> Decimal:
        with localcontext() as context:
            context.prec = PRECISION
            return sum((b[month] for b, _ in series), Decimal(0))

    monthly_total = sum((m for _, m in series), ZERO)
    steady = ZERO if not fire else steady_part(annual_spending, steady_spending)

    def target_at(month: int) -> Decimal:
        assert annual_spending is not None
        return fire_target_at(
            annual_spending, steady, withdrawal_percent, inflation_percent, month
        )

    def shown_target(month: int) -> Decimal:
        """The target month months out in the requested dollars, rounded up."""
        if not today_dollars:
            return target_at(month)
        assert annual_spending is not None
        with localcontext() as context:
            context.prec = PRECISION
            spending = annual_spending - steady + steady / factors[month]
        return fire_target(spending, withdrawal_percent)

    def row(y: int) -> dict:
        month = y * 12
        total = invested(month)
        owed = owed_by_month[month]
        with localcontext() as context:
            context.prec = PRECISION
            contributed = monthly_total * (
                deflated_months[month] if today_dollars else month
            )
        return {
            "years": y,
            "date": _add_months(today, month).isoformat(),
            "investments": str(cents(show(total, month))) if known else None,
            "loans": str(cents(show(owed, month))),
            "net_worth": str(cents(show(total + savings - owed, month)))
            if known
            else None,
            "contributed": str(cents(contributed)),
            "fire_target": str(shown_target(month)) if fire else None,
        }

    result = {
        "as_of": today.isoformat(),
        "dollars": dollars,
        "inflation_percent": str(Decimal(inflation_percent).quantize(CENT)),
        "default_return_percent": str(default_return.quantize(CENT)),
        "today": {
            "investments": str(cents(invested(0))) if known else None,
            "savings": str(savings),
            "loans": str(owed_by_month[0]),
            "net_worth": str(cents(invested(0) + savings - owed_by_month[0]))
            if known
            else None,
        },
        "timeline": [row(y) for y in range(years + 1)],
        "milestones": [row(y) for y in MILESTONES],
        "investments": lines,
        "loans": loan_lines,
        "fire": None,
    }
    if fire:
        reached = (
            next((m for m in range(span + 1) if invested(m) >= target_at(m)), None)
            if known
            else None
        )
        result["fire"] = {
            "annual_spending": str(annual_spending),
            "steady_spending": str(steady),
            "withdrawal_percent": str(withdrawal_percent),
            "target_today": str(fire_target(annual_spending, withdrawal_percent)),
            "target": None if reached is None else str(shown_target(reached)),
            "months_to_target": reached,
            "reached_on": None
            if reached is None
            else _add_months(today, reached).isoformat(),
        }
    return result
