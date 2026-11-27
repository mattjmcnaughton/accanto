"""Delete Entity (TDD 22): entity.deleted_at marks an Entity its owner deleted.

A deleted Entity stays stored with its financial records and append-only audit
history, unreachable through every interface. No new tables or sequences, so no
grant changes. Nothing is backfilled. The downgrade drops the column, which
would make deleted Entities reachable again: never run it after an Entity was
deleted.
"""

import sqlalchemy as sa

from alembic import op

revision = "7a047"
down_revision = "6z046"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("entity", sa.Column("deleted_at", sa.DateTime(timezone=True)))


def downgrade():
    op.drop_column("entity", "deleted_at")
