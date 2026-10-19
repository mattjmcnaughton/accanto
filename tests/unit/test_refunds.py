"""Independently worked purchase/refund-set rules."""

from datetime import date
from decimal import Decimal

import pytest

from accanto.domains.refunds import (
    Refund,
    require_purchase_change_allowed,
    validate_refunds,
)

OCTOBER = date(2026, 10, 10)
NOVEMBER = date(2026, 11, 4)


def test_partial_and_full_refunds_replace_existing_amount():
    first = Refund(Decimal("300.00"), NOVEMBER)
    assert validate_refunds(Decimal("1000.00"), OCTOBER, [first]) == Decimal("700.00")
    assert validate_refunds(
        Decimal("1000.00"), OCTOBER, [first, Refund(Decimal("700.00"), NOVEMBER)]
    ) == Decimal("0.00")
    with pytest.raises(ValueError, match="exceed"):
        validate_refunds(
            Decimal("1000.00"),
            OCTOBER,
            [first, Refund(Decimal("701.00"), NOVEMBER)],
        )
    # Editing the first refund replaces it in the proposed set.
    assert validate_refunds(
        Decimal("1000.00"),
        OCTOBER,
        [Refund(Decimal("200.00"), NOVEMBER), Refund(Decimal("700.00"), NOVEMBER)],
    ) == Decimal("100.00")


def test_purchase_date_amount_origin_and_deletion_guards():
    refund = Refund(Decimal("300.00"), NOVEMBER)
    with pytest.raises(ValueError, match="precede"):
        validate_refunds(Decimal("1000.00"), date(2026, 11, 5), [refund])
    with pytest.raises(ValueError, match="exceed"):
        validate_refunds(Decimal("299.00"), OCTOBER, [refund])
    with pytest.raises(ValueError, match="funding origin"):
        require_purchase_change_allowed(
            has_refunds=True, deleting=False, origin_changed=True
        )
    with pytest.raises(ValueError, match="Delete linked refunds"):
        require_purchase_change_allowed(
            has_refunds=True, deleting=True, origin_changed=False
        )
