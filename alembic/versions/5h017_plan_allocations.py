"""Plan allocations, savings funding and preserved rollups.

Revision ID: 5h017
Revises: 5g016
"""

import sqlalchemy as sa

from alembic import op

revision = "5h017"
down_revision = "5g016"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "plan_fixed_cost_line", sa.Column("debt_account_name", sa.String(120))
    )
    for column in (
        "savings_funding_total",
        "funding_total",
        "saving_total",
        "investing_total",
        "giving_total",
        "allocation_total",
        "giving_difference",
    ):
        op.add_column("plan_revision", sa.Column(column, sa.Numeric(14, 2)))

    for name, target_table, target_column, label in (
        ("plan_savings_funding_line", "saving_account", "account_id", "account_name"),
        ("plan_saving_goal_line", "saving_goal", "goal_id", "goal_name"),
        ("plan_investment_line", "investment", "destination_id", "destination_name"),
        ("plan_giving_line", "giving_recipient", "destination_id", "destination_name"),
    ):
        op.create_table(
            name,
            sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
            sa.Column("uuid", sa.Uuid(), nullable=False, unique=True),
            sa.Column("plan_revision_id", sa.BigInteger(), nullable=False),
            sa.Column("entity_id", sa.BigInteger(), nullable=False),
            sa.Column(target_column, sa.BigInteger(), nullable=False),
            sa.Column(label, sa.String(120), nullable=False),
            sa.Column("amount", sa.Numeric(14, 2), nullable=False),
            sa.ForeignKeyConstraint(
                ["plan_revision_id", "entity_id"],
                ["plan_revision.id", "plan_revision.entity_id"],
            ),
            sa.ForeignKeyConstraint(
                [target_column, "entity_id"],
                [f"{target_table}.id", f"{target_table}.entity_id"],
            ),
            sa.UniqueConstraint("plan_revision_id", target_column),
            sa.CheckConstraint("amount BETWEEN 0 AND 999999999.99"),
        )
        op.execute(f"""
            CREATE TRIGGER saved_{name}_immutable
            BEFORE INSERT OR UPDATE OR DELETE ON {name}
            FOR EACH ROW EXECUTE FUNCTION protect_saved_line()
        """)


def downgrade():
    for name in (
        "plan_giving_line",
        "plan_investment_line",
        "plan_saving_goal_line",
        "plan_savings_funding_line",
    ):
        op.drop_table(name)
    for column in (
        "giving_difference",
        "allocation_total",
        "giving_total",
        "investing_total",
        "saving_total",
        "funding_total",
        "savings_funding_total",
    ):
        op.drop_column("plan_revision", column)
    op.drop_column("plan_fixed_cost_line", "debt_account_name")
