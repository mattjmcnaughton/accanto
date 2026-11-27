"""Create (shown once), list and individually revoke API keys.

Browser session only: no API key, and so no script or agent, reads or changes
any credential, its own included (Constitution §2).
"""

from uuid import UUID

from fastapi import APIRouter

from accanto.dtos.monthly import Input, Name
from accanto.routers.authentication import BrowserToken, Session
from accanto.services.api_keys import list_keys, manage_key

router = APIRouter(prefix="/api/keys", tags=["API keys"])


class KeyInput(Input):
    name: Name


@router.get("")
async def get_keys(session: Session, actor: BrowserToken):
    return await list_keys(session, actor)


@router.post("")
async def create_key(body: KeyInput, session: Session, actor: BrowserToken):
    return await manage_key(session, actor, name=body.name)


@router.delete("/{key_id}")
async def revoke_key(key_id: UUID, session: Session, actor: BrowserToken):
    return await manage_key(session, actor, revoke=key_id)
