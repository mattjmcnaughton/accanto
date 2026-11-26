"""Authenticated loan accounts and investment/debt observations."""

from uuid import UUID

from fastapi import APIRouter

from accanto.dtos.balances import (
    CreateDebt,
    DebtResult,
    EditDebt,
    ObservationInput,
    ObservationResult,
)
from accanto.dtos.monthly import RevisionInput
from accanto.routers.authentication import Session, Token
from accanto.routers.monthly import RequestKey
from accanto.services.balances import read_debts, read_observations
from accanto.services.monthly import write

router = APIRouter(prefix="/api/entities/{entity_id}", tags=["balances"])


@router.get("/debts", response_model=list[DebtResult])
async def debts(entity_id: UUID, session: Session, token: Token):
    return await read_debts(session, token, entity_id)


@router.post("/debts", response_model=DebtResult)
async def create_debt(
    entity_id: UUID,
    body: CreateDebt,
    session: Session,
    token: Token,
    request_key: RequestKey,
):
    return await write(
        session,
        token,
        entity_id,
        "create_debt",
        request_key,
        body.model_dump(mode="json"),
    )


@router.put("/debts/{debt_id}", response_model=DebtResult)
async def edit_debt(
    entity_id: UUID,
    debt_id: UUID,
    body: EditDebt,
    session: Session,
    token: Token,
    request_key: RequestKey,
):
    return await write(
        session,
        token,
        entity_id,
        "edit_debt",
        request_key,
        body.model_dump(mode="json"),
        debt_id,
    )


@router.get("/investment-observations", response_model=list[ObservationResult])
async def investment_observations(entity_id: UUID, session: Session, token: Token):
    return await read_observations(session, token, entity_id, "investment")


@router.get("/debt-observations", response_model=list[ObservationResult])
async def debt_observations(entity_id: UUID, session: Session, token: Token):
    return await read_observations(session, token, entity_id, "debt")


@router.post("/{kind}-observations", response_model=ObservationResult)
async def create_observation(
    entity_id: UUID,
    kind: str,
    body: ObservationInput,
    session: Session,
    token: Token,
    request_key: RequestKey,
):
    if kind not in {"investment", "debt"}:
        from fastapi import HTTPException

        raise HTTPException(404)
    return await write(
        session,
        token,
        entity_id,
        f"create_{kind}_observation",
        request_key,
        body.model_dump(mode="json"),
    )


@router.put("/{kind}-observations/{observation_id}", response_model=ObservationResult)
async def edit_observation(
    entity_id: UUID,
    kind: str,
    observation_id: UUID,
    body: ObservationInput,
    session: Session,
    token: Token,
    request_key: RequestKey,
):
    if kind not in {"investment", "debt"}:
        from fastapi import HTTPException

        raise HTTPException(404)
    return await write(
        session,
        token,
        entity_id,
        f"edit_{kind}_observation",
        request_key,
        body.model_dump(mode="json"),
        observation_id,
    )


@router.delete(
    "/{kind}-observations/{observation_id}", response_model=ObservationResult
)
async def delete_observation(
    entity_id: UUID,
    kind: str,
    observation_id: UUID,
    body: RevisionInput,
    session: Session,
    token: Token,
    request_key: RequestKey,
):
    if kind not in {"investment", "debt"}:
        from fastapi import HTTPException

        raise HTTPException(404)
    return await write(
        session,
        token,
        entity_id,
        f"delete_{kind}_observation",
        request_key,
        body.model_dump(mode="json"),
        observation_id,
    )
