"""Authenticated Tag routes: manage tags and label entries (TDD 05)."""

from uuid import UUID

from fastapi import APIRouter

from accanto.dtos.monthly import EntryTagsInput, RevisionInput, TagEditInput, TagInput
from accanto.routers.authentication import Session, Token
from accanto.routers.monthly import RequestKey, command
from accanto.services.tags import read_tags

router = APIRouter(prefix="/api/entities/{entity_id}", tags=["tags"])


@router.get("/tags")
async def get_tags(entity_id: UUID, session: Session, token: Token):
    return await read_tags(session, token, entity_id)


@router.post("/tags")
async def create_tag(
    entity_id: UUID,
    body: TagInput,
    session: Session,
    token: Token,
    request_key: RequestKey,
):
    return await command(session, token, entity_id, "create_tag", request_key, body)


@router.put("/tags/{tag_id}")
async def edit_tag(
    entity_id: UUID,
    tag_id: UUID,
    body: TagEditInput,
    session: Session,
    token: Token,
    request_key: RequestKey,
):
    return await command(
        session, token, entity_id, "edit_tag", request_key, body, tag_id
    )


@router.delete("/tags/{tag_id}")
async def delete_tag(
    entity_id: UUID,
    tag_id: UUID,
    body: RevisionInput,
    session: Session,
    token: Token,
    request_key: RequestKey,
):
    return await command(
        session, token, entity_id, "delete_tag", request_key, body, tag_id
    )


@router.post("/activity/tags")
async def set_entry_tags(
    entity_id: UUID,
    body: EntryTagsInput,
    session: Session,
    token: Token,
    request_key: RequestKey,
):
    return await command(session, token, entity_id, "set_entry_tags", request_key, body)
