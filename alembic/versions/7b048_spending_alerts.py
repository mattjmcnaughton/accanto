"""Spending alerts (TDD 23): thresholds on a Plan amount, once a month each.

A spending_alert watches guilt-free spending or fixed costs as a whole, one
Spending subcategory or one Fixed cost, with up to ten whole-percentage
thresholds. It stores no amount: it reads the Plan version's. The
spending_alert_notice rows record, per User, month and threshold, when it was
pushed and when it was dismissed on Home, so each reaches a User at most once a
month. Notification preferences gain a spending_alerts switch, on by default.
Not financial records; additive only and nothing is backfilled. Reapply the
runtime grants in docs/api.md for accanto_app after upgrading.
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "7b048"
down_revision = "7a047"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "spending_alert",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("uuid", sa.Uuid(), nullable=False, unique=True),
        sa.Column(
            "entity_id", sa.BigInteger(), sa.ForeignKey("entity.id"), nullable=False
        ),
        sa.Column("category", sa.String(10), nullable=False),
        sa.Column("spending_subcategory_id", sa.BigInteger()),
        sa.Column("fixed_cost_id", sa.BigInteger()),
        sa.Column("thresholds", postgresql.ARRAY(sa.SmallInteger()), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(
            ["spending_subcategory_id", "entity_id"],
            ["spending_subcategory.id", "spending_subcategory.entity_id"],
        ),
        sa.ForeignKeyConstraint(
            ["fixed_cost_id", "entity_id"], ["fixed_cost.id", "fixed_cost.entity_id"]
        ),
        sa.UniqueConstraint("id", "entity_id"),
        sa.CheckConstraint(
            "(category = 'spending' AND fixed_cost_id IS NULL) OR "
            "(category = 'fixed_cost' AND spending_subcategory_id IS NULL)",
            name="spending_alert_target_check",
        ),
        sa.CheckConstraint(
            "cardinality(thresholds) BETWEEN 1 AND 10 "
            "AND 1 <= ALL(thresholds) AND 999 >= ALL(thresholds)",
            name="spending_alert_thresholds_check",
        ),
        sa.CheckConstraint("revision >= 1"),
    )
    op.create_index(
        "spending_alert_target",
        "spending_alert",
        [
            "entity_id",
            "category",
            sa.text("coalesce(spending_subcategory_id, 0)"),
            sa.text("coalesce(fixed_cost_id, 0)"),
        ],
        unique=True,
    )
    op.create_table(
        "spending_alert_notice",
        sa.Column(
            "user_id", sa.BigInteger(), sa.ForeignKey("app_user.id"), nullable=False
        ),
        sa.Column(
            "spending_alert_id",
            sa.BigInteger(),
            sa.ForeignKey("spending_alert.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("month", sa.Date(), nullable=False),
        sa.Column("threshold", sa.SmallInteger(), nullable=False),
        sa.Column("pushed_at", sa.DateTime(timezone=True)),
        sa.Column("outcome", sa.String(10)),
        sa.Column("dismissed_at", sa.DateTime(timezone=True)),
        sa.PrimaryKeyConstraint("user_id", "spending_alert_id", "month", "threshold"),
        sa.CheckConstraint("extract(day FROM month) = 1"),
        sa.CheckConstraint(
            "outcome IN ('pending', 'delivered', 'gone', 'error', 'disabled')"
        ),
    )
    op.add_column(
        "notification_preference",
        sa.Column(
            "spending_alerts", sa.Boolean(), nullable=False, server_default="true"
        ),
    )


def downgrade():
    op.drop_column("notification_preference", "spending_alerts")
    op.drop_table("spending_alert_notice")
    op.drop_index("spending_alert_target", table_name="spending_alert")
    op.drop_table("spending_alert")
