"""Database-maintained Plan revision update metadata.

Existing rows remain unknown rather than claiming migration time as their edit time.
Saved versions keep the existing immutability protection.
"""

import sqlalchemy as sa

from alembic import op

revision = "5l020"
down_revision = "5k019"
branch_labels = None
depends_on = None

LINE_TABLES = (
    "plan_income_line",
    "plan_fixed_cost_line",
    "plan_savings_funding_line",
    "plan_saving_goal_line",
    "plan_investment_line",
    "plan_giving_line",
)


def upgrade():
    op.add_column("plan_revision", sa.Column("updated_at", sa.DateTime(timezone=True)))
    op.execute("""CREATE FUNCTION stamp_plan_revision() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN
          NEW.updated_at = clock_timestamp();
          RETURN NEW;
        END $$""")
    op.execute("""CREATE TRIGGER plan_revision_updated
        BEFORE INSERT OR UPDATE ON plan_revision
        FOR EACH ROW EXECUTE FUNCTION stamp_plan_revision()""")
    op.execute("""CREATE FUNCTION touch_plan_revision() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN
          IF TG_OP != 'INSERT' THEN
            UPDATE plan_revision SET updated_at = clock_timestamp()
              WHERE id = OLD.plan_revision_id AND NOT saved;
          END IF;
          IF TG_OP != 'DELETE' THEN
            UPDATE plan_revision SET updated_at = clock_timestamp()
              WHERE id = NEW.plan_revision_id AND NOT saved;
          END IF;
          RETURN NULL;
        END $$""")
    for table in LINE_TABLES:
        op.execute(f"""CREATE TRIGGER {table}_updated
            AFTER INSERT OR UPDATE OR DELETE ON {table}
            FOR EACH ROW EXECUTE FUNCTION touch_plan_revision()""")


def downgrade():
    for table in LINE_TABLES:
        op.execute(f"DROP TRIGGER {table}_updated ON {table}")
    op.execute("DROP FUNCTION touch_plan_revision()")
    op.execute("DROP TRIGGER plan_revision_updated ON plan_revision")
    op.execute("DROP FUNCTION stamp_plan_revision()")
    op.drop_column("plan_revision", "updated_at")
