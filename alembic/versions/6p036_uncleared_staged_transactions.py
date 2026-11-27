"""Drop waiting staged transactions that are still uncleared (TDD 02, decision F6).

From this revision sync stages a transaction only once its source reports it
cleared. This deletes the waiting items staged earlier whose latest source copy
is uncleared, with their proposals; YNAB sends each again when it clears, and
the next sync stages it then. Recorded, conflict, skipped and removed items are
kept whatever their cleared status. No schema change. The downgrade cannot
restore the deleted rows and changes nothing; a later sync re-stages them once
they clear.
"""

from alembic import op

revision = "6p036"
down_revision = "6o035"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        "DELETE FROM staged_transaction"
        " WHERE status = 'waiting' AND (latest->>'cleared')::boolean IS NOT TRUE"
    )


def downgrade():
    pass
