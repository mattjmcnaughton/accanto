"""Average annual inflation and fixed costs held level (TDD 17, issue #44).

Additive only. The Entity carries an average annual inflation percent (default
3.00) for today's-dollar projections and the FIRE target; each Fixed cost says
whether it rises with inflation (default true). A cost fixed in dollars, such
as a fixed-rate mortgage payment, is held level in the FIRE target. Neither is
financial activity. Reapply the runtime grants in docs/api.md for accanto_app
after upgrading.
"""

import sqlalchemy as sa

from alembic import op

revision = "6r038"
# Chains after inbox notes (6q037).
down_revision = "6q037"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "entity",
        sa.Column(
            "inflation_percent", sa.Numeric(4, 2), nullable=False, server_default="3.00"
        ),
    )
    op.create_check_constraint(
        "entity_inflation_check", "entity", "inflation_percent BETWEEN 0 AND 15"
    )
    op.add_column(
        "fixed_cost",
        sa.Column(
            "rises_with_inflation",
            sa.Boolean,
            nullable=False,
            server_default=sa.true(),
        ),
    )


def downgrade():
    op.drop_column("fixed_cost", "rises_with_inflation")
    op.drop_constraint("entity_inflation_check", "entity")
    op.drop_column("entity", "inflation_percent")
