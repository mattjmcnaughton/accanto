"""Transaction sources and the Transactions inbox of staged transactions.

Additive only. Staged transactions are not actual entries and never contribute to
totals; an entry exists only after an explicit record command links it here.
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "6a021"
down_revision = "5l020"
branch_labels = None
depends_on = None

STATUSES = "'waiting', 'skipped', 'recorded', 'conflict', 'removed'"


def identity():
    return [
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("uuid", sa.Uuid(), nullable=False, unique=True),
    ]


def upgrade():
    op.create_table(
        "transaction_source",
        *identity(),
        sa.Column(
            "entity_id", sa.BigInteger(), sa.ForeignKey("entity.id"), nullable=False
        ),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("external_ref", sa.String(120), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("secret_ciphertext", sa.Text(), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("cursor", sa.String(64)),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("last_synced_at", sa.DateTime(timezone=True)),
        sa.Column("disconnected_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint("id", "entity_id"),
        sa.CheckConstraint("kind IN ('ynab')"),
    )
    op.create_index(
        "one_connected_source",
        "transaction_source",
        ["entity_id", "kind", "external_ref"],
        unique=True,
        postgresql_where=sa.text("disconnected_at IS NULL"),
    )
    op.create_table(
        "source_account_selection",
        *identity(),
        sa.Column("source_id", sa.BigInteger(), nullable=False),
        sa.Column("entity_id", sa.BigInteger(), nullable=False),
        sa.Column("account_ref", sa.String(120), nullable=False),
        sa.Column("name_snapshot", sa.String(200), nullable=False),
        sa.ForeignKeyConstraint(
            ["source_id", "entity_id"],
            ["transaction_source.id", "transaction_source.entity_id"],
        ),
        sa.UniqueConstraint("source_id", "account_ref"),
    )
    op.create_table(
        "staged_transaction",
        *identity(),
        sa.Column("entity_id", sa.BigInteger(), nullable=False),
        sa.Column("source_id", sa.BigInteger(), nullable=False),
        sa.Column("source_ref", sa.String(200), nullable=False),
        sa.Column("parent_ref", sa.String(120)),
        sa.Column("financial_date", sa.Date(), nullable=False),
        sa.Column("latest", postgresql.JSONB(), nullable=False),
        sa.Column("status", sa.String(), nullable=False, server_default="waiting"),
        sa.Column("actual_entry_id", sa.BigInteger(), unique=True),
        sa.Column("rejection", postgresql.JSONB()),
        sa.Column(
            "changed_after_staging",
            sa.Boolean(),
            nullable=False,
            server_default="false",
        ),
        sa.Column("proposal", postgresql.JSONB()),
        sa.Column("proposal_rejection", postgresql.JSONB()),
        sa.Column("proposed_by_user_id", sa.BigInteger(), sa.ForeignKey("app_user.id")),
        sa.Column("proposed_interface", sa.String()),
        sa.Column("proposed_at", sa.DateTime(timezone=True)),
        sa.Column(
            "staged_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        sa.ForeignKeyConstraint(
            ["source_id", "entity_id"],
            ["transaction_source.id", "transaction_source.entity_id"],
        ),
        sa.ForeignKeyConstraint(
            ["actual_entry_id", "entity_id"],
            ["actual_entry.id", "actual_entry.entity_id"],
        ),
        sa.UniqueConstraint("source_id", "source_ref"),
        sa.CheckConstraint(f"status IN ({STATUSES})"),
        sa.CheckConstraint(
            "(status IN ('recorded', 'conflict')) = (actual_entry_id IS NOT NULL)",
            name="staged_entry_matches_status",
        ),
    )
    op.create_index(
        "staged_transaction_inbox",
        "staged_transaction",
        ["entity_id", "status", "financial_date"],
    )


def downgrade():
    op.drop_index("staged_transaction_inbox", table_name="staged_transaction")
    op.drop_table("staged_transaction")
    op.drop_table("source_account_selection")
    op.drop_index("one_connected_source", table_name="transaction_source")
    op.drop_table("transaction_source")
