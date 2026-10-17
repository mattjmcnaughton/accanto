"""Entity names and calendar defaults, independent of persistence and HTTP."""

from datetime import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


def valid_time_zone(value: str) -> str:
    if (
        not isinstance(value, str)
        or value in {"localtime", "posixrules"}
        or value.startswith(("posix/", "right/"))
    ):
        raise ValueError("Choose a valid IANA time zone.")
    try:
        ZoneInfo(value)
    except (ValueError, ZoneInfoNotFoundError):
        raise ValueError("Choose a valid IANA time zone.") from None
    return value


def entity_settings(name: str, time_zone: str) -> dict[str, str]:
    if not isinstance(name, str) or not 1 <= len(name.strip()) <= 120:
        raise ValueError("Entity name must contain 1 to 120 characters.")
    return {"name": name.strip(), "time_zone": valid_time_zone(time_zone)}


def entity_today(instant: datetime, time_zone: str):
    if instant.tzinfo is None or instant.utcoffset() is None:
        raise ValueError("A timezone-aware instant is required.")
    return instant.astimezone(ZoneInfo(valid_time_zone(time_zone))).date()
