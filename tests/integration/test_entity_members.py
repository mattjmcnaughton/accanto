"""Two Users sharing one Entity (TDD 19), against real PostgreSQL.

Synthetic data only: an owner, a member, a stranger and a "Synthetic Household"
Entity. Covers adding by sign-in email, what a member can and cannot do, the audit
trail naming who acted, removal taking effect on the next request (including a
request that waited on the Entity lock) and the browser-only boundary.
"""

import asyncio
import os
from uuid import UUID, uuid4

import httpx
import pytest
from pydantic import SecretStr
from sqlalchemy import delete, insert, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from accanto.app import create_app
from accanto.config import settings
from accanto.db import get_session
from accanto.models import monthly as m
from accanto.services.access import issue_session
from accanto.services.api_keys import issue_key
from accanto.services.browser_auth import csrf_token

URL = os.environ.get("ACCANTO_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="Requires isolated Postgres")


def test_two_users_share_an_entity():
    asyncio.run(scenario())


async def person(db, name):
    user_id, email = (
        await db.execute(
            insert(m.users)
            .values(
                issuer="members-test",
                subject=f"{name}-{uuid4()}",
                email=f"{name}-{uuid4().hex[:8]}@example.test",
            )
            .returning(m.users.c.id, m.users.c.email)
        )
    ).one()
    return {
        "id": user_id,
        "email": email,
        "key": (await issue_key(db, user_id, f"Synthetic {name} key"))["key"],
        "session": (await issue_session(db, user_id))["token"],
    }


async def scenario():
    assert URL and URL.rsplit("/", 1)[-1].endswith("_test")
    engine = create_async_engine(URL)
    sessions = async_sessionmaker(engine)
    async with sessions() as db, db.begin():
        owner = await person(db, "owner")
        member = await person(db, "member")
        stranger = await person(db, "stranger")
        household_id, household = (
            await db.execute(
                insert(m.entities)
                .values(
                    owner_id=owner["id"], name="Synthetic Household", time_zone="UTC"
                )
                .returning(m.entities.c.id, m.entities.c.uuid)
            )
        ).one()

    config = settings.model_copy(
        update={
            "browser_origin": "http://test",
            "browser_csrf_secret": SecretStr("synthetic-members-csrf-secret-long"),
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

    members = f"/api/entities/{household}/members"
    tags = f"/api/entities/{household}/tags"

    async def tag(client, name):
        return await client.post(
            tags, json={"name": name}, headers={"Idempotency-Key": str(uuid4())}
        )

    async def entity_roles(client):
        session = (await client.get("/api/auth/session")).json()
        return {e["id"]: e["role"] for e in session["entities"]}

    async with (
        browser(owner) as owner_web,
        browser(member) as member_web,
        browser(stranger) as stranger_web,
        api(owner) as owner_api,
        api(member) as member_api,
    ):
        # Before sharing, the member cannot see the Entity at all.
        assert await entity_roles(member_web) == {}
        assert (await member_api.get(tags)).status_code == 404

        # Rejected adds change nothing.
        add = {"email": member["email"].upper(), "name": "Synthetic Partner"}
        unknown = await owner_web.post(
            members, json={**add, "email": "nobody@example.test"}
        )
        assert unknown.json()["detail"]["code"] == "user_not_found"
        malformed = await owner_web.post(members, json={**add, "email": "not-email"})
        assert malformed.status_code == 422
        itself = await owner_web.post(members, json={**add, "email": owner["email"]})
        assert itself.json()["detail"]["code"] == "already_member"
        by_key = await owner_api.post(members, json=add)
        assert by_key.json()["detail"]["code"] == "browser_session_required"
        foreign = await stranger_web.post(members, json=add)
        assert foreign.status_code == 404
        blank = await owner_web.post(members, json={**add, "name": "  "})
        assert blank.status_code == 422

        added = await owner_web.post(members, json=add)
        assert added.status_code == 200, added.text
        listing = added.json()
        assert listing["role"] == "owner"
        assert [(r["role"], r["email"], r["you"]) for r in listing["members"]] == [
            ("owner", owner["email"], True),
            ("member", member["email"], False),
        ]
        again = await owner_web.post(members, json=add)
        assert again.json()["detail"]["code"] == "already_member"

        # The member sees the Entity as a member, with the owner's records, and
        # writes through both the browser and their own API key.
        assert await entity_roles(member_web) == {str(household): "member"}
        assert await entity_roles(owner_web) == {str(household): "owner"}
        assert (await tag(owner_api, "Synthetic owner tag")).status_code == 200
        assert (await tag(member_web, "Synthetic member tag")).status_code == 200
        assert (await tag(member_api, "Synthetic member key tag")).status_code == 200
        names = {t["name"] for t in (await owner_web.get(tags)).json()}
        assert names == {
            "Synthetic owner tag",
            "Synthetic member tag",
            "Synthetic member key tag",
        }
        seen = (await member_web.get(members)).json()
        assert seen["role"] == "member"
        assert [r["you"] for r in seen["members"]] == [False, True]

        # Only the owner manages members.
        member_row = listing["members"][1]["id"]
        refused = await member_web.delete(f"{members}/{uuid4()}")
        assert refused.json()["detail"]["code"] == "owner_required"
        invited = await member_web.post(
            members, json={"email": stranger["email"], "name": "Synthetic Guest"}
        )
        assert invited.json()["detail"]["code"] == "owner_required"
        assert (await stranger_web.get(members)).status_code == 404

        # Source setup is the owner's: the saved token may read plans the owner
        # never shared. Members still list and sync connected sources.
        sources = f"/api/entities/{household}/sources"
        plans = await member_web.get(f"{sources}/ynab/plans")
        assert plans.json()["detail"]["code"] == "owner_required"
        provider = await member_web.put(
            f"/api/entities/{household}/transaction-provider",
            json={
                "kind": "ynab",
                "access_token": "synthetic-not-a-token",
                "expected_revision": 0,
            },
            headers={"Idempotency-Key": str(uuid4())},
        )
        assert provider.json()["detail"]["code"] == "owner_required"
        assert (await member_web.get(sources)).status_code == 200

        # The member's assistant turn, replayed after removal, is refused below.
        agent = f"/api/entities/{household}/agent"
        enabled = await owner_web.put(
            f"{agent}/settings",
            json={
                "enabled": True,
                "mode": "ask_first",
                "instructions": "",
                "expected_revision": 0,
            },
            headers={"Idempotency-Key": str(uuid4())},
        )
        assert enabled.status_code == 200, enabled.text
        turn = {"content": "What is my net worth?"}
        turn_key = {"Idempotency-Key": str(uuid4())}
        asked = await member_web.post(
            f"{agent}/conversations/messages", data=turn, headers=turn_key
        )
        assert asked.status_code == 200 and "event: done" in asked.text, asked.text

        # The audit trail names who did what.
        async with sessions() as db:
            audit = (
                await db.execute(
                    select(m.audit.c.action, m.audit.c.actor_id, m.audit.c.interface)
                    .where(m.audit.c.entity_id == household_id)
                    .order_by(m.audit.c.id)
                )
            ).all()
        assert [tuple(row) for row in audit] == [
            ("add_member", owner["id"], "browser"),
            ("create_tag", owner["id"], "direct_api"),
            ("create_tag", member["id"], "browser"),
            ("create_tag", member["id"], "direct_api"),
            ("edit_agent_settings", owner["id"], "browser"),
        ]

        # Removal takes effect on the member's next request, through every
        # credential, and only for that member.
        removed = await owner_web.delete(f"{members}/{member_row}")
        assert [r["role"] for r in removed.json()["members"]] == ["owner"]
        assert await entity_roles(member_web) == {}
        assert (await member_api.get(tags)).status_code == 404
        assert (await tag(member_web, "Synthetic after removal")).status_code == 404
        assert (await owner_web.get(tags)).status_code == 200
        gone = await owner_web.delete(f"{members}/{member_row}")
        assert gone.json()["detail"]["code"] == "member_not_found"
        replay = await member_web.post(
            f"{agent}/conversations/messages", data=turn, headers=turn_key
        )
        assert replay.status_code == 404

        # A member's write that waits on the Entity lock while the owner's
        # removal commits is refused, not applied.
        readded = await owner_web.post(members, json=add)
        member_row = readded.json()["members"][1]["id"]
        async with sessions() as db, db.begin():
            await db.execute(
                select(m.entities.c.id)
                .where(m.entities.c.id == household_id)
                .with_for_update()
            )
            waiting = asyncio.create_task(tag(member_api, "Synthetic racing tag"))
            await asyncio.sleep(0.5)
            assert not waiting.done()
            await db.execute(
                delete(m.members).where(m.members.c.uuid == UUID(member_row))
            )
        assert (await waiting).status_code == 404
        names = {t["name"] for t in (await owner_web.get(tags)).json()}
        assert "Synthetic racing tag" not in names

        # A member can leave on their own, but cannot remove anyone else.
        rejoined = await owner_web.post(members, json=add)
        member_row = rejoined.json()["members"][1]["id"]
        assert (await member_web.delete(f"{members}/{member_row}")).json() == {
            "left": True
        }
        assert await entity_roles(member_web) == {}
        async with sessions() as db:
            last = (
                await db.execute(
                    select(m.audit.c.action, m.audit.c.actor_id)
                    .where(m.audit.c.entity_id == household_id)
                    .order_by(m.audit.c.id.desc())
                    .limit(1)
                )
            ).one()
        assert tuple(last) == ("remove_member", member["id"])
    await engine.dispose()
