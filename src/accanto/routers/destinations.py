"""Authenticated investment and giving destination routes."""

from uuid import UUID

from fastapi import APIRouter

from accanto.dtos.destinations import (
    ContributionInput,
    ContributionResult,
    CreateDestination,
    DestinationResult,
    EditDestination,
)
from accanto.dtos.monthly import RevisionInput
from accanto.routers.authentication import Session, Token
from accanto.routers.income_estimates import RequestKey
from accanto.services.destinations import read_contributions, read_destinations
from accanto.services.monthly import write

router = APIRouter(prefix="/api/entities/{entity_id}", tags=["destinations"])


@router.get("/investments", response_model=list[DestinationResult])
async def investments(entity_id: UUID, session: Session, token: Token):
    return await read_destinations(session, token, entity_id, "investment")


@router.get("/giving-recipients", response_model=list[DestinationResult])
async def giving_recipients(entity_id: UUID, session: Session, token: Token):
    return await read_destinations(session, token, entity_id, "giving")


@router.post("/investments", response_model=DestinationResult)
async def create_investment(
    entity_id: UUID,
    body: CreateDestination,
    session: Session,
    token: Token,
    request_key: RequestKey,
):
    return await write(
        session,
        token,
        entity_id,
        "create_investment",
        request_key,
        body.model_dump(mode="json"),
    )


@router.post("/giving-recipients", response_model=DestinationResult)
async def create_giving(
    entity_id: UUID,
    body: CreateDestination,
    session: Session,
    token: Token,
    request_key: RequestKey,
):
    return await write(
        session,
        token,
        entity_id,
        "create_giving",
        request_key,
        body.model_dump(mode="json"),
    )


@router.put("/investments/{destination_id}", response_model=DestinationResult)
async def edit_investment(
    entity_id: UUID,
    destination_id: UUID,
    body: EditDestination,
    session: Session,
    token: Token,
    request_key: RequestKey,
):
    return await write(
        session,
        token,
        entity_id,
        "edit_investment",
        request_key,
        body.model_dump(mode="json"),
        destination_id,
    )


@router.put("/giving-recipients/{destination_id}", response_model=DestinationResult)
async def edit_giving(
    entity_id: UUID,
    destination_id: UUID,
    body: EditDestination,
    session: Session,
    token: Token,
    request_key: RequestKey,
):
    return await write(
        session,
        token,
        entity_id,
        "edit_giving",
        request_key,
        body.model_dump(mode="json"),
        destination_id,
    )


@router.get("/investment-activity", response_model=list[ContributionResult])
async def investment_history(entity_id: UUID, session: Session, token: Token):
    return await read_contributions(session, token, entity_id, "investment")


@router.get("/giving-activity", response_model=list[ContributionResult])
async def giving_history(entity_id: UUID, session: Session, token: Token):
    return await read_contributions(session, token, entity_id, "giving")


@router.post("/investment-activity", response_model=ContributionResult)
async def create_investment_entry(
    entity_id: UUID,
    body: ContributionInput,
    session: Session,
    token: Token,
    request_key: RequestKey,
):
    return await write(
        session,
        token,
        entity_id,
        "create_investment_entry",
        request_key,
        body.model_dump(mode="json"),
    )


@router.post("/giving-activity", response_model=ContributionResult)
async def create_giving_entry(
    entity_id: UUID,
    body: ContributionInput,
    session: Session,
    token: Token,
    request_key: RequestKey,
):
    return await write(
        session,
        token,
        entity_id,
        "create_giving_entry",
        request_key,
        body.model_dump(mode="json"),
    )


@router.put("/investment-activity/{entry_id}", response_model=ContributionResult)
async def edit_investment_entry(
    entity_id: UUID,
    entry_id: UUID,
    body: ContributionInput,
    session: Session,
    token: Token,
    request_key: RequestKey,
):
    return await write(
        session,
        token,
        entity_id,
        "edit_investment_entry",
        request_key,
        body.model_dump(mode="json"),
        entry_id,
    )


@router.put("/giving-activity/{entry_id}", response_model=ContributionResult)
async def edit_giving_entry(
    entity_id: UUID,
    entry_id: UUID,
    body: ContributionInput,
    session: Session,
    token: Token,
    request_key: RequestKey,
):
    return await write(
        session,
        token,
        entity_id,
        "edit_giving_entry",
        request_key,
        body.model_dump(mode="json"),
        entry_id,
    )


@router.delete("/investment-activity/{entry_id}", response_model=ContributionResult)
async def delete_investment_entry(
    entity_id: UUID,
    entry_id: UUID,
    body: RevisionInput,
    session: Session,
    token: Token,
    request_key: RequestKey,
):
    return await write(
        session,
        token,
        entity_id,
        "delete_investment_entry",
        request_key,
        body.model_dump(mode="json"),
        entry_id,
    )


@router.delete("/giving-activity/{entry_id}", response_model=ContributionResult)
async def delete_giving_entry(
    entity_id: UUID,
    entry_id: UUID,
    body: RevisionInput,
    session: Session,
    token: Token,
    request_key: RequestKey,
):
    return await write(
        session,
        token,
        entity_id,
        "delete_giving_entry",
        request_key,
        body.model_dump(mode="json"),
        entry_id,
    )
