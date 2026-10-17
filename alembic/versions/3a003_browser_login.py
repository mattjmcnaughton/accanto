"""Persist single-use browser-bound OIDC login transactions."""

import sqlalchemy as sa

from alembic import op

revision = "3a003"
down_revision = "2a002"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "oidc_login_transaction",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("uuid", sa.Uuid(), unique=True, nullable=False),
        sa.Column("state_digest", sa.String(64), unique=True, nullable=False),
        sa.Column("binding_digest", sa.String(64), nullable=False),
        sa.Column("nonce", sa.String(), nullable=False),
        sa.Column("verifier", sa.String(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade():
    op.drop_table("oidc_login_transaction")
