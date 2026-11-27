"""Entity members: Users who share an Entity with its owner (TDD 19).

The owner stays `entity.owner_id`; each row here gives one other User full
access to that Entity's finances, with a name the owner chose for them.
app_user.email keeps the verified email of each User's latest browser sign-in,
so an owner can add a member by email; it is empty until they sign in again.
Nothing is backfilled. Reapply the runtime grants in docs/api.md for
accanto_app after upgrading. The downgrade removes every membership.
"""

import sqlalchemy as sa

from alembic import op

revision = "6x044"
down_revision = "6w043"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("app_user", sa.Column("email", sa.String(320)))
    op.create_table(
        "entity_member",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("uuid", sa.Uuid(), nullable=False, unique=True),
        sa.Column(
            "entity_id", sa.BigInteger(), sa.ForeignKey("entity.id"), nullable=False
        ),
        sa.Column(
            "user_id", sa.BigInteger(), sa.ForeignKey("app_user.id"), nullable=False
        ),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint("entity_id", "user_id"),
    )
    op.create_index("entity_member_user", "entity_member", ["user_id"])


def downgrade():
    op.drop_table("entity_member")
    op.drop_column("app_user", "email")
