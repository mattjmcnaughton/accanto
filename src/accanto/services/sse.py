"""Server-sent events framing, as in aleph's services/sse.py.

A data line ends at the first line break; serializing the payload as JSON keeps
every frame on one line, so only this module writes frame boundaries.
"""

import json

SSE_MEDIA_TYPE = "text/event-stream"
SSE_HEADERS = {"Cache-Control": "no-store", "X-Accel-Buffering": "no"}


def sse_event(name: str, data: dict) -> str:
    return f"event: {name}\ndata: {json.dumps(data, separators=(',', ':'))}\n\n"


def sse_heartbeat() -> str:
    return ": ping\n\n"
