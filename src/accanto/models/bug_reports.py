"""Bug reports (TDD 21): notes an opted-in User files about Accanto itself.

Not financial activity and not part of any Entity. The note is the only free
text; the context holds only allowlisted diagnostics checked by the API.
"""

from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
    String,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB

from accanto.models.monthly import table

bug_reports = table(
    "bug_report",
    Column("user_id", ForeignKey("app_user.id"), nullable=False),
    Column("kind", String(4), nullable=False),
    Column("note", String(2000), nullable=False),
    # {screen, month, build, viewport, theme, user_agent, api, errors}
    Column("context", JSONB, nullable=False),
    Column("status", String(7), nullable=False, server_default="open"),
    Column(
        "created_at", DateTime(timezone=True), server_default=func.now(), nullable=False
    ),
    Column("resolved_at", DateTime(timezone=True)),
    CheckConstraint("kind IN ('bug', 'idea', 'fix')", name="bug_report_kind_check"),
    CheckConstraint(
        "status IN ('open', 'done', 'wont_do')", name="bug_report_status_check"
    ),
    CheckConstraint(
        "(status = 'open') = (resolved_at IS NULL)", name="bug_report_resolved_check"
    ),
)
Index("bug_report_user", bug_reports.c.user_id, bug_reports.c.id)
