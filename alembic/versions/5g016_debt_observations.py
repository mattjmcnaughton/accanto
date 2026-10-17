"""Loan accounts, independent observations and payment relationships."""
# ruff: noqa: E501 -- SQL statements remain readable in migration form.

import sqlalchemy as sa

from alembic import op

revision = "5g016"
down_revision = "5f014"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "debt_account",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("uuid", sa.Uuid(), nullable=False, unique=True),
        sa.Column(
            "entity_id", sa.BigInteger(), sa.ForeignKey("entity.id"), nullable=False
        ),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        sa.UniqueConstraint("id", "entity_id"),
        sa.CheckConstraint("revision >= 1"),
    )
    op.add_column("plan_fixed_cost_line", sa.Column("debt_account_id", sa.BigInteger()))
    op.create_foreign_key(
        "plan_fixed_cost_line_debt_account",
        "plan_fixed_cost_line",
        "debt_account",
        ["debt_account_id", "entity_id"],
        ["id", "entity_id"],
    )
    op.create_table(
        "debt_balance_observation",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("uuid", sa.Uuid(), nullable=False, unique=True),
        sa.Column(
            "entity_id", sa.BigInteger(), sa.ForeignKey("entity.id"), nullable=False
        ),
        sa.Column("debt_account_id", sa.BigInteger(), nullable=False),
        sa.Column("financial_date", sa.Date(), nullable=False),
        sa.Column("amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("is_opening", sa.Boolean(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
        sa.ForeignKeyConstraint(
            ["debt_account_id", "entity_id"],
            ["debt_account.id", "debt_account.entity_id"],
        ),
        sa.CheckConstraint("amount BETWEEN 0 AND 999999999.99"),
    )
    op.create_index(
        "one_debt_opening",
        "debt_balance_observation",
        ["debt_account_id"],
        unique=True,
        postgresql_where=sa.text("is_opening"),
    )
    op.create_index(
        "one_debt_daily_observation",
        "debt_balance_observation",
        ["debt_account_id", "financial_date"],
        unique=True,
        postgresql_where=sa.text("NOT is_opening AND deleted_at IS NULL"),
    )
    op.create_index(
        "one_investment_daily_observation",
        "investment_balance_observation",
        ["investment_id", "financial_date"],
        unique=True,
        postgresql_where=sa.text(
            "NOT is_opening AND deleted_at IS NULL AND investment_id IS NOT NULL"
        ),
    )
    op.create_table(
        "entry_debt_account",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("uuid", sa.Uuid(), nullable=False, unique=True),
        sa.Column("entity_id", sa.BigInteger(), nullable=False),
        sa.Column("actual_entry_id", sa.BigInteger(), nullable=False, unique=True),
        sa.Column("debt_account_id", sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(
            ["actual_entry_id", "entity_id"],
            ["actual_entry.id", "actual_entry.entity_id"],
        ),
        sa.ForeignKeyConstraint(
            ["debt_account_id", "entity_id"],
            ["debt_account.id", "debt_account.entity_id"],
        ),
    )
    op.execute("""CREATE FUNCTION protect_debt_opening() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        IF OLD.is_opening THEN RAISE EXCEPTION 'Debt opening must be retained'; END IF;
        RETURN OLD;
      END IF;
      IF OLD.is_opening AND (NEW.financial_date, NEW.amount, NEW.debt_account_id, NEW.entity_id, NEW.is_opening, NEW.deleted_at)
       IS DISTINCT FROM (OLD.financial_date, OLD.amount, OLD.debt_account_id, OLD.entity_id, OLD.is_opening, OLD.deleted_at)
       THEN RAISE EXCEPTION 'Debt opening is immutable'; END IF;
      RETURN NEW;
    END; $$""")
    op.execute(
        "CREATE TRIGGER debt_opening_protected BEFORE UPDATE OR DELETE ON debt_balance_observation FOR EACH ROW EXECUTE FUNCTION protect_debt_opening()"
    )
    op.execute("""CREATE FUNCTION valid_debt_payment() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF EXISTS (SELECT 1 FROM entry_debt_account a JOIN actual_entry e ON e.id = a.actual_entry_id WHERE e.category <> 'fixed_cost')
      THEN RAISE EXCEPTION 'Debt payment requires fixed-cost category'; END IF;
      RETURN NULL;
    END; $$""")
    for table in ("entry_debt_account", "actual_entry"):
        op.execute(
            f"CREATE CONSTRAINT TRIGGER valid_debt_payment AFTER INSERT OR UPDATE ON {table} DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION valid_debt_payment()"
        )


def downgrade():
    for table in ("actual_entry", "entry_debt_account"):
        op.execute(f"DROP TRIGGER valid_debt_payment ON {table}")
    op.execute("DROP FUNCTION valid_debt_payment()")
    op.execute("DROP TRIGGER debt_opening_protected ON debt_balance_observation")
    op.execute("DROP FUNCTION protect_debt_opening()")
    op.drop_table("entry_debt_account")
    op.drop_index(
        "one_investment_daily_observation", table_name="investment_balance_observation"
    )
    op.drop_index("one_debt_daily_observation", table_name="debt_balance_observation")
    op.drop_index("one_debt_opening", table_name="debt_balance_observation")
    op.drop_table("debt_balance_observation")
    op.drop_constraint(
        "plan_fixed_cost_line_debt_account", "plan_fixed_cost_line", type_="foreignkey"
    )
    op.drop_column("plan_fixed_cost_line", "debt_account_id")
    op.drop_table("debt_account")
