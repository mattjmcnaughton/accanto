"""Projections (TDD 14): net worth and FIRE from explicit assumptions."""

from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Query

from accanto.dtos.entities import FireAssumptionsInput
from accanto.routers.authentication import Session, Token
from accanto.routers.monthly import RequestKey, command
from accanto.services.projections import read_fire_assumptions, read_projection

router = APIRouter(prefix="/api/entities/{entity_id}", tags=["Projections"])


@router.get("/projections")
async def get_projection(
    entity_id: UUID,
    session: Session,
    token: Token,
    years: Annotated[int, Query(ge=1, le=100)] = 20,
    dollars: Literal["today", "future"] = "today",
):
    """A Projection from today, not recorded activity or an observed balance.

    dollars: today's (divided by inflation to each date) or future (nominal).
    """
    return await read_projection(session, token, entity_id, years, dollars)


@router.get("/fire-assumptions")
async def get_fire_assumptions(entity_id: UUID, session: Session, token: Token):
    return await read_fire_assumptions(session, token, entity_id)


@router.put("/fire-assumptions")
async def put_fire_assumptions(
    entity_id: UUID,
    body: FireAssumptionsInput,
    session: Session,
    token: Token,
    request_key: RequestKey,
):
    return await command(
        session, token, entity_id, "edit_fire_assumptions", request_key, body
    )
