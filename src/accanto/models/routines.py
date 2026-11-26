"""Routines: Entity-scoped checklists on a cadence (TDD 13). Not financial records."""

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

from accanto.models.monthly import table

routines = table(
    "routine",
    Column("entity_id", ForeignKey("entity.id"), nullable=False),
    Column("name", String(120), nullable=False),
    Column("frequency", String(10), nullable=False),
    Column("interval", SmallInteger, nullable=False),
    # Bit d set for weekday d (0 = Monday); weekly only.
    Column("weekdays", SmallInteger),
    Column("month_day", SmallInteger),
    Column("week", SmallInteger),
    Column("weekday", SmallInteger),
    Column("month", SmallInteger),
    Column("starts_on", Date, nullable=False),
    Column("active", Boolean, nullable=False, server_default="true"),
    Column("revision", Integer, nullable=False, server_default="1"),
    UniqueConstraint("id", "entity_id"),
    CheckConstraint("revision >= 1"),
    CheckConstraint("interval BETWEEN 1 AND 52"),
    CheckConstraint(
        "(frequency = 'weekly' AND weekdays BETWEEN 1 AND 127 AND month_day IS NULL "
        "AND week IS NULL AND weekday IS NULL AND month IS NULL) OR "
        "(frequency = 'monthly' AND weekdays IS NULL AND month IS NULL AND ("
        "(month_day IS NOT NULL AND week IS NULL AND weekday IS NULL) OR "
        "(month_day IS NULL AND week IS NOT NULL AND weekday IS NOT NULL))) OR "
        "(frequency = 'yearly' AND weekdays IS NULL AND week IS NULL "
        "AND weekday IS NULL AND month BETWEEN 1 AND 12 AND month_day IS NOT NULL)",
        name="routine_cadence_check",
    ),
    CheckConstraint("month_day = -1 OR month_day BETWEEN 1 AND 28"),
    CheckConstraint("week = -1 OR week BETWEEN 1 AND 4"),
    CheckConstraint("weekday BETWEEN 0 AND 6"),
)

steps = table(
    "routine_step",
    Column("routine_id", BigInteger, nullable=False),
    Column("entity_id", BigInteger, nullable=False),
    Column("position", Integer, nullable=False),
    Column("title", String(200), nullable=False),
    Column("link_screen", String(20)),
    Column("link_month_offset", SmallInteger),
    Column("link_url", String(2000)),
    # A step removed from the routine stays for the history that ticked it.
    Column("active", Boolean, nullable=False, server_default="true"),
    ForeignKeyConstraint(
        ["routine_id", "entity_id"], ["routine.id", "routine.entity_id"]
    ),
    UniqueConstraint("id", "routine_id"),
    CheckConstraint("position >= 0"),
    CheckConstraint("link_screen IS NULL OR link_url IS NULL"),
    CheckConstraint(
        "link_month_offset IS NULL OR "
        "(link_screen IN ('home', 'activity', 'review') "
        "AND link_month_offset BETWEEN -12 AND 12)"
    ),
    CheckConstraint("link_url IS NULL OR link_url LIKE 'https://%'"),
    Index(
        "routine_step_position",
        "routine_id",
        "position",
        unique=True,
        postgresql_where=text("active"),
    ),
)

occurrences = table(
    "routine_occurrence",
    Column("routine_id", BigInteger, nullable=False),
    Column("entity_id", BigInteger, nullable=False),
    Column("scheduled_on", Date, nullable=False),
    Column("skipped", Boolean, nullable=False, server_default="false"),
    # Set when every active step is ticked or skipped; later than the next
    # scheduled date means completed late.
    Column("completed_on", Date),
    Column("note", String(4000), nullable=False, server_default=""),
    Column("revision", Integer, nullable=False, server_default="1"),
    ForeignKeyConstraint(
        ["routine_id", "entity_id"], ["routine.id", "routine.entity_id"]
    ),
    UniqueConstraint("id", "routine_id"),
    UniqueConstraint("routine_id", "scheduled_on"),
    CheckConstraint("revision >= 1"),
)

ticks = table(
    "routine_occurrence_step",
    Column("occurrence_id", BigInteger, nullable=False),
    Column("step_id", BigInteger, nullable=False),
    Column("routine_id", BigInteger, nullable=False),
    # The title when ticked, so renaming or removing a step leaves history as it was.
    Column("title", String(200), nullable=False),
    Column("status", String(10), nullable=False),
    Column("note", String(4000), nullable=False, server_default=""),
    Column("at", DateTime(timezone=True), nullable=False, server_default=func.now()),
    ForeignKeyConstraint(
        ["occurrence_id", "routine_id"],
        ["routine_occurrence.id", "routine_occurrence.routine_id"],
    ),
    ForeignKeyConstraint(
        ["step_id", "routine_id"], ["routine_step.id", "routine_step.routine_id"]
    ),
    UniqueConstraint("occurrence_id", "step_id"),
    CheckConstraint("status IN ('done', 'skipped')"),
)
