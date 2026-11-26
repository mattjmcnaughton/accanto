"""Spending subcategories: guilt-free spending's Assignment (TDD 07).

Additive only. Existing spending entries stay Unassigned; nothing is backfilled.
Reapply the runtime grants in docs/api.md for accanto_app after upgrading.
"""

import sqlalchemy as sa

from alembic import op

revision = "6f026"
down_revision = "6e025"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "spending_subcategory",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("uuid", sa.Uuid(), nullable=False, unique=True),
        sa.Column(
            "entity_id", sa.BigInteger(), sa.ForeignKey("entity.id"), nullable=False
        ),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        sa.UniqueConstraint("id", "entity_id"),
        sa.CheckConstraint("revision >= 1"),
    )
    op.create_index(
        "spending_subcategory_entity_name",
        "spending_subcategory",
        ["entity_id", sa.text("lower(name)")],
        unique=True,
    )
    op.create_table(
        "entry_spending_subcategory",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("uuid", sa.Uuid(), nullable=False, unique=True),
        sa.Column("actual_entry_id", sa.BigInteger(), nullable=False, unique=True),
        sa.Column("spending_subcategory_id", sa.BigInteger(), nullable=False),
        sa.Column("entity_id", sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(
            ["actual_entry_id", "entity_id"],
            ["actual_entry.id", "actual_entry.entity_id"],
        ),
        sa.ForeignKeyConstraint(
            ["spending_subcategory_id", "entity_id"],
            ["spending_subcategory.id", "spending_subcategory.entity_id"],
        ),
    )
    op.create_index(
        "entry_spending_subcategory_subcategory",
        "entry_spending_subcategory",
        ["spending_subcategory_id"],
    )


def downgrade():
    op.drop_table("entry_spending_subcategory")
    op.drop_table("spending_subcategory")
