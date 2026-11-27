"""Entry schedules (TDD 18): entries the hourly tick stages on a cadence.

A schedule is not financial activity. Each date's entries wait in the
Transactions inbox as staged transactions linked to the date's occurrence;
accepting them there records ordinary actual entries.
"""

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Column,
    Date,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    SmallInteger,
    String,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB

from accanto.models.monthly import table

schedules = table(
    "entry_schedule",
    Column("entity_id", ForeignKey("entity.id"), nullable=False),
    Column("name", String(120), nullable=False),
    # The Routine cadence columns (TDD 13) plus the weekend move.
    Column("frequency", String(10), nullable=False),
    Column("interval", SmallInteger, nullable=False),
    Column("weekdays", SmallInteger),
    Column("month_day", SmallInteger),
    Column("week", SmallInteger),
    Column("weekday", SmallInteger),
    Column("month", SmallInteger),
    Column("weekend", String(6)),
    Column("starts_on", Date, nullable=False),
    Column("ends_on", Date),
    Column("paused", Boolean, nullable=False, server_default="false"),
    # The next date the tick stages; null when no date is left.
    Column("next_on", Date),
    # [{category, amount, note, assignment, funding, tag_ids}], references by UUID.
    Column("lines", JSONB, nullable=False),
    Column("revision", Integer, nullable=False, server_default="1"),
    Column(
        "created_at", DateTime(timezone=True), server_default=func.now(), nullable=False
    ),
    UniqueConstraint("id", "entity_id"),
    CheckConstraint("revision >= 1"),
    CheckConstraint("ends_on IS NULL OR ends_on >= starts_on"),
)
Index(
    "entry_schedule_due",
    schedules.c.next_on,
    postgresql_where=text("NOT paused AND next_on IS NOT NULL"),
)

occurrences = table(
    "entry_schedule_occurrence",
    Column("schedule_id", BigInteger, nullable=False),
    Column("entity_id", BigInteger, nullable=False),
    Column("scheduled_on", Date, nullable=False),
    Column("status", String(10), nullable=False),
    Column("rejection", JSONB(none_as_null=True)),
    Column("revision", Integer, nullable=False, server_default="1"),
    Column(
        "updated_at", DateTime(timezone=True), server_default=func.now(), nullable=False
    ),
    ForeignKeyConstraint(
        ["schedule_id", "entity_id"], ["entry_schedule.id", "entry_schedule.entity_id"]
    ),
    UniqueConstraint("id", "entity_id"),
    UniqueConstraint("schedule_id", "scheduled_on"),
    CheckConstraint("status IN ('staged', 'skipped', 'failed')"),
)
