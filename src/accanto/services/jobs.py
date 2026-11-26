"""Background job runs: an in-process reconciler that advances leased runs (TDD 11).

After aleph's services/lifecycle.py. The FastAPI lifespan starts one JobRunner
and stops it on shutdown. Every `job_reconciler_interval` seconds it claims
queued job runs (repositories/jobs.py) and runs one step of each as a task:

- A step is one bounded unit of work, such as proposals for the next 25 waiting
  inbox items. Its handler returns counts and whether the run is done; the run
  goes back to queued for its next step otherwise.
- The task registry holds a strong reference to every step task, so none is
  garbage-collected mid-flight, and shutdown cancels them all.
- A semaphore (`job_concurrent_steps`) bounds concurrent steps, which may call a
  model. The permit is taken before the claim, so a claimed run never waits for
  a permit while its lease ages.
- A step cancelled by shutdown releases its claim. A crashed process cannot, so
  its lease goes stale after `job_stale_after` seconds and the run is claimed
  again. Handlers must therefore be safe to repeat for the same input.

A job owner adds a kind by adding a handler to HANDLERS and starting runs with
repositories.jobs.start. Logs carry the kind, run UUID, outcome, error code,
counts and ms only (Constitution §6).
"""

import asyncio
import contextlib
import time
from collections.abc import Awaitable, Callable, Coroutine, Mapping
from dataclasses import dataclass, field
from typing import Any

import structlog

from accanto.repositories import jobs
from accanto.repositories.jobs import JobRun

log = structlog.get_logger(__name__)


@dataclass(frozen=True)
class Step:
    """One step's outcome: counts to add to the run, and whether it is done."""

    counts: dict[str, int] = field(default_factory=dict)
    done: bool = True


StepHandler = Callable[[JobRun], Awaitable[Step]]

# Job kinds this process advances. Empty until a job owner adds one, such as
# "inbox_proposals" (TDD 11, first users).
HANDLERS: dict[str, StepHandler] = {}


class TaskRegistry:
    """Strong references to spawned tasks; cancelled together at shutdown."""

    def __init__(self) -> None:
        self._tasks: set[asyncio.Task[Any]] = set()

    def spawn(self, coro: Coroutine[Any, Any, Any]) -> asyncio.Task[Any]:
        task = asyncio.create_task(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return task

    def __len__(self) -> int:
        return len(self._tasks)

    async def join(self) -> None:
        """Wait for every task, including ones spawned while waiting."""
        while self._tasks:
            await asyncio.gather(*list(self._tasks), return_exceptions=True)

    async def cancel_all(self) -> None:
        tasks = list(self._tasks)
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)


class JobRunner:
    """The reconciler loop, its task registry and its step limit."""

    def __init__(self, config, sessions, handlers: Mapping[str, StepHandler]):
        self.config, self.sessions = config, sessions
        self.handlers = dict(handlers)
        self.registry = TaskRegistry()
        self.slots = asyncio.Semaphore(config.job_concurrent_steps)
        self._loop: asyncio.Task[Any] | None = None

    async def start(self) -> None:
        if self._loop is not None:
            raise RuntimeError("JobRunner already started")
        self._loop = asyncio.create_task(self.run_forever())

    async def stop(self) -> None:
        """Stop claiming first, then cancel steps in flight (they release)."""
        if self._loop is not None:
            self._loop.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._loop
            self._loop = None
        await self.registry.cancel_all()

    async def run_forever(self) -> None:
        while True:
            await asyncio.sleep(self.config.job_reconciler_interval)
            try:
                await self.tick()
            except Exception as error:  # one bad pass must not stop the loop
                log.warning("job_reconciler_failed", error=type(error).__name__)

    async def tick(self) -> int:
        """Claim and dispatch runs while step permits are free; returns how many."""
        dispatched = 0
        while self.handlers and not self.slots.locked():
            await self.slots.acquire()
            try:
                async with self.sessions() as session, session.begin():
                    run = await jobs.claim(
                        session,
                        list(self.handlers),
                        stale_after=self.config.job_stale_after,
                    )
            except BaseException:
                self.slots.release()
                raise
            if run is None:
                self.slots.release()
                break
            self.registry.spawn(self._step(run))
            dispatched += 1
        return dispatched

    async def _step(self, run: JobRun) -> None:
        started = time.perf_counter()
        try:
            state, counts, code = "failed", {}, None
            try:
                async with asyncio.timeout(self.config.job_step_timeout):
                    step = await self.handlers[run.kind](run)
                state = "succeeded" if step.done else "queued"
                counts = {str(k): int(v) for k, v in step.counts.items()}
            except TimeoutError:
                code = "step_timeout"
            except asyncio.CancelledError:
                await self._release(run)
                log.info("job_step", kind=run.kind, run_id=str(run.uuid),
                         outcome="released")  # fmt: skip
                raise
            except Exception as error:
                code = "step_failed"
                log.warning("job_step_error", kind=run.kind, run_id=str(run.uuid),
                            error=type(error).__name__)  # fmt: skip
            async with self.sessions() as session, session.begin():
                settled = await jobs.settle(
                    session, run, counts=counts, state=state, error_code=code
                )
            log.info(
                "job_step",
                kind=run.kind,
                run_id=str(run.uuid),
                outcome=state if settled else "superseded",
                code=code,
                counts=counts,
                ms=round((time.perf_counter() - started) * 1000),
            )
        finally:
            self.slots.release()

    async def _release(self, run: JobRun) -> None:
        """Best effort: if this fails, the lease goes stale and is reclaimed."""
        with contextlib.suppress(Exception):
            async with asyncio.timeout(5):
                async with self.sessions() as session, session.begin():
                    await jobs.release(session, run)
