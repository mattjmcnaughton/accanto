"""Measure SQL at the HTTP boundary without collecting SQL or bind values."""

from sqlalchemy import event


async def counted_get(client, engine, path):
    statements = 0

    def count(*_):
        nonlocal statements
        statements += 1

    event.listen(engine.sync_engine, "before_cursor_execute", count)
    try:
        response = await client.get(path)
        response.raise_for_status()
        return response.json(), statements
    finally:
        event.remove(engine.sync_engine, "before_cursor_execute", count)
