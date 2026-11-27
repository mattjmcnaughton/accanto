"""Authenticated HTTP contracts for Entry schedules (TDD 18)."""

from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Header

from accanto.dtos.schedules import ScheduleInput, ScheduleResult, SkipInput
from accanto.routers.authentication import Session, Token
from accanto.services.monthly import write
from accanto.services.schedules import occurrence_target, read_schedules

router = APIRouter(prefix="/api/entities/{entity_id}/schedules", tags=["schedules"])
RequestKey = Annotated[
    str, Header(alias="Idempotency-Key", min_length=1, max_length=120)
]


@router.get("", response_model=list[ScheduleResult])
async def list_schedules(entity_id: UUID, session: Session, token: Token):
    return await read_schedules(session, token, entity_id)


@router.post("", response_model=ScheduleResult)
async def create_schedule(
    entity_id: UUID,
    body: ScheduleInput,
    session: Session,
    token: Token,
    request_key: RequestKey,
):
    return await write(
        session,
        token,
        entity_id,
        "create_schedule",
        request_key,
        body.model_dump(mode="json"),
    )


@router.get("/{schedule_id}", response_model=ScheduleResult)
async def get_schedule(
    entity_id: UUID, schedule_id: UUID, session: Session, token: Token
):
    return await read_schedules(session, token, entity_id, schedule_id)


@router.put("/{schedule_id}", response_model=ScheduleResult)
async def edit_schedule(
    entity_id: UUID,
    schedule_id: UUID,
    body: ScheduleInput,
    session: Session,
    token: Token,
    request_key: RequestKey,
):
    """Edit, pause (paused true), resume or end (ends_on) a schedule."""
    return await write(
        session,
        token,
        entity_id,
        "edit_schedule",
        request_key,
        body.model_dump(mode="json"),
        schedule_id,
    )


@router.put("/{schedule_id}/occurrences/{scheduled_on}", response_model=ScheduleResult)
async def set_occurrence(
    entity_id: UUID,
    schedule_id: UUID,
    scheduled_on: date,
    body: SkipInput,
    session: Session,
    token: Token,
    request_key: RequestKey,
):
    """Skip one upcoming (or failed) date once, or put a skipped date back."""
    return await write(
        session,
        token,
        entity_id,
        "set_schedule_occurrence",
        request_key,
        body.model_dump(mode="json"),
        occurrence_target(schedule_id, scheduled_on),
    )
