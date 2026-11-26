"""Transactions inbox workflows: sync, proposals, record, skip, undo and resolve.

Sync and proposals never write actual entries (decision I1). Record, undo and
conflict deletion run the existing entry, contribution and refund commands
through monthly.write(), with their normal checks, audit, retry outcomes and
stale-edit protection; a hook resolves the staged transaction under the same
Entity lock and marks it in the same transaction.
"""

import time
from datetime import UTC, date, datetime
from typing import Protocol
from uuid import UUID, uuid4

import logfire
import structlog
from cryptography.fernet import Fernet, InvalidToken
from pydantic import ValidationError
from sqlalchemy import BigInteger, String, func, insert, literal, select, tuple_, update
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.exc import DBAPIError

from accanto.domains.inbox import (
    Completion,
    InboxRejectionError,
    StagedFacts,
    StagedTransactionInput,
    command_for,
    synced_status,
    transition,
    validate_shape,
)
from accanto.integrations.ynab import SourceError
from accanto.models import destinations as d
from accanto.models import inbox as st
from accanto.models import monthly as m
from accanto.models import savings as s
from accanto.services.access import RejectionError, lock_user
from accanto.services.monthly import (
    DryRun,
    authorize,
    check_revision,
    json_values,
    scoped,
    write,
)

log = structlog.get_logger(__name__)
INTERFACE = "inbox"
# Source facts whose change after staging is worth a person's attention.
ECONOMIC = ("amount", "financial_date", "account_ref", "payee", "kind")


class TransactionSource(Protocol):
    async def changes_since(
        self, cursor: str | None
    ) -> tuple[list[StagedTransactionInput], str]: ...


def cipher(key) -> Fernet:
    value = key.get_secret_value() if key else ""
    try:
        return Fernet(value.encode())
    except ValueError:
        raise RejectionError(
            "source_secret_unconfigured",
            "An operator must set SOURCE_SECRET_KEY before connecting a source.",
            503,
        ) from None


def source_rejection(error: SourceError) -> RejectionError:
    status = 429 if error.code == "source_rate_limited" else 502
    if error.code == "partial_cents":
        status = 422
    return RejectionError(error.code, error.message, status)


def domain_rejection(error: InboxRejectionError) -> RejectionError:
    status = 409 if error.code == "inbox_status" else 422
    return RejectionError(error.code, str(error), status)


def dto_payload(model, fields: dict, mode="python") -> dict:
    """Reuse the HTTP command DTO validators so recording cannot bypass them.

    mode matches how that command's own router dumps its body.
    """
    try:
        return model(**fields).model_dump(mode=mode)
    except ValidationError as error:
        message = str(error.errors()[0]["msg"]).removeprefix("Value error, ")
        raise RejectionError("invalid_record", message, 422) from None


# Views ----------------------------------------------------------------------


def completion_of(proposal: dict | None) -> Completion:
    p = proposal or {}
    return Completion(
        category=p.get("category"),
        assignment=p.get("assignment"),
        funding=p.get("funding"),
        refund_of=p.get("refund_of"),
        skip=bool(p.get("skip")),
        tag_ids=tuple(p.get("tag_ids") or ()),
    )


def facts_of(row) -> StagedFacts:
    latest = row["latest"]
    from decimal import Decimal

    return StagedFacts(
        financial_date=row["financial_date"],
        amount=Decimal(latest["amount"]),
        payee=latest["payee"],
        memo=latest.get("memo"),
    )


async def item_view(session, row):
    source_uuid = await session.scalar(
        select(st.sources.c.uuid).where(st.sources.c.id == row["source_id"])
    )
    entry_uuid = (
        await session.scalar(
            select(m.entries.c.uuid).where(m.entries.c.id == row["actual_entry_id"])
        )
        if row["actual_entry_id"]
        else None
    )
    proposer = (
        await session.scalar(
            select(m.users.c.uuid).where(m.users.c.id == row["proposed_by_user_id"])
        )
        if row["proposed_by_user_id"]
        else None
    )
    split = None
    if row["parent_ref"]:
        splits = await split_totals(
            session,
            row["entity_id"],
            st.staged.c.source_id == row["source_id"],
            st.staged.c.parent_ref == row["parent_ref"],
        )
        split = splits.get((row["source_id"], row["parent_ref"]))
    return render_item(row, source_uuid, entry_uuid, proposer, split)


