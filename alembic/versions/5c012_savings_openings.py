"""Conserved savings openings and permanent goal identity."""
# ruff: noqa: E501 -- SQL statements remain readable in migration form.

import re

import sqlalchemy as sa

from alembic import op

revision = "5c012"
down_revision = "4a004"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "saving_account",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("uuid", sa.Uuid(), unique=True, nullable=False),
        sa.Column(
            "entity_id", sa.BigInteger(), sa.ForeignKey("entity.id"), nullable=False
        ),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("opening_date", sa.Date(), nullable=False),
        sa.Column("opening_amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("revision", sa.Integer(), server_default="1", nullable=False),
        sa.Column("active", sa.Boolean(), server_default="true", nullable=False),
        sa.UniqueConstraint("id", "entity_id"),
        sa.CheckConstraint("opening_amount BETWEEN 0 AND 999999999.99"),
        sa.CheckConstraint("revision >= 1"),
    )
    op.create_table(
        "saving_goal",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("uuid", sa.Uuid(), unique=True, nullable=False),
        sa.Column("entity_id", sa.BigInteger(), nullable=False),
        sa.Column("account_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("role", sa.String(20), nullable=False),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("target", sa.Numeric(14, 2)),
        sa.Column("opening_amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("revision", sa.Integer(), server_default="1", nullable=False),
        sa.Column("active", sa.Boolean(), server_default="true", nullable=False),
        sa.ForeignKeyConstraint(
            ["account_id", "entity_id"],
            ["saving_account.id", "saving_account.entity_id"],
        ),
        sa.UniqueConstraint("id", "entity_id"),
        sa.UniqueConstraint("id", "account_id"),
        sa.CheckConstraint("role IN ('ordinary', 'unallocated')"),
        sa.CheckConstraint("kind IN ('finite', 'ongoing')"),
        sa.CheckConstraint("opening_amount BETWEEN 0 AND 999999999.99"),
        sa.CheckConstraint(
            "(role = 'unallocated' AND kind = 'ongoing' AND target IS NULL AND active) OR (role = 'ordinary' AND (kind = 'ongoing' OR target > 0) AND (target IS NULL OR target > 0))"
        ),
        sa.CheckConstraint("revision >= 1"),
    )
    op.create_index(
        "one_unallocated_per_account",
        "saving_goal",
        ["account_id"],
        unique=True,
        postgresql_where=sa.text("role = 'unallocated'"),
    )
    op.create_table(
        "saving_linked_activity",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("uuid", sa.Uuid(), unique=True, nullable=False),
        sa.Column("entity_id", sa.BigInteger(), nullable=False),
        sa.Column("account_id", sa.BigInteger(), nullable=False),
        sa.Column("goal_id", sa.BigInteger(), nullable=False),
        sa.Column("financial_date", sa.Date(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
        sa.ForeignKeyConstraint(
            ["account_id", "entity_id"],
            ["saving_account.id", "saving_account.entity_id"],
        ),
        sa.ForeignKeyConstraint(
            ["goal_id", "account_id"], ["saving_goal.id", "saving_goal.account_id"]
        ),
    )
    script = """
        CREATE FUNCTION check_saving_opening() RETURNS trigger LANGUAGE plpgsql AS $$
        DECLARE account_key bigint; account_total numeric; goal_total numeric; unallocated_count integer;
        BEGIN
            account_key := CASE WHEN TG_TABLE_NAME = 'saving_account' THEN COALESCE(NEW.id, OLD.id) ELSE COALESCE(NEW.account_id, OLD.account_id) END;
            SELECT opening_amount INTO account_total FROM saving_account WHERE id = account_key;
            IF account_total IS NOT NULL THEN
                SELECT COALESCE(SUM(opening_amount), 0), COUNT(*) FILTER (WHERE role = 'unallocated')
                  INTO goal_total, unallocated_count FROM saving_goal WHERE account_id = account_key;
                IF goal_total <> account_total OR unallocated_count <> 1 THEN
                    RAISE EXCEPTION 'Saving opening requires exactly one Unallocated goal and conserved designations';
                END IF;
            END IF;
            RETURN NULL;
        END $$;
        CREATE CONSTRAINT TRIGGER saving_account_conserved AFTER INSERT OR UPDATE ON saving_account
          DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_saving_opening();
        CREATE CONSTRAINT TRIGGER saving_goal_conserved AFTER INSERT OR UPDATE OR DELETE ON saving_goal
          DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_saving_opening();
        CREATE FUNCTION protect_saving_history() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF TG_TABLE_NAME = 'saving_account' THEN
                IF (NEW.opening_date, NEW.opening_amount) IS DISTINCT FROM (OLD.opening_date, OLD.opening_amount)
                   AND EXISTS (SELECT 1 FROM saving_linked_activity WHERE account_id = OLD.id) THEN
                    RAISE EXCEPTION 'Saving opening is fixed after linked activity';
                END IF;
            ELSIF TG_TABLE_NAME = 'saving_goal' THEN
                IF NEW.account_id <> OLD.account_id OR NEW.entity_id <> OLD.entity_id OR NEW.role <> OLD.role THEN
                    RAISE EXCEPTION 'Saving goal account and role are immutable';
                END IF;
                IF NEW.opening_amount <> OLD.opening_amount
                   AND EXISTS (SELECT 1 FROM saving_linked_activity WHERE account_id = OLD.account_id) THEN
                    RAISE EXCEPTION 'Saving opening designations are fixed after linked activity';
                END IF;
            END IF;
            RETURN NEW;
        END $$;
        CREATE TRIGGER saving_account_history BEFORE UPDATE ON saving_account FOR EACH ROW EXECUTE FUNCTION protect_saving_history();
        CREATE TRIGGER saving_goal_history BEFORE UPDATE ON saving_goal FOR EACH ROW EXECUTE FUNCTION protect_saving_history();
        CREATE FUNCTION saving_activity_boundary() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF NEW.financial_date < (SELECT opening_date FROM saving_account WHERE id = NEW.account_id) THEN
                RAISE EXCEPTION 'Savings activity precedes the account opening date';
            END IF;
            RETURN NEW;
        END $$;
        CREATE TRIGGER saving_activity_date BEFORE INSERT OR UPDATE ON saving_linked_activity
          FOR EACH ROW EXECUTE FUNCTION saving_activity_boundary();
    """
    # asyncpg permits one DDL statement per execute call.
    for statement in re.split(r"(?<=END \$\$;)|(?<=\(\);)", script):
        if statement.strip():
            op.execute(statement.strip())


def downgrade():
    op.execute("DROP TRIGGER saving_activity_date ON saving_linked_activity")
    op.execute("DROP FUNCTION saving_activity_boundary()")
    op.execute("DROP TRIGGER saving_goal_history ON saving_goal")
    op.execute("DROP TRIGGER saving_account_history ON saving_account")
    op.execute("DROP FUNCTION protect_saving_history()")
    op.execute("DROP TRIGGER saving_goal_conserved ON saving_goal")
    op.execute("DROP TRIGGER saving_account_conserved ON saving_account")
    op.execute("DROP FUNCTION check_saving_opening()")
    op.drop_table("saving_linked_activity")
    op.drop_index("one_unallocated_per_account", table_name="saving_goal")
    op.drop_table("saving_goal")
    op.drop_table("saving_account")
