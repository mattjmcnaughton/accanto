"""Activity pages: index current entries by Entity, newest financial date first.

Activity reads one page at a time, newest financial date first and then in
recording order, with the next page starting after the last entry. This index
serves that order and a month's range without reading the Entity's whole
history. No rows change.
"""

import sqlalchemy as sa

from alembic import op

revision = "6w043"
down_revision = "6v042"
branch_labels = None
depends_on = None


def upgrade():
    op.create_index(
        "actual_entry_entity_date",
        "actual_entry",
        ["entity_id", sa.text("financial_date DESC"), "id"],
        postgresql_where=sa.text("deleted_at IS NULL"),
    )


def downgrade():
    op.drop_index("actual_entry_entity_date", table_name="actual_entry")