def render_item(row, source_uuid, entry_uuid, proposer, split):
    latest = row["latest"]
    return json_values(
        {
            "id": row["uuid"],
            "source_id": source_uuid,
            "source_ref": row["source_ref"],
            "parent_ref": row["parent_ref"],
            "split": split,
            "account_ref": latest["account_ref"],
            "account_name": latest["account_name"],
            "financial_date": row["financial_date"],
            "amount": latest["amount"],
            "payee": latest["payee"],
            "source_category": latest["source_category"],
            "memo": latest["memo"],
            "kind": latest["kind"],
            "cleared": latest["cleared"],
            "approved": latest["approved"],
            "deleted_in_source": latest["deleted"],
            "status": row["status"],
            "actual_entry_id": entry_uuid,
            "rejection": row["rejection"],
            "changed_after_staging": row["changed_after_staging"],
            "proposal": row["proposal"],
            "proposal_rejection": row["proposal_rejection"],
            "proposed_by": {
                "user_id": proposer,
                "interface": row["proposed_interface"],
                "at": row["proposed_at"],
            }
            if row["proposal"]
            else None,
            "staged_at": row["staged_at"],
            "revision": row["revision"],
        }
    )


async def split_totals(session, entity_id, *groups):
    """Each split's line count and total across every line still in its source."""
    from decimal import Decimal

    query = select(
        st.staged.c.source_id, st.staged.c.parent_ref, st.staged.c.latest
    ).where(
        st.staged.c.entity_id == entity_id, st.staged.c.status != "removed", *groups
    )
    result: dict = {}
    for source, parent, latest in (await session.execute(query)).all():
        entry = result.setdefault((source, parent), {"lines": 0, "total": Decimal(0)})
        entry["lines"] += 1
        entry["total"] += Decimal(latest["amount"])
    return {
        key: {"lines": v["lines"], "total": str(v["total"])}
        for key, v in result.items()
    }


async def source_view(session, row):
    accounts = (
        (
            await session.execute(
                select(st.selections)
                .where(st.selections.c.source_id == row["id"])
                .order_by(st.selections.c.name_snapshot)
            )
        )
        .mappings()
        .all()
    )
    waiting = await session.scalar(
        select(func.count()).where(
            st.staged.c.source_id == row["id"], st.staged.c.status == "waiting"
        )
    )
    return json_values(
        {
            "id": row["uuid"],
            "kind": row["kind"],
            "name": row["name"],
            "external_ref": row["external_ref"],
            "start_date": row["start_date"],
            "connected": row["disconnected_at"] is None,
            "synced": row["cursor"] is not None,
            "last_synced_at": row["last_synced_at"],
            "accounts": [
                {"id": a["account_ref"], "name": a["name_snapshot"]} for a in accounts
            ],
            "waiting": waiting,
            "revision": row["revision"],
        }
    )


async def staged_item(session, entity_id, item_uuid):
    return await scoped(session, st.staged, entity_id, item_uuid)


# Reads ----------------------------------------------------------------------


