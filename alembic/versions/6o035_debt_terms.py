"""Fixed-rate loan terms on Debt accounts (TDD 15).

Additive only. A Debt account may carry a fixed annual interest rate and a
level monthly payment; both are null for existing accounts, which keep working
and stay flat in projections. Neither is activity or an observation. Reapply
the runtime grants in docs/api.md for accanto_app after upgrading.
"""

import sqlalchemy as sa

from alembic import op

revision = "6o035"
down_revision = "6n034"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("debt_account", sa.Column("interest_rate_percent", sa.Numeric(5, 2)))
    op.add_column("debt_account", sa.Column("monthly_payment", sa.Numeric(14, 2)))
    op.create_check_constraint(
        "debt_account_interest_rate_check",
        "debt_account",
        "interest_rate_percent IS NULL OR interest_rate_percent BETWEEN 0 AND 40",
    )
    op.create_check_constraint(
        "debt_account_monthly_payment_check",
        "debt_account",
        "monthly_payment IS NULL OR monthly_payment BETWEEN 0.01 AND 999999999.99",
    )


def downgrade():
    op.drop_constraint("debt_account_monthly_payment_check", "debt_account")
    op.drop_constraint("debt_account_interest_rate_check", "debt_account")
    op.drop_column("debt_account", "monthly_payment")
    op.drop_column("debt_account", "interest_rate_percent")
