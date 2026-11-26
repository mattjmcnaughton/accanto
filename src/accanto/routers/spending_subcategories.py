"""Authenticated Spending subcategory routes (TDD 07)."""

from uuid import UUID

from fastapi import APIRouter

from accanto.dtos.monthly import SpendingSubcategoryEditInput, SpendingSubcategoryInput
from accanto.routers.authentication import Session, Token
from accanto.routers.monthly import RequestKey, command
from accanto.services.spending_subcategories import read_spending_subcategories

router = APIRouter(prefix="/api/entities/{entity_id}", tags=["spending subcategories"])


@router.get("/spending-subcategories")
async def get_spending_subcategories(entity_id: UUID, session: Session, token: Token):
    return await read_spending_subcategories(session, token, entity_id)


@router.post("/spending-subcategories")
async def create_spending_subcategory(
    entity_id: UUID,
    body: SpendingSubcategoryInput,
    session: Session,
    token: Token,
    request_key: RequestKey,
):
    return await command(
        session, token, entity_id, "create_spending_subcategory", request_key, body
    )


@router.put("/spending-subcategories/{subcategory_id}")
async def edit_spending_subcategory(
    entity_id: UUID,
    subcategory_id: UUID,
    body: SpendingSubcategoryEditInput,
    session: Session,
    token: Token,
    request_key: RequestKey,
):
    return await command(
        session,
        token,
        entity_id,
        "edit_spending_subcategory",
        request_key,
        body,
        subcategory_id,
    )
