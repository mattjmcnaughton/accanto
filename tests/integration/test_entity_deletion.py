"""Delete Entity (TDD 22), against real PostgreSQL.

Synthetic data only: an owner with a "Synthetic Household" Entity they delete and
a "Synthetic Side Project" they keep, a member of the household, and a stranger
with their own Entity. Covers who may delete, the typed-name confirmation, what
the delete removes or detaches, that the kept Entity's rows (and the stranger's)
are byte-for-byte unchanged, a member's write waiting behind the delete, the
append-only audit history, background ticks skipping the deleted Entity, and
deleting the last owned Entity.
"""

import asyncio
import os
from datetime import UTC, date, datetime
from uuid import uuid4

import httpx
import pytest
from pydantic import SecretStr
from sqlalchemy import func, insert, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from accanto.app import create_app
from accanto.config import settings
from accanto.db import Base, get_session
from accanto.models import agent as ag
from accanto.models import inbox as st
from accanto.models import jobs as j
from accanto.models import monthly as m
from accanto.services.access import issue_session
from accanto.services.api_keys import issue_key
from accanto.services.browser_auth import csrf_token, ensure_own_entity
from accanto.services.schedules import due_work

URL = os.environ.get("ACCANTO_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="Requires isolated Postgres")

EVERY_DAY = {
    "frequency": "weekly",
    "interval": 1,
    "weekdays": ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
}


def test_owner_deletes_one_entity_and_nothing_else():
    asyncio.run(scenario())


async def person(db, name):
    user_id, email = (
        await db.execute(
            insert(m.users)
            .values(
                issuer="deletion-test",
                subject=f"{name}-{uuid4()}",
                email=f"{name}-{uuid4().hex[:8]}@example.test",
            )
            .returning(m.users.c.id, m.users.c.email)
        )
    ).one()
    issued = await issue_session(db, user_id)
    return {
        "id": user_id,
        "email": email,
        "key": (await issue_key(db, user_id, f"Synthetic {name} key"))["key"],
        "session": issued["token"],
        "session_uuid": issued["id"],
    }


async def entity(db, owner, name):
    return (
        await db.execute(
            insert(m.entities)
            .values(owner_id=owner["id"], name=name, time_zone="UTC")
            .returning(m.entities.c.id, m.entities.c.uuid)
        )
    ).one()


# Every table that holds an Entity's rows, by its entity_id column.
SCOPED = [t for t in Base.metadata.sorted_tables if "entity_id" in t.c]


async def snapshot(sessions, entity_id):
    """Every stored row of one Entity, in every table, plus the Entity row."""
    async with sessions() as db:
        rows = {
            t.name: sorted(
                (
                    dict(r)
                    for r in (
                        await db.execute(select(t).where(t.c.entity_id == entity_id))
                    ).mappings()
                ),
                key=repr,
            )
            for t in SCOPED
        }
        rows["entity"] = [
            dict(
                (
                    await db.execute(
                        select(m.entities).where(m.entities.c.id == entity_id)
                    )
                )
                .mappings()
                .one()
            )
        ]
        conversations = select(ag.conversations.c.id).where(
            ag.conversations.c.entity_id == entity_id
        )
        rows["agent_message"] = sorted(
            (
                dict(r)
                for r in (
                    await db.execute(
                        select(ag.messages).where(
                            ag.messages.c.conversation_id.in_(conversations)
                        )
                    )
                ).mappings()
            ),
            key=repr,
        )
    return rows


async def scenario():
    assert URL and URL.rsplit("/", 1)[-1].endswith("_test")
    engine = create_async_engine(URL)
    sessions = async_sessionmaker(engine)
    async with sessions() as db, db.begin():
        owner = await person(db, "owner")
        member = await person(db, "member")
        stranger = await person(db, "stranger")
        household_id, household = await entity(db, owner, "Synthetic Household")
        side_id, side = await entity(db, owner, "Synthetic Side Project")
        theirs_id, theirs = await entity(db, stranger, "Synthetic Stranger Books")
        await db.execute(
            insert(m.members).values(
                entity_id=household_id, user_id=member["id"], name="Synthetic Partner"
            )
        )
        # A saved provider token, a connected source and a queued job run in
        # each of the owner's Entities (the ciphertext is a placeholder).
        for entity_id in (household_id, side_id):
            await db.execute(
                insert(st.providers).values(
                    entity_id=entity_id,
                    kind="ynab",
                    secret_ciphertext="synthetic-placeholder-ciphertext",
                )
            )
            await db.execute(
                insert(st.sources).values(
                    entity_id=entity_id,
                    kind="ynab",
                    external_ref=f"synthetic-plan-{entity_id}",
                    name="Synthetic budget",
                    start_date=date(2026, 1, 1),
                )
            )
            await db.execute(
                insert(j.runs).values(entity_id=entity_id, kind="inbox_proposals")
            )

    config = settings.model_copy(
        update={
            "browser_origin": "http://test",
            "browser_csrf_secret": SecretStr("synthetic-deletion-csrf-secret-long"),
            "agent_model": "stub",
        }
    )
    app = create_app()
    app.state.auth_settings = config
    app.state.sessions = sessions

    async def dependency():
        async with sessions() as db:
            yield db

    app.dependency_overrides[get_session] = dependency
    transport = httpx.ASGITransport(app=app)

    def browser(who):
        return httpx.AsyncClient(
            transport=transport,
            base_url="http://test",
            cookies={"accanto_session": who["session"]},
            headers={
                "Origin": "http://test",
                "X-CSRF-Token": csrf_token(who["session"], config),
            },
        )

    def api(who):
        return httpx.AsyncClient(
            transport=transport,
            base_url="http://test",
            headers={"Authorization": f"Bearer {who['key']}"},
        )

    async def ok(client, method, path, body=None):
        response = await client.request(
            method, path, json=body, headers={"Idempotency-Key": str(uuid4())}
        )
        assert response.status_code == 200, response.text
        return response.json()

    async def seed(client, entity_uuid, label):
        """Records through the API: a Plan, a tag, an entry, a schedule, a turn."""
        prefix = f"/api/entities/{entity_uuid}"
        await ok(
            client,
            "POST",
            f"{prefix}/plans",
            {
                "name": f"Synthetic {label} Plan",
                "incomes": [{"name": "Synthetic pay", "amount": "3000.00"}],
                "spending": "400.00",
            },
        )
        tag = await ok(client, "POST", f"{prefix}/tags", {"name": f"Synthetic {label}"})
        await ok(
            client,
            "POST",
            f"{prefix}/activity",
            {
                "date": "2026-11-02",
                "category": "spending",
                "amount": "42.00",
                "note": f"Synthetic {label} groceries",
                "tag_ids": [tag["uuid"]],
            },
        )
        await ok(
            client,
            "POST",
            f"{prefix}/schedules",
            {
                "name": f"Synthetic {label} coffee",
                "cadence": EVERY_DAY,
                "starts_on": datetime.now(UTC).date().isoformat(),
                "lines": [{"category": "spending", "amount": "4.00"}],
            },
        )
        await ok(
            client,
            "PUT",
            f"{prefix}/agent/settings",
            {
                "enabled": True,
                "mode": "ask_first",
                "instructions": "",
                "expected_revision": 0,
            },
        )
        asked = await client.post(
            f"{prefix}/agent/conversations/messages",
            data={"content": "What did I spend?"},
            headers={"Idempotency-Key": str(uuid4())},
        )
        assert asked.status_code == 200 and "event: done" in asked.text, asked.text

    async def entity_ids(client):
        session = (await client.get("/api/auth/session")).json()
        return [e["id"] for e in session["entities"]]

    def deletion(entity_uuid, name):
        return {
            "method": "DELETE",
            "url": f"/api/entities/{entity_uuid}",
            "json": {"confirm_name": name},
        }

    async with (
        browser(owner) as owner_web,
        browser(member) as member_web,
        browser(stranger) as stranger_web,
        api(owner) as owner_api,
        api(member) as member_api,
    ):
        await seed(owner_web, household, "household")
        await seed(owner_web, side, "side")
        await seed(stranger_web, theirs, "stranger")
        # The member's own conversation in the household goes too.
        asked = await member_web.post(
            f"/api/entities/{household}/agent/conversations/messages",
            data={"content": "Synthetic member question"},
            headers={"Idempotency-Key": str(uuid4())},
        )
        assert asked.status_code == 200, asked.text

        side_before = await snapshot(sessions, side_id)
        theirs_before = await snapshot(sessions, theirs_id)
        household_before = await snapshot(sessions, household_id)
        assert side_before["tag"] and side_before["agent_message"]
        assert len(household_before["agent_conversation"]) == 2

        # Refusals change nothing: a member, an API key (so any agent), a
        # stranger, the wrong name, and the owner aiming at another owner's Entity.
        name = "Synthetic Household"
        refused = await member_web.request(**deletion(household, name))
        assert refused.json()["detail"]["code"] == "owner_required"
        by_key = await owner_api.request(**deletion(household, name))
        assert by_key.json()["detail"]["code"] == "browser_session_required"
        by_member_key = await member_api.request(**deletion(household, name))
        assert by_member_key.json()["detail"]["code"] == "browser_session_required"
        foreign = await stranger_web.request(**deletion(household, name))
        assert foreign.status_code == 404
        mistyped = await owner_web.request(**deletion(household, "synthetic household"))
        assert mistyped.status_code == 422
        assert mistyped.json()["detail"]["code"] == "name_mismatch"
        aimed = await owner_web.request(**deletion(theirs, "Synthetic Stranger Books"))
        assert aimed.status_code == 404
        assert await snapshot(sessions, household_id) == household_before
        assert await snapshot(sessions, theirs_id) == theirs_before

        # A member's write that waits behind the delete on the Entity lock is
        # refused, not applied. The test holds the lock, queues the delete,
        # then the write, and releases.
        async with sessions() as db, db.begin():
            await db.execute(
                select(m.entities.c.id)
                .where(m.entities.c.id == household_id)
                .with_for_update()
            )
            deleting = asyncio.create_task(
                owner_web.request(**deletion(household, f"  {name} "))
            )
            await asyncio.sleep(0.5)
            writing = asyncio.create_task(
                ok_or(member_api, f"/api/entities/{household}/tags")
            )
            await asyncio.sleep(0.5)
            assert not deleting.done() and not writing.done()
        deleted = await deleting
        assert deleted.status_code == 200, deleted.text
        assert deleted.json() == {"deleted": True, "id": str(household)}
        assert (await writing).status_code == 404

        # Gone for everyone, through every credential; the other Entity stays.
        assert await entity_ids(owner_web) == [str(side)]
        assert await entity_ids(member_web) == []
        for client in (owner_web, owner_api, member_web, member_api):
            reply = await client.get(f"/api/entities/{household}/tags")
            assert reply.json()["detail"]["code"] == "entity_not_found"
        again = await owner_web.request(**deletion(household, name))
        assert again.status_code == 404

        # The other Entity of the same owner and the stranger's are untouched,
        # row for row, in every table.
        assert await snapshot(sessions, side_id) == side_before
        assert await snapshot(sessions, theirs_id) == theirs_before

        after = await snapshot(sessions, household_id)
        # Detached or erased: access, the token, sources, runs, conversations.
        assert after["entity_member"] == []
        assert [p["secret_ciphertext"] for p in after["transaction_provider"]] == [None]
        assert all(s["disconnected_at"] for s in after["transaction_source"])
        assert [r["state"] for r in after["job_run"]] == ["cancelled"]
        assert after["agent_conversation"] == [] and after["agent_message"] == []
        assert after["entity"][0]["deleted_at"] is not None
        # Financial records stay stored (soft deletion), unreachable.
        for table in ("tag", "actual_entry", "plan", "entry_schedule"):
            assert after[table] == household_before[table], table
        # The audit history only grows: every earlier row, then this operation.
        earlier = household_before["audit_log"]
        assert all(row in after["audit_log"] for row in earlier)
        added = [r for r in after["audit_log"] if r not in earlier]
        assert len(after["audit_log"]) == len(earlier) + len(added)
        assert sorted(r["action"] for r in added) == [
            "delete_entity",
            "disconnect_source",
            "edit_transaction_provider",
            "remove_member",
        ]
        assert {r["operation_uuid"] for r in added} == {added[0]["operation_uuid"]}
        assert {(r["actor_id"], r["interface"]) for r in added} == {
            (owner["id"], "browser")
        }
        assert all("synthetic-placeholder" not in repr(r) for r in added)

        # Background ticks skip it: only the kept Entities' schedules are due.
        async with sessions() as db:
            work = await due_work(db, datetime.now(UTC))
        due = {row[1] for row in work}
        assert household not in due and {side, theirs} <= due

        # Deleting the last owned Entity is allowed and leaves none; the next
        # sign-in gives the owner a new empty "Personal", as for anyone new.
        last = await owner_web.request(**deletion(side, "Synthetic Side Project"))
        assert last.status_code == 200, last.text
        assert await entity_ids(owner_web) == []
        assert await snapshot(sessions, theirs_id) == theirs_before
        async with sessions() as db, db.begin():
            await ensure_own_entity(db, owner["id"], owner["session_uuid"], "UTC")
        async with sessions() as db:
            live = await db.scalar(
                select(func.count()).where(
                    m.entities.c.owner_id == owner["id"],
                    m.entities.c.deleted_at.is_(None),
                )
            )
        assert live == 1
        assert len(await entity_ids(owner_web)) == 1
    await engine.dispose()


async def ok_or(client, path):
    return await client.post(
        path,
        json={"name": "Synthetic racing tag"},
        headers={"Idempotency-Key": str(uuid4())},
    )
