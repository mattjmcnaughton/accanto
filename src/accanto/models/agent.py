"""Agent settings, Pending changes and sidebar conversations (TDD 03).

Pending changes are drafts, not financial records: they never enter totals and
are applied only through the existing commands, which keep their own audit.
"""

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID

from accanto.models.monthly import table

settings = table(
    "agent_settings",
    Column("entity_id", ForeignKey("entity.id"), nullable=False, unique=True),
    Column("enabled", Boolean, nullable=False, server_default="false"),
    Column("mode", String, nullable=False, server_default="propose"),
    Column("instructions", Text, nullable=False, server_default=""),
    Column("revision", Integer, nullable=False, server_default="1"),
    CheckConstraint("mode IN ('propose', 'record')"),
    CheckConstraint("char_length(instructions) <= 20000"),
)

pending = table(
    "pending_change",
    Column("entity_id", ForeignKey("entity.id"), nullable=False),
    Column("created_by_interface", String, nullable=False),
    Column("tool", String(80), nullable=False),
    Column("operation", String(80), nullable=False),
    Column("input", JSONB, nullable=False),
    Column("target", String(120)),
    Column("expected_revision", Integer),
    Column("summary", String(400), nullable=False),
    Column("status", String, nullable=False, server_default="pending"),
    Column(
        "created_at", DateTime(timezone=True), server_default=func.now(), nullable=False
    ),
    Column("resolved_at", DateTime(timezone=True)),
    Column("revision", Integer, nullable=False, server_default="1"),
    CheckConstraint("created_by_interface IN ('mcp', 'agent')"),
    CheckConstraint("status IN ('pending', 'applied', 'dismissed')"),
)

conversations = table(
    "agent_conversation",
    Column("user_id", ForeignKey("app_user.id"), nullable=False),
    Column("entity_id", ForeignKey("entity.id"), nullable=False),
    Column(
        "created_at", DateTime(timezone=True), server_default=func.now(), nullable=False
    ),
    Column("expires_at", DateTime(timezone=True), nullable=False),
    # Archive hides a conversation; retention deletes it (TDD 08).
    Column("archived_at", DateTime(timezone=True)),
    Index("agent_conversation_owner", "user_id", "entity_id"),
)

messages = table(
    "agent_message",
    Column(
        "conversation_id",
        BigInteger,
        ForeignKey("agent_conversation.id", ondelete="CASCADE"),
        nullable=False,
    ),
    Column("position", Integer, nullable=False),
    Column("role", String, nullable=False),
    Column("content", Text, nullable=False),
    Column("image_count", Integer, nullable=False, server_default="0"),
    Column(
        "pending_change_ids",
        ARRAY(UUID(as_uuid=True)),
        nullable=False,
        server_default="{}",
    ),
    Column(
        "created_at", DateTime(timezone=True), server_default=func.now(), nullable=False
    ),
    UniqueConstraint("conversation_id", "position"),
    CheckConstraint("role IN ('owner', 'agent')"),
    CheckConstraint("image_count BETWEEN 0 AND 4"),
)
