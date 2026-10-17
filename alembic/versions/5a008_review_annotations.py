"""Review annotation and comparison checkpoint.

Revision ID: 5a008
Revises: 4a004
"""

import sqlalchemy as sa

from alembic import op

revision = "5a008"
down_revision = "4a004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "monthly_review", sa.Column("reviewed_at", sa.DateTime(timezone=True))
    )
    op.add_column("monthly_review", sa.Column("checkpoint_fingerprint", sa.String(64)))


def downgrade() -> None:
    op.drop_column("monthly_review", "checkpoint_fingerprint")
    op.drop_column("monthly_review", "reviewed_at")
