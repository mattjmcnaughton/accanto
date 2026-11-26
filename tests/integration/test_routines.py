"""Routines on real PostgreSQL through the API and the agent tools (TDD 13).

Every value is synthetic. Dates count from the Entity's today (UTC), so the
expected states are worked from the cadence, not from the implementation.
"""

import asyncio
import os
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import func, insert, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from accanto.app import create_app
from accanto.db import get_session
from accanto.models import monthly as m
from accanto.models import routines as r
from accanto.services import agent_settings
from accanto.services.access import RejectionError, resolve_actor
from accanto.services.api_keys import issue_key
from accanto.services.tools import TOOLS, ToolContext
from tests.integration.read_cost import counted_get

URL = os.environ.get("ACCANTO_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not URL, reason="Use an isolated migrated test database"
)
DAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")


def test_routines_through_the_api_and_agent_tools():
    asyncio.run(scenario())


async def scenario():
    assert URL and URL.rsplit("/", 1)[-1].endswith("_test")
    engine = create_async_engine(URL)
    sessions = async_sessionmaker(engine)
    async with sessions() as db, db.begin():
        user = await db.scalar(
            insert(m.users)
            .values(issuer="routine-test", subject=str(uuid4()))
            .returning(m.users.c.id)
        )
        (entity, entity_id), (other, _) = [
            (
                await db.execute(
                    insert(m.entities)
                    .values(
                        owner_id=user, name=f"Synthetic routine {n}", time_zone="UTC"
                    )
                    .returning(m.entities.c.uuid, m.entities.c.id)
                )
            ).one()
            for n in (1, 2)
        ]
        key = await issue_key(db, user, "Synthetic routine key")
        actor = await resolve_actor(db, key["key"], "api_key")
    app = create_app()

    async def dependency():
        async with sessions() as session:
            yield session

    app.dependency_overrides[get_session] = dependency
    today = datetime.now(UTC).date()
    day = lambda n: (today + timedelta(days=n)).isoformat()  # noqa: E731
    prefix = f"/api/entities/{entity}/routines"

    async def count(table, *where):
        async with sessions() as db:
            return await db.scalar(
                select(func.count()).select_from(table).where(*where)
            )

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
        headers={"Authorization": f"Bearer {key['key']}"},
    ) as client:

        async def send(method, suffix, body=None, request_key=None, base=prefix):
            return await client.request(
                method,
                base + suffix,
                json=body,
                headers={"Idempotency-Key": request_key or str(uuid4())},
            )

        async def ok(method, suffix, body=None, request_key=None):
            response = await send(method, suffix, body, request_key)
            assert response.status_code == 200, response.text
            return response.json()

        # Weekly on today's weekday from ten weeks ago: today is due, last week
        # was missed (never acted on), and eleven dates are in the history.
        weekly = {
            "frequency": "weekly",
            "interval": 1,
            "weekdays": [DAYS[today.weekday()]],
        }
        body = {
            "name": "Synthetic weekly check",
            "cadence": weekly,
            "starts_on": day(-70),
            "steps": [
                {"title": "Process transactions", "link_screen": "inbox"},
                {
                    "title": "Review last month",
                    "link_screen": "review",
                    "link_month_offset": -1,
                },
                {"title": "Pay the card", "link_url": "https://bank.example.com"},
            ],
        }
        routine = await ok("POST", "", body)
        rid = routine["uuid"]
        steps = [s["uuid"] for s in routine["steps"]]
        assert routine["current"] == {
            "scheduled_on": day(0),
            "state": "due",
            "done": 0,
            "total": 3,
        }
        assert routine["next_on"] == day(7)
        assert [h["scheduled_on"] for h in routine["history"]] == [
            day(n) for n in range(-70, 1, 7)
        ]
        assert routine["history"][-2]["state"] == "missed"

        # Impossible cadences and links are rejected before anything is stored.
        for bad in (
            {**body, "cadence": {**weekly, "weekdays": []}},
            {**body, "cadence": {"frequency": "monthly", "month_day": 31}},
            {**body, "steps": [{"title": "x", "link_url": "http://bank.example"}]},
            {
                **body,
                "steps": [
                    {"title": "x", "link_screen": "plans", "link_month_offset": 1}
                ],
            },
        ):
            assert (await send("POST", "", bad)).status_code == 422
        assert await count(r.routines, r.routines.c.entity_id == entity_id) == 1

        # The first tick stores the occurrence; a retry replays it with one audit.
        tick = f"/{rid}/occurrences/{day(0)}/steps/{steps[0]}"
        first = await ok("PUT", tick, {"status": "done", "note": "Synthetic"}, "k1")
        again = await ok("PUT", tick, {"status": "done", "note": "Synthetic"}, "k1")
        assert first == again and first["revision"] == 1 and first["state"] == "due"
        reused = await send("PUT", tick, {"status": "skipped"}, "k1")
        assert reused.status_code == 409
        occurrence_audits = m.audit.c.record_type == "routine_occurrence"
        assert (
            await count(m.audit, occurrence_audits, m.audit.c.entity_id == entity_id)
            == 1
        )

        # Every step ticked or skipped makes it done today; clearing one reopens it.
        await ok(
            "PUT",
            f"/{rid}/occurrences/{day(0)}/steps/{steps[1]}",
            {"status": "skipped"},
        )
        done = await ok(
            "PUT", f"/{rid}/occurrences/{day(0)}/steps/{steps[2]}", {"status": "done"}
        )
        assert done["state"] == "done" and done["completed_on"] == day(0)
        listed = await ok("GET", f"/{rid}")
        assert listed["current"]["state"] == "done" and listed["current"]["done"] == 3
        cleared = await ok("PUT", tick, {"status": None})
        assert cleared["state"] == "due" and cleared["completed_on"] is None
        await ok("PUT", tick, {"status": "done"})

        # A missed week can still be finished; it is completed late, today.
        late = f"/{rid}/occurrences/{day(-7)}"
        assert (await ok("GET", late))["state"] == "missed"
        for step in steps:
            finished = await ok("PUT", f"{late}/steps/{step}", {"status": "done"})
        assert finished["state"] == "done" and finished["completed_on"] == day(0)
        assert finished["next_on"] == day(0)

        # Only scheduled dates, and none after the next one.
        assert (await send("GET", f"/{rid}/occurrences/{day(-1)}")).status_code == 404
        beyond = await send(
            "PUT", f"/{rid}/occurrences/{day(14)}/steps/{steps[0]}", {"status": "done"}
        )
        assert beyond.status_code == 422

        # Two first ticks at once make one occurrence with two ticked steps.
        await asyncio.gather(
            *(
                ok("PUT", f"/{rid}/occurrences/{day(7)}/steps/{s}", {"status": "done"})
                for s in steps[:2]
            )
        )
        upcoming = await ok("GET", f"/{rid}/occurrences/{day(7)}")
        assert upcoming["revision"] == 2 and upcoming["state"] == "upcoming"
        assert [s["status"] for s in upcoming["steps"]] == ["done", "done", None]

        # Renaming and removing steps leaves past occurrences as they were ticked.
        edit = {
            **body,
            "steps": [
                {
                    "step_id": steps[0],
                    "title": "Triage the inbox",
                    "link_screen": "inbox",
                },
                {"step_id": steps[1], "title": "Review last month"},
            ],
            "expected_revision": 1,
        }
        edited = await ok("PUT", f"/{rid}", edit)
        assert edited["revision"] == 2 and edited["current"]["total"] == 2
        assert (await send("PUT", f"/{rid}", edit)).status_code == 409
        past = await ok("GET", late)
        assert [s["title"] for s in past["steps"]] == [
            "Process transactions",
            "Review last month",
            "Pay the card",
        ]

        # Skipping a whole week keeps its note; ticking waits until it is reopened.
        skip = f"/{rid}/occurrences/{day(-14)}"
        skipped = await ok(
            "PUT", skip, {"skipped": True, "note": "Away", "expected_revision": 0}
        )
        assert skipped["state"] == "skipped" and skipped["note"] == "Away"
        blocked = await send("PUT", f"{skip}/steps/{steps[0]}", {"status": "done"})
        assert blocked.status_code == 409
        stale = await send("PUT", skip, {"skipped": False, "expected_revision": 0})
        assert stale.status_code == 409
        reopened = await ok("PUT", skip, {"skipped": False, "expected_revision": 1})
        assert reopened["state"] == "missed"

        # Routines stay in their Entity.
        foreign = await send("GET", f"/{rid}", base=f"/api/entities/{other}/routines")
        assert foreign.status_code == 404
        foreign_tick = await send(
            "PUT", tick, {"status": "done"}, base=f"/api/entities/{other}/routines"
        )
        assert foreign_tick.status_code == 404

        # Nothing financial is recorded or audited.
        assert await count(m.entries, m.entries.c.entity_id == entity_id) == 0
        audited = await count(
            m.audit,
            m.audit.c.entity_id == entity_id,
            m.audit.c.record_type.notin_(["routine", "routine_occurrence"]),
        )
        assert audited == 0

        # The list costs the same number of statements for 2 and 50 routines.
        await ok("POST", "", {**body, "name": "Synthetic second"})
        _, small = await counted_get(client, engine, prefix)
        for n in range(48):
            await ok("POST", "", {**body, "name": f"Synthetic {n}"})
        listed_all, large = await counted_get(client, engine, prefix)
        assert len(listed_all) == 50 and small == large

    # Agent tools: ticking runs directly in Ask first; editing a routine pends.
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

    await set_mode("ask_first")
    due = await call("list_routines", {"due_only": True})
    # The first routine is done for today; the 49 others are due.
    assert len(due.routines) == 49 and str(rid) not in {str(x.id) for x in due.routines}
    everything = await call("list_routines", {})
    dumped = everything.model_dump(mode="json")["routines"][0]
    assert dumped["name"] == {"untrusted": "Synthetic weekly check"}
    current = await call("get_routine_occurrence", {"routine_id": rid})
    assert current.scheduled_on.isoformat() == day(0)
    second_step = current.steps[1].step_id
    ticked = await call(
        "set_routine_step",
        {
            "routine_id": rid,
            "scheduled_on": day(0),
            "step_id": str(second_step),
            "status": "done",
        },
    )
    assert ticked.steps[1].status == "done" and ticked.entity is not None
    mcp_audits = await count(
        m.audit, m.audit.c.entity_id == entity_id, m.audit.c.interface == "mcp"
    )
    assert mcp_audits == 1
    drafted = await call(
        "save_routine",
        {"values": {**body, "name": "Synthetic drafted"}},
    )
    assert drafted.status == "pending"

    await set_mode("read_only")
    with pytest.raises(RejectionError) as refused:
        await call(
            "set_routine_step",
            {
                "routine_id": rid,
                "scheduled_on": day(0),
                "step_id": str(second_step),
                "status": None,
            },
        )
    assert refused.value.code == "read_only"
    await engine.dispose()
