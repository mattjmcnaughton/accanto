"""Savings accounts, goal identity and retained linked activity boundary."""

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
    Numeric,
    String,
    UniqueConstraint,
)

from accanto.models.monthly import table

accounts = table(
    "saving_account",
    Column("entity_id", BigInteger, ForeignKey("entity.id"), nullable=False),
    Column("name", String(120), nullable=False),
    Column("opening_date", Date, nullable=False),
    Column("opening_amount", Numeric(14, 2), nullable=False),
    Column("revision", Integer, nullable=False, server_default="1"),
    Column("active", Boolean, nullable=False, server_default="true"),
    UniqueConstraint("id", "entity_id"),
    CheckConstraint("opening_amount BETWEEN 0 AND 999999999.99"),
    CheckConstraint("revision >= 1"),
)
goals = table(
    "saving_goal",
    Column("entity_id", BigInteger, nullable=False),
    Column("account_id", BigInteger, nullable=False),
    Column("name", String(120), nullable=False),
    Column("role", String(20), nullable=False),
    Column("kind", String(20), nullable=False),
    Column("target", Numeric(14, 2)),
    Column("opening_amount", Numeric(14, 2), nullable=False),
    Column("revision", Integer, nullable=False, server_default="1"),
    Column("active", Boolean, nullable=False, server_default="true"),
    ForeignKeyConstraint(
        ["account_id", "entity_id"], ["saving_account.id", "saving_account.entity_id"]
    ),
    UniqueConstraint("id", "entity_id"),
    UniqueConstraint("id", "account_id"),
    CheckConstraint("role IN ('ordinary', 'unallocated')"),
    CheckConstraint("kind IN ('finite', 'ongoing')"),
    CheckConstraint("opening_amount BETWEEN 0 AND 999999999.99"),
    CheckConstraint(
        "(role = 'unallocated' AND kind = 'ongoing' AND target IS NULL AND active) OR "
        "(role = 'ordinary' AND (kind = 'ongoing' OR target > 0) "
        "AND (target IS NULL OR target > 0))"
    ),
    CheckConstraint("revision >= 1"),
)
Index(
    "one_unallocated_per_account",
    goals.c.account_id,
    unique=True,
    postgresql_where=goals.c.role == "unallocated",
)

# Retained links preserve every account association, even after corrections or
# deletion. Only current links participate in balances.
linked_activity = table(
    "saving_linked_activity",
    Column("entity_id", BigInteger, nullable=False),
    Column("account_id", BigInteger, nullable=False),
    Column("goal_id", BigInteger, nullable=False),
    Column("financial_date", Date, nullable=False),
    Column("actual_entry_id", BigInteger),
    Column("recording_order", BigInteger, nullable=True),
    Column("deleted_at", DateTime(timezone=True)),
    ForeignKeyConstraint(
        ["account_id", "entity_id"], ["saving_account.id", "saving_account.entity_id"]
    ),
    ForeignKeyConstraint(
        ["goal_id", "account_id"], ["saving_goal.id", "saving_goal.account_id"]
    ),
    ForeignKeyConstraint(
        ["actual_entry_id", "entity_id"], ["actual_entry.id", "actual_entry.entity_id"]
    ),
)
Index(
    "one_current_saving_link_per_entry",
    linked_activity.c.actual_entry_id,
    unique=True,
    postgresql_where=linked_activity.c.deleted_at.is_(None),
)
