"""Create Entity, delete it and its current settings, through shared boundaries."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter
from pydantic import Field

from accanto.dtos.entities import EntityInput, EntitySettingsInput
from accanto.dtos.monthly import Input
from accanto.routers.authentication import BrowserToken, Session, Token
from accanto.routers.monthly import RequestKey, command
from accanto.services.entity_settings import create_entity, delete_entity, read_settings

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


class DeleteEntityInput(Input):
    # The Entity's name, typed by its owner; compared after trimming.
    confirm_name: Annotated[str, Field(min_length=1, max_length=200)]


@collection.delete("/{entity_id}")
async def delete(
    entity_id: UUID, body: DeleteEntityInput, session: Session, actor: BrowserToken
):
    """Owner only, signed-in browser only (TDD 22); cannot be undone."""
    return await delete_entity(session, actor, entity_id, body.confirm_name)


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
