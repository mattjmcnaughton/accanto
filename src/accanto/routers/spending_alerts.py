"""Authenticated Spending alert routes (TDD 23)."""

from uuid import UUID

from fastapi import APIRouter

from accanto.dtos.monthly import RevisionInput
from accanto.dtos.spending_alerts import (
    SpendingAlert,
    SpendingAlertEdit,
    SpendingAlertInput,
    SpendingAlerts,
)
from accanto.routers.authentication import Session, Token
from accanto.routers.monthly import RequestKey, command
from accanto.services import spending_alerts as service

router = APIRouter(
    prefix="/api/entities/{entity_id}/spending-alerts", tags=["spending alerts"]
)


@router.get("", response_model=SpendingAlerts)
async def list_alerts(entity_id: UUID, session: Session, token: Token):
    return await service.read_alerts(session, token, entity_id)


@router.post("")
async def create_alert(
    entity_id: UUID,
    body: SpendingAlertInput,
    session: Session,
    token: Token,
    request_key: RequestKey,
):
    return await command(
        session, token, entity_id, "create_spending_alert", request_key, body
    )


@router.put("/{alert_id}")
async def edit_alert(
    entity_id: UUID,
    alert_id: UUID,
    body: SpendingAlertEdit,
    session: Session,
    token: Token,
    request_key: RequestKey,
):
    return await command(
        session, token, entity_id, "edit_spending_alert", request_key, body, alert_id
    )


@router.delete("/{alert_id}")
async def delete_alert(
    entity_id: UUID,
    alert_id: UUID,
    body: RevisionInput,
    session: Session,
    token: Token,
    request_key: RequestKey,
):
    return await command(
        session, token, entity_id, "delete_spending_alert", request_key, body, alert_id
    )


@router.post("/{alert_id}/dismissal", response_model=SpendingAlert)
async def dismiss_alert(
    entity_id: UUID, alert_id: UUID, session: Session, token: Token
):
    return await service.dismiss(session, token, entity_id, alert_id)
