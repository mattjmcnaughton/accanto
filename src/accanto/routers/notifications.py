"""Notifications over Web Push (TDD 20): push config, Devices and preferences.

Devices and the test send need a signed-in browser: a Device is that browser's
push subscription. Preferences are also readable and settable with an API key.
"""

from uuid import UUID

from fastapi import APIRouter, Response

from accanto.dtos.notifications import DeviceInput, Preferences
from accanto.routers.authentication import BrowserToken, Session, Token
from accanto.services import notifications as service

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


@router.get("/config")
async def get_config(token: Token):
    return service.push_config()


@router.get("/preferences", response_model=Preferences)
async def get_preferences(session: Session, token: Token):
    return await service.read_preferences(session, token)


@router.put("/preferences", response_model=Preferences)
async def put_preferences(body: Preferences, session: Session, token: Token):
    return await service.write_preferences(session, token, body.model_dump())


@router.post("/devices")
async def post_device(body: DeviceInput, session: Session, actor: BrowserToken):
    return await service.register_device(
        session, actor, body.endpoint, body.keys.p256dh, body.keys.auth
    )


@router.delete("/devices/{device_id}", status_code=204)
async def delete_device(device_id: UUID, session: Session, actor: BrowserToken):
    await service.remove_device(session, actor, device_id)
    return Response(status_code=204)


@router.post("/devices/{device_id}/test")
async def post_test(device_id: UUID, session: Session, actor: BrowserToken):
    return await service.send_test(session, actor, device_id)
