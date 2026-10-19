"""Permit all eligible outflows to share retained savings history links."""
# ruff: noqa: E501 -- Keep SQL function body legible.

from alembic import op

revision = "5j018"
down_revision = "5i018"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""CREATE OR REPLACE FUNCTION check_saving_entry_link() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE entry_category text; entry_date date; entry_order bigint;
    BEGIN
      IF NEW.actual_entry_id IS NOT NULL AND NEW.deleted_at IS NULL THEN
        SELECT category, financial_date, recording_order
          INTO entry_category, entry_date, entry_order
          FROM actual_entry WHERE id = NEW.actual_entry_id AND entity_id = NEW.entity_id;
        IF entry_category NOT IN ('saving', 'spending', 'fixed_cost', 'giving', 'investing')
           OR entry_date <> NEW.financial_date OR entry_order <> NEW.recording_order THEN
          RAISE EXCEPTION 'Saving link must match an eligible entry and date';
        END IF;
      END IF;
      RETURN NEW;
    END $$""")


def downgrade():
    op.execute("""CREATE OR REPLACE FUNCTION check_saving_entry_link() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE entry_category text; entry_date date; entry_order bigint;
    BEGIN
      IF NEW.actual_entry_id IS NOT NULL AND NEW.deleted_at IS NULL THEN
        SELECT category, financial_date, recording_order
          INTO entry_category, entry_date, entry_order
          FROM actual_entry WHERE id = NEW.actual_entry_id AND entity_id = NEW.entity_id;
        IF entry_category NOT IN ('saving', 'spending')
           OR entry_date <> NEW.financial_date OR entry_order <> NEW.recording_order THEN
          RAISE EXCEPTION 'Saving link must match an eligible entry and date';
        END IF;
      END IF;
      RETURN NEW;
    END $$""")
