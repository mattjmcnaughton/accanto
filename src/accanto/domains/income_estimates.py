"""Pure monthly estimates from entered per-payment assumptions."""

from decimal import ROUND_HALF_EVEN, Decimal, localcontext

from accanto.domains.monthly import CENT, money

FACTORS = {"annual": 1, "monthly": 12, "twice_monthly": 24, "weekly": 52}
COLUMN_LIMIT = Decimal("999999999999.99")
MAX_STORED_DAYS = 2**63 - 1


def estimate(lines: list[dict]) -> dict:
    """Round each smoothed line to cents, then sum those cent-valued results."""
    if not 1 <= len(lines) <= 100:
        raise ValueError("An estimate needs between 1 and 100 income lines.")
    calculated = []
    with localcontext() as context:
        context.prec = 28
        for line in lines:
            gross = money(line["gross"])
            withholding = money(line["withholding"])
            payroll = money(line["payroll"])
            frequency = line["frequency"]
            paid_days = line.get("paid_days")
            if frequency == "daily":
                if type(paid_days) is not int or not 0 <= paid_days <= MAX_STORED_DAYS:
                    raise ValueError("Daily income needs entered paid days per year.")
                occurrences = paid_days
            elif frequency in FACTORS and paid_days is None:
                occurrences = FACTORS[frequency]
            else:
                raise ValueError("Select a supported frequency and paid days.")
            raw_monthly = (gross - withholding - payroll) * occurrences / 12
            # A valid count can make an enormous result; reject before quantize.
            if abs(raw_monthly) > COLUMN_LIMIT + CENT:
                raise ValueError("Monthly estimate exceeds the supported range.")
            monthly = raw_monthly.quantize(CENT, rounding=ROUND_HALF_EVEN)
            if abs(monthly) > COLUMN_LIMIT:
                raise ValueError("Monthly estimate exceeds the supported range.")
            calculated.append({**line, "monthly_net": str(monthly)})
        total = sum(
            (Decimal(line["monthly_net"]) for line in calculated), Decimal("0.00")
        )
        if abs(total) > COLUMN_LIMIT:
            raise ValueError("Combined estimate exceeds the supported range.")
    return {"lines": calculated, "monthly_total": str(total)}
