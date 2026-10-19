"""Add retained same-Entity purchase/refund relationships."""

import sqlalchemy as sa

from alembic import op

revision = "5i018"
down_revision = "5h017"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "actual_entry",
        sa.Column("is_refund", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.drop_constraint(
        "actual_entry_ordinary_amount_check", "actual_entry", type_="check"
    )
    op.create_check_constraint(
        "entry_nonnegative_or_adjustment_or_refund",
        "actual_entry",
        "is_adjustment OR is_refund OR amount >= 0",
    )
    op.create_table(
        "entry_refund",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("uuid", sa.Uuid(), nullable=False, unique=True),
        sa.Column("entity_id", sa.BigInteger(), nullable=False),
        sa.Column("refund_entry_id", sa.BigInteger(), nullable=False, unique=True),
        sa.Column("original_entry_id", sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(
            ["refund_entry_id", "entity_id"],
            ["actual_entry.id", "actual_entry.entity_id"],
        ),
        sa.ForeignKeyConstraint(
            ["original_entry_id", "entity_id"],
            ["actual_entry.id", "actual_entry.entity_id"],
        ),
        sa.CheckConstraint("refund_entry_id <> original_entry_id"),
    )
    op.create_index("entry_refund_original", "entry_refund", ["original_entry_id"])


def downgrade():
    op.drop_index("entry_refund_original", table_name="entry_refund")
    op.drop_table("entry_refund")
    op.drop_constraint(
        "entry_nonnegative_or_adjustment_or_refund", "actual_entry", type_="check"
    )
    op.create_check_constraint(
        "actual_entry_ordinary_amount_check",
        "actual_entry",
        "is_adjustment OR amount >= 0",
    )
    op.drop_column("actual_entry", "is_refund")
