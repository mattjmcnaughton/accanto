"""Create Entity and current Entity settings, through the shared retry boundary."""

from uuid import UUID

from fastapi import APIRouter

from accanto.dtos.entities import EntityInput, EntitySettingsInput
from accanto.routers.authentication import Session, Token
from accanto.routers.monthly import RequestKey, command
from accanto.services.entity_settings import create_entity, read_settings

collection = APIRouter(prefix="/api/entities", tags=["Entity settings"])
router = APIRouter(
    prefix="/api/entities/{entity_id}/settings", tags=["Entity settings"]
)


@collection.post("")
async def create(
    body: EntityInput, session: Session, token: Token, request_key: RequestKey
):
    """A new, empty Entity owned by the caller; retry with the same key and input."""
    return await create_entity(session, token, request_key, body.model_dump())


@router.get("")
async def get_settings(entity_id: UUID, session: Session, token: Token):
    return await read_settings(session, token, entity_id)


@router.put("")
async def update_settings(
    entity_id: UUID,
    body: EntitySettingsInput,
    session: Session,
    token: Token,
    request_key: RequestKey,
):
    return await command(session, token, entity_id, "edit_entity", request_key, body)