async def read_inbox(
    session, token, entity_uuid, *, statuses, month, source, proposed=None, limit=None
):
    async with session.begin():
        _, entity = await authorize(session, token, entity_uuid, lock=False)
        query = select(st.staged).where(st.staged.c.entity_id == entity["id"])
        if statuses:
            query = query.where(st.staged.c.status.in_(statuses))
        else:
            query = query.where(st.staged.c.status != "removed")
        if month is not None:
            query = query.where(
                st.staged.c.financial_date >= month,
                st.staged.c.financial_date < next_month(month),
            )
        if source is not None:
            src = await scoped(session, st.sources, entity["id"], source)
            query = query.where(st.staged.c.source_id == src["id"])
        if proposed is not None:
            # A cleared proposal is stored as JSON null, not SQL NULL.
            has = func.coalesce(func.jsonb_typeof(st.staged.c.proposal), "null")
            query = query.where((has == "object") == proposed)
        views = (
            query.add_columns(
                st.sources.c.uuid.label("source_uuid"),
                m.entries.c.uuid.label("entry_uuid"),
                m.users.c.uuid.label("proposer_uuid"),
            )
            .join_from(st.staged, st.sources)
            .outerjoin_from(st.staged, m.entries)
            .outerjoin_from(
                st.staged, m.users, m.users.c.id == st.staged.c.proposed_by_user_id
            )
        )
        rows = (
            (
                await session.execute(
                    views.order_by(
                        st.staged.c.financial_date,
                        st.staged.c.parent_ref,
                        st.staged.c.source_ref,
                    ).limit(limit)
                )
            )
            .mappings()
            .all()
        )
        groups = {
            (row["source_id"], row["parent_ref"]) for row in rows if row["parent_ref"]
        }
        splits = {}
        if groups:
            # Use exactly the groups returned by the list and pass them as two
            # arrays so the bind count does not grow with the Inbox.
            source_ids, parents = zip(*groups, strict=True)
            pairs = select(
                func.unnest(literal(list(source_ids), ARRAY(BigInteger))),
                func.unnest(literal(list(parents), ARRAY(String))),
            )
            splits = await split_totals(
                session,
                entity["id"],
                tuple_(st.staged.c.source_id, st.staged.c.parent_ref).in_(pairs),
            )
        with logfire.span("inbox.item_views", item_count=len(rows)):
            return [
                render_item(
                    row,
                    row["source_uuid"],
                    row["entry_uuid"],
                    row["proposer_uuid"],
                    splits.get((row["source_id"], row["parent_ref"])),
                )
                for row in rows
            ]


async def read_item(session, token, entity_uuid, item_uuid):
    async with session.begin():
        _, entity = await authorize(session, token, entity_uuid, lock=False)
        return await item_view(
            session, await staged_item(session, entity["id"], item_uuid)
        )


async def read_sources(session, token, entity_uuid):
    async with session.begin():
        _, entity = await authorize(session, token, entity_uuid, lock=False)
        rows = (
            (
                await session.execute(
                    select(st.sources)
                    .where(st.sources.c.entity_id == entity["id"])
                    .order_by(st.sources.c.id)
                )
            )
            .mappings()
            .all()
        )
        return [await source_view(session, row) for row in rows]


async def provider_row(session, entity_id):
    return (
        (
            await session.execute(
                select(st.providers).where(st.providers.c.entity_id == entity_id)
            )
        )
        .mappings()
        .first()
    )


def provider_view(row) -> dict:
    """Never includes the token: only whether one is saved."""
    if row is None:
        return {"kind": None, "configured": False, "revision": 0}
    return {
        "kind": row["kind"],
        "configured": row["secret_ciphertext"] is not None,
        "revision": row["revision"],
    }


async def read_provider(session, token, entity_uuid):
    async with session.begin():
        _, entity = await authorize(session, token, entity_uuid, lock=False)
        return provider_view(await provider_row(session, entity["id"]))


async def write_provider(session, entity, payload, audit):
    """Save or remove the Entity's provider token; dispatched by monthly.write()."""
    row = await provider_row(session, entity["id"])
    before = provider_view(row)
    check_revision(before, payload["expected_revision"])
    values = {
        "kind": payload["kind"],
        "secret_ciphertext": payload.get("ciphertext"),
        "revision": before["revision"] + 1,
    }
    if row is None:
        statement = insert(st.providers).values(entity_id=entity["id"], **values)
    else:
        statement = update(st.providers).where(st.providers.c.id == row["id"])
        statement = statement.values(**values)
    record = (await session.execute(statement.returning(st.providers))).mappings().one()
    after = provider_view(record)
    await audit(st.providers, record["uuid"], before, after)
    return after


