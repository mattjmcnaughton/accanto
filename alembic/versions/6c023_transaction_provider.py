"""Transaction provider credential per Entity, set in Settings.

Moves each Entity's YNAB token from its connected source to one Settings-level
row, so every source of that kind reads through it. Additive: the legacy source
column stays (emptied, defaulting to '') so the previous image still starts; it
then asks to reconnect. Reapply the runtime grants in docs/api.md for accanto_app
after upgrading.
"""

import sqlalchemy as sa

from alembic import op

revision = "6c023"
down_revision = "6b022"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "transaction_provider",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("uuid", sa.Uuid(), nullable=False, unique=True),
        sa.Column(
            "entity_id",
            sa.BigInteger(),
            sa.ForeignKey("entity.id"),
            nullable=False,
            unique=True,
        ),
        sa.Column("kind", sa.String()),
        sa.Column("secret_ciphertext", sa.Text()),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        sa.CheckConstraint("kind IN ('ynab')"),
        sa.CheckConstraint("(kind IS NULL) = (secret_ciphertext IS NULL)"),
    )
    # The newest connected source's token becomes the Entity's credential.
    op.execute(
        """
        INSERT INTO transaction_provider (uuid, entity_id, kind, secret_ciphertext)
        SELECT DISTINCT ON (entity_id)
               gen_random_uuid(), entity_id, kind, secret_ciphertext
        FROM transaction_source
        WHERE disconnected_at IS NULL AND secret_ciphertext <> ''
        ORDER BY entity_id, id DESC
        """
    )
    # Keep one copy of each token; new sources no longer write this column.
    op.alter_column("transaction_source", "secret_ciphertext", server_default="")
    op.execute("UPDATE transaction_source SET secret_ciphertext = ''")


def downgrade():
    op.execute(
        """
        UPDATE transaction_source s
        SET secret_ciphertext = p.secret_ciphertext
        FROM transaction_provider p
        WHERE p.entity_id = s.entity_id AND p.kind = s.kind
          AND s.disconnected_at IS NULL AND p.secret_ciphertext IS NOT NULL
        """
    )
    op.alter_column("transaction_source", "secret_ciphertext", server_default=None)
    op.drop_table("transaction_provider")
