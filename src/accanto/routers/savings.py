"""Authenticated savings account and goal commands."""

from uuid import UUID

from fastapi import APIRouter

from accanto.dtos.savings import (
    AccountLifecycle,
    AccountResult,
    CompleteGoal,
    CreateAccount,
    CreateGoal,
    DeleteMovement,
    EditAccount,
    EditGoal,
    EditMovement,
    MovementInput,
    MovementResult,
)
from accanto.routers.authentication import Session, Token
from accanto.routers.income_estimates import RequestKey
from accanto.services.monthly import write
from accanto.services.savings import read_account, read_accounts, read_movements

router = APIRouter(
    prefix="/api/entities/{entity_id}/savings-accounts", tags=["savings"]
)


@router.get("/movements", response_model=list[MovementResult])
async def list_movements(entity_id: UUID, session: Session, token: Token):
    return await read_movements(session, token, entity_id)


@router.post("/movements", response_model=MovementResult)
async def create_movement(
    entity_id: UUID,
    body: MovementInput,
    session: Session,
    token: Token,
    request_key: RequestKey,
):
    return await write(
        session,
        token,
        entity_id,
        "create_savings_movement",
        request_key,
        body.model_dump(mode="json"),
    )


@router.put("/movements/{movement_id}", response_model=MovementResult)
async def edit_movement(
    entity_id: UUID,
    movement_id: UUID,
    body: EditMovement,
    session: Session,
    token: Token,
    request_key: RequestKey,
):
    return await write(
        session,
        token,
        entity_id,
        "edit_savings_movement",
        request_key,
        body.model_dump(mode="json"),
        movement_id,
    )


@router.delete("/movements/{movement_id}", response_model=MovementResult)
async def delete_movement(
    entity_id: UUID,
    movement_id: UUID,
    body: DeleteMovement,
    session: Session,
    token: Token,
    request_key: RequestKey,
):
    return await write(
        session,
        token,
        entity_id,
        "delete_savings_movement",
        request_key,
        body.model_dump(mode="json"),
        movement_id,
    )


@router.get("", response_model=list[AccountResult])
async def list_accounts(entity_id: UUID, session: Session, token: Token):
    return await read_accounts(session, token, entity_id)


@router.get("/{account_id}", response_model=AccountResult)
async def get_account(
    entity_id: UUID, account_id: UUID, session: Session, token: Token
):
    return await read_account(session, token, entity_id, account_id)


@router.post("", response_model=AccountResult)
async def create_account(
    entity_id: UUID,
    body: CreateAccount,
    session: Session,
    token: Token,
    request_key: RequestKey,
):
    return await write(
        session,
        token,
        entity_id,
        "create_saving_account",
        request_key,
        body.model_dump(mode="json"),
    )


@router.put("/{account_id}", response_model=AccountResult)
async def edit_account(
    entity_id: UUID,
    account_id: UUID,
    body: EditAccount,
    session: Session,
    token: Token,
    request_key: RequestKey,
):
    return await write(
        session,
        token,
        entity_id,
        "edit_saving_account",
        request_key,
        body.model_dump(mode="json"),
        account_id,
    )


@router.post("/{account_id}/goals", response_model=AccountResult)
async def create_goal(
    entity_id: UUID,
    account_id: UUID,
    body: CreateGoal,
    session: Session,
    token: Token,
    request_key: RequestKey,
):
    return await write(
        session,
        token,
        entity_id,
        "create_saving_goal",
        request_key,
        body.model_dump(mode="json"),
        account_id,
    )


@router.put("/{account_id}/goals/{goal_id}", response_model=AccountResult)
async def edit_goal(
    entity_id: UUID,
    account_id: UUID,
    goal_id: UUID,
    body: EditGoal,
    session: Session,
    token: Token,
    request_key: RequestKey,
):
    return await write(
        session,
        token,
        entity_id,
        "edit_saving_goal",
        request_key,
        {**body.model_dump(mode="json"), "goal_id": goal_id},
        account_id,
    )


@router.post("/{account_id}/archive", response_model=AccountResult)
async def archive_account(
    entity_id: UUID,
    account_id: UUID,
    body: AccountLifecycle,
    session: Session,
    token: Token,
    request_key: RequestKey,
):
    return await write(
        session,
        token,
        entity_id,
        "archive_saving_account",
        request_key,
        body.model_dump(mode="json"),
        account_id,
    )


@router.post("/{account_id}/reopen", response_model=AccountResult)
async def reopen_account(
    entity_id: UUID,
    account_id: UUID,
    body: AccountLifecycle,
    session: Session,
    token: Token,
    request_key: RequestKey,
):
    return await write(
        session,
        token,
        entity_id,
        "reopen_saving_account",
        request_key,
        body.model_dump(mode="json"),
        account_id,
    )


@router.post("/{account_id}/goals/{goal_id}/complete", response_model=AccountResult)
async def complete_goal(
    entity_id: UUID,
    account_id: UUID,
    goal_id: UUID,
    body: CompleteGoal,
    session: Session,
    token: Token,
    request_key: RequestKey,
):
    return await write(
        session,
        token,
        entity_id,
        "complete_saving_goal",
        request_key,
        {**body.model_dump(mode="json"), "goal_id": goal_id},
        account_id,
    )
