"""Transaction sources and staged transactions; never counted as actual entries."""

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Column,
    Date,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB

from accanto.models.monthly import table

# One Transaction provider credential per Entity, set in Settings. Every source of
# that kind reads through it; removing it keeps the row so revisions stay monotonic.
providers = table(
    "transaction_provider",
    Column("entity_id", ForeignKey("entity.id"), nullable=False, unique=True),
    Column("kind", String),
    Column("secret_ciphertext", Text),
    Column("revision", Integer, nullable=False, server_default="1"),
    CheckConstraint("kind IN ('ynab')"),
    CheckConstraint("(kind IS NULL) = (secret_ciphertext IS NULL)"),
)
sources = table(
    "transaction_source",
    Column("entity_id", ForeignKey("entity.id"), nullable=False),
    Column("kind", String, nullable=False),
    Column("external_ref", String(120), nullable=False),
    Column("name", String(200), nullable=False),
    # Legacy, always '': the token now lives in transaction_provider (6c023).
    Column("secret_ciphertext", Text, nullable=False, server_default=""),
    Column("start_date", Date, nullable=False),
    Column("cursor", String(64)),
    Column("revision", Integer, nullable=False, server_default="1"),
    Column(
        "created_at", DateTime(timezone=True), server_default=func.now(), nullable=False
    ),
    Column("last_synced_at", DateTime(timezone=True)),
    Column("disconnected_at", DateTime(timezone=True)),
    UniqueConstraint("id", "entity_id"),
    CheckConstraint("kind IN ('ynab')"),
)
Index(
    "one_connected_source",
    sources.c.entity_id,
    sources.c.kind,
    sources.c.external_ref,
    unique=True,
    postgresql_where=sources.c.disconnected_at.is_(None),
)
selections = table(
    "source_account_selection",
    Column("source_id", BigInteger, nullable=False),
    Column("entity_id", BigInteger, nullable=False),
    Column("account_ref", String(120), nullable=False),
    Column("name_snapshot", String(200), nullable=False),
    ForeignKeyConstraint(
        ["source_id", "entity_id"],
        ["transaction_source.id", "transaction_source.entity_id"],
    ),
    UniqueConstraint("source_id", "account_ref"),
)
staged = table(
    "staged_transaction",
    Column("entity_id", BigInteger, nullable=False),
    Column("source_id", BigInteger, nullable=False),
    Column("source_ref", String(200), nullable=False),
    Column("parent_ref", String(120)),
    Column("financial_date", Date, nullable=False),
    Column("latest", JSONB, nullable=False),
    Column("status", String, nullable=False, server_default="waiting"),
    Column("actual_entry_id", BigInteger, unique=True),
    Column("rejection", JSONB),
    Column("changed_after_staging", Boolean, nullable=False, server_default="false"),
    Column("proposal", JSONB),
    Column("proposal_rejection", JSONB),
    Column("proposed_by_user_id", ForeignKey("app_user.id")),
    Column("proposed_interface", String),
    Column("proposed_at", DateTime(timezone=True)),
    # The owner's note: context, or why a proposal is wrong. Kept on the
    # recorded entry's note; the agent reads it but never writes it.
    Column("note", String(1000), nullable=False, server_default=""),
    Column("noted_at", DateTime(timezone=True)),
    Column(
        "staged_at", DateTime(timezone=True), server_default=func.now(), nullable=False
    ),
    Column("revision", Integer, nullable=False, server_default="1"),
    ForeignKeyConstraint(
        ["source_id", "entity_id"],
        ["transaction_source.id", "transaction_source.entity_id"],
    ),
    ForeignKeyConstraint(
        ["actual_entry_id", "entity_id"], ["actual_entry.id", "actual_entry.entity_id"]
    ),
    UniqueConstraint("source_id", "source_ref"),
    CheckConstraint(
        "status IN ('waiting', 'skipped', 'recorded', 'conflict', 'removed')"
    ),
    CheckConstraint(
        "(status IN ('recorded', 'conflict')) = (actual_entry_id IS NOT NULL)",
        name="staged_entry_matches_status",
    ),
)
Index(
    "staged_transaction_inbox",
    staged.c.entity_id,
    staged.c.status,
    staged.c.financial_date,
)
