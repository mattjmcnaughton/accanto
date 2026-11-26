"""Job runs: leased background work claimed by the in-process reconciler.

Additive only (TDD 11). Operational state, never financial activity. Reapply the
runtime grants in docs/api.md for accanto_app after upgrading.
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "6i029"
down_revision = "6h028"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "job_run",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("uuid", sa.Uuid(), nullable=False, unique=True),
        sa.Column(
            "entity_id", sa.BigInteger(), sa.ForeignKey("entity.id"), nullable=False
        ),
        sa.Column("kind", sa.String(80), nullable=False),
        sa.Column("user_id", sa.BigInteger(), sa.ForeignKey("app_user.id")),
        sa.Column("state", sa.String(), nullable=False, server_default="queued"),
        sa.Column("claimed_at", sa.DateTime(timezone=True)),
        sa.Column("claims", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("steps", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "counts",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("error_code", sa.String(80)),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("finished_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint(
            "state IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')",
            name="job_run_state_check",
        ),
        sa.CheckConstraint(
            "(state = 'running') = (claimed_at IS NOT NULL)",
            name="job_run_lease_check",
        ),
    )
    # At most one active run per Entity and kind.
    op.create_index(
        "job_run_active",
        "job_run",
        ["entity_id", "kind"],
        unique=True,
        postgresql_where=sa.text("state IN ('queued', 'running')"),
    )


def downgrade():
    op.drop_index("job_run_active", table_name="job_run")
    op.drop_table("job_run")
