"""Projection assumptions on investments and the Entity (TDD 14).

Additive only. Each investment may carry an expected annual return and an
expected contribution (monthly or annual); the Entity carries a default return
for investments without one, and the FIRE inputs (annual spending, withdrawal
rate). None of these is financial activity, and nothing is backfilled beyond
column defaults. Inflation is not modelled (issue #44). Reapply the runtime
grants in docs/api.md for accanto_app after upgrading.
"""

import sqlalchemy as sa

from alembic import op

revision = "6n034"
down_revision = "6m033"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("investment", sa.Column("expected_return_percent", sa.Numeric(5, 2)))
    op.add_column("investment", sa.Column("expected_contribution", sa.Numeric(14, 2)))
    op.add_column(
        "investment",
        sa.Column(
            "expected_contribution_frequency",
            sa.String(10),
            nullable=False,
            server_default="monthly",
        ),
    )
    op.create_check_constraint(
        "investment_expected_return_check",
        "investment",
        "expected_return_percent IS NULL OR expected_return_percent BETWEEN -10 AND 30",
    )
    op.create_check_constraint(
        "investment_expected_contribution_check",
        "investment",
        "expected_contribution IS NULL "
        "OR expected_contribution BETWEEN 0 AND 999999999.99",
    )
    op.create_check_constraint(
        "investment_contribution_frequency_check",
        "investment",
        "expected_contribution_frequency IN ('monthly', 'annual')",
    )
    op.add_column(
        "entity",
        sa.Column(
            "default_return_percent",
            sa.Numeric(5, 2),
            nullable=False,
            server_default="6.00",
        ),
    )
    op.add_column("entity", sa.Column("fire_annual_spending", sa.Numeric(14, 2)))
    op.add_column(
        "entity",
        sa.Column(
            "fire_withdrawal_percent",
            sa.Numeric(4, 2),
            nullable=False,
            server_default="4.00",
        ),
    )
    op.create_check_constraint(
        "entity_default_return_check",
        "entity",
        "default_return_percent BETWEEN -10 AND 30",
    )
    op.create_check_constraint(
        "entity_fire_check",
        "entity",
        "(fire_annual_spending IS NULL "
        "OR fire_annual_spending BETWEEN 0.01 AND 999999999.99) "
        "AND fire_withdrawal_percent > 0 AND fire_withdrawal_percent <= 10",
    )


def downgrade():
    op.drop_constraint("entity_fire_check", "entity")
    op.drop_constraint("entity_default_return_check", "entity")
    op.drop_column("entity", "fire_withdrawal_percent")
    op.drop_column("entity", "fire_annual_spending")
    op.drop_column("entity", "default_return_percent")
    op.drop_constraint("investment_contribution_frequency_check", "investment")
    op.drop_constraint("investment_expected_contribution_check", "investment")
    op.drop_constraint("investment_expected_return_check", "investment")
    op.drop_column("investment", "expected_contribution_frequency")
    op.drop_column("investment", "expected_contribution")
    op.drop_column("investment", "expected_return_percent")
