"""Read current settings under the shared credential and Entity locks."""

from datetime import UTC, datetime

from accanto.domains.entity import entity_today
from accanto.services.monthly import authorize


async def read_settings(session, actor, entity_uuid, *, instant=None):
    async with session.begin():
        _, entity = await authorize(session, actor, entity_uuid, lock=True)
        return {
            "id": str(entity["uuid"]),
            "name": entity["name"],
            "time_zone": entity["time_zone"],
            "revision": entity["revision"],
            "today": entity_today(
                instant or datetime.now(UTC), entity["time_zone"]
            ).isoformat(),
        }
