"""Job run persistence: start, claim with a lease, settle, cancel (TDD 11).

After aleph's repositories/_generation.py. The lease and its stale cutoff are
both evaluated on the database clock (`now()`), so processes with skewed wall
clocks agree on when a claim has gone stale. A run is claimable when it is
queued, or running with a lease older than `stale_after` seconds (its process
crashed or was stopped mid-step). Every claim increments `claims`; settling a
step requires the claim it was given, so a step whose lease was taken over can
never overwrite the newer claim's outcome.
"""

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert

from accanto.models import jobs as j

r = j.runs


@dataclass(frozen=True)
class JobRun:
    """A claimed run, as its step handler sees it."""

    id: int
    uuid: UUID
    entity_id: int
    kind: str
    user_id: int | None
    credential_kind: str | None
    credential_uuid: UUID | None
    claims: int
    steps: int
    counts: dict[str, int]


def stale_cutoff(stale_after: float):
    """The database-clock instant before which a running lease is stale."""
    return func.now() - func.make_interval(0, 0, 0, 0, 0, 0, stale_after)


def claimable(stale_after: float):
    return or_(
        r.c.state == "queued",
        and_(r.c.state == "running", r.c.claimed_at < stale_cutoff(stale_after)),
    )


async def start(
    session,
    entity_id: int,
    kind: str,
    user_id: int | None = None,
    credential: tuple[str, UUID] | None = None,
):
    """Queue a run, or return the active one for this Entity and kind.

    Returns (uuid, created). The partial unique index `job_run_active` keeps one
    queued or running run per Entity and kind, so starting twice is safe.
    """
    created = await session.scalar(
        pg_insert(r)
        .values(
            entity_id=entity_id,
            kind=kind,
            user_id=user_id,
            credential_kind=credential[0] if credential else None,
            credential_uuid=credential[1] if credential else None,
        )
        .on_conflict_do_nothing(
            index_elements=[r.c.entity_id, r.c.kind],
            index_where=r.c.state.in_(j.ACTIVE),
        )
        .returning(r.c.uuid)
    )
    if created is not None:
        return created, True
    active = await session.scalar(
        select(r.c.uuid).where(
            r.c.entity_id == entity_id, r.c.kind == kind, r.c.state.in_(j.ACTIVE)
        )
    )
    return active, False


async def claim(session, kinds, *, stale_after: float) -> JobRun | None:
    """Claim the oldest claimable run of these kinds for one step, or None.

    `FOR UPDATE SKIP LOCKED` lets concurrent claimers pass over a row another
    claimer is taking, and the UPDATE re-checks nothing else: the locked row was
    claimable when selected and nobody else can change it until commit.
    """
    if not kinds:
        return None
    target = (
        select(r.c.id)
        .where(r.c.kind.in_(kinds), claimable(stale_after))
        .order_by(r.c.updated_at, r.c.id)
        .limit(1)
        .with_for_update(skip_locked=True)
        .scalar_subquery()
    )
    row = (
        await session.execute(
            update(r)
            .where(r.c.id == target)
            .values(
                state="running",
                claimed_at=func.now(),
                claims=r.c.claims + 1,
                updated_at=func.now(),
            )
            .returning(
                r.c.id,
                r.c.uuid,
                r.c.entity_id,
                r.c.kind,
                r.c.user_id,
                r.c.credential_kind,
                r.c.credential_uuid,
                r.c.claims,
                r.c.steps,
                r.c.counts,
            )
        )
    ).one_or_none()
    return JobRun(**row._mapping) if row else None


async def settle(
    session,
    run: JobRun,
    *,
    counts: dict[str, int],
    state: str,
    error_code: str | None = None,
) -> bool:
    """Record one step's outcome under the claim it ran with.

    state: "queued" (more steps to do; releases the lease), "succeeded" or
    "failed". Counts add to the run's totals. Returns False, changing nothing,
    when the claim is no longer current: the lease went stale and another
    process claimed the run, or the run was cancelled.
    """
    current = await session.scalar(
        select(r.c.counts)
        .where(r.c.id == run.id, r.c.claims == run.claims, r.c.state == "running")
        .with_for_update()
    )
    if current is None:
        return False
    total = dict(current)
    for key, value in counts.items():
        total[key] = total.get(key, 0) + value
    finished = func.now() if state != "queued" else None
    await session.execute(
        update(r)
        .where(r.c.id == run.id)
        .values(
            state=state,
            claimed_at=None,
            steps=r.c.steps + 1,
            counts=total,
            error_code=error_code,
            updated_at=func.now(),
            finished_at=finished,
        )
    )
    return True


async def release(session, run: JobRun) -> bool:
    """Give up a claim without finishing its step, so it is claimable now.

    Used at shutdown for steps that were cancelled mid-flight. A no-op when the
    claim is no longer current.
    """
    released = await session.scalar(
        update(r)
        .where(r.c.id == run.id, r.c.claims == run.claims, r.c.state == "running")
        .values(state="queued", claimed_at=None, updated_at=func.now())
        .returning(r.c.id)
    )
    return released is not None


async def cancel(session, entity_id: int, run_uuid: UUID) -> bool:
    """Stop an active run. A step in flight finishes but cannot settle."""
    cancelled = await session.scalar(
        update(r)
        .where(
            r.c.entity_id == entity_id,
            r.c.uuid == run_uuid,
            r.c.state.in_(j.ACTIVE),
        )
        .values(
            state="cancelled",
            claimed_at=None,
            updated_at=func.now(),
            finished_at=func.now(),
        )
        .returning(r.c.id)
    )
    return cancelled is not None


async def read(session, entity_id: int, run_uuid: UUID):
    """A run's progress for its owner's poll: state, steps, counts, error code."""
    row = (
        await session.execute(
            select(
                r.c.uuid,
                r.c.kind,
                r.c.state,
                r.c.steps,
                r.c.counts,
                r.c.error_code,
                r.c.created_at,
                r.c.finished_at,
            ).where(r.c.entity_id == entity_id, r.c.uuid == run_uuid)
        )
    ).one_or_none()
    return dict(row._mapping) if row else None


async def latest(session, entity_id: int, kind: str):
    """The Entity's newest run of this kind, as read() shows it, or None."""
    run_uuid = await session.scalar(
        select(r.c.uuid)
        .where(r.c.entity_id == entity_id, r.c.kind == kind)
        .order_by(r.c.id.desc())
        .limit(1)
    )
    return None if run_uuid is None else await read(session, entity_id, run_uuid)
