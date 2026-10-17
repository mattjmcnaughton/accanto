"""Current Entity settings through the shared transaction and retry boundary."""

from uuid import UUID

from fastapi import APIRouter

from accanto.dtos.entities import EntitySettingsInput
from accanto.routers.authentication import Session, Token
from accanto.routers.monthly import RequestKey, command
from accanto.services.entity_settings import read_settings

router = APIRouter(
    prefix="/api/entities/{entity_id}/settings", tags=["Entity settings"]
)


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
