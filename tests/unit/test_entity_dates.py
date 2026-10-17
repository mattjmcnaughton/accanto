"""Independent calendar-boundary examples; financial dates are not timestamps."""

from datetime import UTC, date, datetime

import pytest

from accanto.domains.entity import entity_settings, entity_today, valid_time_zone


def test_same_instant_has_different_entity_dates():
    instant = datetime(2026, 11, 1, 0, 30, tzinfo=UTC)
    assert entity_today(instant, "America/Los_Angeles") == date(2026, 10, 31)
    assert entity_today(instant, "Pacific/Kiritimati") == date(2026, 11, 1)


def test_dst_changes_clock_without_reinterpreting_financial_date():
    assert entity_today(
        datetime(2026, 3, 8, 9, 59, tzinfo=UTC), "America/Los_Angeles"
    ) == date(2026, 3, 8)
    assert entity_today(
        datetime(2026, 3, 8, 10, 1, tzinfo=UTC), "America/Los_Angeles"
    ) == date(2026, 3, 8)
    with pytest.raises(ValueError):
        entity_today(datetime(2026, 3, 8), "UTC")


@pytest.mark.parametrize(
    "zone",
    [
        "",
        "Mars/Olympus",
        "/etc/passwd",
        "../UTC",
        "localtime",
        "posixrules",
        "right/UTC",
        "posix/UTC",
    ],
)
def test_invalid_zone_never_falls_back_to_utc(zone):
    with pytest.raises(ValueError, match="IANA"):
        valid_time_zone(zone)


@pytest.mark.parametrize("name", ["", "   ", "x" * 121])
def test_name_rule_applies_without_http_validation(name):
    with pytest.raises(ValueError):
        entity_settings(name, "UTC")
