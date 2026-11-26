"""Position snapshot and balance changes (TDD 07), with hand-worked amounts."""

from datetime import date
from decimal import Decimal

from accanto.domains.position import account_line, net_position

TODAY = date(2026, 11, 26)


def obs(day, amount, opening=False):
    return {"financial_date": day, "amount": amount, "is_opening": opening}


def paid(day, amount):
    return {"financial_date": day, "amount": amount}


MORTGAGE = {"id": "m", "name": "Synthetic mortgage", "active": True}
LOAN_OBSERVATIONS = [
    obs("2026-01-01", "250000.00", opening=True),
    obs("2026-06-30", "246100.00"),
    obs("2026-10-31", "243500.00"),
]
PAYMENTS = [paid(d, "1500.00") for d in ("2026-07-01", "2026-08-01", "2026-09-01")]
PAYMENTS += [paid("2026-10-01", "1500.00"), paid("2026-11-01", "1500.00")]


def test_latest_observation_staleness_and_change_since_a_date():
    line = account_line(
        MORTGAGE,
        LOAN_OBSERVATIONS,
        PAYMENTS,
        today=TODAY,
        since=date(2026, 7, 15),
        stale_after_days=45,
    )
    assert line["balance"] == Decimal("243500.00")
    assert line["observed_on"] == date(2026, 10, 31)
    assert (line["days_old"], line["stale"]) == (26, False)
    change = line["change"]
    # Baseline is the last observation on or before July 15: June 30.
    assert change["from_date"] == date(2026, 6, 30)
    # 243,500 − 246,100: owed 2,600 less, while 4 payments of 1,500 (Jul to
    # Oct; Nov 1 is after the latest observation) recorded 6,000. Neither is
    # inferred from the other.
    assert change["balance_change"] == Decimal("-2600.00")
    assert change["recorded_total"] == Decimal("6000.00")
    assert change["recorded_entries"] == 4


def test_since_before_any_observation_starts_from_the_earliest():
    line = account_line(
        MORTGAGE,
        LOAN_OBSERVATIONS,
        [],
        today=TODAY,
        since=date(2025, 1, 1),
        stale_after_days=45,
    )
    assert line["change"]["from_balance"] == Decimal("250000.00")


def test_an_old_observation_is_stale_and_a_missing_one_is_unknown():
    old = account_line(
        MORTGAGE,
        LOAN_OBSERVATIONS[:2],
        [],
        today=TODAY,
        since=None,
        stale_after_days=45,
    )
    assert old["stale"] is True and old["change"] is None
    fund = {"id": "f", "name": "Synthetic fund", "active": True}
    unknown = account_line(fund, [], [], today=TODAY, since=None, stale_after_days=45)
    assert unknown["balance"] is None and unknown["stale"] is True


def test_net_position_is_unknown_when_an_active_balance_is():
    def line(balance, active=True):
        return {
            "balance": None if balance is None else Decimal(balance),
            "active": active,
        }

    savings = Decimal("12000.00")
    # 12,000 + 30,000 + 1,500 (inactive, still held) − 243,500 = −200,000.
    assert net_position(
        savings, [line("30000.00"), line("1500.00", active=False)], [line("243500.00")]
    ) == Decimal("-200000.00")
    assert net_position(savings, [line(None)], [line("243500.00")]) is None
    assert net_position(savings, [line(None, active=False)], []) == savings
