"""Signed actual adjustments with ordinary entry sign constraint."""

import sqlalchemy as sa

from alembic import op

revision = "5b009"
down_revision = "4a004"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "actual_entry",
        sa.Column(
            "is_adjustment", sa.Boolean(), server_default="false", nullable=False
        ),
    )
    op.drop_constraint("actual_entry_amount_check", "actual_entry", type_="check")
    op.create_check_constraint(
        "actual_entry_amount_check",
        "actual_entry",
        "amount BETWEEN -999999999.99 AND 999999999.99",
    )
    op.create_check_constraint(
        "actual_entry_ordinary_amount_check",
        "actual_entry",
        "is_adjustment OR amount >= 0",
    )


def downgrade():
    op.drop_constraint(
        "actual_entry_ordinary_amount_check", "actual_entry", type_="check"
    )
    op.drop_constraint("actual_entry_amount_check", "actual_entry", type_="check")
    op.create_check_constraint(
        "actual_entry_amount_check",
        "actual_entry",
        "amount >= 0 AND amount <= 999999999.99",
    )
    op.drop_column("actual_entry", "is_adjustment")
