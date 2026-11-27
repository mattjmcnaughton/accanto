import { useMemo, useState } from "react";
import type { IsoDate, UUID } from "../../lib/api";
import { destinations } from "../../lib/destinations";
import { decimalToCents, formatMoney, inputMoney, money, parseMoney } from "../../lib/format";
import type { InboxCategory } from "../../lib/inbox";
import { monthly } from "../../lib/monthly";
import { dayLabel } from "../../lib/routines";
import { savings } from "../../lib/savings";
import {
  type Schedule,
  type ScheduleCadence,
  type ScheduleInput,
  type ScheduleLine,
  type Weekend,
  describeSchedule,
  inputOf,
  schedules,
} from "../../lib/schedules";
import { spendingSubcategories } from "../../lib/spendingSubcategories";
import { Empty, Field, Head, Icon, tint } from "../../ui";
import { CATEGORIES, CATEGORY, type Option } from "../inbox/inboxModel";
import { CadenceFields } from "../routines/Routines";
import { type ScreenProps, sourceChoices, useLoad } from "../workspace/shared";
import "../routines/routines.css";
import "./schedules.css";

type View = { kind: "list" } | { kind: "edit"; id?: UUID };
const OUTFLOWS: InboxCategory[] = ["fixed_cost", "spending", "investing", "giving"];

export function Schedules(p: ScreenProps) {
  const [reload, setReload] = useState(0);
  const [view, setView] = useState<View>({ kind: "list" });
  const state = useLoad(() => schedules.list(p.entity.id), [p.entity.id, p.refresh, reload]);
  if (p.concealed) return null;
  const records = state.kind === "ready" ? state.data : [];
  const back = () => {
    if (!p.guard()) return;
    p.dirty(false);
    setView({ kind: "list" });
  };
  if (view.kind === "edit")
    return (
      <Editor
        {...p}
        key={view.id ?? "new"}
        schedule={records.find((s) => s.uuid === view.id)}
        back={back}
        saved={() => {
          setView({ kind: "list" });
          setReload((n) => n + 1);
        }}
      />
    );
  const startNew = () => p.guard() && setView({ kind: "edit" });
  const save = (spec: Parameters<ScreenProps["save"]>[0]) =>
    p.save(spec, () => setReload((n) => n + 1));
  const current = records.filter((s) => s.state !== "ended");
  const ended = records.filter((s) => s.state === "ended");
  const row = (s: Schedule) => (
    <ScheduleRow
      key={s.uuid}
      schedule={s}
      today={p.entity.today}
      busy={p.busy}
      edit={() => p.guard() && setView({ kind: "edit", id: s.uuid })}
      pause={(paused) => save(schedules.edit(p.entity.id, s.uuid, inputOf(s, { paused })))}
      skip={(on, skipped) => save(schedules.skip(p.entity.id, s.uuid, on, skipped))}
    />
  );
  return (
    <section className="screen rt-screen" aria-label="Scheduled entries">
      <Head
        title="Scheduled entries"
        tip="On each date, the entries wait in the Transactions inbox. Accepting them records them."
      >
        <button type="button" className="btn pri" disabled={p.busy} onClick={startNew}>
          <Icon name="plus" />
          New schedule
        </button>
      </Head>
      {state.kind === "loading" && (
        <output className="card pad sk-card" aria-label="Loading schedules">
          <div className="sk" style={{ width: "40%", height: 20 }} />
          <div className="sk" style={{ height: 34 }} />
          <div className="sk" style={{ height: 34 }} />
        </output>
      )}
      {"error" in state && (
        <div className="banner bad" role="alert">
          <span>Could not load scheduled entries. {state.error.message}</span>
          <button type="button" className="btn sm" onClick={() => setReload((n) => n + 1)}>
            Try loading again
          </button>
        </div>
      )}
      {state.kind === "empty" && (
        <Empty
          title="No scheduled entries yet"
          action={
            <button type="button" className="btn pri" disabled={p.busy} onClick={startNew}>
              Create a schedule
            </button>
          }
        >
          The same entries in the inbox on a cadence, such as a monthly paycheck.
        </Empty>
      )}
      {current.length > 0 && (
        <ul className="card rt-list" aria-label="Schedules">
          {current.map(row)}
        </ul>
      )}
      {ended.length > 0 && (
        <details className="rt-archived">
          <summary>Ended {ended.length === 1 ? "schedule" : `schedules (${ended.length})`}</summary>
          <ul className="card rt-list" aria-label="Ended schedules">
            {ended.map(row)}
          </ul>
        </details>
      )}
    </section>
  );
}

