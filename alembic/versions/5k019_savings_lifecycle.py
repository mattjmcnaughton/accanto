"""Preserve savings goal completion and account retirement provenance."""

# ruff: noqa: E501 -- SQL constraints and trigger definitions remain readable.

import sqlalchemy as sa

from alembic import op

revision = "5k019"
down_revision = "5j018"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "saving_goal",
        sa.Column("completed", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.add_column(
        "saving_goal",
        sa.Column(
            "archived_by_account", sa.Boolean(), nullable=False, server_default="false"
        ),
    )
    # The old unnamed role/target check required Unallocated to remain active even
    # when its entire account was retired. Find just that check, retaining others.
    op.execute("""DO $$ DECLARE item record; BEGIN
        FOR item IN SELECT conname FROM pg_constraint
          WHERE conrelid = 'saving_goal'::regclass AND contype = 'c'
            AND pg_get_constraintdef(oid) LIKE '%role%unallocated%kind%target%active%'
        LOOP EXECUTE format('ALTER TABLE saving_goal DROP CONSTRAINT %I', item.conname); END LOOP;
        END $$""")
    op.create_check_constraint(
        "saving_goal_definition",
        "saving_goal",
        "(role = 'unallocated' AND kind = 'ongoing' AND target IS NULL AND NOT completed AND (active OR archived_by_account)) OR (role = 'ordinary' AND (kind = 'ongoing' OR target > 0) AND (target IS NULL OR target > 0))",
    )
    op.create_check_constraint(
        "saving_goal_completed_state",
        "saving_goal",
        "NOT completed OR (kind = 'finite' AND role = 'ordinary' AND NOT active)",
    )
    op.create_check_constraint(
        "saving_goal_archive_state",
        "saving_goal",
        "NOT archived_by_account OR NOT active",
    )
    op.add_column(
        "savings_reassignment",
        sa.Column(
            "completion_goal_id", sa.BigInteger(), sa.ForeignKey("saving_goal.id")
        ),
    )
    op.execute("""CREATE FUNCTION retain_saving_completion() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF OLD.completion_goal_id IS NOT NULL THEN
            RAISE EXCEPTION 'Completion reassignment is retained with its lifecycle operation';
          END IF;
          RETURN NEW;
        END $$""")
    op.execute(
        "CREATE TRIGGER saving_completion_retained BEFORE UPDATE OR DELETE ON savings_reassignment FOR EACH ROW EXECUTE FUNCTION retain_saving_completion()"
    )


def downgrade():
    raise RuntimeError("Lifecycle history must be retained; use a forward migration.")
