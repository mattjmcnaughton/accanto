"""Investment and giving identities, observations, and entry assignments."""

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

investments = table(
    "investment",
    Column("entity_id", BigInteger, ForeignKey("entity.id"), nullable=False),
    Column("name", String(120), nullable=False),
    Column("target", Numeric(14, 2)),
    Column("active", Boolean, nullable=False, server_default="true"),
    Column("revision", Integer, nullable=False, server_default="1"),
    # Projection assumptions (TDD 14); not activity or observations.
    Column("expected_return_percent", Numeric(5, 2)),
    Column("expected_contribution", Numeric(14, 2)),
    Column(
        "expected_contribution_frequency",
        String(10),
        nullable=False,
        server_default="monthly",
    ),
    # Classification only; nothing calculates with these yet.
    Column("tax_treatment", String(14), nullable=False, server_default="taxable"),
    Column("liquidity", String(8), nullable=False, server_default="liquid"),
    UniqueConstraint("id", "entity_id"),
    CheckConstraint("target IS NULL OR target BETWEEN 0.01 AND 999999999.99"),
    CheckConstraint("revision >= 1"),
)
recipients = table(
    "giving_recipient",
    Column("entity_id", BigInteger, ForeignKey("entity.id"), nullable=False),
    Column("name", String(120), nullable=False),
    Column("target", Numeric(14, 2)),
    Column("active", Boolean, nullable=False, server_default="true"),
    Column("revision", Integer, nullable=False, server_default="1"),
    UniqueConstraint("id", "entity_id"),
    CheckConstraint("target IS NULL OR target BETWEEN 0.01 AND 999999999.99"),
    CheckConstraint("revision >= 1"),
)
observations = table(
    "investment_balance_observation",
    Column("entity_id", BigInteger, nullable=False),
    Column("investment_id", BigInteger),
    Column("financial_date", Date, nullable=False),
    Column("amount", Numeric(14, 2), nullable=False),
    Column("is_opening", Boolean, nullable=False),
    Column("revision", Integer, nullable=False, server_default="1"),
    Column("deleted_at", DateTime(timezone=True)),
    ForeignKeyConstraint(["entity_id"], ["entity.id"]),
    ForeignKeyConstraint(
        ["investment_id", "entity_id"], ["investment.id", "investment.entity_id"]
    ),
    CheckConstraint("amount BETWEEN 0 AND 999999999.99"),
    CheckConstraint("NOT is_opening OR investment_id IS NOT NULL"),
)
Index(
    "one_investment_daily_observation",
    observations.c.investment_id,
    observations.c.financial_date,
    unique=True,
    postgresql_where=text(
        "NOT is_opening AND deleted_at IS NULL AND investment_id IS NOT NULL"
    ),
)

investment_entries = table(
    "entry_investment_destination",
    Column("entity_id", BigInteger, nullable=False),
    Column("actual_entry_id", BigInteger, nullable=False, unique=True),
    Column("investment_id", BigInteger, nullable=False),
    ForeignKeyConstraint(
        ["actual_entry_id", "entity_id"], ["actual_entry.id", "actual_entry.entity_id"]
    ),
    ForeignKeyConstraint(
        ["investment_id", "entity_id"], ["investment.id", "investment.entity_id"]
    ),
)
giving_entries = table(
    "entry_giving_recipient",
    Column("entity_id", BigInteger, nullable=False),
    Column("actual_entry_id", BigInteger, nullable=False, unique=True),
    Column("giving_recipient_id", BigInteger, nullable=False),
    ForeignKeyConstraint(
        ["actual_entry_id", "entity_id"], ["actual_entry.id", "actual_entry.entity_id"]
    ),
    ForeignKeyConstraint(
        ["giving_recipient_id", "entity_id"],
        ["giving_recipient.id", "giving_recipient.entity_id"],
    ),
)
