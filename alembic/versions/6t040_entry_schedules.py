"""Entry schedules: entries staged in the inbox on a cadence by the tick (TDD 18).

A schedule describes one or more entries and a Routine-style cadence; each
scheduled date it reaches is stored once as an occurrence (staged, skipped or
failed). A staged date's entries wait in the Transactions inbox as staged
transactions that come from the occurrence instead of a Transaction source, so
staged_transaction.source_id becomes nullable. Existing rows are unchanged and
nothing is backfilled. Reapply the runtime grants in docs/api.md for
accanto_app after upgrading. The downgrade deletes scheduled inbox items.
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

revision = "6t040"
down_revision = "6s039"
branch_labels = None
depends_on = None


def identity():
    return [
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("uuid", sa.Uuid(), nullable=False, unique=True),
    ]


def upgrade():
    op.create_table(
        "entry_schedule",
        *identity(),
        sa.Column(
            "entity_id", sa.BigInteger(), sa.ForeignKey("entity.id"), nullable=False
        ),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("frequency", sa.String(10), nullable=False),
        sa.Column("interval", sa.SmallInteger(), nullable=False),
        sa.Column("weekdays", sa.SmallInteger()),
        sa.Column("month_day", sa.SmallInteger()),
        sa.Column("week", sa.SmallInteger()),
        sa.Column("weekday", sa.SmallInteger()),
        sa.Column("month", sa.SmallInteger()),
        sa.Column("weekend", sa.String(6)),
        sa.Column("starts_on", sa.Date(), nullable=False),
        sa.Column("ends_on", sa.Date()),
        sa.Column("paused", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("next_on", sa.Date()),
        sa.Column("lines", JSONB(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint("id", "entity_id"),
        sa.CheckConstraint("revision >= 1"),
        sa.CheckConstraint("interval BETWEEN 1 AND 52"),
        sa.CheckConstraint(
            "(frequency = 'weekly' AND weekdays BETWEEN 1 AND 127 "
            "AND month_day IS NULL AND week IS NULL AND weekday IS NULL "
            "AND month IS NULL) OR "
            "(frequency = 'monthly' AND weekdays IS NULL AND month IS NULL AND ("
            "(month_day IS NOT NULL AND week IS NULL AND weekday IS NULL) OR "
            "(month_day IS NULL AND week IS NOT NULL AND weekday IS NOT NULL))) OR "
            "(frequency = 'yearly' AND weekdays IS NULL AND week IS NULL "
            "AND weekday IS NULL AND month BETWEEN 1 AND 12 "
            "AND month_day IS NOT NULL)",
            name="entry_schedule_cadence_check",
        ),
        sa.CheckConstraint("month_day = -1 OR month_day BETWEEN 1 AND 28"),
        sa.CheckConstraint("week = -1 OR week BETWEEN 1 AND 4"),
        sa.CheckConstraint("weekday BETWEEN 0 AND 6"),
        sa.CheckConstraint(
            "weekend IS NULL OR (weekend IN ('before', 'after') "
            "AND month_day IS NOT NULL)"
        ),
        sa.CheckConstraint("ends_on IS NULL OR ends_on >= starts_on"),
        sa.CheckConstraint("jsonb_typeof(lines) = 'array'"),
    )
    op.create_index("entry_schedule_entity", "entry_schedule", ["entity_id"])
    # The tick's scan: schedules with a date to record.
    op.create_index(
        "entry_schedule_due",
        "entry_schedule",
        ["next_on"],
        postgresql_where=sa.text("NOT paused AND next_on IS NOT NULL"),
    )
    op.create_table(
        "entry_schedule_occurrence",
        *identity(),
        sa.Column("schedule_id", sa.BigInteger(), nullable=False),
        sa.Column("entity_id", sa.BigInteger(), nullable=False),
        sa.Column("scheduled_on", sa.Date(), nullable=False),
        sa.Column("status", sa.String(10), nullable=False),
        sa.Column("rejection", JSONB()),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(
            ["schedule_id", "entity_id"],
            ["entry_schedule.id", "entry_schedule.entity_id"],
        ),
        sa.UniqueConstraint("id", "entity_id"),
        # Each date is staged, skipped or failed once: the idempotency guarantee.
        sa.UniqueConstraint("schedule_id", "scheduled_on"),
        sa.CheckConstraint("status IN ('staged', 'skipped', 'failed')"),
        sa.CheckConstraint("(status = 'failed') = (rejection IS NOT NULL)"),
        sa.CheckConstraint("revision >= 1"),
    )
    op.create_index(
        "entry_schedule_occurrence_failed",
        "entry_schedule_occurrence",
        ["schedule_id"],
        postgresql_where=sa.text("status = 'failed'"),
    )
    # A scheduled inbox item comes from an occurrence instead of a source;
    # source_ref is its line ("line-1"), unique within the occurrence.
    op.alter_column("staged_transaction", "source_id", nullable=True)
    op.add_column(
        "staged_transaction",
        sa.Column("schedule_occurrence_id", sa.BigInteger()),
    )
    op.create_foreign_key(
        "staged_transaction_schedule_occurrence_fkey",
        "staged_transaction",
        "entry_schedule_occurrence",
        ["schedule_occurrence_id", "entity_id"],
        ["id", "entity_id"],
    )
    op.create_check_constraint(
        "staged_transaction_one_origin",
        "staged_transaction",
        "(source_id IS NULL) <> (schedule_occurrence_id IS NULL)",
    )
    op.create_index(
        "staged_transaction_schedule_line",
        "staged_transaction",
        ["schedule_occurrence_id", "source_ref"],
        unique=True,
        postgresql_where=sa.text("schedule_occurrence_id IS NOT NULL"),
    )


def downgrade():
    op.execute(
        "DELETE FROM staged_transaction WHERE schedule_occurrence_id IS NOT NULL"
    )
    op.drop_index("staged_transaction_schedule_line", "staged_transaction")
    op.drop_constraint("staged_transaction_one_origin", "staged_transaction")
    op.drop_constraint(
        "staged_transaction_schedule_occurrence_fkey", "staged_transaction"
    )
    op.drop_column("staged_transaction", "schedule_occurrence_id")
    op.alter_column("staged_transaction", "source_id", nullable=False)
    op.drop_table("entry_schedule_occurrence")
    op.drop_table("entry_schedule")
