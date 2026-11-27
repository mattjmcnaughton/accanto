"""Add the owner's note to staged transactions.

A free-text annotation on an inbox item, kept on the recorded entry's note.
Existing rows get an empty note. Downgrade drops the notes.
"""

import sqlalchemy as sa

from alembic import op

revision = "6q037"
down_revision = "6p036"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "staged_transaction",
        sa.Column("note", sa.String(1000), nullable=False, server_default=""),
    )
    op.add_column(
        "staged_transaction",
        sa.Column("noted_at", sa.DateTime(timezone=True)),
    )


def downgrade():
    op.drop_column("staged_transaction", "noted_at")
    op.drop_column("staged_transaction", "note")
