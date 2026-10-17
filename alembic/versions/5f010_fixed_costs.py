"""Named fixed-cost Plan lines and income-funded payment assignments."""
# ruff: noqa: E501 -- SQL statements remain readable in migration form.

import sqlalchemy as sa

from alembic import op

revision = "5f010"
down_revision = "5e015"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "plan_revision",
        sa.Column(
            "fixed_cost_total",
            sa.Numeric(14, 2),
            nullable=False,
            server_default="0",
        ),
    )
    op.create_table(
        "fixed_cost",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("uuid", sa.Uuid(), nullable=False, unique=True),
        sa.Column("plan_id", sa.BigInteger(), nullable=False),
        sa.Column("entity_id", sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(
            ["plan_id", "entity_id"], ["plan.id", "plan.entity_id"]
        ),
        sa.UniqueConstraint("id", "entity_id"),
        sa.UniqueConstraint("id", "plan_id"),
    )
    op.create_table(
        "plan_fixed_cost_line",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("uuid", sa.Uuid(), nullable=False, unique=True),
        sa.Column("plan_revision_id", sa.BigInteger(), nullable=False),
        sa.Column("plan_id", sa.BigInteger(), nullable=False),
        sa.Column("fixed_cost_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("frequency", sa.String(), nullable=False),
        sa.Column("monthly_amount", sa.Numeric(14, 2), nullable=False),
        sa.ForeignKeyConstraint(
            ["plan_revision_id", "plan_id"],
            ["plan_revision.id", "plan_revision.plan_id"],
        ),
        sa.ForeignKeyConstraint(
            ["fixed_cost_id", "plan_id"], ["fixed_cost.id", "fixed_cost.plan_id"]
        ),
        sa.UniqueConstraint("plan_revision_id", "fixed_cost_id"),
        sa.CheckConstraint("frequency IN ('monthly', 'annual')"),
        sa.CheckConstraint("amount BETWEEN 0 AND 999999999.99"),
        sa.CheckConstraint("monthly_amount BETWEEN 0 AND 999999999.99"),
    )
    op.execute("""
        CREATE TRIGGER saved_fixed_cost_line_immutable
        BEFORE INSERT OR UPDATE OR DELETE ON plan_fixed_cost_line
        FOR EACH ROW EXECUTE FUNCTION protect_saved_line()
    """)
    op.create_table(
        "entry_fixed_cost",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("uuid", sa.Uuid(), nullable=False, unique=True),
        sa.Column("actual_entry_id", sa.BigInteger(), nullable=False, unique=True),
        sa.Column("fixed_cost_id", sa.BigInteger(), nullable=False),
        sa.Column("entity_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.ForeignKeyConstraint(
            ["actual_entry_id", "entity_id"],
            ["actual_entry.id", "actual_entry.entity_id"],
        ),
        sa.ForeignKeyConstraint(
            ["fixed_cost_id", "entity_id"], ["fixed_cost.id", "fixed_cost.entity_id"]
        ),
    )
    op.drop_constraint("actual_entry_category_check", "actual_entry", type_="check")
    op.create_check_constraint(
        "actual_entry_category_check",
        "actual_entry",
        "category IN ('income', 'spending', 'saving', 'investing', 'giving', 'fixed_cost')",
    )
    op.execute("""
        CREATE FUNCTION require_fixed_cost_assignment()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM entry_fixed_cost a JOIN actual_entry e
                    ON e.id = a.actual_entry_id
                WHERE e.category <> 'fixed_cost'
            ) THEN RAISE EXCEPTION 'Fixed cost assignment requires fixed_cost category'; END IF;
            RETURN NULL;
        END $$
    """)
    for table in ("entry_fixed_cost", "actual_entry"):
        op.execute(f"""
            CREATE CONSTRAINT TRIGGER valid_fixed_cost_assignment
            AFTER INSERT OR UPDATE ON {table} DEFERRABLE INITIALLY DEFERRED
            FOR EACH ROW EXECUTE FUNCTION require_fixed_cost_assignment()
        """)


def downgrade():
    for table in ("actual_entry", "entry_fixed_cost"):
        op.execute(f"DROP TRIGGER valid_fixed_cost_assignment ON {table}")
    op.execute("DROP FUNCTION require_fixed_cost_assignment()")
    op.drop_constraint("actual_entry_category_check", "actual_entry", type_="check")
    op.create_check_constraint(
        "actual_entry_category_check",
        "actual_entry",
        "category IN ('income', 'spending', 'saving', 'investing', 'giving')",
    )
    op.drop_table("entry_fixed_cost")
    op.execute("DROP TRIGGER saved_fixed_cost_line_immutable ON plan_fixed_cost_line")
    op.drop_table("plan_fixed_cost_line")
    op.drop_table("fixed_cost")
    op.drop_column("plan_revision", "fixed_cost_total")
