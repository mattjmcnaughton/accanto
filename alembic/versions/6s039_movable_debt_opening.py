"""Let a debt opening's date move while its amount stays protected (TDD 15).

As 6m033 did for investments, a debt opening may change only its
financial_date (with a revision bump). A later date is refused when a current
observation or payment for the same loan would then predate it. Deletion and
every other opening field remain protected. The downgrade restores the
immutable trigger and leaves already moved dates as they are. No schema or
grant changes.
"""

from alembic import op

revision = "6s039"
down_revision = "6r038"
branch_labels = None
depends_on = None

MOVABLE = """
CREATE OR REPLACE FUNCTION protect_debt_opening() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.is_opening THEN
            RAISE EXCEPTION 'Debt opening must be retained';
        END IF;
        RETURN OLD;
    END IF;
    IF OLD.is_opening AND (NEW.amount, NEW.debt_account_id, NEW.entity_id,
        NEW.is_opening, NEW.deleted_at) IS DISTINCT FROM
        (OLD.amount, OLD.debt_account_id, OLD.entity_id, OLD.is_opening,
        OLD.deleted_at) THEN
        RAISE EXCEPTION 'Debt opening is immutable';
    END IF;
    IF OLD.is_opening AND NEW.financial_date > OLD.financial_date AND (
        EXISTS (SELECT 1 FROM debt_balance_observation o
                WHERE o.debt_account_id = NEW.debt_account_id
                AND NOT o.is_opening AND o.deleted_at IS NULL
                AND o.financial_date < NEW.financial_date)
        OR EXISTS (SELECT 1 FROM entry_debt_account a
                   JOIN actual_entry e ON e.id = a.actual_entry_id
                   WHERE a.debt_account_id = NEW.debt_account_id
                   AND e.deleted_at IS NULL
                   AND e.financial_date < NEW.financial_date)
    ) THEN
        RAISE EXCEPTION 'Debt activity precedes the new opening date';
    END IF;
    RETURN NEW;
END; $$;
"""

IMMUTABLE = """
CREATE OR REPLACE FUNCTION protect_debt_opening() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_opening THEN RAISE EXCEPTION 'Debt opening must be retained'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.is_opening AND (NEW.financial_date, NEW.amount, NEW.debt_account_id,
    NEW.entity_id, NEW.is_opening, NEW.deleted_at) IS DISTINCT FROM
    (OLD.financial_date, OLD.amount, OLD.debt_account_id, OLD.entity_id,
    OLD.is_opening, OLD.deleted_at)
    THEN RAISE EXCEPTION 'Debt opening is immutable'; END IF;
  RETURN NEW;
END; $$;
"""


def upgrade():
    op.execute(MOVABLE)


def downgrade():
    op.execute(IMMUTABLE)
