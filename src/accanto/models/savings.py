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

from accanto.models.monthly import entry_order, table

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
    Column("completed", Boolean, nullable=False, server_default="false"),
    Column("archived_by_account", Boolean, nullable=False, server_default="false"),
    ForeignKeyConstraint(
        ["account_id", "entity_id"], ["saving_account.id", "saving_account.entity_id"]
    ),
    UniqueConstraint("id", "entity_id"),
    UniqueConstraint("id", "account_id"),
    CheckConstraint("role IN ('ordinary', 'unallocated')"),
    CheckConstraint("kind IN ('finite', 'ongoing')"),
    CheckConstraint("opening_amount BETWEEN 0 AND 999999999.99"),
    CheckConstraint(
        "(role = 'unallocated' AND kind = 'ongoing' AND target IS NULL "
        "AND NOT completed AND (active OR archived_by_account)) OR "
        "(role = 'ordinary' AND (kind = 'ongoing' OR target > 0) "
        "AND (target IS NULL OR target > 0))"
    ),
    CheckConstraint(
        "NOT completed OR (kind = 'finite' AND role = 'ordinary' AND NOT active)"
    ),
    CheckConstraint("NOT archived_by_account OR NOT active"),
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


def movement_table(name):
    return table(
        name,
        Column("entity_id", BigInteger, ForeignKey("entity.id"), nullable=False),
        Column("financial_date", Date, nullable=False),
        Column("from_goal_id", BigInteger, nullable=False),
        Column("to_goal_id", BigInteger, nullable=False),
        Column("amount", Numeric(14, 2), nullable=False),
        Column("note", String(2000), nullable=False, server_default=""),
        Column(
            "recording_order",
            BigInteger,
            entry_order,
            server_default=entry_order.next_value(),
            nullable=False,
            unique=True,
        ),
        Column("revision", Integer, nullable=False, server_default="1"),
        Column("deleted_at", DateTime(timezone=True)),
        ForeignKeyConstraint(
            ["from_goal_id", "entity_id"], ["saving_goal.id", "saving_goal.entity_id"]
        ),
        ForeignKeyConstraint(
            ["to_goal_id", "entity_id"], ["saving_goal.id", "saving_goal.entity_id"]
        ),
        CheckConstraint("from_goal_id <> to_goal_id"),
        CheckConstraint("amount > 0 AND amount <= 999999999.99"),
        CheckConstraint("revision >= 1"),
    )


reassignments = movement_table("savings_reassignment")
reassignments.append_column(
    Column("completion_goal_id", BigInteger, ForeignKey("saving_goal.id"))
)
transfers = movement_table("savings_transfer")
adjustments = table(
    "savings_balance_adjustment",
    Column("entity_id", BigInteger, ForeignKey("entity.id"), nullable=False),
    Column("goal_id", BigInteger, nullable=False),
    Column("financial_date", Date, nullable=False),
    Column("amount", Numeric(14, 2), nullable=False),
    Column("note", String(2000), nullable=False, server_default=""),
    Column(
        "recording_order",
        BigInteger,
        entry_order,
        server_default=entry_order.next_value(),
        nullable=False,
        unique=True,
    ),
    Column("revision", Integer, nullable=False, server_default="1"),
    Column("deleted_at", DateTime(timezone=True)),
    ForeignKeyConstraint(
        ["goal_id", "entity_id"], ["saving_goal.id", "saving_goal.entity_id"]
    ),
    CheckConstraint("amount BETWEEN -999999999.99 AND 999999999.99"),
    CheckConstraint("amount <> 0"),
    CheckConstraint("revision >= 1"),
)
