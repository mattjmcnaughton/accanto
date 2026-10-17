"""Operator-only bootstrap of an already admitted identity; not public registration.

Run in a trusted terminal. The key is printed once and must not be sent to logs.
"""

import argparse
import asyncio
import json
from zoneinfo import ZoneInfo

from sqlalchemy import insert

from accanto.db import async_session, engine
from accanto.models.monthly import entities, users
from accanto.services.api_keys import issue_key


async def bootstrap(args):
    ZoneInfo(args.time_zone)
    async with async_session() as session, session.begin():
        user_id = await session.scalar(
            insert(users)
            .values(issuer=args.issuer, subject=args.subject)
            .returning(users.c.id)
        )
        entity_uuid = await session.scalar(
            insert(entities)
            .values(owner_id=user_id, name=args.entity, time_zone=args.time_zone)
            .returning(entities.c.uuid)
        )
        key = await issue_key(session, user_id, "Initial operator key")
    await engine.dispose()
    print(json.dumps({"entity_id": str(entity_uuid), **key}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("issuer", "subject", "entity", "time-zone"):
        parser.add_argument(f"--{name}", required=True)
    asyncio.run(bootstrap(parser.parse_args()))