function lineText(l: ScheduleLine) {
  const category = CATEGORY[l.category].name;
  const line = l.assignment_name ?? (l.category === "spending" ? "No subcategory" : "Unassigned");
  return `${category} · ${line}`;
}
const total = (lines: ScheduleLine[]) =>
  lines.reduce((sum, l) => sum + (decimalToCents(l.amount) ?? 0), 0);
/** Income and outflows apart: a deferral and the contribution it funds are not one sum. */
function totals(lines: ScheduleLine[]) {
  const income = total(lines.filter((l) => l.category === "income"));
  const out = total(lines.filter((l) => l.category !== "income"));
  if (income && out) return `${money(income)} in · ${money(out)} out`;
  return money(income || out);
}

function nextText(s: Schedule, today: IsoDate) {
  if (s.state === "ended") return s.ends_on ? `Ended ${dayLabel(s.ends_on, today)}.` : "Ended.";
  if (s.state === "paused") return "Paused: nothing reaches the inbox until you resume it.";
  if (!s.next_on) return "No more dates.";
  const when = s.next_on === today ? "today" : dayLabel(s.next_on, today);
  const entries = s.lines.length === 1 ? "1 entry" : `${s.lines.length} entries`;
  return `Next: ${entries} to the inbox ${s.next_on === today ? "" : "on "}${when}.`;
}

function ScheduleRow({
  schedule: s,
  today,
  busy,
  edit,
  pause,
  skip,
}: {
  schedule: Schedule;
  today: IsoDate;
  busy: boolean;
  edit: () => void;
  pause: (paused: boolean) => void;
  skip: (on: IsoDate, skipped: boolean) => void;
}) {
  const failed = s.recent.filter((o) => o.status === "failed");
  const last = s.recent.find((o) => o.status === "staged");
  const accepted = last?.items.filter((i) => i.status === "recorded").length ?? 0;
  const waiting = last?.items.filter((i) => i.status === "waiting").length ?? 0;
  return (
    <li className="sc-row">
      <div className="sc-main">
        <div className="rt-name">
          {s.name}
          {s.state === "paused" && <span className="chip warn">Paused</span>}
          {s.state === "ended" && <span className="chip">Ended</span>}
        </div>
        <small className="sc-cadence">{describeSchedule(s.cadence)}</small>
        <ul className="sc-lines" aria-label={`${s.name} entries`}>
          {s.lines.map((l, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: lines have no identity of their own.
            <li key={i} style={tint(CATEGORY[l.category].kind)}>
              <i className="dot" />
              <span className="sc-line-t">
                {lineText(l)}
                {l.note && <small> — {l.note}</small>}
                {l.funding && l.funding !== "income" && (
                  <small> · from {l.funding_name ?? "saved money"}</small>
                )}
              </span>
              <span className="num">{formatMoney(l.amount)}</span>
            </li>
          ))}
        </ul>
        <small className={s.state === "active" ? "" : "warn"}>{nextText(s, today)}</small>
        {failed.map((o) => (
          <div className="banner bad sc-failed" role="alert" key={o.scheduled_on}>
            <span>
              Not in the inbox for {dayLabel(o.scheduled_on, today)}: {o.rejection?.message}{" "}
              Retrying hourly.
            </span>
            <button
              type="button"
              className="btn sm"
              disabled={busy}
              onClick={() => skip(o.scheduled_on, true)}
            >
              Skip {dayLabel(o.scheduled_on, today)}
            </button>
          </div>
        ))}
        {s.state === "active" && s.upcoming.length > 0 && (
          <fieldset className="sc-dates rt-bare">
            <legend className="sr-only">{`${s.name} upcoming dates`}</legend>
            <small>Upcoming</small>
            {s.upcoming.map((u) => (
              <button
                key={u.scheduled_on}
                type="button"
                className={`sc-date${u.skipped ? " is-skipped" : ""}`}
                aria-pressed={u.skipped}
                disabled={busy}
                title={
                  u.skipped
                    ? "Skipped once. Click to bring it to the inbox after all."
                    : "Skip this date once"
                }
                aria-label={`${u.skipped ? "Unskip" : "Skip"} ${dayLabel(u.scheduled_on, today)}`}
                onClick={() => skip(u.scheduled_on, !u.skipped)}
              >
                {dayLabel(u.scheduled_on, today)}
                <span>{u.skipped ? "Skipped" : "Skip"}</span>
              </button>
            ))}
          </fieldset>
        )}
        {last && (
          <small>
            Last in the inbox {dayLabel(last.scheduled_on, today)}: {accepted} accepted
            {waiting > 0 && `, ${waiting} waiting`}.
          </small>
        )}
      </div>
      <div className="sc-acts">
        <span className="num sc-total" aria-label="Total per date">
          {totals(s.lines)}
        </span>
        <div className="sc-btns">
          {s.state !== "ended" && (
            <button
              type="button"
              className="btn sm"
              disabled={busy}
              onClick={() => pause(!s.paused)}
            >
              {s.paused ? "Resume" : "Pause"}
            </button>
          )}
          <button type="button" className="btn sm" disabled={busy} onClick={edit}>
            Edit
          </button>
        </div>
      </div>
    </li>
  );
}