async def source_secret(session, token, entity_uuid, source_uuid, key, kind="ynab"):
    """The Settings token for an outside call; never returned to callers.

    With a source_uuid, also returns that connected source's row.
    """
    async with session.begin():
        _, entity = await authorize(session, token, entity_uuid, lock=False)
        row = None
        if source_uuid is not None:
            row = await scoped(session, st.sources, entity["id"], source_uuid)
            kind = row["kind"]
        provider = await provider_row(session, entity["id"])
    if row is not None and row["disconnected_at"] is not None:
        raise RejectionError("source_disconnected", "Reconnect this source first.", 409)
    if provider is None or provider["kind"] != kind:
        raise RejectionError(
            "provider_not_configured",
            "Add a YNAB access token in Settings first.",
            409,
        )
    try:
        secret = cipher(key).decrypt(provider["secret_ciphertext"].encode()).decode()
    except InvalidToken:
        raise RejectionError(
            "source_secret_unreadable",
            "The saved token cannot be decrypted with the current key. "
            "Save it again in Settings.",
            409,
        ) from None
    return row, secret


async def selected_accounts(session, source_id) -> set[str]:
    async with session.begin():
        return set(
            (
                await session.scalars(
                    select(st.selections.c.account_ref).where(
                        st.selections.c.source_id == source_id
                    )
                )
            ).all()
        )


def next_month(month: date) -> date:
    return date(month.year + (month.month == 12), month.month % 12 + 1, 1)


async def waiting_count(session, entity_id, month: date) -> int:
    """For the Review: staged transactions are never totals, only a visible count."""
    return await session.scalar(
        select(func.count()).where(
            st.staged.c.entity_id == entity_id,
            st.staged.c.status == "waiting",
            st.staged.c.financial_date >= month,
            st.staged.c.financial_date < next_month(month),
        )
    )


# Inbox-native commands, dispatched by monthly.write() -------------------------


async def write_inbox(session, entity, actor, operation, payload, target, audit):
    if operation == "inbox_detach":
        return None
    if operation.endswith("_source"):
        return await write_source(session, entity, operation, payload, target, audit)
    row = await staged_item(session, entity["id"], target)
    before = await item_view(session, row)
    action = operation.removeprefix("inbox_")
    try:
        status = transition(
            row["status"], "propose" if action == "clear_proposal" else action
        )
    except InboxRejectionError as error:
        raise domain_rejection(error) from None
    check_revision(row, payload["expected_revision"])
    values: dict = {"status": status, "revision": row["revision"] + 1}
    if action == "propose":
        await check_references(session, entity["id"], payload)
        values.update(
            proposal={
                key: payload[key]
                for key in ("category", "assignment", "funding", "refund_of", "skip")
            }
            | {"tag_ids": payload.get("tag_ids") or []}
            | {"rationale": payload["rationale"]},
            proposal_rejection=payload["proposal_rejection"],
            proposed_by_user_id=actor.user_id,
            proposed_interface=actor.interface,
            proposed_at=datetime.now(UTC),
            rejection=None,
        )
    elif action == "clear_proposal":
        values.update(
            proposal=None,
            proposal_rejection=None,
            proposed_by_user_id=None,
            proposed_interface=None,
            proposed_at=None,
        )
    elif action == "skip":
        values["rejection"] = None
    record = (
        (
            await session.execute(
                update(st.staged)
                .where(st.staged.c.id == row["id"])
                .values(**values)
                .returning(st.staged)
            )
        )
        .mappings()
        .one()
    )
    after = await item_view(session, record)
    await audit(st.staged, record["uuid"], before, after, action=operation)
    return after


async def check_references(session, entity_id, proposal):
    """Every proposed reference exists in this Entity; reasons stay actionable."""
    tables = {
        "income": m.sources,
        "fixed_cost": m.fixed_costs,
        "spending": m.spending_subcategories,
        "saving": s.goals,
        "investing": d.investments,
        "giving": d.recipients,
    }

    async def exists(table, value, label):
        try:
            await scoped(session, table, entity_id, UUID(str(value)))
        except (RejectionError, ValueError):
            raise RejectionError(
                "invalid_proposal", f"The proposed {label} is unavailable.", 422
            ) from None

    category, assignment = proposal.get("category"), proposal.get("assignment")
    if category in tables and assignment not in (None, "unassigned"):
        await exists(tables[category], assignment, "assignment")
    if proposal.get("funding") not in (None, "income"):
        await exists(s.goals, proposal["funding"], "funding goal")
    if proposal.get("refund_of"):
        await exists(m.entries, proposal["refund_of"], "purchase")


