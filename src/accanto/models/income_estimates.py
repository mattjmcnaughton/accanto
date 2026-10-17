"""Entity-scoped, editable income-estimation scenarios."""

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Column,
    ForeignKey,
    ForeignKeyConstraint,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
)

from accanto.models.monthly import table

estimates = table(
    "income_estimate",
    Column("entity_id", ForeignKey("entity.id"), nullable=False),
    Column("name", String(120), nullable=False),
    Column("revision", Integer, nullable=False, server_default="1"),
    Column("monthly_total", Numeric(14, 2), nullable=False),
    UniqueConstraint("id", "entity_id"),
    CheckConstraint("revision >= 1"),
    CheckConstraint("monthly_total BETWEEN -999999999999.99 AND 999999999999.99"),
)

lines = table(
    "income_estimate_line",
    Column("estimate_id", BigInteger, nullable=False),
    Column("entity_id", BigInteger, nullable=False),
    Column("position", Integer, nullable=False),
    Column("name", String(120), nullable=False),
    Column("gross", Numeric(14, 2), nullable=False),
    Column("withholding", Numeric(14, 2), nullable=False),
    Column("payroll", Numeric(14, 2), nullable=False),
    Column("frequency", String(20), nullable=False),
    Column("paid_days", BigInteger),
    Column("monthly_net", Numeric(14, 2), nullable=False),
    ForeignKeyConstraint(
        ["estimate_id", "entity_id"],
        ["income_estimate.id", "income_estimate.entity_id"],
    ),
    UniqueConstraint("estimate_id", "position"),
    CheckConstraint("position >= 0"),
    CheckConstraint("gross BETWEEN 0 AND 999999999.99"),
    CheckConstraint("withholding BETWEEN 0 AND 999999999.99"),
    CheckConstraint("payroll BETWEEN 0 AND 999999999.99"),
    CheckConstraint("monthly_net BETWEEN -999999999999.99 AND 999999999999.99"),
    CheckConstraint(
        "(frequency = 'daily' AND paid_days IS NOT NULL AND paid_days >= 0) OR "
        "(frequency IN ('annual', 'monthly', 'twice_monthly', 'weekly') "
        "AND paid_days IS NULL)"
    ),
)
