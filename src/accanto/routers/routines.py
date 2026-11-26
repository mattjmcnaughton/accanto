"""Authenticated HTTP contracts for Routines (TDD 13)."""

from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Header

from accanto.dtos.routines import (
    OccurrenceInput,
    OccurrenceResult,
    RoutineInput,
    RoutineResult,
    StepTick,
)
from accanto.routers.authentication import Session, Token
from accanto.services.monthly import write
from accanto.services.routines import (
    occurrence_target,
    read_occurrence,
    read_routines,
)

router = APIRouter(prefix="/api/entities/{entity_id}/routines", tags=["routines"])
RequestKey = Annotated[
    str, Header(alias="Idempotency-Key", min_length=1, max_length=120)
]


@router.get("", response_model=list[RoutineResult])
async def list_routines(entity_id: UUID, session: Session, token: Token):
    return await read_routines(session, token, entity_id)


@router.post("", response_model=RoutineResult)
async def create_routine(
    entity_id: UUID,
    body: RoutineInput,
    session: Session,
    token: Token,
    request_key: RequestKey,
):
    return await write(
        session,
        token,
        entity_id,
        "create_routine",
        request_key,
        body.model_dump(mode="json"),
    )


@router.get("/{routine_id}", response_model=RoutineResult)
async def get_routine(
    entity_id: UUID, routine_id: UUID, session: Session, token: Token
):
    return await read_routines(session, token, entity_id, routine_id)


@router.put("/{routine_id}", response_model=RoutineResult)
async def edit_routine(
    entity_id: UUID,
    routine_id: UUID,
    body: RoutineInput,
    session: Session,
    token: Token,
    request_key: RequestKey,
):
    return await write(
        session,
        token,
        entity_id,
        "edit_routine",
        request_key,
        body.model_dump(mode="json"),
        routine_id,
    )


@router.get("/{routine_id}/occurrences/{scheduled_on}", response_model=OccurrenceResult)
async def get_occurrence(
    entity_id: UUID,
    routine_id: UUID,
    scheduled_on: date,
    session: Session,
    token: Token,
):
    return await read_occurrence(session, token, entity_id, routine_id, scheduled_on)


@router.put("/{routine_id}/occurrences/{scheduled_on}", response_model=OccurrenceResult)
async def set_occurrence(
    entity_id: UUID,
    routine_id: UUID,
    scheduled_on: date,
    body: OccurrenceInput,
    session: Session,
    token: Token,
    request_key: RequestKey,
):
    return await write(
        session,
        token,
        entity_id,
        "set_routine_occurrence",
        request_key,
        body.model_dump(mode="json"),
        occurrence_target(routine_id, scheduled_on),
    )


@router.put(
    "/{routine_id}/occurrences/{scheduled_on}/steps/{step_id}",
    response_model=OccurrenceResult,
)
async def set_step(
    entity_id: UUID,
    routine_id: UUID,
    scheduled_on: date,
    step_id: UUID,
    body: StepTick,
    session: Session,
    token: Token,
    request_key: RequestKey,
):
    return await write(
        session,
        token,
        entity_id,
        "set_routine_step",
        request_key,
        body.model_dump(mode="json"),
        occurrence_target(routine_id, scheduled_on, step_id),
    )
