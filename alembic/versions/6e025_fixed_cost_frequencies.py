"""Weekly, biweekly and quarterly fixed-cost frequencies (TDD 06).

Widens the frequency check only; saved lines and their stored monthly amounts
are unchanged. Downgrade fails while any line uses a new frequency, because
saved lines are immutable and cannot be rewritten.
"""

from alembic import op

revision = "6e025"
down_revision = "6d024"
branch_labels = None
depends_on = None

NAME = "plan_fixed_cost_line_frequency_check"


def upgrade():
    op.drop_constraint(NAME, "plan_fixed_cost_line", type_="check")
    op.create_check_constraint(
        NAME,
        "plan_fixed_cost_line",
        "frequency IN ('weekly', 'biweekly', 'monthly', 'quarterly', 'annual')",
    )


def downgrade():
    op.drop_constraint(NAME, "plan_fixed_cost_line", type_="check")
    op.create_check_constraint(
        NAME, "plan_fixed_cost_line", "frequency IN ('monthly', 'annual')"
    )
