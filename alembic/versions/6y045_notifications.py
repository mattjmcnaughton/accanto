"""Notifications over Web Push: Devices, preferences and sends (TDD 20).

A Device is one browser or Home Screen app where the User turned on
Notifications (one Web Push subscription). Preferences are one row per User;
a missing row reads as the defaults. notification_send records each kind sent
per User, Entity and local date before delivery, so a kind is sent at most once a
day. Nothing financial is stored and nothing is backfilled. Reapply the
runtime grants in docs/api.md for accanto_app after upgrading. The downgrade
drops the three tables: Devices must then turn Notifications on again.
"""

import sqlalchemy as sa

from alembic import op

revision = "6y045"
down_revision = "6x044"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "push_device",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("uuid", sa.Uuid(), nullable=False, unique=True),
        sa.Column(
            "user_id", sa.BigInteger(), sa.ForeignKey("app_user.id"), nullable=False
        ),
        sa.Column("endpoint", sa.String(2000), nullable=False, unique=True),
        sa.Column("p256dh", sa.String(120), nullable=False),
        sa.Column("auth", sa.String(60), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "registered_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("push_device_user", "push_device", ["user_id"])
    op.create_table(
        "notification_preference",
        sa.Column(
            "user_id", sa.BigInteger(), sa.ForeignKey("app_user.id"), primary_key=True
        ),
        sa.Column("hour", sa.SmallInteger(), nullable=False, server_default="9"),
        sa.Column("routines_due", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column(
            "scheduled_entries", sa.Boolean(), nullable=False, server_default="true"
        ),
        sa.Column(
            "transactions_waiting",
            sa.Boolean(),
            nullable=False,
            server_default="false",
        ),
        sa.CheckConstraint("hour BETWEEN 0 AND 23"),
    )
    op.create_table(
        "notification_send",
        sa.Column(
            "user_id", sa.BigInteger(), sa.ForeignKey("app_user.id"), nullable=False
        ),
        sa.Column(
            "entity_id", sa.BigInteger(), sa.ForeignKey("entity.id"), nullable=False
        ),
        sa.Column("kind", sa.String(30), nullable=False),
        sa.Column("local_date", sa.Date(), nullable=False),
        sa.Column(
            "sent_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("outcome", sa.String(10), nullable=False, server_default="pending"),
        sa.PrimaryKeyConstraint("user_id", "entity_id", "kind", "local_date"),
        sa.CheckConstraint(
            "kind IN ('routines_due', 'scheduled_entries', 'transactions_waiting')"
        ),
        sa.CheckConstraint(
            "outcome IN ('pending', 'delivered', 'gone', 'error', 'disabled')"
        ),
    )


def downgrade():
    op.drop_table("notification_send")
    op.drop_table("notification_preference")
    op.drop_index("push_device_user", table_name="push_device")
    op.drop_table("push_device")
