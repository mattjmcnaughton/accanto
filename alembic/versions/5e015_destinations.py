"""Investment and giving destinations, protected investment openings."""
# ruff: noqa: E501 -- SQL statements remain readable in migration form.

import sqlalchemy as sa

from alembic import op

revision = "5e015"
down_revision = "5d013"
branch_labels = None
depends_on = None


def destination(name):
    op.create_table(
        name,
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("uuid", sa.Uuid(), unique=True, nullable=False),
        sa.Column(
            "entity_id", sa.BigInteger(), sa.ForeignKey("entity.id"), nullable=False
        ),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("target", sa.Numeric(14, 2)),
        sa.Column("active", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("revision", sa.Integer(), server_default="1", nullable=False),
        sa.UniqueConstraint("id", "entity_id"),
        sa.CheckConstraint("target IS NULL OR target BETWEEN 0.01 AND 999999999.99"),
        sa.CheckConstraint("revision >= 1"),
    )


def assignment(name, target_name, target_id):
    op.create_table(
        name,
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("uuid", sa.Uuid(), unique=True, nullable=False),
        sa.Column("entity_id", sa.BigInteger(), nullable=False),
        sa.Column("actual_entry_id", sa.BigInteger(), nullable=False, unique=True),
        sa.Column(target_id, sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(
            ["actual_entry_id", "entity_id"],
            ["actual_entry.id", "actual_entry.entity_id"],
        ),
        sa.ForeignKeyConstraint(
            [target_id, "entity_id"], [f"{target_name}.id", f"{target_name}.entity_id"]
        ),
    )


def upgrade():
    op.drop_constraint("actual_entry_category_check", "actual_entry", type_="check")
    op.create_check_constraint(
        "actual_entry_category_check",
        "actual_entry",
        "category IN ('income', 'spending', 'saving', 'investing', 'giving')",
    )
    destination("investment")
    destination("giving_recipient")
    op.create_table(
        "investment_balance_observation",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("uuid", sa.Uuid(), unique=True, nullable=False),
        sa.Column(
            "entity_id", sa.BigInteger(), sa.ForeignKey("entity.id"), nullable=False
        ),
        sa.Column("investment_id", sa.BigInteger()),
        sa.Column("financial_date", sa.Date(), nullable=False),
        sa.Column("amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("is_opening", sa.Boolean(), nullable=False),
        sa.Column("revision", sa.Integer(), server_default="1", nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
        sa.ForeignKeyConstraint(
            ["investment_id", "entity_id"], ["investment.id", "investment.entity_id"]
        ),
        sa.CheckConstraint("amount BETWEEN 0 AND 999999999.99"),
        sa.CheckConstraint("NOT is_opening OR investment_id IS NOT NULL"),
    )
    op.create_index(
        "one_investment_opening",
        "investment_balance_observation",
        ["investment_id"],
        unique=True,
        postgresql_where=sa.text("is_opening"),
    )
    assignment("entry_investment_destination", "investment", "investment_id")
    assignment("entry_giving_recipient", "giving_recipient", "giving_recipient_id")
    op.execute("""
        CREATE FUNCTION check_destination_entry_category() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF (TG_TABLE_NAME = 'entry_investment_destination' AND
                (SELECT category FROM actual_entry WHERE id = NEW.actual_entry_id) <> 'investing')
                OR (TG_TABLE_NAME = 'entry_giving_recipient' AND
                (SELECT category FROM actual_entry WHERE id = NEW.actual_entry_id) <> 'giving') THEN
                RAISE EXCEPTION 'Destination assignment category mismatch';
            END IF;
            RETURN NEW;
        END; $$;
    """)
    op.execute("""
        CREATE TRIGGER investment_entry_category BEFORE INSERT OR UPDATE
        ON entry_investment_destination FOR EACH ROW
        EXECUTE FUNCTION check_destination_entry_category()
    """)
    op.execute("""
        CREATE TRIGGER giving_entry_category BEFORE INSERT OR UPDATE
        ON entry_giving_recipient FOR EACH ROW
        EXECUTE FUNCTION check_destination_entry_category()
    """)
    op.execute("""
        CREATE FUNCTION investment_entry_boundary() RETURNS trigger LANGUAGE plpgsql AS $$
        DECLARE opening_date date;
        BEGIN
            SELECT financial_date INTO opening_date FROM investment_balance_observation
            WHERE investment_id = NEW.investment_id AND is_opening;
            IF opening_date IS NOT NULL AND
               (SELECT financial_date FROM actual_entry WHERE id = NEW.actual_entry_id) < opening_date THEN
                RAISE EXCEPTION 'Investment entry precedes opening observation';
            END IF;
            RETURN NEW;
        END; $$;
    """)
    op.execute("""
        CREATE TRIGGER investment_entry_opening BEFORE INSERT OR UPDATE
        ON entry_investment_destination FOR EACH ROW
        EXECUTE FUNCTION investment_entry_boundary()
    """)
    op.execute("""
        CREATE FUNCTION protect_assigned_entry() RETURNS trigger LANGUAGE plpgsql AS $$
        DECLARE opening_date date;
        BEGIN
            IF EXISTS (SELECT 1 FROM entry_investment_destination
                       WHERE actual_entry_id = NEW.id) THEN
                IF NEW.category <> 'investing' THEN
                    RAISE EXCEPTION 'Investment entry category mismatch';
                END IF;
                SELECT o.financial_date INTO opening_date
                FROM entry_investment_destination a
                JOIN investment_balance_observation o ON o.investment_id = a.investment_id
                WHERE a.actual_entry_id = NEW.id AND o.is_opening;
                IF opening_date IS NOT NULL AND NEW.financial_date < opening_date THEN
                    RAISE EXCEPTION 'Investment entry precedes opening observation';
                END IF;
            END IF;
            IF NEW.category <> 'giving' AND EXISTS (
                SELECT 1 FROM entry_giving_recipient WHERE actual_entry_id = NEW.id
            ) THEN RAISE EXCEPTION 'Giving entry category mismatch'; END IF;
            RETURN NEW;
        END; $$;
    """)
    op.execute("""
        CREATE TRIGGER assigned_entry_protected BEFORE UPDATE ON actual_entry
        FOR EACH ROW EXECUTE FUNCTION protect_assigned_entry()
    """)
    op.execute("""
        CREATE FUNCTION protect_investment_opening() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF TG_OP = 'DELETE' THEN
                IF OLD.is_opening THEN RAISE EXCEPTION 'Investment opening must be retained'; END IF;
                RETURN OLD;
            END IF;
            IF OLD.is_opening AND (NEW.financial_date, NEW.amount, NEW.investment_id,
                NEW.entity_id, NEW.is_opening, NEW.deleted_at) IS DISTINCT FROM
                (OLD.financial_date, OLD.amount, OLD.investment_id, OLD.entity_id,
                OLD.is_opening, OLD.deleted_at) THEN
                RAISE EXCEPTION 'Investment opening is immutable';
            END IF;
            RETURN NEW;
        END; $$;
    """)
    op.execute("""
        CREATE TRIGGER investment_opening_protected BEFORE UPDATE OR DELETE
        ON investment_balance_observation FOR EACH ROW
        EXECUTE FUNCTION protect_investment_opening()
    """)


def downgrade():
    op.execute("DROP TRIGGER assigned_entry_protected ON actual_entry")
    op.execute("DROP FUNCTION protect_assigned_entry()")
    op.execute("DROP TRIGGER investment_entry_opening ON entry_investment_destination")
    op.execute("DROP FUNCTION investment_entry_boundary()")
    op.execute("DROP TRIGGER giving_entry_category ON entry_giving_recipient")
    op.execute("DROP TRIGGER investment_entry_category ON entry_investment_destination")
    op.execute("DROP FUNCTION check_destination_entry_category()")
    op.execute(
        "DROP TRIGGER investment_opening_protected ON investment_balance_observation"
    )
    op.execute("DROP FUNCTION protect_investment_opening()")
    op.drop_table("entry_giving_recipient")
    op.drop_table("entry_investment_destination")
    op.drop_index("one_investment_opening", table_name="investment_balance_observation")
    op.drop_table("investment_balance_observation")
    op.drop_table("giving_recipient")
    op.drop_table("investment")
    op.drop_constraint("actual_entry_category_check", "actual_entry", type_="check")
    op.create_check_constraint(
        "actual_entry_category_check",
        "actual_entry",
        "category IN ('income', 'spending', 'saving')",
    )
