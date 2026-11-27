"""Operator-only bootstrap of an already admitted identity; not public registration.

Run in a trusted terminal. The key is printed once and must not be sent to logs.
Browser users do not need it: an allowlisted email's first sign-in creates its
User and its own Entity. Without --entity, that User gets one on next sign-in.
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
    if args.entity is not None:
        ZoneInfo(args.time_zone)
    async with async_session() as session, session.begin():
        user_id, user_uuid = (
            await session.execute(
                insert(users)
                .values(issuer=args.issuer, subject=args.subject)
                .returning(users.c.id, users.c.uuid)
            )
        ).one()
        entity_uuid = None
        if args.entity is not None:
            entity_uuid = await session.scalar(
                insert(entities)
                .values(owner_id=user_id, name=args.entity, time_zone=args.time_zone)
                .returning(entities.c.uuid)
            )
        key = await issue_key(session, user_id, "Initial operator key")
    await engine.dispose()
    print(
        json.dumps(
            {
                "user_id": str(user_uuid),
                "entity_id": entity_uuid and str(entity_uuid),
                **key,
            }
        )
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("issuer", "subject"):
        parser.add_argument(f"--{name}", required=True)
    parser.add_argument("--entity", help="Name of a first Entity to create")
    parser.add_argument("--time-zone", help="That Entity's time zone (IANA)")
    arguments = parser.parse_args()
    if (arguments.entity is None) != (arguments.time_zone is None):
        parser.error("--entity and --time-zone go together")
    asyncio.run(bootstrap(arguments))
