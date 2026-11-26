"""Agent modes: read_only, ask_first (default) and apply_directly.

Renames the stored modes: propose becomes ask_first (every write waits as a
Pending change) and record becomes apply_directly (writes run). read_only is
new: every agent write is rejected. Data-only on agent_settings; no grant
changes.
"""

from alembic import op

revision = "6h028"
down_revision = "6g027"
branch_labels = None
depends_on = None


def upgrade():
    op.drop_constraint("agent_settings_mode_check", "agent_settings")
    op.execute(
        "UPDATE agent_settings SET mode = CASE mode"
        " WHEN 'propose' THEN 'ask_first' WHEN 'record' THEN 'apply_directly'"
        " ELSE mode END"
    )
    op.alter_column("agent_settings", "mode", server_default="ask_first")
    op.create_check_constraint(
        "agent_settings_mode_check",
        "agent_settings",
        "mode IN ('read_only', 'ask_first', 'apply_directly')",
    )


def downgrade():
    # read_only has no earlier equivalent; propose is the closest (nothing runs).
    op.drop_constraint("agent_settings_mode_check", "agent_settings")
    op.execute(
        "UPDATE agent_settings SET mode = CASE mode"
        " WHEN 'apply_directly' THEN 'record' ELSE 'propose' END"
    )
    op.alter_column("agent_settings", "mode", server_default="propose")
    op.create_check_constraint(
        "agent_settings_mode_check",
        "agent_settings",
        "mode IN ('propose', 'record')",
    )
