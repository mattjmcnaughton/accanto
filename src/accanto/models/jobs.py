"""Job runs: leased background work for the in-process reconciler (TDD 11).

A job run is operational state, not a financial record: it never enters totals
and has no audit history. Its steps change financial records only through the
existing commands, which keep their own audit.
"""

from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Uuid,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB

from accanto.models.monthly import table

ACTIVE = ("queued", "running")

runs = table(
    "job_run",
    Column("entity_id", ForeignKey("entity.id"), nullable=False),
    Column("kind", String(80), nullable=False),
    # The User who started the run; null for a scheduled run.
    Column("user_id", ForeignKey("app_user.id")),
    # The session or API key that started it, re-checked by every step (6j030).
    Column("credential_kind", String(20)),
    Column("credential_uuid", Uuid),
    Column("state", String, nullable=False, server_default="queued"),
    # Lease: set by the database clock when a step is claimed.
    Column("claimed_at", DateTime(timezone=True)),
    # Fencing token: a step settles only while its claim is still the latest.
    Column("claims", Integer, nullable=False, server_default="0"),
    Column("steps", Integer, nullable=False, server_default="0"),
    # Counts only, summed over steps, such as {"proposed": 25}.
    Column("counts", JSONB, nullable=False, server_default=text("'{}'::jsonb")),
    Column("error_code", String(80)),
    Column(
        "created_at", DateTime(timezone=True), server_default=func.now(), nullable=False
    ),
    Column(
        "updated_at", DateTime(timezone=True), server_default=func.now(), nullable=False
    ),
    Column("finished_at", DateTime(timezone=True)),
    CheckConstraint(
        "state IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')",
        name="job_run_state_check",
    ),
    CheckConstraint(
        "(state = 'running') = (claimed_at IS NOT NULL)", name="job_run_lease_check"
    ),
    Index(
        "job_run_active",
        "entity_id",
        "kind",
        unique=True,
        postgresql_where=text("state IN ('queued', 'running')"),
    ),
)
