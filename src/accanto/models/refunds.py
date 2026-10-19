"""Retained links between real refunds and their original purchases."""

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Column,
    ForeignKeyConstraint,
    UniqueConstraint,
)

from accanto.models.monthly import table

refunds = table(
    "entry_refund",
    Column("entity_id", BigInteger, nullable=False),
    Column("refund_entry_id", BigInteger, nullable=False),
    Column("original_entry_id", BigInteger, nullable=False),
    ForeignKeyConstraint(
        ["refund_entry_id", "entity_id"], ["actual_entry.id", "actual_entry.entity_id"]
    ),
    ForeignKeyConstraint(
        ["original_entry_id", "entity_id"],
        ["actual_entry.id", "actual_entry.entity_id"],
    ),
    UniqueConstraint("refund_entry_id"),
    CheckConstraint("refund_entry_id <> original_entry_id"),
)