async def write_source(session, entity, operation, payload, target, audit):
    if operation == "connect_source":
        # One YNAB plan feeds one of the owner's Entities at a time, so the same
        # transactions are never staged into two Entities. The User lock makes
        # concurrent connects from different Entities check and insert in turn.
        await lock_user(session, entity["owner_id"])
        elsewhere = await session.scalar(
            select(m.entities.c.name)
            .join(st.sources, st.sources.c.entity_id == m.entities.c.id)
            .where(
                m.entities.c.owner_id == entity["owner_id"],
                m.entities.c.id != entity["id"],
                st.sources.c.kind == payload["kind"],
                st.sources.c.external_ref == payload["plan_id"],
                st.sources.c.disconnected_at.is_(None),
            )
            .limit(1)
        )
        if elsewhere is not None:
            raise RejectionError(
                "source_connected_elsewhere",
                f"This plan is already connected to your Entity {elsewhere}. "
                "Disconnect it there before connecting it here.",
                409,
            )
        record = (
            (
                await session.execute(
                    insert(st.sources)
                    .values(
                        entity_id=entity["id"],
                        kind=payload["kind"],
                        external_ref=payload["plan_id"],
                        name=payload["name"],
                        start_date=date.fromisoformat(payload["start_date"]),
                    )
                    .returning(st.sources)
                )
            )
            .mappings()
            .one()
        )
        await audit(st.sources, record["uuid"], None, dict(record))
        return await source_view(session, record)
    row = await scoped(session, st.sources, entity["id"], target)
    check_revision(row, payload["expected_revision"])
    if row["disconnected_at"] is not None:
        raise RejectionError("source_disconnected", "This source is disconnected.", 409)
    values: dict = {"revision": row["revision"] + 1}
    if operation == "select_source":
        current = set(
            (
                await session.scalars(
                    select(st.selections.c.account_ref).where(
                        st.selections.c.source_id == row["id"]
                    )
                )
            ).all()
        )
        await session.execute(
            st.selections.delete().where(st.selections.c.source_id == row["id"])
        )
        for account in payload["accounts"]:
            await session.execute(
                insert(st.selections).values(
                    source_id=row["id"],
                    entity_id=entity["id"],
                    account_ref=account["id"],
                    name_snapshot=account["name"],
                )
            )
        if {a["id"] for a in payload["accounts"]} - current:
            # A delta cursor already passed the new account's history; read it again.
            values["cursor"] = None
    else:
        values.update(disconnected_at=datetime.now(UTC))
    record = (
        (
            await session.execute(
                update(st.sources)
                .where(st.sources.c.id == row["id"])
                .values(**values)
                .returning(st.sources)
            )
        )
        .mappings()
        .one()
    )
    await audit(st.sources, record["uuid"], dict(row), dict(record))
    return await source_view(session, record)


# Hooks around the existing entry commands -------------------------------------


class Hook:
    # Entry commands from the inbox audit as interface "inbox" (TDD).
    interface: str | None = INTERFACE

    async def before(self, session, entity, actor):  # pragma: no cover - abstract
        raise NotImplementedError

    async def after(self, session, entity, actor, response, audit):
        return response


class Payload(Hook):
    """Adds server-derived facts to an inbox-native command after the retry lookup."""

    interface = None  # audited under the caller's own interface

    def __init__(self, operation, target, extra):
        self.operation, self.target, self.extra = operation, target, extra
        self.payload: dict = {}

    async def before(self, session, entity, actor):
        return self.operation, {**self.payload, **self.extra}, self.target


