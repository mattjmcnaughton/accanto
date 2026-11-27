"""Who shares an Entity (TDD 19). Browser session only, like credentials."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter
from pydantic import Field

from accanto.dtos.monthly import Input, Name
from accanto.routers.authentication import BrowserToken, Session
from accanto.services.entity_members import change_members, list_members

router = APIRouter(prefix="/api/entities/{entity_id}/members", tags=["Entity members"])


class MemberInput(Input):
    # Only matched against verified emails already stored at sign-in.
    email: Annotated[str, Field(max_length=320, pattern=r"^[^@\s]+@[^@\s]+$")]
    name: Name


@router.get("")
async def get_members(entity_id: UUID, session: Session, actor: BrowserToken):
    return await list_members(session, actor, entity_id)


@router.post("")
async def add_member(
    entity_id: UUID, body: MemberInput, session: Session, actor: BrowserToken
):
    """Owner only: give the User who signs in with this email full access."""
    return await change_members(session, actor, entity_id, add=(body.email, body.name))


@router.delete("/{member_id}")
async def remove_member(
    entity_id: UUID, member_id: UUID, session: Session, actor: BrowserToken
):
    """Owner only: the member loses access on their next request."""
    return await change_members(session, actor, entity_id, remove=member_id)
