"""The FIRE number interview over HTTP with the stub model and real PostgreSQL.

The assistant starts from the latest saved Plan version's fixed costs, asks
four questions one per reply, explains the FIRE number and saves the FIRE
assumptions only after the owner approves, following the Agent mode: Read only
refuses, Ask first drafts a Pending change. Synthetic data only; figures are
worked out by hand in the comments.
"""

import asyncio
import os
from uuid import uuid4

import httpx
import pytest
from pydantic import SecretStr
from sqlalchemy import insert, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from accanto.app import create_app
from accanto.config import settings
from accanto.db import get_session
from accanto.models import monthly as m
from accanto.services.access import issue_session
from accanto.services.api_keys import issue_key
from accanto.services.browser_auth import csrf_token
from tests.integration.test_agent_turns import frames

URL = os.environ.get("ACCANTO_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="Requires isolated Postgres")
PROMPT = (
    "Interview me for my FIRE number: ask one question at a time, starting "
    "from my Plan's fixed costs, then propose FIRE assumptions to save."
)


def test_fire_interview_saves_assumptions_per_agent_mode():
    asyncio.run(scenario())


async def scenario():
    assert URL and URL.rsplit("/", 1)[-1].endswith("_test")
    engine = create_async_engine(URL)
    sessions = async_sessionmaker(engine)
    async with sessions() as db, db.begin():
        user = await db.scalar(
            insert(m.users)
            .values(issuer="fire-interview-test", subject=str(uuid4()))
            .returning(m.users.c.id)
        )
        entity = await db.scalar(
            insert(m.entities)
            .values(owner_id=user, name="Synthetic FIRE Entity", time_zone="UTC")
            .returning(m.entities.c.uuid)
        )
        key = await issue_key(db, user, "Synthetic FIRE key")
        browser = await issue_session(db, user)

    config = settings.model_copy(
        update={
            "browser_origin": "http://test",
            "browser_csrf_secret": SecretStr("synthetic-fire-csrf-secret-long-enough"),
            "agent_model": "stub",
            "agent_daily_message_cap": 40,
        }
    )
    app = create_app()
    app.state.auth_settings = config
    app.state.sessions = sessions

    async def dependency():
        async with sessions() as db:
            yield db

    app.dependency_overrides[get_session] = dependency
    prefix = f"/api/entities/{entity}"
    headers = {
        "Origin": "http://test",
        "X-CSRF-Token": csrf_token(browser["token"], config),
    }
    transport = httpx.ASGITransport(app=app)
    async with (
        httpx.AsyncClient(
            transport=transport,
            base_url="http://test",
            cookies={"accanto_session": browser["token"]},
        ) as client,
        httpx.AsyncClient(transport=transport, base_url="http://test") as api,
    ):

        async def keyed(method, path, body=None):
            response = await api.request(
                method,
                prefix + path,
                json=body,
                headers={
                    "Authorization": f"Bearer {key['key']}",
                    "Idempotency-Key": str(uuid4()),
                },
            )
            assert response.status_code == 200, response.text
            return response.json()

        async def mode(value):
            current = (await client.get(prefix + "/agent/settings")).json()
            saved = await client.put(
                prefix + "/agent/settings",
                json={
                    "enabled": True,
                    "mode": value,
                    "instructions": "",
                    "expected_revision": current["revision"],
                },
                headers={**headers, "Idempotency-Key": str(uuid4())},
            )
            assert saved.status_code == 200, saved.text

        async def say(text):
            response = await client.post(
                prefix + "/agent/conversation/messages",
                data={"content": text},
                headers=headers,
            )
            events = frames(response.text)
            assert events[-1][0] == "done", response.text
            reply = "".join(d["text"] for name, d in events if name == "delta")
            drafted = [d for name, d in events if name == "pending_change"]
            return reply, drafted

        await mode("ask_first")
        # Fixed costs a month: 1850.00 + 240.00 + 1440.00 / 12 = 2210.00.
        plan = await keyed(
            "POST",
            "/plans",
            {
                "name": "Synthetic FIRE Plan",
                "incomes": [{"name": "Synthetic pay", "amount": "6000.00"}],
                "spending": "900.00",
                "fixed_costs": [
                    {
                        "name": "Synthetic mortgage",
                        "amount": "1850.00",
                        "frequency": "monthly",
                    },
                    {
                        "name": "Synthetic utilities",
                        "amount": "240.00",
                        "frequency": "monthly",
                    },
                    {
                        "name": "Synthetic insurance",
                        "amount": "1440.00",
                        "frequency": "annual",
                    },
                ],
            },
        )
        await keyed(
            "POST", f"/plans/{plan['plan_id']}/versions", {"expected_revision": 1}
        )
        before = await keyed("GET", "/fire-assumptions")
        assert before["annual_spending"] is None

        async def level():
            """Names of the Entity's Fixed costs held level, by the database."""
            async with sessions() as db:
                return set(
                    await db.scalars(
                        select(m.fixed_costs.c.name)
                        .join(m.entities, m.entities.c.id == m.fixed_costs.c.entity_id)
                        .where(
                            m.entities.c.uuid == entity,
                            m.fixed_costs.c.rises_with_inflation.is_(False),
                        )
                    )
                )

        assert await level() == set()

        # Question 1 lists the saved version's costs; nothing is retyped.
        first, _ = await say(PROMPT)
        assert "1 of 4" in first
        assert "Synthetic insurance: 1440.00 annual, 120.00 a month" in first
        assert "Total **2210.00 a month**" in first
        for answer, step in (
            ("Yes, all correct.", "2 of 4"),
            ("Nothing changes.", "3 of 4"),
            ("Synthetic mortgage is fixed rate.", "4 of 4"),
        ):
            reply, drafted = await say(answer)
            assert step in reply and not drafted

        # (2210.00 + 1790.00) x 12 = 48000.00; 48000.00 / 4% = 1200000.00.
        proposal, drafted = await say("$1,790 a month.")
        assert "**48000.00**" in proposal and "1200000.00" in proposal
        assert "Does not rise with inflation: Synthetic mortgage\n" in proposal
        assert "at 3.00% a year" in proposal
        assert "Shall I save it?" in proposal and not drafted

        # Read only refuses the save and records nothing.
        await mode("read_only")
        refused, drafted = await say("Yes, save it.")
        assert "could not save" in refused and not drafted
        assert (await keyed("GET", "/fire-assumptions"))["annual_spending"] is None

        # Ask first drafts one Pending change; applying it saves the spending.
        await mode("ask_first")
        reply, drafted = await say("Yes, save it.")
        assert "pending change" in reply
        (change,) = drafted
        assert change["tool"] == "save_fire_assumptions"
        assert change["input"]["annual_spending"] == "48000.00"
        # Only the cost the owner named is held level, by id; the card names it.
        (mortgage_id,) = change["input"]["fixed_costs_not_rising_with_inflation"]
        listed = (await client.get(prefix + "/agent/pending-changes")).json()
        assert listed[0]["labels"][mortgage_id] == "Synthetic mortgage"
        assert await level() == set()
        assert (await keyed("GET", "/fire-assumptions"))["annual_spending"] is None
        applied = await client.post(
            prefix + f"/agent/pending-changes/{change['id']}/apply",
            json={"input": None},
            headers=headers,
        )
        assert applied.status_code == 200, applied.text
        after = await keyed("GET", "/fire-assumptions")
        assert (after["annual_spending"], after["withdrawal_percent"]) == (
            "48000.00",
            "4.00",
        )
        assert await level() == {"Synthetic mortgage"}
    await engine.dispose()
