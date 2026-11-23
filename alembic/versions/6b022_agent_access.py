"""Agent settings, Pending changes and built-in agent conversations.

Additive only. Pending changes are drafts that never contribute to totals; images
are never stored (messages keep only a count). Reapply the runtime grants in
docs/api.md for accanto_app after upgrading.
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "6b022"
down_revision = "6a021"
branch_labels = None
depends_on = None


def identity():
    return [
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("uuid", sa.Uuid(), nullable=False, unique=True),
    ]


def created_at(name="created_at"):
    return sa.Column(
        name, sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
    )


def upgrade():
    op.create_table(
        "agent_settings",
        *identity(),
        sa.Column(
            "entity_id",
            sa.BigInteger(),
            sa.ForeignKey("entity.id"),
            nullable=False,
            unique=True,
        ),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("mode", sa.String(), nullable=False, server_default="propose"),
        sa.Column("instructions", sa.Text(), nullable=False, server_default=""),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        sa.CheckConstraint("mode IN ('propose', 'record')"),
        sa.CheckConstraint("char_length(instructions) <= 20000"),
    )
    op.create_table(
        "pending_change",
        *identity(),
        sa.Column(
            "entity_id", sa.BigInteger(), sa.ForeignKey("entity.id"), nullable=False
        ),
        sa.Column("created_by_interface", sa.String(), nullable=False),
        sa.Column("tool", sa.String(80), nullable=False),
        sa.Column("operation", sa.String(80), nullable=False),
        sa.Column("input", postgresql.JSONB(), nullable=False),
        sa.Column("target", sa.String(120)),
        sa.Column("expected_revision", sa.Integer()),
        sa.Column("summary", sa.String(400), nullable=False),
        sa.Column("status", sa.String(), nullable=False, server_default="pending"),
        created_at(),
        sa.Column("resolved_at", sa.DateTime(timezone=True)),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        sa.CheckConstraint("created_by_interface IN ('mcp', 'agent')"),
        sa.CheckConstraint("status IN ('pending', 'applied', 'dismissed')"),
    )
    op.create_index(
        "pending_change_open", "pending_change", ["entity_id", "status", "created_at"]
    )
    op.create_table(
        "agent_conversation",
        *identity(),
        sa.Column(
            "user_id", sa.BigInteger(), sa.ForeignKey("app_user.id"), nullable=False
        ),
        sa.Column(
            "entity_id", sa.BigInteger(), sa.ForeignKey("entity.id"), nullable=False
        ),
        created_at(),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("user_id", "entity_id"),
    )
    op.create_table(
        "agent_message",
        *identity(),
        sa.Column(
            "conversation_id",
            sa.BigInteger(),
            sa.ForeignKey("agent_conversation.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("role", sa.String(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("image_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "pending_change_ids",
            postgresql.ARRAY(sa.Uuid()),
            nullable=False,
            server_default="{}",
        ),
        created_at(),
        sa.UniqueConstraint("conversation_id", "position"),
        sa.CheckConstraint("role IN ('owner', 'agent')"),
        sa.CheckConstraint("image_count BETWEEN 0 AND 4"),
    )


def downgrade():
    # Drafts and conversations only; no financial records or audit history.
    op.drop_table("agent_message")
    op.drop_table("agent_conversation")
    op.drop_index("pending_change_open", table_name="pending_change")
    op.drop_table("pending_change")
    op.drop_table("agent_settings")