class RecordHook(Hook):
    def __init__(self, item_uuid, expected_revision, completion, *, dry_run=False):
        self.item_uuid, self.expected = item_uuid, expected_revision
        self.completion, self.dry_run = completion, dry_run
        self.checked = False

    async def before(self, session, entity, actor):
        from accanto.dtos.destinations import ContributionInput
        from accanto.dtos.monthly import ActivityInput, RefundInput

        self.row = await staged_item(session, entity["id"], self.item_uuid)
        if not self.dry_run:
            try:
                transition(self.row["status"], "record")
            except InboxRejectionError as error:
                raise domain_rejection(error) from None
            check_revision(self.row, self.expected)
        self.checked = True
        completion = self.completion or completion_of(self.row["proposal"])
        try:
            command = command_for(facts_of(self.row), completion)
        except InboxRejectionError as error:
            raise domain_rejection(error) from None
        fields = command.fields
        if command.kind == "refund":
            purchase = fields.pop("purchase_id")
            try:
                purchase_uuid = UUID(purchase)
            except ValueError:
                raise RejectionError(
                    "invalid_record", "Choose an existing purchase.", 422
                ) from None
            return "create_refund", dto_payload(RefundInput, fields), purchase_uuid
        if command.kind in {"investment", "giving"}:
            return (
                f"create_{command.kind}_entry",
                dto_payload(ContributionInput, fields, "json"),
                None,
            )
        return "create_entry", dto_payload(ActivityInput, fields), None

    async def after(self, session, entity, actor, response, audit):
        entry_id = await session.scalar(
            select(m.entries.c.id).where(
                m.entries.c.uuid == UUID(str(response["uuid"]))
            )
        )
        before = await item_view(session, self.row)
        record = (
            (
                await session.execute(
                    update(st.staged)
                    .where(st.staged.c.id == self.row["id"])
                    .values(
                        status="recorded",
                        actual_entry_id=entry_id,
                        rejection=None,
                        revision=self.row["revision"] + 1,
                    )
                    .returning(st.staged)
                )
            )
            .mappings()
            .one()
        )
        after = await item_view(session, record)
        source = {"source_ref": record["source_ref"], "source_id": after["source_id"]}
        await audit(st.staged, record["uuid"], before, after, action="inbox_record")
        return {"item": after, "entry": {**response, "inbox_source": source}}


class RemoveEntryHook(Hook):
    """Undo (recorded → waiting) or delete a conflict's entry (conflict → removed)."""

    def __init__(self, item_uuid, expected_revision, action):
        self.item_uuid, self.expected, self.action = (
            item_uuid,
            expected_revision,
            action,
        )

    async def before(self, session, entity, actor):
        self.row = await staged_item(session, entity["id"], self.item_uuid)
        try:
            self.status = transition(self.row["status"], self.action)
        except InboxRejectionError as error:
            raise domain_rejection(error) from None
        check_revision(self.row, self.expected)
        from accanto.models import refunds as r

        entry = (
            (
                await session.execute(
                    select(m.entries).where(
                        m.entries.c.id == self.row["actual_entry_id"]
                    )
                )
            )
            .mappings()
            .one()
        )
        refund = await session.scalar(
            select(r.refunds.c.id).where(r.refunds.c.refund_entry_id == entry["id"])
        )
        if refund:
            operation = "delete_refund"
        elif entry["category"] == "investing":
            operation = "delete_investment_entry"
        elif entry["category"] == "giving":
            operation = "delete_giving_entry"
        else:
            operation = "delete_entry"
        if entry["deleted_at"] is not None:
            # Deleted elsewhere already; only the inbox item changes.
            return "inbox_detach", {}, None
        return operation, {"expected_revision": entry["revision"]}, entry["uuid"]

    async def after(self, session, entity, actor, response, audit):
        before = await item_view(session, self.row)
        record = (
            (
                await session.execute(
                    update(st.staged)
                    .where(st.staged.c.id == self.row["id"])
                    .values(
                        status=self.status,
                        actual_entry_id=None,
                        revision=self.row["revision"] + 1,
                    )
                    .returning(st.staged)
                )
            )
            .mappings()
            .one()
        )
        after = await item_view(session, record)
        await audit(
            st.staged, record["uuid"], before, after, action=f"inbox_{self.action}"
        )
        return {"item": after, "entry": response}


