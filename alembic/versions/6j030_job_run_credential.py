"""Job runs remember the credential that started them (TDD 12).

Additive only. Each step of a run started by a person re-checks this credential
(a browser session or API key, by its UUID), so a sign-out, a revoked key or a
lost Entity stops the run at its next step. Scheduled runs leave both null.
Reapply the runtime grants in docs/api.md for accanto_app after upgrading.
"""

import sqlalchemy as sa

from alembic import op

revision = "6j030"
down_revision = "6i029"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("job_run", sa.Column("credential_kind", sa.String(20)))
    op.add_column("job_run", sa.Column("credential_uuid", sa.Uuid()))
    op.create_check_constraint(
        "job_run_credential_check",
        "job_run",
        "credential_kind IS NULL OR credential_kind IN ('session', 'api_key')",
    )
    op.create_check_constraint(
        "job_run_credential_pair_check",
        "job_run",
        "(credential_kind IS NULL) = (credential_uuid IS NULL)",
    )


def downgrade():
    op.drop_constraint("job_run_credential_pair_check", "job_run")
    op.drop_constraint("job_run_credential_check", "job_run")
    op.drop_column("job_run", "credential_uuid")
    op.drop_column("job_run", "credential_kind")
