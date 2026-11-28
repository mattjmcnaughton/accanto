"""Spending alerts (TDD 23): thresholds on a Plan amount. Not financial records."""

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Column,
    Date,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    PrimaryKeyConstraint,
    SmallInteger,
    String,
    Table,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY

from accanto.db import Base
from accanto.models.monthly import table

# One per target: guilt-free spending or fixed costs as a whole (no reference),
# one Spending subcategory, or one Fixed cost. No amount: it reads the Plan's.
alerts = table(
    "spending_alert",
    Column("entity_id", ForeignKey("entity.id"), nullable=False),
    Column("category", String(10), nullable=False),
    Column("spending_subcategory_id", BigInteger),
    Column("fixed_cost_id", BigInteger),
    Column("thresholds", ARRAY(SmallInteger), nullable=False),
    Column("revision", Integer, nullable=False, server_default="1"),
    Column(
        "created_at", DateTime(timezone=True), server_default=func.now(), nullable=False
    ),
    ForeignKeyConstraint(
        ["spending_subcategory_id", "entity_id"],
        ["spending_subcategory.id", "spending_subcategory.entity_id"],
    ),
    ForeignKeyConstraint(
        ["fixed_cost_id", "entity_id"], ["fixed_cost.id", "fixed_cost.entity_id"]
    ),
    UniqueConstraint("id", "entity_id"),
    CheckConstraint(
        "(category = 'spending' AND fixed_cost_id IS NULL) OR "
        "(category = 'fixed_cost' AND spending_subcategory_id IS NULL)",
        name="spending_alert_target_check",
    ),
    CheckConstraint(
        "cardinality(thresholds) BETWEEN 1 AND 10 "
        "AND 1 <= ALL(thresholds) AND 999 >= ALL(thresholds)",
        name="spending_alert_thresholds_check",
    ),
    CheckConstraint("revision >= 1"),
)
Index(
    "spending_alert_target",
    alerts.c.entity_id,
    alerts.c.category,
    text("coalesce(spending_subcategory_id, 0)"),
    text("coalesce(fixed_cost_id, 0)"),
    unique=True,
)

# Per User, month and threshold: when it was pushed (claimed before delivery,
# so a retried or overlapping tick never pushes it twice) and dismissed on Home.
notices = Table(
    "spending_alert_notice",
    Base.metadata,
    Column("user_id", BigInteger, ForeignKey("app_user.id"), nullable=False),
    Column(
        "spending_alert_id",
        BigInteger,
        ForeignKey("spending_alert.id", ondelete="CASCADE"),
        nullable=False,
    ),
    Column("month", Date, nullable=False),
    Column("threshold", SmallInteger, nullable=False),
    Column("pushed_at", DateTime(timezone=True)),
    Column("outcome", String(10)),
    Column("dismissed_at", DateTime(timezone=True)),
    PrimaryKeyConstraint("user_id", "spending_alert_id", "month", "threshold"),
    CheckConstraint("extract(day FROM month) = 1"),
    CheckConstraint("outcome IN ('pending', 'delivered', 'gone', 'error', 'disabled')"),
)
