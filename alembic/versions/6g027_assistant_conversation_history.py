"""Assistant conversation history: several conversations per User and Entity.

Drops the one-per-Entity constraint and adds archived_at (archive hides a
conversation; retention still hard-deletes it 30 days after its last turn).
Existing conversations stay as each history's first entry. Reapply the runtime
grants in docs/api.md for accanto_app after upgrading.
"""

import sqlalchemy as sa

from alembic import op

revision = "6g027"
down_revision = "6f026"
branch_labels = None
depends_on = None


def upgrade():
    op.drop_constraint("agent_conversation_user_id_entity_id_key", "agent_conversation")
    op.add_column(
        "agent_conversation",
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "agent_conversation_owner", "agent_conversation", ["user_id", "entity_id"]
    )


def downgrade():
    # Keeps only each User and Entity's latest conversation, as before.
    op.execute(
        "DELETE FROM agent_conversation c USING agent_conversation d"
        " WHERE c.user_id = d.user_id AND c.entity_id = d.entity_id"
        " AND (c.expires_at, c.id) < (d.expires_at, d.id)"
    )
    op.drop_index("agent_conversation_owner", table_name="agent_conversation")
    op.drop_column("agent_conversation", "archived_at")
    op.create_unique_constraint(
        "agent_conversation_user_id_entity_id_key",
        "agent_conversation",
        ["user_id", "entity_id"],
    )
