"""Notifications (TDD 20): Devices, a User's preferences and what was sent.

Not financial records. A Device's endpoint and keys are a capability to push
to one browser: never logged or exported.
"""

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Index,
    PrimaryKeyConstraint,
    SmallInteger,
    String,
    Table,
    func,
)

from accanto.db import Base
from accanto.models.monthly import table

devices = table(
    "push_device",
    Column("user_id", ForeignKey("app_user.id"), nullable=False),
    Column("endpoint", String(2000), nullable=False, unique=True),
    Column("p256dh", String(120), nullable=False),
    Column("auth", String(60), nullable=False),
    Column(
        "created_at", DateTime(timezone=True), server_default=func.now(), nullable=False
    ),
    Column(
        "registered_at",
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    ),
)
Index("push_device_user", devices.c.user_id)

# A missing row reads as the defaults in domains.notifications.DEFAULTS.
preferences = Table(
    "notification_preference",
    Base.metadata,
    Column("user_id", ForeignKey("app_user.id"), primary_key=True),
    Column("hour", SmallInteger, nullable=False, server_default="9"),
    Column("routines_due", Boolean, nullable=False, server_default="true"),
    Column("scheduled_entries", Boolean, nullable=False, server_default="true"),
    Column("transactions_waiting", Boolean, nullable=False, server_default="false"),
    CheckConstraint("hour BETWEEN 0 AND 23"),
)

# One row per User, Entity, kind and local date, written before delivery: a
# tick that is retried, overlaps or crashes never sends a kind twice that day.
# Per User because an Entity's owner and its members are each notified.
sends = Table(
    "notification_send",
    Base.metadata,
    Column("user_id", BigInteger, ForeignKey("app_user.id"), nullable=False),
    Column("entity_id", BigInteger, ForeignKey("entity.id"), nullable=False),
    Column("kind", String(30), nullable=False),
    Column("local_date", Date, nullable=False),
    Column(
        "sent_at", DateTime(timezone=True), server_default=func.now(), nullable=False
    ),
    Column("outcome", String(10), nullable=False, server_default="pending"),
    PrimaryKeyConstraint("user_id", "entity_id", "kind", "local_date"),
    CheckConstraint(
        "kind IN ('routines_due', 'scheduled_entries', 'transactions_waiting')"
    ),
    CheckConstraint("outcome IN ('pending', 'delivered', 'gone', 'error', 'disabled')"),
)
