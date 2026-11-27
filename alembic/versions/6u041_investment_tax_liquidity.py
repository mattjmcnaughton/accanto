"""An investment's tax treatment and liquidity.

Additive with defaults. Each investment is taxable (a brokerage account) or
tax-advantaged (a 401(k), IRA or HSA), and liquid (a stock fund) or illiquid
(a house). Existing investments take the column defaults, taxable and liquid,
which the owner corrects from each investment's Edit dialog. Neither changes
contributions, observations, net worth or projections yet. No new tables or
sequences, so no grant changes.
"""

import sqlalchemy as sa

from alembic import op

revision = "6u041"
down_revision = "6t040"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "investment",
        sa.Column(
            "tax_treatment", sa.String(14), nullable=False, server_default="taxable"
        ),
    )
    op.add_column(
        "investment",
        sa.Column("liquidity", sa.String(8), nullable=False, server_default="liquid"),
    )
    op.create_check_constraint(
        "investment_tax_treatment_check",
        "investment",
        "tax_treatment IN ('taxable', 'tax_advantaged')",
    )
    op.create_check_constraint(
        "investment_liquidity_check",
        "investment",
        "liquidity IN ('liquid', 'illiquid')",
    )


def downgrade():
    op.drop_constraint("investment_liquidity_check", "investment")
    op.drop_constraint("investment_tax_treatment_check", "investment")
    op.drop_column("investment", "liquidity")
    op.drop_column("investment", "tax_treatment")