// Editor

type LineForm = {
  key: string;
  category: InboxCategory;
  amount: string;
  note: string;
  assignment: string | null;
  funding: string;
  tag_ids: UUID[];
};
type Form = {
  name: string;
  cadence: ScheduleCadence;
  monthly: "day" | "weekday";
  starts_on: IsoDate;
  ends: boolean;
  ends_on: IsoDate;
  paused: boolean;
  lines: LineForm[];
};
const blankLine = (category: InboxCategory = "income"): LineForm => ({
  key: crypto.randomUUID(),
  category,
  amount: "",
  note: "",
  assignment: null,
  funding: "income",
  tag_ids: [],
});
function toForm(s: Schedule | undefined, today: IsoDate): Form {
  if (!s)
    return {
      name: "",
      cadence: {
        frequency: "monthly",
        interval: 1,
        weekdays: [],
        month_day: -1,
        week: null,
        weekday: null,
        month: null,
        weekend: "before",
      },
      monthly: "day",
      starts_on: today,
      ends: false,
      ends_on: today,
      paused: false,
      lines: [blankLine()],
    };
  return {
    name: s.name,
    cadence: s.cadence,
    monthly: s.cadence.week !== null ? "weekday" : "day",
    starts_on: s.starts_on,
    ends: s.ends_on !== null,
    ends_on: s.ends_on ?? today,
    paused: s.paused,
    lines: s.lines.map((l) => ({
      key: crypto.randomUUID(),
      category: l.category,
      amount: l.amount,
      note: l.note,
      assignment: l.assignment,
      funding: l.funding ?? "income",
      tag_ids: l.tag_ids,
    })),
  };
}
function cadenceOf(f: Form): ScheduleCadence {
  const c = f.cadence;
  const none = { weekdays: [], month_day: null, week: null, weekday: null, month: null };
  if (c.frequency === "weekly") return { ...c, ...none, weekdays: c.weekdays, weekend: null };
  if (c.frequency === "monthly")
    return f.monthly === "day"
      ? { ...c, ...none, month_day: c.month_day ?? 1 }
      : { ...c, ...none, week: c.week ?? 1, weekday: c.weekday ?? "fri", weekend: null };
  return { ...c, ...none, month: c.month ?? 1, month_day: c.month_day ?? 1 };
}
function lineError(l: LineForm) {
  const cents = parseMoney(l.amount);
  if (cents === null || cents <= 0) return "Enter an amount above zero.";
  if (CATEGORY[l.category].article && !l.assignment)
    return `Choose ${CATEGORY[l.category].article}.`;
  return "";
}

function useChoices(p: ScreenProps) {
  const deps = [p.entity.id, p.refresh];
  const plans = useLoad(() => monthly.plans(p.entity.id), deps, { share: "plans" });
  const accounts = useLoad(() => savings.list(p.entity.id), deps, { share: "savings" });
  const investments = useLoad(() => destinations.list(p.entity.id, "investment"), deps, {
    share: "investments",
  });
  const recipients = useLoad(() => destinations.list(p.entity.id, "giving"), deps, {
    share: "giving",
  });
  const subcategories = useLoad(() => spendingSubcategories.list(p.entity.id), deps, {
    share: "spending-subcategories",
  });
  return useMemo(() => {
    const unassigned: Option = { id: "unassigned", name: "Unassigned" };
    const fixed =
      plans.kind === "ready"
        ? [
            ...new Map(
              plans.data.flatMap((plan) =>
                plan.revisions.flatMap((r) =>
                  r.fixed_costs.map((c) => [
                    c.fixed_cost_id,
                    { id: c.fixed_cost_id, name: c.name },
                  ]),
                ),
              ),
            ).values(),
          ]
        : [];
    const goals: Option[] =
      accounts.kind === "ready"
        ? accounts.data.flatMap((a) =>
            a.goals
              .filter((g) => g.active)
              .map((g) => ({ id: g.uuid, name: `${a.name} · ${g.name}` })),
          )
        : [];
    const active = (state: typeof investments) =>
      state.kind === "ready"
        ? state.data.filter((d) => d.active).map((d) => ({ id: d.uuid, name: d.name }))
        : [];
    const lines: Record<InboxCategory, Option[]> = {
      income: [
        ...(plans.kind === "ready"
          ? sourceChoices(plans.data).map((s) => ({ id: s.id, name: s.label }))
          : []),
        unassigned,
      ],
      fixed_cost: [...fixed, unassigned],
      spending: [
        ...(subcategories.kind === "ready"
          ? subcategories.data.filter((s) => s.active).map((s) => ({ id: s.uuid, name: s.name }))
          : []),
      ],
      saving: goals,
      investing: [...active(investments), unassigned],
      giving: [...active(recipients), unassigned],
    };
    return { lines, goals };
  }, [plans, accounts, investments, recipients, subcategories]);
}

