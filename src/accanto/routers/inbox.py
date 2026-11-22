"""Transactions inbox: list staged transactions, propose, record, skip, undo."""

import hashlib
from datetime import date
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Header, HTTPException, Query

from accanto.dtos.inbox import (
    BulkProposalInput,
    BulkRecordInput,
    ProposalInput,
    RecordInput,
    ResolveInput,
    RevisionInput,
)
from accanto.routers.authentication import Session, Token
from accanto.services import inbox
from accanto.services.access import RejectionError
from accanto.services.monthly import write

router = APIRouter(prefix="/api/entities/{entity_id}/inbox", tags=["inbox"])
RequestKey = Annotated[
    str, Header(alias="Idempotency-Key", min_length=1, max_length=120)
]
Status = Literal["waiting", "skipped", "recorded", "conflict", "removed"]


def item_key(request_key, item_id) -> str:
    """One retry identity per item of a bulk request, within the column's length."""
    return hashlib.sha256(f"{request_key}:{item_id}".encode()).hexdigest()


def outcome(item_id, error: RejectionError):
    return {
        "item_id": str(item_id),
        "ok": False,
        "error": {"code": error.code, "message": error.message},
    }


@router.get("")
async def list_inbox(
    entity_id: UUID,
    session: Session,
    token: Token,
    status: Annotated[list[Status] | None, Query()] = None,
    month: date | None = None,
    source: UUID | None = None,
):
    if month is not None and month.day != 1:
        raise HTTPException(422, "Use the first day of the calendar month.")
    return await inbox.read_inbox(
        session, token, entity_id, statuses=status, month=month, source=source
    )


@router.get("/{item_id}")
async def get_item(entity_id: UUID, item_id: UUID, session: Session, token: Token):
    return await inbox.read_item(session, token, entity_id, item_id)


@router.put("/proposals")
async def set_proposals(
    entity_id: UUID,
    body: BulkProposalInput,
    session: Session,
    token: Token,
    request_key: RequestKey,
):
    """Each proposal is its own write; one rejection does not block the rest."""
    results = []
    for proposal in body.proposals:
        fields = proposal.model_dump(exclude={"item_id"})
        try:
            item = await inbox.propose(
                session,
                token,
                entity_id,
                proposal.item_id,
                item_key(request_key, proposal.item_id),
                fields,
            )
            results.append({"item_id": str(proposal.item_id), "ok": True, "item": item})
        except RejectionError as error:
            if error.status == 401:
                raise
            results.append(outcome(proposal.item_id, error))
    return {"results": results}


@router.put("/{item_id}/proposal")
async def set_proposal(
    entity_id: UUID,
    item_id: UUID,
    body: ProposalInput,
    session: Session,
    token: Token,
    request_key: RequestKey,
):
    """Store a proposal with its dry-run rejection, if any. Records nothing."""
    return await inbox.propose(
        session, token, entity_id, item_id, request_key, body.model_dump()
    )


@router.delete("/{item_id}/proposal")
async def clear_proposal(
    entity_id: UUID,
    item_id: UUID,
    body: RevisionInput,
    session: Session,
    token: Token,
    request_key: RequestKey,
):
    return await write(
        session,
        token,
        entity_id,
        "inbox_clear_proposal",
        request_key,
        body.model_dump(),
        item_id,
    )


def record_key(revision: int) -> str:
    # The staged transaction's id (in the operation scope) and revision identify
    # a record attempt, so pressing Enter twice records one entry.
    return f"revision:{revision}"


@router.post("/record")
async def record_many(
    entity_id: UUID, body: BulkRecordInput, session: Session, token: Token
):
    """Each item records in its own transaction and reports its own outcome."""
    results = []
    for item in body.items:
        fields = item.model_dump(exclude={"item_id"})
        try:
            result = await inbox.record(
                session,
                token,
                entity_id,
                item.item_id,
                record_key(item.expected_revision),
                fields,
            )
            results.append({"item_id": str(item.item_id), "ok": True, **result})
        except RejectionError as error:
            if error.status == 401:
                raise
            results.append(outcome(item.item_id, error))
    return {"results": results}


@router.post("/{item_id}/record")
async def record_one(
    entity_id: UUID,
    item_id: UUID,
    body: RecordInput,
    session: Session,
    token: Token,
):
    """Record from the proposal, or from a completion that replaces it."""
    return await inbox.record(
        session,
        token,
        entity_id,
        item_id,
        record_key(body.expected_revision),
        body.model_dump(),
    )


@router.post("/{item_id}/skip")
async def skip(
    entity_id: UUID,
    item_id: UUID,
    body: RevisionInput,
    session: Session,
    token: Token,
    request_key: RequestKey,
):
    return await write(
        session, token, entity_id, "inbox_skip", request_key, body.model_dump(), item_id
    )


@router.post("/{item_id}/unskip")
async def unskip(
    entity_id: UUID,
    item_id: UUID,
    body: RevisionInput,
    session: Session,
    token: Token,
    request_key: RequestKey,
):
    return await write(
        session,
        token,
        entity_id,
        "inbox_unskip",
        request_key,
        body.model_dump(),
        item_id,
    )


@router.post("/{item_id}/undo")
async def undo(
    entity_id: UUID,
    item_id: UUID,
    body: RevisionInput,
    session: Session,
    token: Token,
    request_key: RequestKey,
):
    """Soft-delete the recorded entry through its delete command; item waits again."""
    return await inbox.remove_entry(
        session, token, entity_id, item_id, request_key, body.model_dump(), "undo"
    )


@router.post("/{item_id}/resolve")
async def resolve(
    entity_id: UUID,
    item_id: UUID,
    body: ResolveInput,
    session: Session,
    token: Token,
    request_key: RequestKey,
):
    """F7 (open): keep the entry, or delete it through its normal delete command."""
    if body.resolution == "delete":
        return await inbox.remove_entry(
            session,
            token,
            entity_id,
            item_id,
            request_key,
            body.model_dump(),
            "delete",
        )
    return await write(
        session,
        token,
        entity_id,
        "inbox_keep",
        request_key,
        body.model_dump(),
        item_id,
    )
