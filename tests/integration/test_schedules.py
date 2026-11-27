"""Entry schedules on real PostgreSQL: API, the tick's staging and inbox pairs (TDD 18).

Every value is synthetic. The service clock is moved by hand so days pass and
ticks are missed; expected dates and entries are worked from the cadence.
"""

import asyncio
import os
from datetime import UTC, date, datetime
from decimal import Decimal
from uuid import UUID, uuid4

import httpx
import pytest
from sqlalchemy import func, insert, select, update
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from accanto.app import create_app
from accanto.db import get_session
from accanto.domains.inbox import StagedTransactionInput
from accanto.models import destinations as d
from accanto.models import inbox as st
from accanto.models import monthly as m
from accanto.models import schedules as sc
from accanto.services import agent_settings, schedules
from accanto.services.access import RejectionError, resolve_actor
from accanto.services.api_keys import issue_key
from accanto.services.tools import TOOLS, ToolContext
from tests.integration.read_cost import counted_get

URL = os.environ.get("ACCANTO_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not URL, reason="Use an isolated migrated test database"
)
DAILY = {
    "frequency": "weekly",
    "interval": 1,
    "weekdays": ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
}
# Mon Oct 26, 2026: the day the schedule is created.
CREATED = date(2026, 10, 26)


def at(day: date) -> datetime:
    """Three in the morning UTC on day, when an hourly tick has run."""
    return datetime(day.year, day.month, day.day, 3, tzinfo=UTC)


def test_entry_schedules_end_to_end(monkeypatch):
    asyncio.run(scenario(monkeypatch))


