"""Let an investment's opening date move while its amount stays protected.

An opening may change only its financial_date (with a revision bump). The move
is refused when a current observation or assigned contribution for the same
investment would then predate the opening. Deletion and every other opening
field remain protected.
"""

from alembic import op

revision = "6m033"
down_revision = "6l032"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        CREATE OR REPLACE FUNCTION protect_investment_opening() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
            IF TG_OP = 'DELETE' THEN
                IF OLD.is_opening THEN
                    RAISE EXCEPTION 'Investment opening must be retained';
                END IF;
                RETURN OLD;
            END IF;
            IF OLD.is_opening AND (NEW.amount, NEW.investment_id, NEW.entity_id,
                NEW.is_opening, NEW.deleted_at) IS DISTINCT FROM
                (OLD.amount, OLD.investment_id, OLD.entity_id, OLD.is_opening,
                OLD.deleted_at) THEN
                RAISE EXCEPTION 'Investment opening is immutable';
            END IF;
            IF OLD.is_opening AND NEW.financial_date > OLD.financial_date AND (
                EXISTS (SELECT 1 FROM investment_balance_observation o
                        WHERE o.investment_id = NEW.investment_id
                        AND NOT o.is_opening AND o.deleted_at IS NULL
                        AND o.financial_date < NEW.financial_date)
                OR EXISTS (SELECT 1 FROM entry_investment_destination a
                           JOIN actual_entry e ON e.id = a.actual_entry_id
                           WHERE a.investment_id = NEW.investment_id
                           AND e.deleted_at IS NULL
                           AND e.financial_date < NEW.financial_date)
            ) THEN
                RAISE EXCEPTION 'Investment activity precedes the new opening date';
            END IF;
            RETURN NEW;
        END; $$;
    """)


def downgrade():
    op.execute("""
        CREATE OR REPLACE FUNCTION protect_investment_opening() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
            IF TG_OP = 'DELETE' THEN
                IF OLD.is_opening THEN
                    RAISE EXCEPTION 'Investment opening must be retained';
                END IF;
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