async def record(session, token, entity_uuid, item_uuid, request_key, body, **extra):
    """Record one staged transaction; a domain rejection is kept as its reason.

    extra passes write()'s agent guard/finish callbacks through unchanged.
    """
    body = json_values(body)
    completion = body.get("completion")
    hook = RecordHook(
        item_uuid,
        body["expected_revision"],
        Completion(
            **{
                k: v for k, v in completion.items() if k not in {"rationale", "tag_ids"}
            },
            tag_ids=tuple(completion.get("tag_ids") or ()),
        )
        if completion
        else None,
    )
    try:
        return await write(
            session,
            token,
            entity_uuid,
            "inbox_record",
            request_key,
            body,
            item_uuid,
            hook=hook,
            scope=f"inbox_record:{item_uuid}",
            **extra,
        )
    except RejectionError as error:
        if hook.checked:
            await keep_rejection(session, token, entity_uuid, item_uuid, error)
        raise


async def keep_rejection(session, token, entity_uuid, item_uuid, error):
    async with session.begin():
        _, entity = await authorize(session, token, entity_uuid, lock=True)
        await session.execute(
            update(st.staged)
            .where(
                st.staged.c.uuid == item_uuid,
                st.staged.c.entity_id == entity["id"],
                st.staged.c.status == "waiting",
            )
            .values(rejection={"code": error.code, "message": error.message})
        )


async def remove_entry(
    session, token, entity_uuid, item_uuid, request_key, body, action, **extra
):
    return await write(
        session,
        token,
        entity_uuid,
        f"inbox_{action}",
        request_key,
        json_values(body),
        item_uuid,
        hook=RemoveEntryHook(item_uuid, body["expected_revision"], action),
        scope=f"inbox_{action}:{item_uuid}",
        **extra,
    )


async def dry_run(session, token, entity_uuid, item_uuid, completion: Completion):
    """The record command's checks for a proposal, rolled back; None when it passes."""
    try:
        await write(
            session,
            token,
            entity_uuid,
            "inbox_dry_run",
            str(uuid4()),
            {},
            item_uuid,
            hook=RecordHook(item_uuid, None, completion, dry_run=True),
            dry_run=True,
        )
    except DryRun:
        return None
    except RejectionError as error:
        if error.status in {401, 403} or error.code == "entity_not_found":
            raise
        return {"code": error.code, "message": error.message}
    return None


async def propose(session, token, entity_uuid, item_uuid, request_key, body):
    """Store a proposal and its dry-run outcome; never records anything."""
    body = json_values(body)
    completion = Completion(
        category=body.get("category"),
        assignment=body.get("assignment"),
        funding=body.get("funding"),
        refund_of=body.get("refund_of"),
        skip=bool(body.get("skip")),
        tag_ids=tuple(body.get("tag_ids") or ()),
    )
    try:
        validate_shape(completion)
    except InboxRejectionError as error:
        raise domain_rejection(error) from None
    outcome = None
    if not completion.skip:
        outcome = await dry_run(session, token, entity_uuid, item_uuid, completion)
    hook = Payload("inbox_propose", item_uuid, {"proposal_rejection": outcome})
    hook.payload = body
    return await write(
        session,
        token,
        entity_uuid,
        "inbox_propose",
        request_key,
        hook.payload,
        item_uuid,
        hook=hook,
    )


# Sync -------------------------------------------------------------------------


