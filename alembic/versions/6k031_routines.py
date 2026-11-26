"""Routines: per-Entity checklists on a cadence, ticked by a person (TDD 13).

Additive only. Routines are not financial records; nothing existing changes and
nothing is backfilled. Reapply the runtime grants in docs/api.md for accanto_app
after upgrading.
"""

import sqlalchemy as sa

from alembic import op

revision = "6k031"
down_revision = "6j030"
branch_labels = None
depends_on = None


def identity():
    return [
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("uuid", sa.Uuid(), nullable=False, unique=True),
    ]


def upgrade():
    op.create_table(
        "routine",
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
        sa.Column("starts_on", sa.Date(), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
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
            name="routine_cadence_check",
        ),
        sa.CheckConstraint("month_day = -1 OR month_day BETWEEN 1 AND 28"),
        sa.CheckConstraint("week = -1 OR week BETWEEN 1 AND 4"),
        sa.CheckConstraint("weekday BETWEEN 0 AND 6"),
    )
    op.create_index("routine_entity", "routine", ["entity_id"])
    op.create_table(
        "routine_step",
        *identity(),
        sa.Column("routine_id", sa.BigInteger(), nullable=False),
        sa.Column("entity_id", sa.BigInteger(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("link_screen", sa.String(20)),
        sa.Column("link_month_offset", sa.SmallInteger()),
        sa.Column("link_url", sa.String(2000)),
        sa.Column("active", sa.Boolean(), nullable=False, server_default="true"),
        sa.ForeignKeyConstraint(
            ["routine_id", "entity_id"], ["routine.id", "routine.entity_id"]
        ),
        sa.UniqueConstraint("id", "routine_id"),
        sa.CheckConstraint("position >= 0"),
        sa.CheckConstraint("link_screen IS NULL OR link_url IS NULL"),
        sa.CheckConstraint(
            "link_month_offset IS NULL OR "
            "(link_screen IN ('home', 'activity', 'review') "
            "AND link_month_offset BETWEEN -12 AND 12)"
        ),
        sa.CheckConstraint("link_url IS NULL OR link_url LIKE 'https://%'"),
    )
    op.create_index(
        "routine_step_position",
        "routine_step",
        ["routine_id", "position"],
        unique=True,
        postgresql_where=sa.text("active"),
    )
    op.create_table(
        "routine_occurrence",
        *identity(),
        sa.Column("routine_id", sa.BigInteger(), nullable=False),
        sa.Column("entity_id", sa.BigInteger(), nullable=False),
        sa.Column("scheduled_on", sa.Date(), nullable=False),
        sa.Column("skipped", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("completed_on", sa.Date()),
        sa.Column("note", sa.String(4000), nullable=False, server_default=""),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        sa.ForeignKeyConstraint(
            ["routine_id", "entity_id"], ["routine.id", "routine.entity_id"]
        ),
        sa.UniqueConstraint("id", "routine_id"),
        sa.UniqueConstraint("routine_id", "scheduled_on"),
        sa.CheckConstraint("revision >= 1"),
    )
    op.create_table(
        "routine_occurrence_step",
        *identity(),
        sa.Column("occurrence_id", sa.BigInteger(), nullable=False),
        sa.Column("step_id", sa.BigInteger(), nullable=False),
        sa.Column("routine_id", sa.BigInteger(), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("status", sa.String(10), nullable=False),
        sa.Column("note", sa.String(4000), nullable=False, server_default=""),
        sa.Column(
            "at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(
            ["occurrence_id", "routine_id"],
            ["routine_occurrence.id", "routine_occurrence.routine_id"],
        ),
        sa.ForeignKeyConstraint(
            ["step_id", "routine_id"],
            ["routine_step.id", "routine_step.routine_id"],
        ),
        sa.UniqueConstraint("occurrence_id", "step_id"),
        sa.CheckConstraint("status IN ('done', 'skipped')"),
    )


def downgrade():
    op.drop_table("routine_occurrence_step")
    op.drop_table("routine_occurrence")
    op.drop_table("routine_step")
    op.drop_table("routine")
