"""Create (shown once) and individually revoke API keys."""

from uuid import UUID

from fastapi import APIRouter, HTTPException

from accanto.dtos.monthly import Input, Name
from accanto.routers.monthly import Session, Token
from accanto.services.api_keys import list_keys, manage_key
from accanto.services.monthly import RejectionError

router = APIRouter(prefix="/api/keys", tags=["API keys"])


class KeyInput(Input):
    name: Name


@router.get("")
async def get_keys(session: Session, token: Token):
    return await list_keys(session, token)


@router.post("")
async def create_key(body: KeyInput, session: Session, token: Token):
    try:
        return await manage_key(session, token, name=body.name)
    except RejectionError as error:
        raise HTTPException(error.status, error.message) from None


@router.delete("/{key_id}")
async def revoke_key(key_id: UUID, session: Session, token: Token):
    try:
        return await manage_key(session, token, revoke=key_id)
    except RejectionError as error:
        raise HTTPException(error.status, error.message) from None
