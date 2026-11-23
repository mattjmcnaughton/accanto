"""MCP projections release only the agreed synthetic financial fields."""

from datetime import date
from uuid import UUID

from accanto.dtos.tools import project_entities, project_review, project_versions

ENTITY = "00000000-0000-0000-0000-000000000101"
PLAN = "00000000-0000-0000-0000-000000000102"
VERSION = "00000000-0000-0000-0000-000000000103"
SOURCE = "00000000-0000-0000-0000-000000000104"


def test_entities_and_saved_versions_exclude_internal_and_draft_fields():
    entities = project_entities(
        {
            "user": {"id": "private-user"},
            "entities": [
                {
                    "id": ENTITY,
                    "name": "Synthetic workshop",
                    "time_zone": "UTC",
                    "today": "2026-10-01",
                    "owner_id": 919,
                }
            ],
        }
    )
    assert entities.model_dump(mode="json") == {
        "entities": [
            {
                "id": ENTITY,
                "name": "Synthetic workshop",
                "time_zone": "UTC",
                "today": "2026-10-01",
            }
        ],
    }
    versions = project_versions(
        [
            {
                "plan_id": PLAN,
                "revisions": [
                    {"saved": False, "private_draft": "must not leak"},
                    {
                        "saved": True,
                        "uuid": VERSION,
                        "name": "Synthetic plan",
                        "number": 2,
                        "revision": 3,
                        "incomes": [{"amount": "999.00"}],
                        "id": 808,
                        "future_field": "must not leak",
                    },
                ],
            }
        ]
    )
    assert versions.model_dump(mode="json") == {
        "versions": [
            {
                "plan_id": PLAN,
                "version_id": VERSION,
                "name": "Synthetic plan",
                "number": 2,
                "revision": 3,
            }
        ]
    }


def test_review_projection_preserves_unknowns_and_omits_raw_details():
    # All values are deliberately synthetic, independent of any user records.
    item = {
        "id": SOURCE,
        "name": "Synthetic income",
        "planned": "123.00",
        "recorded": None,
        "difference": None,
        "entries": [{"note": "excluded raw entry", "amount": "999.00"}],
        "future_identity_field": "excluded",
    }
    result = {
        "review": {"month": "2026-10-01", "note": "excluded Review note", "id": 42},
        "version": {"uuid": VERSION, "incomes": ["excluded inputs"]},
        "comparison": {
            category: {
                "planned": "123.00",
                "recorded": None,
                "incomplete": True,
                "difference": None,
                "items": [item] if category == "income" else [],
                "entries": ["excluded"],
                "unplanned": ["excluded"],
            }
            for category in (
                "income",
                "fixed_cost",
                "spending",
                "saving",
                "investing",
                "giving",
            )
        },
        "summary": {
            "new_saving": None,
            "savings_used": None,
            "net_saving": None,
            "total_investing": None,
            "income_funded_fixed_cost": None,
            "income_funded_investing": None,
            "savings_used_incomplete": True,
            "future_summary_field": "excluded",
        },
        "metrics": [
            {
                "key": "actual:synthetic",
                "basis": "actual",
                "label": "Synthetic ratio",
                "numerator_label": "Saving",
                "denominator_label": "Income",
                "numerator": None,
                "denominator": None,
                "percentage": None,
                "unavailable_reason": "Required amount is unknown or incomplete.",
                "components": [
                    {
                        "name": "Synthetic component",
                        "amount": None,
                        "future_component_field": "excluded",
                    }
                ],
                "future_metric_field": "excluded",
            }
        ],
        "entries": [{"note": "excluded"}],
        "audit": ["excluded"],
        "future_top_level_field": "excluded",
    }
    review = project_review(result)
    assert review.month == date(2026, 10, 1)
    assert review.version_id == UUID(VERSION)
    assert review.categories[0].items[0].recorded is None
    assert review.categories[0].items[0].difference is None
    assert review.summary.new_saving is None
    assert review.metrics[0].percentage is None
    assert review.metrics[0].components[0].amount is None
    assert "excluded" not in review.model_dump_json()
    assert set(review.model_dump()) == {
        "month",
        "version_id",
        "categories",
        "summary",
        "metrics",
    }
    assert set(review.categories[0].items[0].model_dump()) == {
        "id",
        "name",
        "planned",
        "recorded",
        "difference",
    }