async def scenario(monkeypatch):
    assert URL and URL.rsplit("/", 1)[-1].endswith("_test")
    engine = create_async_engine(URL)
    sessions = async_sessionmaker(engine)
    now = {"value": at(CREATED)}
    monkeypatch.setattr(schedules, "clock", lambda: now["value"])
    async with sessions() as db, db.begin():
        user = await db.scalar(
            insert(m.users)
            .values(issuer="schedule-test", subject=str(uuid4()))
            .returning(m.users.c.id)
        )
        (entity, entity_id), (other, _) = [
            (
                await db.execute(
                    insert(m.entities)
                    .values(
                        owner_id=user, name=f"Synthetic schedules {n}", time_zone="UTC"
                    )
                    .returning(m.entities.c.uuid, m.entities.c.id)
                )
            ).one()
            for n in (1, 2)
        ]
        key = await issue_key(db, user, "Synthetic schedule key")
        actor = await resolve_actor(db, key["key"], "api_key")
    app = create_app()

    async def dependency():
        async with sessions() as session:
            yield session

    app.dependency_overrides[get_session] = dependency
    prefix = f"/api/entities/{entity}"

    async def count(table, *where):
        async with sessions() as db:
            return await db.scalar(
                select(func.count()).select_from(table).where(*where)
            )

    async def live_entries():
        async with sessions() as db:
            rows = await db.execute(
                select(
                    m.entries.c.financial_date, m.entries.c.category, m.entries.c.amount
                )
                .where(
                    m.entries.c.entity_id == entity_id, m.entries.c.deleted_at.is_(None)
                )
                .order_by(m.entries.c.financial_date, m.entries.c.category)
            )
            return [(r.financial_date, r.category, r.amount) for r in rows]

    async def tick(day: date):
        now["value"] = at(day)
        return await schedules.stage_due(sessions)

    async def scheduled_items():
        return [i for i in await ok("GET", "/inbox") if i["schedule"]]

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
        headers={"Authorization": f"Bearer {key['key']}"},
    ) as client:

        async def send(method, suffix, body=None, request_key=None):
            return await client.request(
                method,
                prefix + suffix,
                json=body,
                headers={"Idempotency-Key": request_key or str(uuid4())},
            )

        async def ok(method, suffix, body=None, request_key=None):
            response = await send(method, suffix, body, request_key)
            assert response.status_code == 200, response.text
            return response.json()

        plan = await ok(
            "POST",
            "/plans",
            {
                "name": "Synthetic schedule Plan",
                "incomes": [{"name": "Synthetic payroll", "amount": "4000.00"}],
                "spending": "500.00",
            },
        )
        source = plan["draft"]["incomes"][0]["source_id"]
        fund = await ok(
            "POST",
            "/investments",
            {
                "name": "Synthetic retirement fund",
                "target": None,
                "opening": {"date": "2026-01-01", "amount": "1000.00"},
            },
        )
        lines = [
            {
                "category": "income",
                "amount": "1200.00",
                "note": "Synthetic deferral",
                "assignment": source,
            },
            {
                "category": "investing",
                "amount": "1200.00",
                "note": "Synthetic contribution",
                "assignment": fund["uuid"],
                "funding": "income",
            },
        ]
        body = {
            "name": "Synthetic payroll 401(k)",
            "cadence": DAILY,
            "starts_on": "2026-10-01",
            "lines": lines,
        }

        # Rejections leave nothing behind.
        saving = {**body, "lines": [{"category": "saving", "amount": "10.00"}]}
        bad = await send("POST", "/schedules", saving)
        assert bad.status_code == 422 and bad.json()["detail"]["code"] == "invalid_line"
        unknown = {**body, "lines": [{**lines[1], "assignment": str(uuid4())}]}
        bad = await send("POST", "/schedules", unknown)
        assert bad.status_code == 422, bad.text
        assert "investment is unavailable" in bad.json()["detail"]["message"]
        ends = {**body, "ends_on": "2026-09-30"}
        assert (await send("POST", "/schedules", ends)).status_code == 422
        rolled = {**body, "cadence": {**DAILY, "weekend": "before"}}
        assert (await send("POST", "/schedules", rolled)).json()["detail"][
            "code"
        ] == "invalid_cadence"
        assert await count(sc.schedules, sc.schedules.c.entity_id == entity_id) == 0

        # Created on Oct 26 with a start in the past: nothing before today.
        request_key = str(uuid4())
        created = await ok("POST", "/schedules", body, request_key)
        assert created == await ok("POST", "/schedules", body, request_key)
        assert (
            await send("POST", "/schedules", {**body, "name": "Other"}, request_key)
        ).status_code == 409
        sid = created["uuid"]
        assert created["state"] == "active"
        assert created["next_on"] == "2026-10-26"
        assert [u["scheduled_on"] for u in created["upcoming"]] == [
            "2026-10-26",
            "2026-10-27",
            "2026-10-28",
        ]
        assert created["lines"][0]["assignment_name"] == "Synthetic payroll"
        assert created["lines"][1]["assignment_name"] == "Synthetic retirement fund"
        assert (
            await client.get(f"/api/entities/{other}/schedules/{sid}")
        ).status_code == 404

        # Skip Oct 27 once, then the Box is off until Oct 29: one tick stages
        # Oct 26, 28 and 29 (two inbox items each), passes the skipped date and
        # records nothing.
        skipped = await ok(
            "PUT", f"/schedules/{sid}/occurrences/2026-10-27", {"skipped": True}
        )
        assert skipped["upcoming"][1] == {"scheduled_on": "2026-10-27", "skipped": True}
        far = await send(
            "PUT", f"/schedules/{sid}/occurrences/2026-11-20", {"skipped": True}
        )
        assert far.status_code == 422
        # Two ticks at once stage each date once; a later tick adds nothing.
        await asyncio.gather(tick(date(2026, 10, 29)), tick(date(2026, 10, 29)))
        await tick(date(2026, 10, 29))
        assert await live_entries() == []
        items = await scheduled_items()
        assert [
            (i["financial_date"], i["amount"], i["status"], i["proposal"]["category"])
            for i in items
        ] == [
            (f"2026-10-{d}", amount, "waiting", category)
            for d in (26, 28, 29)
            for amount, category in (("1200.00", "income"), ("-1200.00", "investing"))
        ]
        first = items[0]
        assert first["payee"] == body["name"] and first["memo"] == "Synthetic deferral"
        assert first["schedule"]["schedule_id"] == sid
        assert first["source_id"] is None and first["cleared"] is True
        assert first["proposed_by"]["interface"] == "schedule"
        assert first["proposal_rejection"] is None
        audits = await count(
            m.audit,
            m.audit.c.entity_id == entity_id,
            m.audit.c.action == "schedule_stage",
            m.audit.c.interface == "schedule",
            m.audit.c.actor_id == user,
        )
        assert audits == 3
        view = await ok("GET", f"/schedules/{sid}")
        assert view["next_on"] == "2026-10-30"
        assert [
            (o["scheduled_on"], o["status"], len(o["items"])) for o in view["recent"]
        ] == [
            ("2026-10-29", "staged", 2),
            ("2026-10-28", "staged", 2),
            ("2026-10-27", "skipped", 0),
            ("2026-10-26", "staged", 2),
        ]
        staged = await send(
            "PUT", f"/schedules/{sid}/occurrences/2026-10-28", {"skipped": True}
        )
        assert staged.json()["detail"]["code"] == "occurrence_staged"
        passed = await send(
            "PUT", f"/schedules/{sid}/occurrences/2026-10-27", {"skipped": False}
        )
        assert passed.json()["detail"]["code"] == "occurrence_passed"

        # Accepting in the inbox is what records: one item, then a batch.
        one = await ok(
            "POST",
            f"/inbox/{first['id']}/record",
            {"expected_revision": first["revision"]},
        )
        assert one["item"]["status"] == "recorded"
        batch = await ok(
            "POST",
            "/inbox/record",
            {
                "items": [
                    {"item_id": i["id"], "expected_revision": i["revision"]}
                    for i in items[1:4]
                ]
            },
        )
        assert all(r["ok"] for r in batch["results"])
        assert await live_entries() == [
            (date(2026, 10, d), category, Decimal("1200.00"))
            for d in (26, 28)
            for category in ("income", "investing")
        ]
        recorded = await count(
            m.audit,
            m.audit.c.entity_id == entity_id,
            m.audit.c.record_type == "actual_entry",
        )
        assert recorded == 4
        # Ignoring a scheduled item records nothing for it.
        await ok(
            "POST",
            f"/inbox/{items[4]['id']}/skip",
            {"expected_revision": items[4]["revision"]},
        )
        assert len(await live_entries()) == 4

        # An inactive investment still stages, but its item says now that
        # recording it would be rejected, before anyone accepts it.
        async with sessions() as db, db.begin():
            await db.execute(
                update(d.investments)
                .where(d.investments.c.uuid == fund["uuid"])
                .values(active=False)
            )
        assert (await tick(date(2026, 10, 30)))["staged"] == 1
        latest = [
            i for i in await scheduled_items() if i["financial_date"] == "2026-10-30"
        ]
        assert latest[0]["proposal_rejection"] is None
        assert latest[1]["proposal_rejection"]["code"] == "inactive_destination"
        async with sessions() as db, db.begin():
            await db.execute(
                update(d.investments)
                .where(d.investments.c.uuid == fund["uuid"])
                .values(active=True)
            )

        # A line whose record is gone fails the date; the reason is kept, later
        # dates continue, and the date stages once the cause is fixed.
        async with sessions() as db, db.begin():
            good = await db.scalar(
                select(sc.schedules.c.lines).where(sc.schedules.c.uuid == sid)
            )
            broken = [good[0], {**good[1], "assignment": str(uuid4())}]
            await db.execute(
                update(sc.schedules)
                .where(sc.schedules.c.uuid == sid)
                .values(lines=broken)
            )
        assert (await tick(date(2026, 10, 31)))["not_staged"] == 1
        view = await ok("GET", f"/schedules/{sid}")
        failed = view["recent"][0]
        assert (failed["scheduled_on"], failed["status"]) == ("2026-10-31", "failed")
        assert failed["rejection"]["code"] == "invalid_line"
        assert view["next_on"] == "2026-11-01"
        # The same reason an hour later is neither stored nor audited again.
        audit_rows = await count(m.audit, m.audit.c.entity_id == entity_id)
        await tick(date(2026, 10, 31))
        assert await count(m.audit, m.audit.c.entity_id == entity_id) == audit_rows
        async with sessions() as db, db.begin():
            await db.execute(
                update(sc.schedules)
                .where(sc.schedules.c.uuid == sid)
                .values(lines=good)
            )
        await tick(date(2026, 10, 31))
        assert len(await scheduled_items()) == 10
        view = await ok("GET", f"/schedules/{sid}")
        assert view["recent"][0]["status"] == "staged"

        # Edit: a raise applies from the next date; staged items stay.
        raised = [{**lines[0], "amount": "1600.00"}, {**lines[1], "amount": "1600.00"}]
        view = await ok(
            "PUT",
            f"/schedules/{sid}",
            {**body, "lines": raised, "expected_revision": view["revision"]},
        )
        stale = await send("PUT", f"/schedules/{sid}", {**body, "expected_revision": 1})
        assert stale.json()["detail"]["code"] == "stale_revision"
        assert view["next_on"] == "2026-11-01"

        # Pause on Nov 1; nothing stages while paused, and resuming on Nov 3
        # does not stage Nov 1 or 2.
        view = await ok(
            "PUT",
            f"/schedules/{sid}",
            {
                **body,
                "lines": raised,
                "paused": True,
                "expected_revision": view["revision"],
            },
        )
        assert view["state"] == "paused" and view["next_on"] is None
        await tick(date(2026, 11, 2))
        now["value"] = at(date(2026, 11, 3))
        view = await ok(
            "PUT",
            f"/schedules/{sid}",
            {**body, "lines": raised, "expected_revision": view["revision"]},
        )
        assert view["next_on"] == "2026-11-03"
        await tick(date(2026, 11, 3))
        items = await scheduled_items()
        assert {i["financial_date"] for i in items} == {
            f"2026-10-{d}" for d in (26, 28, 29, 30, 31)
        } | {"2026-11-03"}
        assert [i["amount"] for i in items[-2:]] == ["1600.00", "-1600.00"]

        # End on Nov 4: the last date stages, then the schedule has ended.
        view = await ok(
            "PUT",
            f"/schedules/{sid}",
            {
                **body,
                "lines": raised,
                "ends_on": "2026-11-04",
                "expected_revision": view["revision"],
            },
        )
        assert [u["scheduled_on"] for u in view["upcoming"]] == ["2026-11-04"]
        await tick(date(2026, 11, 9))
        view = await ok("GET", f"/schedules/{sid}")
        assert view["state"] == "ended" and view["next_on"] is None
        assert len(await scheduled_items()) == 14

        # YNAB also brings in the Nov 4 deferral as a deposit on Nov 5: the two
        # waiting items flag each other as the same money. A deposit too far
        # away pairs with nothing; an outflow pairs only with the investment.
        async with sessions() as db, db.begin():
            source_id = await db.scalar(
                insert(st.sources)
                .values(
                    entity_id=entity_id,
                    kind="ynab",
                    external_ref="synthetic-plan",
                    name="Synthetic plan",
                    start_date=date(2026, 10, 1),
                )
                .returning(st.sources.c.id)
            )
            for ref, amount, day in (
                ("deposit", "1600.00", date(2026, 11, 5)),
                ("other", "1600.00", date(2026, 11, 20)),
                ("transfer", "-1600.00", date(2026, 11, 5)),
            ):
                facts = StagedTransactionInput(
                    ref,
                    "acct",
                    "Synthetic checking",
                    day,
                    Decimal(amount),
                    "Synthetic employer",
                    "ordinary",
                    cleared=True,
                )
                await db.execute(
                    insert(st.staged).values(
                        uuid=uuid4(),
                        entity_id=entity_id,
                        source_id=source_id,
                        source_ref=ref,
                        financial_date=day,
                        latest=facts.latest(),
                    )
                )
        everything = await ok("GET", "/inbox")
        ynab = {i["source_ref"]: i for i in everything if not i["schedule"]}
        nov4 = [i for i in everything if i["financial_date"] == "2026-11-04"]
        pay, contribution = nov4
        assert ynab["deposit"]["pair"]["item_id"] == pay["id"]
        assert ynab["deposit"]["pair"]["from_schedule"] is True
        assert pay["pair"]["item_id"] == ynab["deposit"]["id"]
        assert ynab["transfer"]["pair"]["item_id"] == contribution["id"]
        assert ynab["other"]["pair"] is None
        # Keep the schedule's item and ignore YNAB's: the money counts once.
        before = await live_entries()
        await ok(
            "POST",
            f"/inbox/{pay['id']}/record",
            {"expected_revision": pay["revision"]},
        )
        deposit = next(
            i for i in await ok("GET", "/inbox") if i["source_ref"] == "deposit"
        )
        assert deposit["pair"]["status"] == "recorded"
        await ok(
            "POST",
            f"/inbox/{deposit['id']}/skip",
            {"expected_revision": deposit["revision"]},
        )
        assert len(await live_entries()) == len(before) + 1
        after = {i["id"]: i for i in await ok("GET", "/inbox")}
        assert after[deposit["id"]]["status"] == "skipped"

        # The list reads in a fixed number of statements: 2 and 20 schedules.
        async with sessions() as db, db.begin():
            row = (
                (
                    await db.execute(
                        select(sc.schedules).where(sc.schedules.c.uuid == sid)
                    )
                )
                .mappings()
                .one()
            )
            values = {k: v for k, v in row.items() if k not in {"id", "uuid"}}
            await db.execute(insert(sc.schedules).values(uuid=uuid4(), **values))
        _, two = await counted_get(client, engine, f"{prefix}/schedules")
        async with sessions() as db, db.begin():
            for _ in range(18):
                await db.execute(insert(sc.schedules).values(uuid=uuid4(), **values))
        many, twenty = await counted_get(client, engine, f"{prefix}/schedules")
        assert len(many) == 20 and twenty == two

        # Agent tools follow the Agent mode: reads always, a schedule save
        # pends in Ask first, is refused in Read only and runs in Apply directly.
        mcp = ToolContext(sessions, actor.acting_as("mcp"))

        async def call(tool, args):
            spec = TOOLS[tool]
            return await spec.run(
                mcp, entity, spec.input.model_validate(args), str(uuid4())
            )

        async def set_mode(mode):
            async with sessions() as db:
                current = await agent_settings.read_settings(db, actor, entity)
            async with sessions() as db:
                await agent_settings.update_settings(
                    db,
                    actor,
                    entity,
                    str(uuid4()),
                    {
                        "enabled": True,
                        "mode": mode,
                        "instructions": "",
                        "expected_revision": current["revision"],
                    },
                )

        def named(name):
            return count(
                sc.schedules,
                sc.schedules.c.entity_id == entity_id,
                sc.schedules.c.name == name,
            )

        await set_mode("ask_first")
        listed = await call("list_schedules", {})
        assert len(listed.schedules) == 20
        assert listed.model_dump(mode="json")["schedules"][0]["name"] == {
            "untrusted": body["name"]
        }
        agent_body = {**body, "name": "Synthetic agent schedule"}
        assert (await call("save_schedule", {"values": agent_body})).status == "pending"
        assert await named("Synthetic agent schedule") == 0
        await set_mode("read_only")
        with pytest.raises(RejectionError) as refused:
            await call("save_schedule", {"values": agent_body})
        assert refused.value.code == "read_only"
        await set_mode("apply_directly")
        assert (
            await call("save_schedule", {"values": agent_body})
        ).status == "recorded"
        assert await named("Synthetic agent schedule") == 1
        listed = await call("list_inbox", {"status": ["waiting"]})
        transfer = next(i for i in listed.items if i.id == UUID(ynab["transfer"]["id"]))
        assert transfer.pair is not None
        assert transfer.pair.item_id == UUID(contribution["id"])
        scheduled = next(i for i in listed.items if i.id == UUID(contribution["id"]))
        assert scheduled.schedule is not None and scheduled.source_id is None
    await engine.dispose()
