"""Connect Transaction sources (YNAB), select their accounts, and sync them.

Source setup (plans, connect, accounts, disconnect) needs a browser session: the
token never passes through an agent or API key (PRD AG-02, AG-05). Listing
sources and syncing remain available to every caller.
"""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Header, Request
from sqlalchemy.exc import IntegrityError

from accanto.dtos.inbox import (
    ConnectYnabInput,
    PlanListInput,
    RevisionInput,
    SelectAccountsInput,
)
from accanto.integrations.ynab import SourceError, YnabClient, YnabSource
from accanto.routers.authentication import BrowserToken, Session, Token
from accanto.services import inbox
from accanto.services.access import RejectionError
from accanto.services.monthly import authorize, write

router = APIRouter(prefix="/api/entities/{entity_id}/sources", tags=["inbox"])
RequestKey = Annotated[
    str, Header(alias="Idempotency-Key", min_length=1, max_length=120)
]


def client(request: Request, token: str) -> YnabClient:
    config = request.app.state.auth_settings
    return YnabClient(
        token,
        base_url=config.ynab_api_url,
        transport=getattr(request.app.state, "ynab_transport", None),
    )


async def outside(call):
    try:
        return await call
    except SourceError as error:
        raise inbox.source_rejection(error) from None


@router.get("")
async def list_sources(entity_id: UUID, session: Session, token: Token):
    return await inbox.read_sources(session, token, entity_id)


@router.post("/ynab/plans")
async def list_ynab_plans(
    entity_id: UUID,
    body: PlanListInput,
    request: Request,
    session: Session,
    token: BrowserToken,
):
    """Plans this YNAB token can read, so the person can pick one. Stores nothing."""
    async with session.begin():
        await authorize(session, token, entity_id, lock=False)
    return await outside(client(request, body.access_token).plans())


@router.post("/ynab")
async def connect_ynab(
    entity_id: UUID,
    body: ConnectYnabInput,
    request: Request,
    session: Session,
    token: BrowserToken,
    request_key: RequestKey,
):
    key = request.app.state.auth_settings.source_secret_key
    fernet = inbox.cipher(key)
    async with session.begin():
        await authorize(session, token, entity_id, lock=False)
    plans = await outside(client(request, body.access_token).plans())
    plan = next((p for p in plans if p["id"] == body.plan_id), None)
    if plan is None:
        raise RejectionError(
            "source_not_found", "This token cannot read that plan.", 404
        )
    if plan["currency"] != "USD":
        raise RejectionError(
            "unsupported_currency", "Accanto imports only USD YNAB plans.", 422
        )
    # The retry identity covers the choice, never the token itself.
    hook = inbox.Payload(
        "connect_source",
        None,
        {"ciphertext": fernet.encrypt(body.access_token.encode()).decode()},
    )
    hook.payload = {
        "kind": "ynab",
        "plan_id": body.plan_id,
        "name": plan["name"][:200],
        "start_date": body.start_date.isoformat(),
    }
    try:
        return await write(
            session,
            token,
            entity_id,
            "connect_source",
            request_key,
            hook.payload,
            hook=hook,
        )
    except IntegrityError:
        raise RejectionError(
            "source_exists", "This YNAB plan is already connected.", 409
        ) from None


@router.get("/{source_id}/accounts")
async def source_accounts(
    entity_id: UUID,
    source_id: UUID,
    request: Request,
    session: Session,
    token: BrowserToken,
):
    """The source's accounts, with which ones are selected for import."""
    key = request.app.state.auth_settings.source_secret_key
    row, secret = await inbox.source_secret(session, token, entity_id, source_id, key)
    accounts = await outside(client(request, secret).accounts(row["external_ref"]))
    selected = await inbox.selected_accounts(session, row["id"])
    return [
        {
            "id": a["id"],
            "name": a["name"],
            "type": a["type"],
            "on_budget": a["on_budget"],
            "closed": a["closed"],
            "selected": a["id"] in selected,
        }
        for a in accounts
    ]


@router.put("/{source_id}/accounts")
async def select_accounts(
    entity_id: UUID,
    source_id: UUID,
    body: SelectAccountsInput,
    request: Request,
    session: Session,
    token: BrowserToken,
    request_key: RequestKey,
):
    key = request.app.state.auth_settings.source_secret_key
    row, secret = await inbox.source_secret(session, token, entity_id, source_id, key)
    names = {
        a["id"]: a["name"]
        for a in await outside(client(request, secret).accounts(row["external_ref"]))
    }
    unknown = [ref for ref in body.account_ids if ref not in names]
    if unknown:
        raise RejectionError(
            "source_account_not_found", "Choose accounts from this plan.", 422
        )
    payload = {
        "expected_revision": body.expected_revision,
        "accounts": [
            {"id": ref, "name": names[ref][:200]}
            for ref in dict.fromkeys(body.account_ids)
        ],
    }
    return await write(
        session, token, entity_id, "select_source", request_key, payload, source_id
    )


@router.delete("/{source_id}")
async def disconnect(
    entity_id: UUID,
    source_id: UUID,
    body: RevisionInput,
    session: Session,
    token: BrowserToken,
    request_key: RequestKey,
):
    """Forget the token. Recorded entries and the inbox history stay."""
    return await write(
        session,
        token,
        entity_id,
        "disconnect_source",
        request_key,
        body.model_dump(),
        source_id,
    )


@router.post("/{source_id}/sync")
async def sync_source(
    entity_id: UUID,
    source_id: UUID,
    request: Request,
    session: Session,
    token: Token,
):
    """Stage new, changed and deleted transactions. Records nothing."""
    key = request.app.state.auth_settings.source_secret_key
    row, secret = await inbox.source_secret(session, token, entity_id, source_id, key)
    source = YnabSource(client(request, secret), row["external_ref"], row["start_date"])
    return await inbox.sync(session, token, entity_id, source_id, source)
