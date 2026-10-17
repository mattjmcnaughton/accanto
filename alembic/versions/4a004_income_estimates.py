"""Editable Entity-scoped income estimates and independent assumption lines."""

import sqlalchemy as sa

from alembic import op

revision = "4a004"
down_revision = "3a003"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "income_estimate",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("uuid", sa.Uuid(), unique=True, nullable=False),
        sa.Column(
            "entity_id", sa.BigInteger(), sa.ForeignKey("entity.id"), nullable=False
        ),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("revision", sa.Integer(), server_default="1", nullable=False),
        sa.Column("monthly_total", sa.Numeric(14, 2), nullable=False),
        sa.UniqueConstraint("id", "entity_id"),
        sa.CheckConstraint("revision >= 1"),
        sa.CheckConstraint(
            "monthly_total BETWEEN -999999999999.99 AND 999999999999.99"
        ),
    )
    op.create_table(
        "income_estimate_line",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("uuid", sa.Uuid(), unique=True, nullable=False),
        sa.Column("estimate_id", sa.BigInteger(), nullable=False),
        sa.Column("entity_id", sa.BigInteger(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("gross", sa.Numeric(14, 2), nullable=False),
        sa.Column("withholding", sa.Numeric(14, 2), nullable=False),
        sa.Column("payroll", sa.Numeric(14, 2), nullable=False),
        sa.Column("frequency", sa.String(20), nullable=False),
        sa.Column("paid_days", sa.BigInteger()),
        sa.Column("monthly_net", sa.Numeric(14, 2), nullable=False),
        sa.ForeignKeyConstraint(
            ["estimate_id", "entity_id"],
            ["income_estimate.id", "income_estimate.entity_id"],
        ),
        sa.UniqueConstraint("estimate_id", "position"),
        sa.CheckConstraint("position >= 0"),
        sa.CheckConstraint("gross BETWEEN 0 AND 999999999.99"),
        sa.CheckConstraint("withholding BETWEEN 0 AND 999999999.99"),
        sa.CheckConstraint("payroll BETWEEN 0 AND 999999999.99"),
        sa.CheckConstraint("monthly_net BETWEEN -999999999999.99 AND 999999999999.99"),
        sa.CheckConstraint(
            "(frequency = 'daily' AND paid_days IS NOT NULL AND paid_days >= 0) OR "
            "(frequency IN ('annual', 'monthly', 'twice_monthly', 'weekly') "
            "AND paid_days IS NULL)"
        ),
    )


def downgrade():
    op.drop_table("income_estimate_line")
    op.drop_table("income_estimate")
