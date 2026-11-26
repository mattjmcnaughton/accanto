"""Progress toward saving, investment and giving targets (TDD 07)."""

from decimal import ROUND_HALF_EVEN, Decimal

ZERO = Decimal("0.00")
CENT = Decimal("0.01")


def target_gap(target, progress) -> tuple[Decimal | None, Decimal | None]:
    """Remaining to a target (never below zero) and the percent of it reached."""
    if target is None or Decimal(target) <= 0:
        return None, None
    target, progress = Decimal(target), Decimal(progress)
    remaining = max(target - progress, ZERO).quantize(CENT)
    percent = (progress / target * 100).quantize(CENT, rounding=ROUND_HALF_EVEN)
    return remaining, percent
