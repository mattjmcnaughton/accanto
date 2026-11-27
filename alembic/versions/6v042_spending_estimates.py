"""Spending estimates: an optional monthly estimate per Spending subcategory.

Each Plan revision may carry an estimate line for any of its Entity's Spending
subcategories. Estimates are informational: guilt-free spending stays one
planned amount, and no Plan total reads them. Saving a version copies its lines,
so saved versions keep their estimates. Additive only; existing Plans have no
estimates and nothing is backfilled. Reapply the runtime grants in docs/api.md
for accanto_app after upgrading.
"""

import sqlalchemy as sa

from alembic import op

revision = "6v042"
down_revision = "6u041"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "plan_spending_estimate_line",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("uuid", sa.Uuid(), nullable=False, unique=True),
        sa.Column("plan_revision_id", sa.BigInteger(), nullable=False),
        sa.Column("entity_id", sa.BigInteger(), nullable=False),
        sa.Column("spending_subcategory_id", sa.BigInteger(), nullable=False),
        sa.Column("amount", sa.Numeric(14, 2), nullable=False),
        sa.ForeignKeyConstraint(
            ["plan_revision_id", "entity_id"],
            ["plan_revision.id", "plan_revision.entity_id"],
        ),
        sa.ForeignKeyConstraint(
            ["spending_subcategory_id", "entity_id"],
            ["spending_subcategory.id", "spending_subcategory.entity_id"],
        ),
        sa.UniqueConstraint("plan_revision_id", "spending_subcategory_id"),
        sa.CheckConstraint("amount BETWEEN 0 AND 999999999.99"),
    )


def downgrade():
    op.drop_table("plan_spending_estimate_line")
