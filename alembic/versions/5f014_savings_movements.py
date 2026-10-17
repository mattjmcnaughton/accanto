"""One ordered savings movement and goal-level reconciliation records."""
# ruff: noqa: E501 -- schema constraints are clearer in migration form.

import sqlalchemy as sa

from alembic import op

revision = "5f014"
down_revision = "5f010"
branch_labels = None
depends_on = None


def movement(name):
    op.create_table(
        name,
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("uuid", sa.Uuid(), nullable=False, unique=True),
        sa.Column(
            "entity_id", sa.BigInteger(), sa.ForeignKey("entity.id"), nullable=False
        ),
        sa.Column("financial_date", sa.Date(), nullable=False),
        sa.Column("from_goal_id", sa.BigInteger(), nullable=False),
        sa.Column("to_goal_id", sa.BigInteger(), nullable=False),
        sa.Column("amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("note", sa.String(2000), nullable=False, server_default=""),
        sa.Column(
            "recording_order",
            sa.BigInteger(),
            nullable=False,
            server_default=sa.text("nextval('saving_activity_recording_order_seq')"),
            unique=True,
        ),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
        sa.ForeignKeyConstraint(
            ["from_goal_id", "entity_id"], ["saving_goal.id", "saving_goal.entity_id"]
        ),
        sa.ForeignKeyConstraint(
            ["to_goal_id", "entity_id"], ["saving_goal.id", "saving_goal.entity_id"]
        ),
        sa.CheckConstraint("from_goal_id <> to_goal_id"),
        sa.CheckConstraint("amount > 0 AND amount <= 999999999.99"),
        sa.CheckConstraint("revision >= 1"),
    )


def upgrade():
    movement("savings_reassignment")
    movement("savings_transfer")
    op.create_table(
        "savings_balance_adjustment",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("uuid", sa.Uuid(), nullable=False, unique=True),
        sa.Column(
            "entity_id", sa.BigInteger(), sa.ForeignKey("entity.id"), nullable=False
        ),
        sa.Column("goal_id", sa.BigInteger(), nullable=False),
        sa.Column("financial_date", sa.Date(), nullable=False),
        sa.Column("amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("note", sa.String(2000), nullable=False, server_default=""),
        sa.Column(
            "recording_order",
            sa.BigInteger(),
            nullable=False,
            server_default=sa.text("nextval('saving_activity_recording_order_seq')"),
            unique=True,
        ),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
        sa.ForeignKeyConstraint(
            ["goal_id", "entity_id"], ["saving_goal.id", "saving_goal.entity_id"]
        ),
        sa.CheckConstraint("amount BETWEEN -999999999.99 AND 999999999.99"),
        sa.CheckConstraint("amount <> 0"),
        sa.CheckConstraint("revision >= 1"),
    )
    op.execute("""CREATE FUNCTION preserve_savings_recording_order() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF NEW.recording_order <> OLD.recording_order THEN
                RAISE EXCEPTION 'Savings recording order is immutable';
            END IF;
            RETURN NEW;
        END $$""")
    for name in (
        "savings_reassignment",
        "savings_transfer",
        "savings_balance_adjustment",
    ):
        op.execute(
            f"CREATE TRIGGER {name}_order_immutable BEFORE UPDATE ON {name} FOR EACH ROW EXECUTE FUNCTION preserve_savings_recording_order()"
        )


def downgrade():
    for name in (
        "savings_reassignment",
        "savings_transfer",
        "savings_balance_adjustment",
    ):
        op.drop_table(name)
    op.execute("DROP FUNCTION preserve_savings_recording_order()")