async def sync(session, token, entity_uuid, source_uuid, source: TransactionSource):
    """Fetch outside the transaction, then stage everything and the cursor together."""
    started = time.monotonic()
    async with session.begin():
        _, entity = await authorize(session, token, entity_uuid, lock=False)
        row = await scoped(session, st.sources, entity["id"], source_uuid)
        selected = set(
            (
                await session.scalars(
                    select(st.selections.c.account_ref).where(
                        st.selections.c.source_id == row["id"]
                    )
                )
            ).all()
        )
    if row["disconnected_at"] is not None:
        raise RejectionError("source_disconnected", "This source is disconnected.", 409)
    if not selected:
        raise RejectionError(
            "no_accounts_selected", "Select at least one account to import.", 422
        )
    try:
        inputs, cursor = await source.changes_since(row["cursor"])
    except SourceError as error:
        log.warning("inbox_sync_failed", source=str(source_uuid), code=error.code)
        raise source_rejection(error) from None
    counts = dict.fromkeys(
        ("added", "changed", "removed", "conflicts", "unchanged", "ignored"), 0
    )
    async with session.begin():
        _, entity = await authorize(session, token, entity_uuid, lock=True)
        try:
            current = (
                (
                    await session.execute(
                        select(st.sources)
                        .where(st.sources.c.id == row["id"])
                        .with_for_update(nowait=True)
                    )
                )
                .mappings()
                .one()
            )
        except DBAPIError:
            raise RejectionError(
                "sync_in_progress", "Another sync is in progress. Try again.", 409
            ) from None
        if current["cursor"] != row["cursor"] or current["revision"] != row["revision"]:
            raise RejectionError(
                "sync_in_progress",
                "This source changed during the sync. Sync again.",
                409,
            )
        existing = {
            r["source_ref"]: r
            for r in (
                await session.execute(
                    select(st.staged).where(st.staged.c.source_id == row["id"])
                )
            )
            .mappings()
            .all()
        }
        children: dict[str, list] = {}
        for r in existing.values():
            if r["parent_ref"]:
                children.setdefault(r["parent_ref"], []).append(r)

        async def apply(target, latest, deleted):
            economic = any(target["latest"].get(k) != latest.get(k) for k in ECONOMIC)
            status = synced_status(target["status"], deleted=deleted, changed=economic)
            if status == "conflict" and target["status"] != "conflict":
                counts["conflicts"] += 1
            elif status == "removed" and target["status"] != "removed":
                counts["removed"] += 1
            else:
                counts["changed"] += 1
            await session.execute(
                update(st.staged)
                .where(st.staged.c.id == target["id"])
                .values(
                    latest=latest,
                    financial_date=date.fromisoformat(latest["financial_date"]),
                    status=status,
                    changed_after_staging=target["changed_after_staging"] or economic,
                    revision=target["revision"] + 1,
                )
            )

        for item in inputs:
            if (
                item.account_ref not in selected
                or item.financial_date < row["start_date"]
            ):
                counts["ignored"] += 1
                continue
            latest = item.latest()
            target = existing.get(item.source_ref)
            if target is None and item.deleted:
                # A deleted split parent arrives without its lines.
                for child in children.get(item.source_ref, []):
                    if not child["latest"]["deleted"]:
                        await apply(child, {**child["latest"], "deleted": True}, True)
                continue
            if target is None:
                await session.execute(
                    insert(st.staged).values(
                        entity_id=entity["id"],
                        source_id=row["id"],
                        source_ref=item.source_ref,
                        parent_ref=item.parent_ref,
                        financial_date=item.financial_date,
                        latest=latest,
                    )
                )
                counts["added"] += 1
                if item.parent_ref and item.parent_ref in existing:
                    # It was staged unsplit; the whole transaction is now its lines.
                    whole = existing.pop(item.parent_ref)
                    if not whole["latest"]["deleted"]:
                        await apply(whole, {**whole["latest"], "deleted": True}, True)
                continue
            if target["latest"] == latest:
                counts["unchanged"] += 1
                continue
            await apply(target, latest, item.deleted)
        await session.execute(
            update(st.sources)
            .where(st.sources.c.id == row["id"])
            .values(cursor=cursor, last_synced_at=datetime.now(UTC))
        )
        view = await source_view(
            session,
            (
                await session.execute(
                    select(st.sources).where(st.sources.c.id == row["id"])
                )
            )
            .mappings()
            .one(),
        )
    log.info(
        "inbox_sync",
        source=str(source_uuid),
        ms=round((time.monotonic() - started) * 1000),
        **counts,
    )
    logfire.info("inbox.sync_counts", source_id=str(source_uuid), counts=counts)
    return {"source": view, "counts": counts}