function Editor(p: ScreenProps & { schedule?: Schedule; back: () => void; saved: () => void }) {
  const [form, setForm] = useState<Form>(() => toForm(p.schedule, p.entity.today));
  const [showErrors, setShowErrors] = useState(false);
  const choices = useChoices(p);
  const s = p.schedule;
  const c = form.cadence;
  function update(next: Partial<Form>) {
    setForm({ ...form, ...next });
    p.dirty(true);
  }
  function updateLine(i: number, next: Partial<LineForm>) {
    update({ lines: form.lines.map((l, j) => (i === j ? { ...l, ...next } : l)) });
  }
  const errors = {
    name: form.name.trim() ? "" : "Name the schedule.",
    weekdays: c.frequency === "weekly" && !c.weekdays.length ? "Choose at least one day." : "",
    lines: form.lines.length ? "" : "Add at least one entry.",
    ends: form.ends && form.ends_on < form.starts_on ? "End on or after the start date." : "",
  };
  const rollable =
    c.frequency !== "weekly" && !(c.frequency === "monthly" && form.monthly === "weekday");
  function save() {
    if (p.busy) return;
    if (Object.values(errors).some(Boolean) || form.lines.some(lineError)) {
      setShowErrors(true);
      return;
    }
    const body: ScheduleInput = {
      name: form.name.trim(),
      cadence: cadenceOf(form),
      starts_on: form.starts_on,
      ends_on: form.ends ? form.ends_on : null,
      paused: form.paused,
      lines: form.lines.map((l) => ({
        category: l.category,
        amount: inputMoney(parseMoney(l.amount) ?? 0),
        note: l.note.trim(),
        assignment: l.assignment,
        funding: OUTFLOWS.includes(l.category) ? l.funding : null,
        tag_ids: l.tag_ids,
      })),
      ...(s ? { expected_revision: s.revision } : {}),
    };
    p.save(
      s ? schedules.edit(p.entity.id, s.uuid, body) : schedules.create(p.entity.id, body),
      () => {
        p.dirty(false);
        p.saved();
      },
    );
  }
  return (
    <section className="screen rt-screen" aria-label={s ? `Edit ${s.name}` : "New schedule"}>
      <button type="button" className="link-btn rt-back" onClick={p.back}>
        ← Scheduled entries
      </button>
      <form
        className="card rt-editor"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <fieldset disabled={p.busy}>
          <h1 className="h1">{s ? "Edit schedule" : "New schedule"}</h1>
          <Field label="Name">
            <input
              className="input"
              maxLength={120}
              placeholder="Payroll 401(k)"
              value={form.name}
              aria-invalid={showErrors && !!errors.name}
              onChange={(event) => update({ name: event.target.value })}
            />
          </Field>
          {showErrors && errors.name && <p className="err">{errors.name}</p>}

          <fieldset className="rt-group">
            <legend>Entries</legend>
            <ol className="sc-edit-lines">
              {form.lines.map((l, i) => {
                const error = showErrors ? lineError(l) : "";
                const category = CATEGORY[l.category];
                const options = choices.lines[l.category];
                return (
                  <li key={l.key} className="sc-edit-line" style={tint(category.kind)}>
                    <i className="dot" />
                    <div className="sc-edit-fields">
                      <div className="rt-inline">
                        <select
                          className="input"
                          aria-label={`Entry ${i + 1} category`}
                          value={l.category}
                          onChange={(event) =>
                            updateLine(i, {
                              category: event.target.value as InboxCategory,
                              assignment: null,
                              funding: "income",
                            })
                          }
                        >
                          {CATEGORIES.map((x) => (
                            <option key={x.id} value={x.id}>
                              {x.name}
                            </option>
                          ))}
                        </select>
                        <select
                          className="input"
                          aria-label={`Entry ${i + 1} ${category.line ?? "line"}`}
                          value={l.assignment ?? ""}
                          aria-invalid={!!error && !l.assignment}
                          onChange={(event) =>
                            updateLine(i, { assignment: event.target.value || null })
                          }
                        >
                          <option value="">
                            {l.category === "spending"
                              ? "No subcategory"
                              : `Choose ${category.article}`}
                          </option>
                          {options.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.name}
                            </option>
                          ))}
                        </select>
                        <input
                          className="input sc-amount"
                          inputMode="decimal"
                          aria-label={`Entry ${i + 1} amount`}
                          placeholder="0.00"
                          value={l.amount}
                          aria-invalid={!!error && !(Number(parseMoney(l.amount)) > 0)}
                          onChange={(event) => updateLine(i, { amount: event.target.value })}
                        />
                      </div>
                      <div className="rt-inline">
                        {OUTFLOWS.includes(l.category) && (
                          <select
                            className="input"
                            aria-label={`Entry ${i + 1} funding origin`}
                            value={l.funding}
                            onChange={(event) => updateLine(i, { funding: event.target.value })}
                          >
                            <option value="income">Funded from current income</option>
                            {choices.goals.map((g) => (
                              <option key={g.id} value={g.id}>
                                From saved money: {g.name}
                              </option>
                            ))}
                          </select>
                        )}
                        <input
                          className="input sc-note"
                          aria-label={`Entry ${i + 1} note`}
                          placeholder="Note, such as Payroll 401(k) deferral"
                          maxLength={2000}
                          value={l.note}
                          onChange={(event) => updateLine(i, { note: event.target.value })}
                        />
                      </div>
                      {error && <p className="err">{error}</p>}
                    </div>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Remove entry ${i + 1}`}
                      onClick={() => update({ lines: form.lines.filter((_, j) => j !== i) })}
                    >
                      <Icon name="x" />
                    </button>
                  </li>
                );
              })}
            </ol>
            {showErrors && errors.lines && <p className="err">{errors.lines}</p>}
            <button
              type="button"
              className="btn sm quiet"
              disabled={form.lines.length >= 10}
              onClick={() => update({ lines: [...form.lines, blankLine("investing")] })}
            >
              <Icon name="plus" />
              Add entry
            </button>
          </fieldset>

          <CadenceFields
            cadence={c}
            monthly={form.monthly}
            startsOn={form.starts_on}
            change={({ cadence: next, ...rest }) =>
              update({ ...rest, ...(next ? { cadence: { ...c, ...next } } : {}) })
            }
            error={showErrors ? errors.weekdays : ""}
            summary={`${describeSchedule(cadenceOf(form))}, from ${dayLabel(form.starts_on, p.entity.today)}.`}
          >
            {rollable && (
              <div className="rt-inline">
                <label className="rt-every">
                  When that is a weekend,
                  <select
                    className="input"
                    aria-label="When the date is a weekend"
                    value={c.weekend ?? ""}
                    onChange={(event) =>
                      update({
                        cadence: { ...c, weekend: (event.target.value || null) as Weekend },
                      })
                    }
                  >
                    <option value="">keep the date</option>
                    <option value="before">use the weekday before</option>
                    <option value="after">use the weekday after</option>
                  </select>
                </label>
              </div>
            )}
            <div className="rt-inline">
              <label className="rt-every">
                <input
                  type="checkbox"
                  checked={form.ends}
                  onChange={(event) => update({ ends: event.target.checked })}
                />
                Ends on
              </label>
              <input
                className="input"
                type="date"
                aria-label="Ends on"
                disabled={!form.ends}
                value={form.ends_on}
                aria-invalid={showErrors && !!errors.ends}
                onChange={(event) => update({ ends_on: event.target.value })}
              />
            </div>
            {showErrors && errors.ends && <p className="err">{errors.ends}</p>}
            <p className="note">
              {s ? "Applies from the next date." : "Nothing arrives for past dates."}
            </p>
          </CadenceFields>

          <div className="rt-editor-foot">
            {s && s.state !== "ended" && (
              <label className="rt-archive">
                <input
                  type="checkbox"
                  checked={form.paused}
                  onChange={(event) => update({ paused: event.target.checked })}
                />
                Paused (dates while paused never arrive)
              </label>
            )}
            <span className="spacer" />
            <button type="button" className="btn" onClick={p.back}>
              Cancel
            </button>
            <button type="submit" className="btn pri">
              {s ? "Save schedule" : "Create schedule"}
            </button>
          </div>
        </fieldset>
      </form>
    </section>
  );
}
