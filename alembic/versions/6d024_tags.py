"""Tags: Entity-defined labels, zero or more per actual entry (TDD 05).

Additive only. Existing entries start untagged; nothing is backfilled. Reapply
the runtime grants in docs/api.md for accanto_app after upgrading.
"""

import sqlalchemy as sa

from alembic import op

revision = "6d024"
down_revision = "6c023"
branch_labels = None
depends_on = None


def identity():
    return [
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("uuid", sa.Uuid(), nullable=False, unique=True),
    ]


def upgrade():
    op.create_table(
        "tag",
        *identity(),
        sa.Column(
            "entity_id", sa.BigInteger(), sa.ForeignKey("entity.id"), nullable=False
        ),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint("id", "entity_id"),
        sa.CheckConstraint("revision >= 1"),
    )
    op.create_index(
        "tag_entity_name",
        "tag",
        ["entity_id", sa.text("lower(name)")],
        unique=True,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_table(
        "entry_tag",
        *identity(),
        sa.Column("actual_entry_id", sa.BigInteger(), nullable=False),
        sa.Column("tag_id", sa.BigInteger(), nullable=False),
        sa.Column("entity_id", sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(
            ["actual_entry_id", "entity_id"],
            ["actual_entry.id", "actual_entry.entity_id"],
        ),
        sa.ForeignKeyConstraint(["tag_id", "entity_id"], ["tag.id", "tag.entity_id"]),
        sa.UniqueConstraint("actual_entry_id", "tag_id"),
    )
    op.create_index("entry_tag_tag", "entry_tag", ["tag_id"])


def downgrade():
    op.drop_table("entry_tag")
    op.drop_table("tag")
