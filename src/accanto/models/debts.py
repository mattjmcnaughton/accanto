"""Loan accounts, dated owed observations and actual payment relationships."""

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
    text,
)

from accanto.models.monthly import table

debts = table(
    "debt_account",
    Column("entity_id", BigInteger, ForeignKey("entity.id"), nullable=False),
    Column("name", String(120), nullable=False),
    Column("active", Boolean, nullable=False, server_default="true"),
    Column("revision", Integer, nullable=False, server_default="1"),
    # Fixed-rate loan terms (TDD 15); null when unknown.
    Column("interest_rate_percent", Numeric(5, 2)),
    Column("monthly_payment", Numeric(14, 2)),
    UniqueConstraint("id", "entity_id"),
    CheckConstraint("revision >= 1"),
)
observations = table(
    "debt_balance_observation",
    Column("entity_id", BigInteger, nullable=False),
    Column("debt_account_id", BigInteger, nullable=False),
    Column("financial_date", Date, nullable=False),
    Column("amount", Numeric(14, 2), nullable=False),
    Column("is_opening", Boolean, nullable=False),
    Column("revision", Integer, nullable=False, server_default="1"),
    Column("deleted_at", DateTime(timezone=True)),
    ForeignKeyConstraint(["entity_id"], ["entity.id"]),
    ForeignKeyConstraint(
        ["debt_account_id", "entity_id"], ["debt_account.id", "debt_account.entity_id"]
    ),
    CheckConstraint("amount BETWEEN 0 AND 999999999.99"),
)
Index(
    "one_debt_opening",
    observations.c.debt_account_id,
    unique=True,
    postgresql_where=text("is_opening"),
)
Index(
    "one_debt_daily_observation",
    observations.c.debt_account_id,
    observations.c.financial_date,
    unique=True,
    postgresql_where=text("NOT is_opening AND deleted_at IS NULL"),
)
entry_debts = table(
    "entry_debt_account",
    Column("entity_id", BigInteger, nullable=False),
    Column("actual_entry_id", BigInteger, nullable=False, unique=True),
    Column("debt_account_id", BigInteger, nullable=False),
    ForeignKeyConstraint(
        ["actual_entry_id", "entity_id"], ["actual_entry.id", "actual_entry.entity_id"]
    ),
    ForeignKeyConstraint(
        ["debt_account_id", "entity_id"], ["debt_account.id", "debt_account.entity_id"]
    ),
)
