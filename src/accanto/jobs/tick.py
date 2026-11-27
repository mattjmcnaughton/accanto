"""Run one finite tick of scheduled steps: ``python -m accanto.jobs.tick``.

After aleph's jobs/tick.py. Each step is independent and has its own deadline
(`job_tick_step_timeout`): a step that fails or runs out of time is logged and
the next step still runs. The exit status is 1 when any step failed, so the
scheduler can see it. The tick starts no HTTP server and no reconciler.

A step is an async function returning counts. Logs carry the step name, counts,
outcome and error type only (Constitution §6). See TDD 11 for how the Box runs
it on a schedule.
"""

import asyncio
import time
from collections.abc import Awaitable, Callable, Sequence

import structlog

from accanto import db
from accanto.config import settings
from accanto.logging import configure_logging
from accanto.repositories import agent as conversations

log = structlog.get_logger(__name__)

TickStep = tuple[str, Callable[[], Awaitable[dict[str, int]]]]


async def run_steps(steps: Sequence[TickStep], *, timeout: float) -> int:
    """Run every step in order; one failure or timeout cannot skip the next."""
    failed = False
    log.info("job_tick_started", steps=len(steps))
    for name, step in steps:
        started = time.perf_counter()
        try:
            async with asyncio.timeout(timeout):
                counts = await step()
            outcome = "failed" if counts.get("failed") else "succeeded"
            failed |= outcome == "failed"
            log.info(
                "job_tick_step",
                step=name,
                outcome=outcome,
                counts=counts,
                ms=round((time.perf_counter() - started) * 1000),
            )
        except Exception as error:
            failed = True
            log.warning(
                "job_tick_step",
                step=name,
                outcome="failed",
                error=type(error).__name__,
                ms=round((time.perf_counter() - started) * 1000),
            )
    log.info("job_tick_finished", failed=failed)
    return int(failed)


async def conversation_retention() -> dict[str, int]:
    """Delete expired assistant conversations for everyone (TDD 08 retention)."""
    async with db.async_session() as session, session.begin():
        return {"deleted": await conversations.purge_expired(session)}


async def scheduled_entries() -> dict[str, int]:
    """Stage every due Entry schedule date in the inbox once, as its owner (TDD 18)."""
    from accanto.services.schedules import stage_due

    return await stage_due(db.async_session)


STEPS: list[TickStep] = [
    ("conversation_retention", conversation_retention),
    ("scheduled_entries", scheduled_entries),
]


async def main() -> int:
    configure_logging()
    try:
        return await run_steps(STEPS, timeout=settings.job_tick_step_timeout)
    finally:
        await db.engine.dispose()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
