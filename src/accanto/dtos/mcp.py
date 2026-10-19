"""Explicit MCP disclosure contracts, separate from database and HTTP records."""

from datetime import date
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

# Preserve decimal strings and unknown amounts; never coerce money to floats.
Amount = Annotated[str, Field(pattern=r"^-?\d+(?:\.\d+)?$")]
Category = Literal["income", "fixed_cost", "spending", "saving", "investing", "giving"]


class Output(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Entity(Output):
    id: UUID
    name: str
    time_zone: str
    today: date


class EntityList(Output):
    entities: list[Entity]


class PlanVersion(Output):
    plan_id: UUID
    version_id: UUID
    name: str
    number: int
    revision: int


class PlanVersionList(Output):
    versions: list[PlanVersion]


class IdentityComparison(Output):
    id: UUID
    name: str
    planned: Amount
    recorded: Amount | None
    difference: Amount | None


class CategoryComparison(Output):
    category: Category
    planned: Amount | None
    recorded: Amount | None
    incomplete: bool
    difference: Amount | None
    items: list[IdentityComparison]


class Summary(Output):
    new_saving: Amount | None
    savings_used: Amount | None
    net_saving: Amount | None
    total_investing: Amount | None
    income_funded_fixed_cost: Amount | None
    income_funded_investing: Amount | None
    savings_used_incomplete: bool


class Component(Output):
    name: str
    amount: Amount | None


class Metric(Output):
    key: str
    basis: Literal["planned", "actual"]
    label: str
    numerator_label: str
    denominator_label: str
    numerator: Amount | None
    denominator: Amount | None
    percentage: Amount | None
    unavailable_reason: str | None
    components: list[Component]


class MonthlyReview(Output):
    month: date
    version_id: UUID
    categories: list[CategoryComparison]
    summary: Summary
    metrics: list[Metric]


class StartedReview(Output):
    review_id: UUID
    month: date
    version_id: UUID
    revision: int


def _select(model, values):
    """Select known fields explicitly, even when services acquire new fields."""
    return {field: values[field] for field in model.model_fields}


def project_entities(metadata) -> EntityList:
    return EntityList(
        entities=[Entity(**_select(Entity, entity)) for entity in metadata["entities"]]
    )


def project_versions(plans) -> PlanVersionList:
    return PlanVersionList(
        versions=[
            PlanVersion(
                plan_id=plan["plan_id"],
                version_id=version["uuid"],
                name=version["name"],
                number=version["number"],
                revision=version["revision"],
            )
            for plan in plans
            for version in plan["revisions"]
            if version["saved"]
        ]
    )


def project_review(result) -> MonthlyReview:
    return MonthlyReview(
        month=result["review"]["month"],
        version_id=result["version"]["uuid"],
        categories=[
            CategoryComparison(
                category=category,
                planned=comparison["planned"],
                recorded=comparison["recorded"],
                incomplete=comparison["incomplete"],
                difference=comparison["difference"],
                items=[
                    IdentityComparison(**_select(IdentityComparison, item))
                    for item in comparison["items"]
                ],
            )
            for category in (
                "income",
                "fixed_cost",
                "spending",
                "saving",
                "investing",
                "giving",
            )
            for comparison in (result["comparison"][category],)
        ],
        summary=Summary(**_select(Summary, result["summary"])),
        metrics=[
            Metric(
                **_select(Metric, metric)
                | {
                    "components": [
                        Component(**_select(Component, component))
                        for component in metric["components"]
                    ]
                }
            )
            for metric in result["metrics"]
        ],
    )
