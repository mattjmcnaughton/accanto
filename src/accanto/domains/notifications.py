"""Notifications (TDD 20): what is sent, when, and to which push services.

Pure rules, independent of HTTP, persistence and transport. A Notification's
text carries counts, Routine names, and Spending alert target names with their
thresholds (TDD 23) only: never an amount, payee, memo,
note, account or Entity name (Constitution §6 applies to the lock screen too).
"""

import re
from dataclasses import dataclass
from datetime import datetime
from typing import Literal
from urllib.parse import urlsplit

Kind = Literal[
    "routines_due",
    "scheduled_entries",
    "transactions_waiting",
    "spending_alerts",
    "test",
]
# The kinds the hourly tick sends, in the order it sends them.
KINDS: tuple[Kind, ...] = ("routines_due", "scheduled_entries", "transactions_waiting")
DEFAULT_HOUR = 9
DEFAULTS = {
    "hour": DEFAULT_HOUR,
    "routines_due": True,
    "scheduled_entries": True,
    "transactions_waiting": False,
    "spending_alerts": True,
}

PROVIDER_HOSTS = (
    "push.apple.com",
    "fcm.googleapis.com",
    "push.services.mozilla.com",
    "notify.windows.com",
)
NAME_LIMIT = 60
SHOWN_NAMES = 3


def is_allowed_endpoint(url: str) -> bool:
    """A Device's endpoint: HTTPS on a known push service, no port or credentials.

    Without this, registering a Device would let a caller make the server post
    to any URL. Ambiguous URLs are rejected, never normalized into acceptance.
    """
    if not url or re.search(r"[\s\\\x00-\x1f\x7f]", url):
        return False
    try:
        parsed = urlsplit(url)
    except ValueError:
        return False
    host = parsed.hostname or ""
    return (
        parsed.scheme == "https"
        and parsed.netloc.lower() == host
        and not parsed.fragment
        and bool(parsed.path)
        and all(
            re.fullmatch(r"[a-z0-9](?:[a-z0-9-]*[a-z0-9])?", label)
            for label in host.split(".")
        )
        and any(
            host == allowed or host.endswith("." + allowed)
            for allowed in PROVIDER_HOSTS
        )
    )


def is_send_time(local: datetime, hour: int) -> bool:
    """The day's notifications go out at the first tick at or after the hour.

    The tick runs about hourly and can drift past an hour, so an exact-hour
    match could skip a day. A sent kind is recorded per local date, so later
    ticks that day send nothing again.
    """
    return local.hour >= hour


@dataclass(frozen=True)
class Notice:
    kind: Kind
    body: str
    # A screen of the web app, as a path with its hash route, such as "/#/inbox".
    path: str
    tag: str
    ttl: int

    def payload(self, origin: str) -> dict:
        """Declarative Web Push JSON; the service worker shows the same shape."""
        return {
            "web_push": 8030,
            "notification": {
                "title": "Accanto",
                "body": self.body,
                "navigate": origin.rstrip("/") + self.path,
                "tag": self.tag,
                "lang": "en",
            },
        }


def plain_name(name: str) -> str:
    """A Routine name as one plain line of at most NAME_LIMIT characters."""
    flat = " ".join(re.sub(r"[\x00-\x1f\x7f-\x9f]", " ", name).split())
    return flat if len(flat) <= NAME_LIMIT else flat[: NAME_LIMIT - 1].rstrip() + "…"


def _plural(count: int, one: str, many: str) -> str:
    return f"{count} {one} is" if count == 1 else f"{count} {many} are"


def routines_due(names: list[str], on: str, entity: str) -> Notice:
    shown = [plain_name(n) for n in names[:SHOWN_NAMES]]
    if len(names) == 1:
        body = f"{shown[0]} is due today."
    elif len(names) <= SHOWN_NAMES:
        body = f"{', '.join(shown[:-1])} and {shown[-1]} are due today."
    else:
        rest = len(names) - 2
        body = f"{shown[0]}, {shown[1]} and {rest} more routines are due today."
    return Notice("routines_due", body, "/#/routines", f"routines-{entity}-{on}", 21600)


def scheduled_entries(count: int, on: str, entity: str) -> Notice:
    body = (
        f"{_plural(count, 'scheduled entry', 'scheduled entries')} waiting "
        "in your inbox."
    )
    return Notice("scheduled_entries", body, "/#/inbox", f"sched-{entity}-{on}", 43200)


def transactions_waiting(count: int, on: str, entity: str) -> Notice:
    body = f"{_plural(count, 'transaction', 'transactions')} waiting in your inbox."
    return Notice("transactions_waiting", body, "/#/inbox", f"txn-{entity}-{on}", 43200)


def confirmation() -> Notice:
    """What "Send a test" sends."""
    return Notice(
        "test",
        "Notifications are on for this device.",
        "/#/settings",
        "test",
        600,
    )
