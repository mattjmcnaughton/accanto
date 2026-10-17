"""Connect real actual entries to retained savings history."""
# ruff: noqa: E501 -- SQL statements remain readable in migration form.

import sqlalchemy as sa

from alembic import op

revision = "5d013"
down_revision = "5c012"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TABLE actual_entry DROP CONSTRAINT actual_entry_category_check")
    op.create_check_constraint(
        "actual_entry_category_check",
        "actual_entry",
        "category IN ('income', 'spending', 'saving')",
    )
    op.execute("CREATE SEQUENCE saving_activity_recording_order_seq")
    op.add_column(
        "actual_entry",
        sa.Column("recording_order", sa.BigInteger(), nullable=True),
    )
    op.execute("UPDATE actual_entry SET recording_order = id")
    op.execute(
        "SELECT setval('saving_activity_recording_order_seq', "
        "GREATEST((SELECT COALESCE(MAX(id), 0) FROM actual_entry), 1))"
    )
    op.alter_column(
        "actual_entry",
        "recording_order",
        nullable=False,
        server_default=sa.text("nextval('saving_activity_recording_order_seq')"),
    )
    op.create_unique_constraint(
        "actual_entry_recording_order_key", "actual_entry", ["recording_order"]
    )
    op.add_column(
        "saving_linked_activity",
        sa.Column("actual_entry_id", sa.BigInteger(), nullable=True),
    )
    op.add_column(
        "saving_linked_activity",
        sa.Column(
            "recording_order",
            sa.BigInteger(),
            nullable=True,
        ),
    )
    op.create_foreign_key(
        "saving_linked_entry_entity_fk",
        "saving_linked_activity",
        "actual_entry",
        ["actual_entry_id", "entity_id"],
        ["id", "entity_id"],
    )
    op.create_index(
        "one_current_saving_link_per_entry",
        "saving_linked_activity",
        ["actual_entry_id"],
        unique=True,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.execute(
        """CREATE FUNCTION check_saving_entry_link() RETURNS trigger LANGUAGE plpgsql AS $$
        DECLARE entry_category text; entry_date date; entry_order bigint;
        BEGIN
            IF NEW.actual_entry_id IS NOT NULL AND NEW.deleted_at IS NULL THEN
                SELECT category, financial_date, recording_order
                  INTO entry_category, entry_date, entry_order
                  FROM actual_entry WHERE id = NEW.actual_entry_id AND entity_id = NEW.entity_id;
                IF entry_category NOT IN ('saving', 'spending')
                   OR entry_date <> NEW.financial_date
                   OR entry_order <> NEW.recording_order THEN
                    RAISE EXCEPTION 'Saving link must match an eligible entry and date';
                END IF;
            END IF;
            RETURN NEW;
        END $$"""
    )
    op.execute(
        """CREATE TRIGGER saving_entry_link_valid BEFORE INSERT OR UPDATE ON saving_linked_activity
        FOR EACH ROW EXECUTE FUNCTION check_saving_entry_link()"""
    )
    op.execute(
        """CREATE FUNCTION prevent_saving_link_entry_change() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF NEW.actual_entry_id IS DISTINCT FROM OLD.actual_entry_id OR
               NEW.recording_order IS DISTINCT FROM OLD.recording_order THEN
                RAISE EXCEPTION 'Saving link entry and recording order are immutable';
            END IF;
            RETURN NEW;
        END $$"""
    )
    op.execute(
        """CREATE TRIGGER saving_link_entry_immutable BEFORE UPDATE ON saving_linked_activity
        FOR EACH ROW EXECUTE FUNCTION prevent_saving_link_entry_change()"""
    )
    op.execute(
        """CREATE FUNCTION protect_actual_entry_order() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF NEW.recording_order <> OLD.recording_order THEN
                RAISE EXCEPTION 'Actual entry recording order is immutable';
            END IF;
            RETURN NEW;
        END $$"""
    )
    op.execute(
        """CREATE TRIGGER actual_entry_order_immutable BEFORE UPDATE ON actual_entry
        FOR EACH ROW EXECUTE FUNCTION protect_actual_entry_order()"""
    )
    op.execute(
        """CREATE FUNCTION check_entry_saving_relationship() RETURNS trigger LANGUAGE plpgsql AS $$
        DECLARE entry_key bigint; entry_kind text; entry_deleted timestamptz; active_links integer;
        BEGIN
            IF TG_TABLE_NAME = 'actual_entry' THEN
                entry_key := NEW.id;
            ELSE
                entry_key := NEW.actual_entry_id;
            END IF;
            IF entry_key IS NULL THEN RETURN NULL; END IF;
            SELECT category, deleted_at INTO entry_kind, entry_deleted
              FROM actual_entry WHERE id = entry_key;
            IF entry_kind IS NULL THEN RETURN NULL; END IF;
            SELECT COUNT(*) INTO active_links FROM saving_linked_activity
              WHERE actual_entry_id = entry_key AND deleted_at IS NULL;
            IF (entry_kind = 'saving' AND entry_deleted IS NULL AND active_links <> 1)
               OR ((entry_kind = 'income' OR entry_deleted IS NOT NULL) AND active_links <> 0) THEN
                RAISE EXCEPTION 'Actual entry has an invalid saving relationship';
            END IF;
            RETURN NULL;
        END $$"""
    )
    op.execute(
        """CREATE CONSTRAINT TRIGGER actual_entry_saving_relationship
        AFTER INSERT OR UPDATE ON actual_entry DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW EXECUTE FUNCTION check_entry_saving_relationship()"""
    )
    op.execute(
        """CREATE CONSTRAINT TRIGGER saving_link_relationship
        AFTER INSERT OR UPDATE ON saving_linked_activity DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW EXECUTE FUNCTION check_entry_saving_relationship()"""
    )


def downgrade():
    op.execute("DROP TRIGGER saving_link_relationship ON saving_linked_activity")
    op.execute("DROP TRIGGER actual_entry_saving_relationship ON actual_entry")
    op.execute("DROP FUNCTION check_entry_saving_relationship()")
    op.execute("DROP TRIGGER actual_entry_order_immutable ON actual_entry")
    op.execute("DROP FUNCTION protect_actual_entry_order()")
    op.execute("DROP TRIGGER saving_link_entry_immutable ON saving_linked_activity")
    op.execute("DROP FUNCTION prevent_saving_link_entry_change()")
    op.execute("DROP TRIGGER saving_entry_link_valid ON saving_linked_activity")
    op.execute("DROP FUNCTION check_saving_entry_link()")
    op.drop_index(
        "one_current_saving_link_per_entry", table_name="saving_linked_activity"
    )
    op.drop_constraint("saving_linked_entry_entity_fk", "saving_linked_activity")
    op.drop_column("saving_linked_activity", "recording_order")
    op.drop_column("saving_linked_activity", "actual_entry_id")
    op.drop_constraint("actual_entry_recording_order_key", "actual_entry")
    op.drop_column("actual_entry", "recording_order")
    op.execute("DROP SEQUENCE saving_activity_recording_order_seq")
    op.execute("ALTER TABLE actual_entry DROP CONSTRAINT actual_entry_category_check")
    op.create_check_constraint(
        "actual_entry_category_check",
        "actual_entry",
        "category IN ('income', 'spending')",
    )
