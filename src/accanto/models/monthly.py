"""Typed relational records for the initial monthly API slice."""

from uuid import uuid4

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Column,
    Date,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Identity,
    Index,
    Integer,
    Numeric,
    Sequence,
    String,
    Table,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB

from accanto.db import Base


def identity():
    return [
        Column("id", BigInteger, Identity(), primary_key=True),
        Column("uuid", Uuid, default=uuid4, nullable=False, unique=True),
    ]


def table(name, *columns):
    return Table(name, Base.metadata, *identity(), *columns)


entry_order = Sequence("saving_activity_recording_order_seq")


users = table(
    "app_user",
    Column("issuer", String, nullable=False),
    Column("subject", String, nullable=False),
    UniqueConstraint("issuer", "subject"),
)
entities = table(
    "entity",
    Column("owner_id", ForeignKey("app_user.id"), nullable=False),
    Column("name", String(120), nullable=False),
    Column("time_zone", String, nullable=False),
    Column("revision", Integer, nullable=False, server_default="1"),
)
keys = table(
    "api_key",
    Column("user_id", ForeignKey("app_user.id"), nullable=False),
    Column("digest", String(64), nullable=False, unique=True),
    Column("name", String(120), nullable=False),
    Column(
        "created_at", DateTime(timezone=True), server_default=func.now(), nullable=False
    ),
    Column("revoked_at", DateTime(timezone=True)),
)
sessions = table(
    "browser_session",
    Column("user_id", ForeignKey("app_user.id"), nullable=False),
    Column("digest", String(64), nullable=False, unique=True),
    Column(
        "created_at", DateTime(timezone=True), server_default=func.now(), nullable=False
    ),
    Column("expires_at", DateTime(timezone=True), nullable=False),
    Column("revoked_at", DateTime(timezone=True)),
)
login_transactions = table(
    "oidc_login_transaction",
    Column("state_digest", String(64), nullable=False, unique=True),
    Column("binding_digest", String(64), nullable=False),
    Column("nonce", String, nullable=False),
    Column("verifier", String, nullable=False),
    Column("expires_at", DateTime(timezone=True), nullable=False),
)
plans = table(
    "plan",
    Column("entity_id", ForeignKey("entity.id"), nullable=False),
    UniqueConstraint("id", "entity_id"),
)
sources = table(
    "income_source",
    Column("plan_id", BigInteger, nullable=False),
    Column("entity_id", BigInteger, nullable=False),
    ForeignKeyConstraint(["plan_id", "entity_id"], ["plan.id", "plan.entity_id"]),
    UniqueConstraint("id", "entity_id"),
    UniqueConstraint("id", "plan_id"),
)
revisions = table(
    "plan_revision",
    Column("plan_id", BigInteger, nullable=False),
    Column("entity_id", BigInteger, nullable=False),
    Column("name", String(120), nullable=False),
    Column("number", Integer, nullable=False),
    Column("saved", Boolean, nullable=False, server_default="false"),
    Column("revision", Integer, nullable=False, server_default="1"),
    Column("spending", Numeric(14, 2), nullable=False),
    Column("income", Numeric(14, 2), nullable=False),
    Column("tithe_target", Numeric(14, 2), nullable=False),
    Column("unassigned", Numeric(14, 2), nullable=False),
    Column("rule_version", String, nullable=False, server_default="monthly-net-1"),
    Column("saved_at", DateTime(timezone=True)),
    ForeignKeyConstraint(["plan_id", "entity_id"], ["plan.id", "plan.entity_id"]),
    UniqueConstraint("plan_id", "number"),
    UniqueConstraint("id", "entity_id"),
    UniqueConstraint("id", "plan_id"),
    CheckConstraint("spending >= 0 AND spending <= 999999999.99"),
)
Index(
    "one_plan_draft",
    revisions.c.plan_id,
    unique=True,
    postgresql_where=~revisions.c.saved,
)
income_lines = table(
    "plan_income_line",
    Column("plan_revision_id", BigInteger, nullable=False),
    Column("plan_id", BigInteger, nullable=False),
    Column("income_source_id", BigInteger, nullable=False),
    Column("name", String(120), nullable=False),
    Column("amount", Numeric(14, 2), nullable=False),
    ForeignKeyConstraint(
        ["plan_revision_id", "plan_id"], ["plan_revision.id", "plan_revision.plan_id"]
    ),
    ForeignKeyConstraint(
        ["income_source_id", "plan_id"], ["income_source.id", "income_source.plan_id"]
    ),
    UniqueConstraint("plan_revision_id", "income_source_id"),
    CheckConstraint("amount >= 0 AND amount <= 999999999.99"),
)
entries = table(
    "actual_entry",
    Column("entity_id", ForeignKey("entity.id"), nullable=False),
    Column("financial_date", Date, nullable=False),
    Column("recording_order", BigInteger, entry_order, nullable=False),
    Column("category", String, nullable=False),
    Column("amount", Numeric(14, 2), nullable=False),
    Column("note", String(2000), nullable=False),
    Column("is_adjustment", Boolean, nullable=False, server_default="false"),
    Column("revision", Integer, nullable=False, server_default="1"),
    Column("deleted_at", DateTime(timezone=True)),
    CheckConstraint(
        "category IN ('income', 'spending', 'saving', 'investing', 'giving')"
    ),
    CheckConstraint("amount BETWEEN -999999999.99 AND 999999999.99"),
    CheckConstraint("is_adjustment OR amount >= 0"),
    UniqueConstraint("id", "entity_id"),
    UniqueConstraint("recording_order"),
)
assignments = table(
    "entry_income_source",
    Column("actual_entry_id", BigInteger, nullable=False, unique=True),
    Column("income_source_id", BigInteger, nullable=False),
    Column("entity_id", BigInteger, nullable=False),
    ForeignKeyConstraint(
        ["actual_entry_id", "entity_id"], ["actual_entry.id", "actual_entry.entity_id"]
    ),
    ForeignKeyConstraint(
        ["income_source_id", "entity_id"],
        ["income_source.id", "income_source.entity_id"],
    ),
)
reviews = table(
    "monthly_review",
    Column("entity_id", BigInteger, nullable=False),
    Column("month", Date, nullable=False),
    Column("plan_revision_id", BigInteger, nullable=False),
    Column("revision", Integer, nullable=False, server_default="1"),
    Column("note", String(4000), nullable=False, server_default=""),
    Column("reviewed_at", DateTime(timezone=True)),
    Column("checkpoint_fingerprint", String(64)),
    ForeignKeyConstraint(
        ["plan_revision_id", "entity_id"],
        ["plan_revision.id", "plan_revision.entity_id"],
    ),
    UniqueConstraint("entity_id", "month"),
    CheckConstraint("EXTRACT(DAY FROM month) = 1"),
)
audit = table(
    "audit_log",
    Column("entity_id", ForeignKey("entity.id"), nullable=False),
    Column("actor_id", ForeignKey("app_user.id"), nullable=False),
    Column("api_key_uuid", Uuid),
    Column("session_uuid", Uuid),
    Column("interface", String, nullable=False),
    Column("operation_uuid", Uuid, nullable=False),
    Column("record_type", String, nullable=False),
    Column("record_uuid", Uuid, nullable=False),
    Column("action", String, nullable=False),
    Column("at", DateTime(timezone=True), nullable=False, server_default=func.now()),
    Column("before", JSONB),
    Column("after", JSONB, nullable=False),
)
outcomes = table(
    "idempotency_outcome",
    Column("entity_id", ForeignKey("entity.id"), nullable=False),
    Column("user_id", ForeignKey("app_user.id"), nullable=False),
    Column("operation", String, nullable=False),
    Column("request_key", String(120), nullable=False),
    Column("request_hash", String(64), nullable=False),
    Column("response", JSONB, nullable=False),
    Column(
        "created_at", DateTime(timezone=True), server_default=func.now(), nullable=False
    ),
    UniqueConstraint("entity_id", "user_id", "operation", "request_key"),
)
