# 11 — Background jobs: job runs and the scheduled tick

Status: Implemented (infrastructure only; no job kind yet)
Updated: 2026-11-26

## Purpose and scope

Accanto had no background work: the only task outside a request streams one
agent reply (`services/agent.py`), sync is manual ([TDD 02](02-transactions-inbox.md)
T3), and the Box runs one uvicorn `web` service. Two planned features need work
that outlives a request:

- **Agent proposal run** over the Transactions inbox: proposals for about 150
  waiting items, 25 per step, that continues when the tab closes and resumes
  after a crash ([inbox batch design](https://ampcode.com/artifacts/inbox-batch-processing-analysis-and-design-4be75e03-dd63-494e-bfce-b1f073d99e12),
  section 2.4).
- **Scheduled YNAB sync**, replacing manual-only T3.

This design adds the shared infrastructure, following two patterns from aleph
(`services/lifecycle.py`, `repositories/_generation.py`, `jobs/tick.py`), and
builds neither feature. Read with the [constitution](../../CONSTITUTION.md) and
[architecture](../architecture.md).

**Constitution §5 decision.** A background loop, a new table and a scheduled
process are a substantial architectural commitment. The owner decided on
2026-11-26 to adopt them now as prework for the two features above. This
records that decision. No new paid service is added: both pieces run in the
existing application process and Box.

Excluded: the proposal run and scheduled sync themselves, their API, UI and
agent tools, and retries with backoff.

## Workflows and domain rules

No domain impact. A job run is operational state: it is not financial activity,
never contributes to totals, and has no audit history. A step changes financial
records only through existing commands (for example `propose` or `sync` in
`services/inbox.py`), which keep their own authorization, rules, audit and
atomicity. No domain rule in [CONTEXT.md](../../CONTEXT.md) changes.

Each future job owner's TDD states the rules its steps enforce, including how a
step is safe to repeat (see the lease below).

## Implementation and data

### Two mechanisms

| | In-process reconciler | Finite tick |
| --- | --- | --- |
| For | Work someone starts, in steps, possibly long: the proposal run | Periodic work with no starter: scheduled sync, retention |
| Runs in | The web process, started and stopped by the FastAPI lifespan | `python -m accanto.jobs.tick`, a separate short-lived process |
| State | One `job_run` row per run, leased per step | None of its own; each step owns its state |
| Code | `services/jobs.py`, `repositories/jobs.py` | `jobs/tick.py` |

A tick step may also *start* job runs (for example one `ynab_sync` run per
connected source); the web process's reconciler then advances them. That keeps
model calls and long work under one concurrency bound.

### `job_run` table (migration `6i029`)

| Column | Meaning |
| --- | --- |
| `id`, `uuid` | Identity, as on every table |
| `entity_id` | The Entity the run works on. Every run belongs to one Entity. |
| `kind` | Handler name, such as `inbox_proposals` (`String(80)`) |
| `user_id` | Who started it; null for a scheduled run |
| `state` | `queued`, `running`, `succeeded`, `failed`, `cancelled` |
| `claimed_at` | Lease start, from the database clock; set only while `running` (check constraint) |
| `claims` | Fencing token, incremented by every claim |
| `steps` | Steps settled so far |
| `counts` | JSONB counts summed over steps, such as `{"proposed": 45}`. Counts only. |
| `error_code` | Fixed code: `step_failed` or `step_timeout` |
| `created_at`, `updated_at`, `finished_at` | Timestamps (UTC) |

The partial unique index `job_run_active (entity_id, kind) WHERE state IN
('queued','running')` keeps at most one active run per Entity and kind, so
pressing "Propose" twice, or two ticks, start one run.

### Lease protocol (`repositories/jobs.py`)

- **`start(session, entity_id, kind, user_id=None) -> (uuid, created)`**
  queues a run, or returns the active one.
- **`claim(session, kinds, stale_after=) -> JobRun | None`** picks the
  least-recently-updated claimable run of those kinds with `FOR UPDATE SKIP
  LOCKED` and sets `state='running'`, `claimed_at=now()`, `claims+1`. Claimable
  means `queued`, or `running` with `claimed_at < now() - stale_after`. Both
  sides of that comparison use the database clock, as in aleph, so processes
  with skewed clocks agree.
- **`settle(session, run, counts=, state=, error_code=) -> bool`** records a
  step: `queued` (more to do, lease released), `succeeded` or `failed`. It adds
  counts and only applies while `claims` still equals the claim the step ran
  with and the run is `running`. A step whose lease went stale and was claimed
  again, or a cancelled run, returns `False` and changes nothing.
- **`release(session, run)`** puts a claimed run back to `queued` (used at
  shutdown). **`cancel(session, entity_id, uuid)`** and **`read(session,
  entity_id, uuid)`** are the Entity-scoped calls a future API uses to stop a
  run and to poll its progress.

### Reconciler (`services/jobs.py`)

`JobRunner(config, sessions, handlers)` is created in the lifespan with the
module-level `HANDLERS` dict. Every `JOB_RECONCILER_INTERVAL` seconds (default
5) `tick()` claims runs while a step permit is free and spawns one step per run:

- The **task registry** holds strong references to step tasks and cancels them
  at shutdown.
- A **semaphore** of `JOB_CONCURRENT_STEPS` (default 1) bounds steps that call
  a model. It is taken before the claim, so a claimed run never waits for a
  permit while its lease ages. It is separate from the chat reply limit
  (`agent_concurrent_replies`), so background work never makes the owner wait
  for a reply.
- Each step runs with a `JOB_STEP_TIMEOUT` deadline (default 240 s), outside any
  transaction; claim and settle are short transactions of their own.
- A handler exception fails the run with `step_failed`; a timeout with
  `step_timeout`. No message is stored or logged.
- **Shutdown** stops the loop first, then cancels steps in flight; each
  releases its claim, so the next process claims it at once. A crashed process
  cannot release, so its lease goes stale after `JOB_STALE_AFTER` (default
  600 s, comfortably above the step timeout) and the run is claimed again.
  Handlers must therefore be safe to repeat: the proposal step chooses "the next
  25 waiting items with no proposal", so a repeated step re-proposes at most the
  items a crashed step had not settled.

With no handlers registered, as now, the loop runs no query.

### Adding a job kind

```python
# services/jobs.py
async def propose_step(run: JobRun) -> Step:
    ...  # own sessions; existing commands; at most 25 items
    return Step({"proposed": n}, done=n == 0)


HANDLERS["inbox_proposals"] = propose_step

# the router or service that starts it, inside its transaction:
run_uuid, created = await jobs.start(session, entity_id, "inbox_proposals", user_id)
```

The owner's TDD then adds the API to start, poll (`read`) and cancel a run,
with the Entity authorization every route uses, and the UI.

### Finite tick (`jobs/tick.py`)

`run_steps(steps, timeout=)` runs `(name, async () -> counts)` steps in order,
each under `JOB_TICK_STEP_TIMEOUT` (default 300 s). A step that raises or times
out is logged with its error type and the next step still runs. The process
exits 1 when any step failed (or returned a nonzero `failed` count), so a
scheduler can alert. It starts no HTTP server and no reconciler.

The first step is `conversation_retention`, which deletes every expired
assistant conversation (`repositories/agent.purge_expired`). TDD 08's 30-day
retention otherwise runs only when the owner reads their conversations, so
conversations of an Entity nobody opens again were kept indefinitely. This step
proves the tick end to end without new behavior.

The second step, `scheduled_entries`, stages due dates of Entry schedules in
the Transactions inbox ([TDD 18](18-entry-schedules.md)). It is safe to repeat:
each date is staged under the Entity lock only while it is the schedule's next
date, and a unique key per schedule and date keeps it to one staging.

A job owner adds a scheduled step by appending to `STEPS`.

### Running the tick on the Box

Amp Boxes have no job scheduler; a Box's run schedule only switches the whole
machine on and off daily. The owner chose (2026-11-26) a second service,
`jobs`, in `.amp/box.yaml`:

```yaml
jobs:
  cwd: box-release
  env:
    PYTHONPATH: site
    PYTHONNOUSERSITE: "1"
    PGSSLROOTCERT: site/certifi/cacert.pem
  command: >-
    sh -c 'sleep 60; python/bin/python3 -m accanto.jobs.tick; exec sleep 3600'
```

- Each Box service is a systemd unit that restarts when it exits. The command
  runs one tick and then sleeps an hour, so the restart makes it hourly, and a
  failing tick still waits an hour instead of restarting in a tight loop.
- Every deploy restarts the unit, so a tick runs about a minute after each
  deploy. The 60 s wait comes first because a deploy starts `web` and `jobs`
  together on a freshly unpacked release: both import the app cold on the
  b1.small's one sustained vCPU, and `web` took 10 s against the deploy's
  ~12 s port wait (3 s when it started alone). Waiting leaves `web` the CPU.
- It shares the release, the deployment's secrets and the restricted runtime
  `DATABASE_URL`, and runs as the same sandboxed account as `web`.
- Each tick is a fresh process, so a leaked connection or a hung library
  cannot build up across ticks.
- The deploy waits only for the deployment's `PORT`, which `web` serves; `jobs`
  never listens.
- The interval is not a fixed hour: it is about 61 minutes plus each tick's
  duration, and restarts at each deploy. That is enough for retention, and scheduled sync
  decides in its own TDD whether it needs more.

Alternatives considered: a GitHub Actions `schedule` calling `amp boxes exec
--as-app` (needs a standing Amp credential in CI), and the web process's
reconciler calling the tick (shares the web event loop and database pool).

Hourly is enough for retention; scheduled sync decides its own interval in its
TDD. Overlapping ticks are harmless for retention; a sync step should start
`ynab_sync` runs, whose active-run index already prevents two at once.

### Interfaces (Constitution §2)

`job_run` is a new table, so §2 applies. This change deliberately skips these
layers, and records why:

- **API and `docs/api.md`, agent tool catalog and MCP, UI**: decided by the
  owner (2026-11-26): a job run is not exposed as its own primitive, now or
  later. There is no generic job endpoint, tool or screen. Each feature exposes
  its own workflow: for example, the proposal run's routes and Inbox progress
  are inbox operations that call `start`, `read` and `cancel` internally, and
  that feature's TDD covers its interfaces.
- **CONTEXT.md**: a job run is not a domain meaning. The proposal run's TDD
  adds any user-facing term it needs.
- **Domain rules**: none (see above).

## Atomicity, concurrency, and retries

- A claim commits on its own, before the step runs, so no transaction spans a
  model call. The step's own writes commit through existing commands.
- Two processes cannot claim the same run: `SKIP LOCKED` plus the row lock
  serializes them, and a fresh lease is not claimable.
- A stale claim's late `settle` is rejected by the `claims` fence, so counts are
  never double-added and a newer claim's outcome is never overwritten. The
  step's own financial writes are not fenced; handlers must be idempotent, or
  use the existing idempotency keys (`revision:n`).
- `cancel` wins over an in-flight step: the step finishes but cannot settle.
- One process runs the web service today; the protocol is safe for several.

## Verification

`tests/integration/test_jobs.py`, real PostgreSQL, synthetic data:

- **Lease claim**: `start` twice returns one run; two concurrent claims take two
  different runs; a third finds none; the claimed row is `running` with
  `claimed_at` and `claims = 1`.
- **Stale lease**: a lease 10 minutes old is not claimable under an 11-minute
  window and is under a 9-minute one, with `claims = 2`; the old claim's settle
  of 25 is rejected and the new claim's 7 is stored.
- **Clean shutdown**: a blocking step is cancelled by `stop()`, the registry is
  empty, and the run is `queued` with no lease; a new runner then advances it
  over three steps, summing 25 + 15 + 5 = 45, to `succeeded`. A raising step
  fails the run with `step_failed` and no message.
- **Tick step isolation**: a raising step and a step past its 0.2 s deadline do
  not stop retention, which deletes only the expired conversation; the exit
  status is 1; logs name `RuntimeError` and `TimeoutError` but not the canary
  in the exception or the deleted message.
- **Telemetry** (`tests/integration/test_trace_privacy.py`): after the server
  scenario, the real `python -m accanto.jobs.tick` deletes that run's
  conversation (its messages carry the prompt canary) and its log contains no
  canary or secret.

## Alternatives and tradeoffs

- **Browser loop only** (inbox design 2.1): no table or loop, but stops when the
  tab closes and cannot serve scheduled sync. The owner chose server-side.
- **A worker queue (Redis, arq, Celery)**: a new service and operating cost for
  one person's workload; Postgres leases suffice.
- **`pg_cron` or Neon scheduling**: puts application logic in the database role
  and is unavailable to the restricted runtime login.
- **Aleph's effective-state CASE for stale reads**: not needed until a run's
  progress is shown; `read` returns stored state, and the owner's TDD can add it.

## Delivery and compatibility

- Migration `6i029` is additive. `6h028` code ignores `job_run`; roll back the
  app before downgrading. After upgrading, reapply the runtime grants in
  [api.md](../api.md#local-setup-and-credentials) so `accanto_app` can use
  `job_run`. `/readyz` pinned `6i029`; TDD 12's `6j030` adds the run's
  credential columns and is now the pinned revision.
- `.amp/box.yaml` declares the `jobs` service; it starts on the next
  `amp boxes deploy`. Its command was checked in a locally built release
  against a test database, and it has run on the Box since 2026-11-26: after a
  deploy, read its unit log (`...-svc-jobs.service`) for `job_tick_finished`
  about a minute later.

## Open decisions

- Technical: retries. A failed step fails the run; a handler that wants retries
  catches its own transient errors and returns `done=False`.
- Technical: retention of finished `job_run` rows (counts only, small); add a
  tick step when the first job kind ships.
