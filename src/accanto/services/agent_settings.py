"""Agent enablement, Agent mode and AGENT.md per Entity (TDD 03).

Only a browser session may read or change these (the routers enforce it); no
agent tool reaches them, so an agent cannot widen its own permissions.
"""

from sqlalchemy import insert, select, update

from accanto.models import agent as a
from accanto.services.access import RejectionError
from accanto.services.monthly import authorize, check_revision, write

# read_only rejects every agent write; ask_first drafts each as a Pending
# change; apply_directly runs them (irreversible deletes still pend).
MODES = ("read_only", "ask_first", "apply_directly")
DEFAULTS = {"enabled": False, "mode": "ask_first", "instructions": "", "revision": 0}
MAX_INSTRUCTIONS = 20_000


async def current(session, entity_id) -> dict:
    """Settings inside the caller's transaction; defaults until first saved."""
    row = (
        (
            await session.execute(
                select(a.settings).where(a.settings.c.entity_id == entity_id)
            )
        )
        .mappings()
        .first()
    )
    if row is None:
        return dict(DEFAULTS)
    return {key: row[key] for key in DEFAULTS}


async def mode(session, entity_id) -> str:
    return (await current(session, entity_id))["mode"]


async def read_settings(session, actor, entity_uuid) -> dict:
    async with session.begin():
        _, entity = await authorize(session, actor, entity_uuid, lock=False)
        return await current(session, entity["id"])


async def update_settings(session, actor, entity_uuid, request_key, payload):
    return await write(
        session, actor, entity_uuid, "edit_agent_settings", request_key, payload
    )


async def write_agent_settings(session, entity, payload, audit):
    """Dispatched by monthly.write() under the Entity lock; audited like edits."""
    if payload["mode"] not in MODES:
        raise RejectionError(
            "invalid_settings", "Choose read_only, ask_first or apply_directly.", 422
        )
    if len(payload["instructions"]) > MAX_INSTRUCTIONS:
        raise RejectionError(
            "invalid_settings", "AGENT.md is limited to 20,000 characters.", 422
        )
    before = await current(session, entity["id"])
    check_revision(before, payload["expected_revision"])
    values = {
        "enabled": payload["enabled"],
        "mode": payload["mode"],
        "instructions": payload["instructions"],
        "revision": before["revision"] + 1,
    }
    if before["revision"] == 0:
        statement = (
            insert(a.settings)
            .values(entity_id=entity["id"], **values)
            .returning(a.settings)
        )
    else:
        statement = (
            update(a.settings)
            .where(a.settings.c.entity_id == entity["id"])
            .values(**values)
            .returning(a.settings)
        )
    record = (await session.execute(statement)).mappings().one()
    after = {key: record[key] for key in DEFAULTS}
    await audit(a.settings, record["uuid"], before, after)
    return after
