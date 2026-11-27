"""Bug reports (TDD 21): an opted-in User's notes about Accanto itself.

Adds `app_user.report_bug_enabled` (default false; sign-in sets it from
REPORT_BUG_EMAILS) and the `bug_report` table. Additive; `6y045` code never
reads either. Reapply the runtime grants in docs/api.md for accanto_app after
upgrading: the new table has an identity sequence. The downgrade drops the
reports.
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

revision = "6z046"
down_revision = "6y045"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "app_user",
        sa.Column(
            "report_bug_enabled",
            sa.Boolean(),
            nullable=False,
            server_default="false",
        ),
    )
    op.create_table(
        "bug_report",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("uuid", sa.Uuid(), nullable=False, unique=True),
        sa.Column(
            "user_id", sa.BigInteger(), sa.ForeignKey("app_user.id"), nullable=False
        ),
        sa.Column("kind", sa.String(4), nullable=False),
        sa.Column("note", sa.String(2000), nullable=False),
        sa.Column("context", JSONB(), nullable=False),
        sa.Column("status", sa.String(7), nullable=False, server_default="open"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("resolved_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint(
            "kind IN ('bug', 'idea', 'fix')", name="bug_report_kind_check"
        ),
        sa.CheckConstraint(
            "status IN ('open', 'done', 'wont_do')", name="bug_report_status_check"
        ),
        sa.CheckConstraint(
            "(status = 'open') = (resolved_at IS NULL)",
            name="bug_report_resolved_check",
        ),
    )
    op.create_index("bug_report_user", "bug_report", ["user_id", "id"])


def downgrade():
    op.drop_table("bug_report")
    op.drop_column("app_user", "report_bug_enabled")
