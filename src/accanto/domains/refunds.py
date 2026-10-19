"""Pure rules for a purchase and its current linked refunds."""

from dataclasses import dataclass
from datetime import date
from decimal import Decimal


@dataclass(frozen=True)
class Refund:
    amount: Decimal
    financial_date: date


class RefundCapError(ValueError):
    """The proposed live refunds exceed their purchase."""


def validate_refunds(
    purchase_amount: Decimal,
    purchase_date: date,
    refunds: list[Refund],
) -> Decimal:
    """Return remaining refundable after validating the whole proposed set."""
    if purchase_amount <= 0:
        raise ValueError("A refunded purchase must have a positive amount.")
    if any(refund.amount <= 0 for refund in refunds):
        raise ValueError("A refund must have a positive amount.")
    if any(refund.financial_date < purchase_date for refund in refunds):
        raise ValueError("A refund cannot precede its purchase.")
    remaining = purchase_amount - sum(
        (refund.amount for refund in refunds), Decimal("0.00")
    )
    if remaining < 0:
        raise RefundCapError(
            f"Refunds exceed the purchase by ${-remaining:.2f}; "
            "reduce or delete a linked refund first."
        )
    return remaining


def require_purchase_change_allowed(
    *, has_refunds: bool, deleting: bool, origin_changed: bool
) -> None:
    if deleting and has_refunds:
        raise ValueError("Delete linked refunds before deleting the purchase.")
    if origin_changed and has_refunds:
        raise ValueError("Delete linked refunds before changing funding origin.")
