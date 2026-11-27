import { type CSSProperties, type ReactNode, useRef, useState } from "react";
import type { BrowserSession, IsoDate, LoadState, UUID } from "../../lib/api";
import { daysBetween, plural } from "../../lib/format";
import { browserCall } from "../../lib/inbox";
import {
  type Cadence,
  type Frequency,
  LINK_SCREENS,
  type LinkScreen,
  MONTHLY_SCREENS,
  type Occurrence,
  type OccurrenceSummary,
  type Routine,
  type RoutineInput,
  type StepStatus,
  WEEKDAYS,
  type Weekday,
  dayLabel,
  describeCadence,
  linkMonth,
  ordinalDay,
  routines,
} from "../../lib/routines";
import { Empty, Field, Head, Icon } from "../../ui";
import { hrefFor } from "../workspace/Workspace";
import { type ScreenProps, useLoad } from "../workspace/shared";
import "./routines.css";

type View = { kind: "list" } | { kind: "run"; id: UUID; on: IsoDate } | { kind: "edit"; id?: UUID };
type Credentials = (signIn?: boolean) => Promise<BrowserSession>;

export function Routines(
  p: ScreenProps & {
    credentials: Credentials;
    /** Opens an accanto screen from a step link, guarded like any navigation. */
    open?: (screen: LinkScreen, month?: string) => void;
    /** An occurrence to open on arrival, as Home's Continue does. */
    start?: { routine: UUID; on: IsoDate };
  },
) {
  const [reload, setReload] = useState(0);
  const [view, setView] = useState<View>(
    p.start ? { kind: "run", id: p.start.routine, on: p.start.on } : { kind: "list" },
  );
  const state = useLoad(() => routines.list(p.entity.id), [p.entity.id, p.refresh, reload]);
  if (p.concealed) return null;
  const records = state.kind === "ready" ? state.data : [];
  const back = () => {
    if (!p.guard()) return;
    p.dirty(false);
    setView({ kind: "list" });
    setReload((n) => n + 1);
  };

  if (view.kind === "run") {
    const routine = records.find((r) => r.uuid === view.id);
    return (
      <Run
        {...p}
        key={`${view.id}:${view.on}`}
        routine={routine}
        on={view.on}
        back={back}
        choose={(on) => setView({ kind: "run", id: view.id, on })}
      />
    );
  }
  if (view.kind === "edit")
    return (
      <Editor
        {...p}
        key={view.id ?? "new"}
        routine={records.find((r) => r.uuid === view.id)}
        back={back}
        saved={() => {
          setView({ kind: "list" });
          setReload((n) => n + 1);
        }}
      />
    );

  const active = records.filter((r) => r.active);
  const archived = records.filter((r) => !r.active);
  const startNew = () => p.guard() && setView({ kind: "edit" });
  return (
    <section className="screen rt-screen" aria-label="Routines">
      <Head
        title="Routines"
        sub="Checklists you tick yourself. A step only links to where the work happens; recorded activity never ticks one."
      >
        <button type="button" className="btn pri" disabled={p.busy} onClick={startNew}>
          <Icon name="plus" />
          New routine
        </button>
      </Head>
      {state.kind === "loading" && (
        <output className="card pad sk-card" aria-label="Loading routines">
          <div className="sk" style={{ width: "40%", height: 20 }} />
          <div className="sk" style={{ height: 34 }} />
          <div className="sk" style={{ height: 34 }} />
        </output>
      )}
      {"error" in state && (
        <div className="banner bad" role="alert">
          <span>Could not load routines. {state.error.message}</span>
          <button type="button" className="btn sm" onClick={() => setReload((n) => n + 1)}>
            Try loading again
          </button>
        </div>
      )}
      {state.kind === "empty" && (
        <Empty
          title="No routines yet"
          action={
            <button type="button" className="btn pri" disabled={p.busy} onClick={startNew}>
              Create a routine
            </button>
          }
        >
          A routine is a checklist on a schedule, such as a Saturday money check: pay the card,
          process transactions, buy the index fund. Home shows it when it is due.
        </Empty>
      )}
      {active.length > 0 && (
        <ul className="card rt-list" aria-label="Routines">
          {active.map((r) => (
            <RoutineRow
              key={r.uuid}
              routine={r}
              today={p.entity.today}
              run={(on) => setView({ kind: "run", id: r.uuid, on })}
              edit={() => p.guard() && setView({ kind: "edit", id: r.uuid })}
            />
          ))}
        </ul>
      )}
      {active.length > 0 && (
        <p className="note rt-legend" aria-hidden="true">
          {(
            [
              ["d", "Done"],
              ["p", "Partly done"],
              ["s", "Skipped"],
              ["m", "Missed"],
            ] as const
          ).map(([k, label]) => (
            <span key={k}>
              <i className={`rt-dot ${k}`} />
              {label}
            </span>
          ))}
          <span>The ringed dot is the current occurrence.</span>
        </p>
      )}
      {archived.length > 0 && (
        <details className="rt-archived">
          <summary>Archived {plural(archived.length, "routine")}</summary>
          <ul className="card rt-list" aria-label="Archived routines">
            {archived.map((r) => (
              <RoutineRow
                key={r.uuid}
                routine={r}
                today={p.entity.today}
                run={(on) => setView({ kind: "run", id: r.uuid, on })}
                edit={() => p.guard() && setView({ kind: "edit", id: r.uuid })}
              />
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/** One line of what the current occurrence needs: shared by the list and Home. */
export function currentLine(r: Routine, today: IsoDate): { tone: string; text: string } {
  const c = r.current;
  const next = r.next_on ? `Next ${dayLabel(r.next_on, today)}.` : "";
  if (!c) return { tone: "", text: next || "Not scheduled." };
  const when = dayLabel(c.scheduled_on, today);
  const progress = `${c.done} of ${plural(c.total, "step")} done.`;
  if (c.state === "due") return { tone: "warn", text: `Due today. ${progress}` };
  if (c.state === "overdue") {
    const late = daysBetween(c.scheduled_on, today);
    const missed = missedBefore(r.history);
    return {
      tone: "warn",
      text: `Due ${when}, ${plural(late, "day")} overdue. ${progress}${missed ? ` Missed ${missed} before this.` : ""}`,
    };
  }
  if (c.state === "skipped") return { tone: "", text: `Skipped ${when}. ${next}` };
  if (c.state === "done") return { tone: "good", text: `Done for ${when}. ${next}` };
  return { tone: "", text: next };
}
/** Missed occurrences in a row just before the current one. */
function missedBefore(history: OccurrenceSummary[]) {
  let count = 0;
  for (let i = history.length - 2; i >= 0 && history[i].state === "missed"; i--) count++;
  return count;
}

const DOT_WORDS: Record<OccurrenceSummary["state"], string> = {
  upcoming: "upcoming",
  due: "due",
  overdue: "overdue",
  missed: "missed",
  done: "done",
  skipped: "skipped",
};
function dotClass(o: OccurrenceSummary) {
  if (o.state === "done") return "d";
  if (o.state === "skipped") return "s";
  if (o.done > 0) return "p";
  return o.state === "missed" ? "m" : "o";
}

function RoutineRow({
  routine: r,
  today,
  run,
  edit,
}: {
  routine: Routine;
  today: IsoDate;
  run: (on: IsoDate) => void;
  edit: () => void;
}) {
  const line = currentLine(r, today);
  return (
    <li className="rt-row">
      <div className="rt-main">
        <span className="rt-name">
          {r.name}
          {!r.active && <span className="chip">Archived</span>}
        </span>
        <small>
          {describeCadence(r.cadence)} · {plural(r.steps.length, "step")}
        </small>
        <small className={line.tone}>{line.text}</small>
      </div>
      <div className="rt-hist">
        {r.history.length > 0 && <span className="cap">Last {r.history.length}</span>}
        {r.history.length ? (
          <ol className="rt-dots" aria-label={`${r.name} history, oldest first`}>
            {r.history.map((o, i) => (
              <li key={o.scheduled_on}>
                <button
                  type="button"
                  className={`rt-dot ${dotClass(o)}${i === r.history.length - 1 ? " cur" : ""}`}
                  title={`${dayLabel(o.scheduled_on, today)}: ${DOT_WORDS[o.state]}, ${o.done} of ${o.total}`}
                  aria-label={`${dayLabel(o.scheduled_on, today)}: ${DOT_WORDS[o.state]}, ${o.done} of ${o.total} steps`}
                  onClick={() => run(o.scheduled_on)}
                />
              </li>
            ))}
          </ol>
        ) : (
          <span className="note">Not yet run</span>
        )}
      </div>
      <div className="rt-acts">
        {r.current && (
          <button
            type="button"
            className="btn sm"
            onClick={() => run(r.current?.scheduled_on ?? "")}
          >
            {r.current.state === "due" || r.current.state === "overdue" ? "Continue" : "Open"}
          </button>
        )}
        <button type="button" className="btn sm quiet" onClick={edit}>
          Edit
        </button>
      </div>
    </li>
  );
}

const STATE_WORDS: Record<Occurrence["state"], string> = {
  upcoming: "Upcoming",
  due: "Due today",
  overdue: "Overdue",
  missed: "Missed",
  done: "Done",
  skipped: "Skipped",
};

function Run(
  p: ScreenProps & {
    credentials: Credentials;
    open?: (screen: LinkScreen, month?: string) => void;
    routine?: Routine;
    on: IsoDate;
    back: () => void;
    choose: (on: IsoDate) => void;
  },
) {
  const [reload, setReload] = useState(0);
  const loaded = useLoad(
    () => routines.occurrence(p.entity.id, p.routine?.uuid ?? "", p.on),
    [p.entity.id, p.routine?.uuid, p.on, reload],
    { enabled: !!p.routine },
  );
  const [local, setLocal] = useState<Occurrence | null>(null);
  const [error, setError] = useState("");
  const [noting, setNoting] = useState<UUID | null>(null);
  const [skipping, setSkipping] = useState(false);
  const [skipNote, setSkipNote] = useState("");
  // Ticks go out one at a time, so each reply is the occurrence after every earlier tick.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const occ: Occurrence | null = local ?? (loaded.kind === "ready" ? loaded.data : null);
  const today = p.entity.today;

  function send(path: Parameters<typeof browserCall>[1], body: object, optimistic: Occurrence) {
    const before = occ;
    setLocal(optimistic);
    setError("");
    queue.current = queue.current.then(() =>
      browserCall<Occurrence>(p.credentials, path, "PUT", body).then(
        (saved) => setLocal(saved),
        (issue: Error) => {
          setLocal(before);
          setError(`Not saved. ${issue.message}`);
        },
      ),
    );
  }
  function setStep(stepId: UUID, status: StepStatus | null, note?: string) {
    if (!occ || !p.routine) return;
    const steps = occ.steps.map((s) =>
      s.step_id === stepId ? { ...s, status, note: note ?? (status ? s.note : "") } : s,
    );
    const settled = steps.every((s) => s.status);
    const spec = routines.setStep(p.entity.id, p.routine.uuid, p.on, stepId, {
      status,
      ...(note === undefined ? {} : { note }),
    });
    send(spec.path, spec.body, {
      ...occ,
      steps,
      state: settled ? "done" : occ.state === "done" ? stateWithout(occ, today) : occ.state,
      completed_on: settled ? (occ.completed_on ?? today) : null,
    });
  }
  function setSkipped(skipped: boolean, note: string) {
    if (!occ || !p.routine) return;
    const spec = routines.setOccurrence(p.entity.id, p.routine.uuid, p.on, {
      skipped,
      note,
      expected_revision: occ.revision,
    });
    send(spec.path, spec.body, {
      ...occ,
      skipped,
      note,
      state: skipped ? "skipped" : stateWithout(occ, today),
    });
    setSkipping(false);
  }

  if (!p.routine)
    return (
      <section className="screen rt-screen" aria-label="Routine">
        <BackLink back={p.back} />
        <p className="note">This routine is not available.</p>
      </section>
    );
  const r = p.routine;
  const done = occ?.steps.filter((s) => s.status).length ?? 0;
  const total = occ?.steps.length ?? r.steps.length;
  const late =
    occ?.completed_on && occ.next_on && occ.completed_on >= occ.next_on
      ? ` Completed late, on ${dayLabel(occ.completed_on, today)}.`
      : occ?.completed_on
        ? ` Completed ${dayLabel(occ.completed_on, today)}.`
        : "";
  const index = r.history.findIndex((o) => o.scheduled_on === p.on);
  const earlier = index > 0 ? r.history[index - 1] : null;
  const later = index >= 0 && index < r.history.length - 1 ? r.history[index + 1] : null;

  return (
    <section className="screen rt-screen" aria-label={`${r.name}, ${dayLabel(p.on, today)}`}>
      <BackLink back={p.back} />
      <div className="card rt-run">
        <div className="rt-run-head">
          <div>
            <h1 className="h1">{r.name}</h1>
            <p className="sub">
              {dayLabel(p.on, today)}
              {occ?.next_on &&
              (occ.state === "overdue" || occ.state === "due" || occ.state === "upcoming")
                ? `. Counts as missed from ${dayLabel(occ.next_on, today)} if not finished.`
                : "."}
              {late}
            </p>
          </div>
          {occ && (
            <span
              className={`chip ${occ.state === "done" ? "good" : occ.state === "overdue" || occ.state === "due" ? "warn" : ""}`}
            >
              {STATE_WORDS[occ.state]}
            </span>
          )}
        </div>
        <div className="rt-progress">
          <div
            className="meter"
            style={{ "--c": "var(--good)" } as CSSProperties}
            aria-hidden="true"
          >
            <i style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
          </div>
          <span className="cap">
            {done} of {plural(total, "step")} done
          </span>
        </div>
        {occ?.state === "missed" && (
          <p className="banner">
            <span>
              This occurrence was missed. You can still finish it; it is recorded as completed late.
            </span>
          </p>
        )}
        {occ?.skipped && (
          <p className="banner">
            <span>Skipped{occ.note ? `: ${occ.note}` : "."}</span>
            <button type="button" className="btn sm" onClick={() => setSkipped(false, "")}>
              Reopen
            </button>
          </p>
        )}
        {error && (
          <p className="banner bad" role="alert">
            <span>{error}</span>
          </p>
        )}
        {!occ ? (
          <LoadOccurrence state={loaded} retry={() => setReload((n) => n + 1)} />
        ) : (
          <ul className="rt-steps" aria-label="Steps">
            {occ.steps.map((s) => (
              <li key={s.step_id} className={`rt-step${s.status ? ` is-${s.status}` : ""}`}>
                <button
                  type="button"
                  className="rt-check"
                  aria-pressed={s.status === "done"}
                  aria-label={s.title}
                  disabled={occ.skipped}
                  onClick={() => setStep(s.step_id, s.status === "done" ? null : "done")}
                >
                  {s.status === "done" && <CheckMark />}
                  {s.status === "skipped" && <span className="rt-dash" />}
                </button>
                <div className="rt-step-t">
                  <span className="rt-title">{s.title}</span>
                  {s.status === "skipped" && <small>Skipped this time</small>}
                  {s.note && noting !== s.step_id && <small className="rt-note">{s.note}</small>}
                  {noting === s.step_id && (
                    <textarea
                      className="input rt-note-in"
                      aria-label={`Note for ${s.title}`}
                      maxLength={4000}
                      rows={2}
                      // biome-ignore lint/a11y/noAutofocus: The User asked to write a note.
                      autoFocus
                      defaultValue={s.note}
                      onBlur={(event) => {
                        setNoting(null);
                        if (event.target.value !== s.note)
                          setStep(s.step_id, s.status, event.target.value);
                      }}
                    />
                  )}
                </div>
                <div className="rt-step-acts">
                  <StepLink step={s} on={p.on} open={p.open} entity={p.entity.id} />
                  {!occ.skipped && (
                    <span className="rt-minor">
                      {s.status && (
                        <button
                          type="button"
                          className="link-btn"
                          onClick={() => setNoting(s.step_id)}
                        >
                          {s.note ? "Edit note" : "Note"}
                        </button>
                      )}
                      <button
                        type="button"
                        className="link-btn"
                        onClick={() =>
                          setStep(s.step_id, s.status === "skipped" ? null : "skipped")
                        }
                      >
                        {s.status === "skipped" ? "Unskip" : "Skip"}
                      </button>
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {occ && !occ.skipped && (
          <div className="rt-run-foot">
            {skipping ? (
              <div className="rt-skip">
                <input
                  className="input"
                  aria-label="Why skip, optional"
                  placeholder="Why skip? (optional, such as away this week)"
                  maxLength={4000}
                  value={skipNote}
                  onChange={(event) => setSkipNote(event.target.value)}
                />
                <button type="button" className="btn sm" onClick={() => setSkipped(true, skipNote)}>
                  Skip {dayLabel(p.on, today)}
                </button>
                <button type="button" className="btn sm quiet" onClick={() => setSkipping(false)}>
                  Cancel
                </button>
              </div>
            ) : (
              occ.state !== "done" && (
                <button type="button" className="btn sm quiet" onClick={() => setSkipping(true)}>
                  Skip this occurrence
                </button>
              )
            )}
            <span className="spacer" />
            <span className="rt-pager">
              <button
                type="button"
                className="btn sm quiet"
                disabled={!earlier}
                onClick={() => earlier && p.choose(earlier.scheduled_on)}
              >
                <Icon name="left" />
                Earlier
              </button>
              <button
                type="button"
                className="btn sm quiet"
                disabled={!later}
                onClick={() => later && p.choose(later.scheduled_on)}
              >
                Later
                <Icon name="right" />
              </button>
            </span>
          </div>
        )}
      </div>
      <p className="note">
        Ticking a step records nothing financial. Use the links to do the work, then tick it here.
      </p>
    </section>
  );
}
/** The state an occurrence falls back to when it stops being done or skipped. */
function stateWithout(occ: Occurrence, today: IsoDate): Occurrence["state"] {
  if (occ.scheduled_on > today) return "upcoming";
  if (occ.scheduled_on === today) return "due";
  return occ.next_on && occ.next_on <= today ? "missed" : "overdue";
}
function LoadOccurrence({ state, retry }: { state: LoadState<Occurrence>; retry: () => void }) {
  if (state.kind === "loading")
    return (
      <output className="rt-steps" aria-label="Loading steps">
        <div className="sk" style={{ height: 30, margin: "12px 16px" }} />
        <div className="sk" style={{ height: 30, margin: "12px 16px" }} />
      </output>
    );
  return (
    <div className="banner bad" role="alert">
      <span>
        Could not load this occurrence.{"error" in state ? ` ${state.error.message}` : ""}
      </span>
      <button type="button" className="btn sm" onClick={retry}>
        Try loading again
      </button>
    </div>
  );
}
const CheckMark = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true" className="ico">
    <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2" />
  </svg>
);
const BackLink = ({ back }: { back: () => void }) => (
  <button type="button" className="btn sm quiet rt-back" onClick={back}>
    <Icon name="left" />
    All routines
  </button>
);
const screenName = (screen: LinkScreen) => LINK_SCREENS.find(([s]) => s === screen)?.[1] ?? "";

function StepLink({
  step,
  on,
  open,
  entity,
}: {
  step: {
    link_screen: LinkScreen | null;
    link_month_offset: number | null;
    link_url: string | null;
  };
  on: IsoDate;
  open?: (screen: LinkScreen, month?: string) => void;
  entity: string;
}) {
  if (step.link_url)
    return (
      <a className="rt-link" href={step.link_url} target="_blank" rel="noopener noreferrer">
        Open {new URL(step.link_url).hostname}
        <Icon name="expand" />
      </a>
    );
  if (!step.link_screen) return null;
  const screen = step.link_screen;
  const month =
    MONTHLY_SCREENS.includes(screen) && step.link_month_offset !== null
      ? linkMonth(on, step.link_month_offset)
      : undefined;
  const label = month
    ? `Open ${screenName(screen)} for ${new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`))}`
    : `Open ${screenName(screen)}`;
  return (
    <a
      className="rt-link"
      href={hrefFor(screen, month, undefined)}
      data-entity={entity}
      onClick={(event) => {
        if (!open) return;
        event.preventDefault();
        open(screen, month);
      }}
    >
      {label}
    </a>
  );
}

// Editor

type StepForm = {
  key: string;
  step_id?: UUID;
  title: string;
  link: "none" | "screen" | "url";
  screen: LinkScreen;
  offset: number;
  url: string;
};
type Form = {
  name: string;
  cadence: Cadence;
  monthly: "day" | "weekday";
  starts_on: IsoDate;
  active: boolean;
  steps: StepForm[];
};
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const OFFSETS: [number, string][] = [
  [0, "Month of the occurrence"],
  [-1, "Month before"],
  [-2, "Two months before"],
];
const blankStep = (): StepForm => ({
  key: crypto.randomUUID(),
  title: "",
  link: "none",
  screen: "inbox",
  offset: 0,
  url: "",
});
function toForm(r: Routine | undefined, today: IsoDate): Form {
  if (!r)
    return {
      name: "",
      cadence: {
        frequency: "weekly",
        interval: 1,
        weekdays: ["sat"],
        month_day: 1,
        week: null,
        weekday: null,
        month: 1,
      },
      monthly: "day",
      starts_on: today,
      active: true,
      steps: [blankStep()],
    };
  return {
    name: r.name,
    cadence: r.cadence,
    monthly: r.cadence.week !== null ? "weekday" : "day",
    starts_on: r.starts_on,
    active: r.active,
    steps: r.steps.map((s) => ({
      key: s.uuid,
      step_id: s.uuid,
      title: s.title,
      link: s.link_url ? "url" : s.link_screen ? "screen" : "none",
      screen: s.link_screen ?? "inbox",
      offset: s.link_month_offset ?? 0,
      url: s.link_url ?? "",
    })),
  };
}
/** The cadence sent to the API: only the fields its frequency uses. */
function cadenceOf(f: Form): Cadence {
  const c = f.cadence;
  const none = { weekdays: [], month_day: null, week: null, weekday: null, month: null };
  if (c.frequency === "weekly") return { ...c, ...none, weekdays: c.weekdays };
  if (c.frequency === "monthly")
    return f.monthly === "day"
      ? { ...c, ...none, month_day: c.month_day ?? 1 }
      : { ...c, ...none, week: c.week ?? 1, weekday: c.weekday ?? "sat" };
  return { ...c, ...none, month: c.month ?? 1, month_day: c.month_day ?? 1 };
}
function stepError(s: StepForm) {
  if (!s.title.trim()) return "Enter what to do.";
  if (s.link === "url" && !/^https:\/\/[^\s/]+\.[^\s]+$/.test(s.url.trim()))
    return "Enter a website address starting with https://.";
  return "";
}

function Editor(p: ScreenProps & { routine?: Routine; back: () => void; saved: () => void }) {
  const [form, setForm] = useState<Form>(() => toForm(p.routine, p.entity.today));
  const [showErrors, setShowErrors] = useState(false);
  const r = p.routine;
  const c = form.cadence;
  function update(next: Partial<Form>) {
    setForm({ ...form, ...next });
    p.dirty(true);
  }
  function updateStep(i: number, next: Partial<StepForm>) {
    update({ steps: form.steps.map((s, j) => (i === j ? { ...s, ...next } : s)) });
  }
  function move(i: number, by: number) {
    const steps = [...form.steps];
    [steps[i], steps[i + by]] = [steps[i + by], steps[i]];
    update({ steps });
  }
  const errors = {
    name: form.name.trim() ? "" : "Name the routine.",
    weekdays: c.frequency === "weekly" && !c.weekdays.length ? "Choose at least one day." : "",
    steps: form.steps.length ? "" : "Add at least one step.",
  };
  function save() {
    if (p.busy) return;
    if (Object.values(errors).some(Boolean) || form.steps.some(stepError)) {
      setShowErrors(true);
      return;
    }
    const body: RoutineInput = {
      name: form.name.trim(),
      cadence: cadenceOf(form),
      starts_on: form.starts_on,
      active: form.active,
      steps: form.steps.map((s) => ({
        ...(s.step_id ? { step_id: s.step_id } : {}),
        title: s.title.trim(),
        link_screen: s.link === "screen" ? s.screen : null,
        link_month_offset:
          s.link === "screen" && MONTHLY_SCREENS.includes(s.screen) ? s.offset : null,
        link_url: s.link === "url" ? s.url.trim() : null,
      })),
      ...(r ? { expected_revision: r.revision } : {}),
    };
    p.save(
      r ? routines.edit(p.entity.id, r.uuid, body) : routines.create(p.entity.id, body),
      () => {
        p.dirty(false);
        p.saved();
      },
    );
  }

  return (
    <section className="screen rt-screen" aria-label={r ? `Edit ${r.name}` : "New routine"}>
      <BackLink back={p.back} />
      <form
        className="card rt-editor"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <fieldset disabled={p.busy}>
          <h1 className="h1">{r ? "Edit routine" : "New routine"}</h1>
          <Field label="Name">
            <input
              className="input"
              maxLength={120}
              placeholder="Saturday money check"
              value={form.name}
              aria-invalid={showErrors && !!errors.name}
              onChange={(event) => update({ name: event.target.value })}
            />
          </Field>
          {showErrors && errors.name && <p className="err">{errors.name}</p>}

          <CadenceFields
            cadence={c}
            monthly={form.monthly}
            startsOn={form.starts_on}
            change={update}
            error={showErrors ? errors.weekdays : ""}
            summary={`${describeCadence(cadenceOf(form))}, from ${dayLabel(form.starts_on, p.entity.today)}.`}
            zone={p.entity.name}
          />

          <fieldset className="rt-group">
            <legend>Steps</legend>
            <p className="note">
              You tick each step yourself. A link only opens a screen or a website to do it.
            </p>
            <ol className="rt-edit-steps">
              {form.steps.map((s, i) => {
                const error = showErrors ? stepError(s) : "";
                return (
                  <li key={s.key} className="rt-edit-step">
                    <span className="rt-num">{i + 1}</span>
                    <div className="rt-edit-fields">
                      <input
                        className="input"
                        aria-label={`Step ${i + 1}`}
                        placeholder="What to do, such as Process transactions"
                        maxLength={200}
                        value={s.title}
                        aria-invalid={!!error && !s.title.trim()}
                        onChange={(event) => updateStep(i, { title: event.target.value })}
                      />
                      <div className="rt-inline">
                        <select
                          className="input"
                          aria-label={`Step ${i + 1} link`}
                          value={s.link === "screen" ? s.screen : s.link}
                          onChange={(event) => {
                            const v = event.target.value;
                            if (v === "none" || v === "url") updateStep(i, { link: v });
                            else updateStep(i, { link: "screen", screen: v as LinkScreen });
                          }}
                        >
                          <option value="none">No link</option>
                          <optgroup label="Open in accanto">
                            {LINK_SCREENS.map(([screen, name]) => (
                              <option key={screen} value={screen}>
                                {name}
                              </option>
                            ))}
                          </optgroup>
                          <option value="url">A website…</option>
                        </select>
                        {s.link === "screen" && MONTHLY_SCREENS.includes(s.screen) && (
                          <select
                            className="input"
                            aria-label={`Step ${i + 1} month`}
                            value={s.offset}
                            onChange={(event) =>
                              updateStep(i, { offset: Number(event.target.value) })
                            }
                          >
                            {OFFSETS.map(([n, label]) => (
                              <option key={n} value={n}>
                                {label}
                              </option>
                            ))}
                          </select>
                        )}
                        {s.link === "url" && (
                          <input
                            className="input rt-url"
                            type="url"
                            inputMode="url"
                            aria-label={`Step ${i + 1} website`}
                            placeholder="https://bank.example.com"
                            value={s.url}
                            aria-invalid={!!error && s.link === "url"}
                            onChange={(event) => updateStep(i, { url: event.target.value })}
                          />
                        )}
                      </div>
                      {error && <p className="err">{error}</p>}
                    </div>
                    <div className="rt-edit-acts">
                      <button
                        type="button"
                        className="icon-btn rt-up"
                        aria-label={`Move step ${i + 1} up`}
                        disabled={i === 0}
                        onClick={() => move(i, -1)}
                      >
                        <Icon name="down" />
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={`Move step ${i + 1} down`}
                        disabled={i === form.steps.length - 1}
                        onClick={() => move(i, 1)}
                      >
                        <Icon name="down" />
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={`Remove step ${i + 1}`}
                        onClick={() => update({ steps: form.steps.filter((_, j) => j !== i) })}
                      >
                        <Icon name="x" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ol>
            {showErrors && errors.steps && <p className="err">{errors.steps}</p>}
            <button
              type="button"
              className="btn sm quiet"
              disabled={form.steps.length >= 50}
              onClick={() => update({ steps: [...form.steps, blankStep()] })}
            >
              <Icon name="plus" />
              Add step
            </button>
            {r && (
              <p className="note">
                Renaming or removing a step leaves past occurrences as they were ticked.
              </p>
            )}
          </fieldset>

          <div className="rt-editor-foot">
            {r && (
              <label className="rt-archive">
                <input
                  type="checkbox"
                  checked={!form.active}
                  onChange={(event) => update({ active: !event.target.checked })}
                />
                Archive: hide from Home and stop scheduling. History stays.
              </label>
            )}
            <span className="spacer" />
            <button type="button" className="btn" onClick={p.back}>
              Cancel
            </button>
            <button type="submit" className="btn pri">
              {r ? "Save routine" : "Create routine"}
            </button>
          </div>
        </fieldset>
      </form>
    </section>
  );
}

/** The Repeats fieldset: frequency, interval, days and start date. Schedules reuse it. */
export function CadenceFields(p: {
  cadence: Cadence;
  monthly: "day" | "weekday";
  startsOn: IsoDate;
  change: (next: { cadence?: Cadence; monthly?: "day" | "weekday"; starts_on?: IsoDate }) => void;
  error: string;
  summary: string;
  /** The Entity's name, whose time zone dates follow. */
  zone: string;
  children?: ReactNode;
}) {
  const c = p.cadence;
  const cadence = (next: Partial<Cadence>) => p.change({ cadence: { ...c, ...next } });
  const unit = { weekly: "week", monthly: "month", yearly: "year" }[c.frequency];
  return (
    <fieldset className="rt-group">
      <legend>Repeats</legend>
      <div className="rt-inline">
        <fieldset className="seg-control rt-bare">
          <legend className="sr-only">Frequency</legend>
          {(["weekly", "monthly", "yearly"] as Frequency[]).map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={c.frequency === f}
              onClick={() => cadence({ frequency: f })}
            >
              {f[0].toUpperCase() + f.slice(1)}
            </button>
          ))}
        </fieldset>
        <label className="rt-every">
          Every
          <input
            className="input"
            type="number"
            min={1}
            max={52}
            aria-label={`Every how many ${unit}s`}
            value={c.interval}
            onChange={(event) =>
              cadence({
                interval: Math.max(1, Math.min(52, Number(event.target.value) || 1)),
              })
            }
          />
          {c.interval === 1 ? unit : `${unit}s`}
        </label>
      </div>
      {c.frequency === "weekly" && (
        <fieldset className="rt-days rt-bare">
          <legend className="sr-only">On these days</legend>
          {WEEKDAYS.map(([d, name]) => (
            <button
              key={d}
              type="button"
              className="rt-day"
              aria-pressed={c.weekdays.includes(d)}
              aria-label={name}
              onClick={() =>
                cadence({
                  weekdays: c.weekdays.includes(d)
                    ? c.weekdays.filter((x) => x !== d)
                    : [...c.weekdays, d],
                })
              }
            >
              {name.slice(0, 2)}
            </button>
          ))}
        </fieldset>
      )}
      {p.error && <p className="err">{p.error}</p>}
      {c.frequency === "monthly" && (
        <div className="rt-choice" role="radiogroup" aria-label="Day of the month">
          <label>
            <input
              type="radio"
              checked={p.monthly === "day"}
              onChange={() => p.change({ monthly: "day" })}
            />
            On the
            <DaySelect
              value={c.month_day ?? 1}
              disabled={p.monthly !== "day"}
              change={(month_day) => cadence({ month_day })}
            />
          </label>
          <label>
            <input
              type="radio"
              checked={p.monthly === "weekday"}
              onChange={() =>
                p.change({
                  monthly: "weekday",
                  cadence: { ...c, week: c.week ?? 1, weekday: c.weekday ?? "sat" },
                })
              }
            />
            On the
            <select
              className="input"
              aria-label="Which week"
              disabled={p.monthly !== "weekday"}
              value={c.week ?? 1}
              onChange={(event) => cadence({ week: Number(event.target.value) })}
            >
              {[1, 2, 3, 4, -1].map((n) => (
                <option key={n} value={n}>
                  {["last", "first", "second", "third", "fourth"][n === -1 ? 0 : n]}
                </option>
              ))}
            </select>
            <select
              className="input"
              aria-label="Weekday"
              disabled={p.monthly !== "weekday"}
              value={c.weekday ?? "sat"}
              onChange={(event) => cadence({ weekday: event.target.value as Weekday })}
            >
              {WEEKDAYS.map(([d, name]) => (
                <option key={d} value={d}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {c.frequency === "yearly" && (
        <div className="rt-inline">
          On
          <select
            className="input"
            aria-label="Month"
            value={c.month ?? 1}
            onChange={(event) => cadence({ month: Number(event.target.value) })}
          >
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
          <DaySelect value={c.month_day ?? 1} change={(month_day) => cadence({ month_day })} />
        </div>
      )}
      <div className="rt-inline">
        <label className="rt-every">
          Starting
          <input
            className="input"
            type="date"
            aria-label="Starting on"
            value={p.startsOn}
            onChange={(event) => p.change({ starts_on: event.target.value })}
          />
        </label>
      </div>
      {p.children}
      <p className="note rt-summary">
        {(c.frequency !== "weekly" || c.weekdays.length > 0) && p.summary} Dates follow {p.zone}'s
        time zone.
        {c.frequency !== "weekly" &&
          " Days run to the 28th so every month has one; choose “last day” for month ends."}
      </p>
    </fieldset>
  );
}

function DaySelect({
  value,
  change,
  disabled,
}: {
  value: number;
  change: (day: number) => void;
  disabled?: boolean;
}) {
  return (
    <select
      className="input"
      aria-label="Day"
      disabled={disabled}
      value={value}
      onChange={(event) => change(Number(event.target.value))}
    >
      {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
        <option key={d} value={d}>
          {ordinalDay(d)}
        </option>
      ))}
      <option value={-1}>last day</option>
    </select>
  );
}
