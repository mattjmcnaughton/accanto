"""Add browser credentials without changing historical financial records."""

import sqlalchemy as sa

from alembic import op

revision = "2a002"
down_revision = "191e70341645"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "browser_session",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("uuid", sa.Uuid(), nullable=False, unique=True),
        sa.Column(
            "user_id", sa.BigInteger(), sa.ForeignKey("app_user.id"), nullable=False
        ),
        sa.Column("digest", sa.String(64), nullable=False, unique=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True)),
    )
    op.alter_column("audit_log", "api_key_uuid", nullable=True)
    op.add_column("audit_log", sa.Column("session_uuid", sa.Uuid(), nullable=True))


def downgrade():
    # Session-attributed history cannot be converted to API-key history honestly.
    raise RuntimeError(
        "Session audit cannot be downgraded; use a forward repair preserving history."
    )
