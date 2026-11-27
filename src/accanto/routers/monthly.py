"""Authenticated direct API for the incremental monthly core."""

from datetime import date
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Header, HTTPException, Query
from sqlalchemy.exc import IntegrityError

from accanto.dtos.monthly import (
    ActivityInput,
    KnownTotalInput,
    PlanCopyInput,
    PlanInput,
    RefundInput,
    ReviewEditInput,
    ReviewInput,
    RevisionInput,
)
from accanto.routers.authentication import Session, Token
from accanto.services.monthly import (
    ACTIVITY_PAGE_LIMIT,
    RejectionError,
    read_activity,
    read_activity_page,
    read_plans,
    read_review,
    write,
)

router = APIRouter(prefix="/api/entities/{entity_id}", tags=["monthly core"])
RequestKey = Annotated[
    str, Header(alias="Idempotency-Key", min_length=1, max_length=120)
]


def public_result(value):
    """Internal relational IDs are not public API identifiers."""
    if isinstance(value, list):
        return [public_result(v) for v in value]
    if isinstance(value, dict):
        return {
            k: public_result(v)
            for k, v in value.items()
            if k != "recording_order"
            and not (isinstance(v, int) and (k == "id" or k.endswith("_id")))
        }
    return value


async def command(
    session, token, entity_id, operation, request_key, payload, target=None
):
    try:
        return public_result(
            await write(
                session,
                token,
                entity_id,
                operation,
                request_key,
                payload.model_dump(),
                target,
            )
        )
    except RejectionError as error:
        raise HTTPException(
            error.status, {"code": error.code, "message": error.message}
        ) from None
    except IntegrityError:
        raise HTTPException(
            409, {"code": "record_conflict", "message": "A conflicting record exists."}
        ) from None


@router.post("/plans")
async def create_plan(
    entity_id: UUID,
    body: PlanInput,
    session: Session,
    token: Token,
    request_key: RequestKey,
):
    return await command(session, token, entity_id, "create_plan", request_key, body)


@router.post("/plans/{plan_id}/copies")
async def copy_plan(
    entity_id: UUID,
    plan_id: UUID,
    body: PlanCopyInput,
    session: Session,
    token: Token,
    request_key: RequestKey,
):
    return await command(
        session, token, entity_id, "copy_plan", request_key, body, plan_id
    )


@router.put("/plans/{plan_id}/draft")
async def edit_plan(
    entity_id: UUID,
    plan_id: UUID,
    body: PlanInput,
    session: Session,
    token: Token,
    request_key: RequestKey,
):
    return await command(
        session, token, entity_id, "edit_plan", request_key, body, plan_id
    )


@router.post("/plans/{plan_id}/versions")
async def save_version(
    entity_id: UUID,
    plan_id: UUID,
    body: RevisionInput,
    session: Session,
    token: Token,
    request_key: RequestKey,
):
    return await command(
        session, token, entity_id, "save_version", request_key, body, plan_id
    )


@router.post("/activity")
async def create_activity(
    entity_id: UUID,
    body: ActivityInput,
    session: Session,
    token: Token,
    request_key: RequestKey,
):
    return await command(session, token, entity_id, "create_entry", request_key, body)


@router.post("/activity/known-total")
async def create_known_total(
    entity_id: UUID,
    body: KnownTotalInput,
    session: Session,
    token: Token,
    request_key: RequestKey,
):
    return await command(session, token, entity_id, "known_total", request_key, body)


@router.post("/activity/{entry_id}/refunds")
async def create_refund(
    entity_id: UUID,
    entry_id: UUID,
    body: RefundInput,
    session: Session,
    token: Token,
    request_key: RequestKey,
):
    return await command(
        session, token, entity_id, "create_refund", request_key, body, entry_id
    )


@router.put("/activity/refunds/{entry_id}")
async def edit_refund(
    entity_id: UUID,
    entry_id: UUID,
    body: RefundInput,
    session: Session,
    token: Token,
    request_key: RequestKey,
):
    return await command(
        session, token, entity_id, "edit_refund", request_key, body, entry_id
    )


@router.delete("/activity/refunds/{entry_id}")
async def delete_refund(
    entity_id: UUID,
    entry_id: UUID,
    body: RevisionInput,
    session: Session,
    token: Token,
    request_key: RequestKey,
):
    return await command(
        session, token, entity_id, "delete_refund", request_key, body, entry_id
    )


@router.put("/activity/{entry_id}")
async def edit_activity(
    entity_id: UUID,
    entry_id: UUID,
    body: ActivityInput,
    session: Session,
    token: Token,
    request_key: RequestKey,
):
    return await command(
        session, token, entity_id, "edit_entry", request_key, body, entry_id
    )


@router.delete("/activity/{entry_id}")
async def delete_activity(
    entity_id: UUID,
    entry_id: UUID,
    body: RevisionInput,
    session: Session,
    token: Token,
    request_key: RequestKey,
):
    return await command(
        session, token, entity_id, "delete_entry", request_key, body, entry_id
    )


@router.post("/reviews")
async def create_review(
    entity_id: UUID,
    body: ReviewInput,
    session: Session,
    token: Token,
    request_key: RequestKey,
):
    return await command(session, token, entity_id, "create_review", request_key, body)


@router.get("/reviews/{month}")
async def get_review(entity_id: UUID, month: date, session: Session, token: Token):
    if month.day != 1:
        raise HTTPException(422, "Use the first day of the calendar month.")
    try:
        return public_result(await read_review(session, token, entity_id, month))
    except RejectionError as error:
        raise HTTPException(
            error.status, {"code": error.code, "message": error.message}
        ) from None


@router.put("/reviews/{month}")
async def edit_review(
    entity_id: UUID,
    month: date,
    body: ReviewEditInput,
    session: Session,
    token: Token,
    request_key: RequestKey,
):
    if month.day != 1:
        raise HTTPException(422, "Use the first day of the calendar month.")
    return await command(
        session, token, entity_id, "edit_review", request_key, body, month
    )


@router.get("/plans")
async def get_plans(entity_id: UUID, session: Session, token: Token):
    try:
        return public_result(await read_plans(session, token, entity_id))
    except RejectionError as error:
        raise HTTPException(error.status, error.message) from None


@router.get("/activity/page")
async def get_activity_page(
    entity_id: UUID,
    session: Session,
    token: Token,
    month: date | None = None,
    category: Literal[
        "income", "fixed_cost", "spending", "saving", "investing", "giving"
    ]
    | None = None,
    tag_id: UUID | None = None,
    q: Annotated[str, Query(max_length=200)] = "",
    entry_id: UUID | None = None,
    cursor: UUID | None = None,
    limit: Annotated[int, Query(ge=1, le=ACTIVITY_PAGE_LIMIT)] = 100,
):
    if month is not None and month.day != 1:
        raise HTTPException(422, "Use the first day of the calendar month.")
    try:
        return public_result(
            await read_activity_page(
                session,
                token,
                entity_id,
                month=month,
                category=category,
                tag_id=tag_id,
                query=q,
                entry_id=entry_id,
                cursor=cursor,
                limit=limit,
            )
        )
    except RejectionError as error:
        raise HTTPException(error.status, error.message) from None


@router.get("/activity")
async def get_activity(
    entity_id: UUID, session: Session, token: Token, tag_id: UUID | None = None
):
    try:
        return public_result(await read_activity(session, token, entity_id, tag_id))
    except RejectionError as error:
        raise HTTPException(error.status, error.message) from None
