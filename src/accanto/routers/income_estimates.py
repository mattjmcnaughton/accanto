"""Authenticated HTTP contracts for independent income estimates."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Header

from accanto.dtos.income_estimates import DuplicateInput, EstimateInput, EstimateResult
from accanto.routers.authentication import Session, Token
from accanto.services.income_estimates import read_estimates
from accanto.services.monthly import write

router = APIRouter(
    prefix="/api/entities/{entity_id}/income-estimates", tags=["income estimates"]
)
RequestKey = Annotated[
    str, Header(alias="Idempotency-Key", min_length=1, max_length=120)
]


@router.get("", response_model=list[EstimateResult])
async def list_estimates(entity_id: UUID, session: Session, token: Token):
    return await read_estimates(session, token, entity_id)


@router.get("/{estimate_id}", response_model=EstimateResult)
async def get_estimate(
    entity_id: UUID, estimate_id: UUID, session: Session, token: Token
):
    return await read_estimates(session, token, entity_id, estimate_id)


@router.post("", response_model=EstimateResult)
async def create_estimate(
    entity_id: UUID,
    body: EstimateInput,
    session: Session,
    token: Token,
    request_key: RequestKey,
):
    return await write(
        session,
        token,
        entity_id,
        "create_estimate",
        request_key,
        body.model_dump(mode="json"),
    )


@router.put("/{estimate_id}", response_model=EstimateResult)
async def edit_estimate(
    entity_id: UUID,
    estimate_id: UUID,
    body: EstimateInput,
    session: Session,
    token: Token,
    request_key: RequestKey,
):
    return await write(
        session,
        token,
        entity_id,
        "edit_estimate",
        request_key,
        body.model_dump(mode="json"),
        estimate_id,
    )


@router.post("/{estimate_id}/duplicate", response_model=EstimateResult)
async def duplicate_estimate(
    entity_id: UUID,
    estimate_id: UUID,
    body: DuplicateInput,
    session: Session,
    token: Token,
    request_key: RequestKey,
):
    return await write(
        session,
        token,
        entity_id,
        "duplicate_estimate",
        request_key,
        body.model_dump(mode="json"),
        estimate_id,
    )
