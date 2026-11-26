/**
 * A stateful, synthetic set of routines for stories: the list, occurrence reads and the tick,
 * skip and note commands, so ticking in Storybook persists until the story reloads. Dates are
 * relative to the fixture Entity's today, Tue 2026-11-10. The backend is the authority on every
 * date and state; this only imitates it closely enough to show each one.
 */
import { http, HttpResponse, delay } from "msw";
import type { IsoDate } from "../../lib/api";
import type {
  Occurrence,
  OccurrenceState,
  OccurrenceSummary,
  Routine,
  RoutineInput,
  RoutineStep,
  StepStatus,
} from "../../lib/routines";
import { entity } from "./fixtures";

const route = "/api/entities/:entity/routines";
const TODAY = entity.today;
const addDays = (iso: IsoDate, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
let serial = 0;
const id = (prefix: string) => {
  serial += 1;
  return `${prefix}-0000-4000-8000-${String(serial).padStart(12, "0")}`;
};
const step = (
  title: string,
  link: Partial<Pick<RoutineStep, "link_screen" | "link_month_offset" | "link_url">> = {},
): RoutineStep => ({
  uuid: id("5e9b0000"),
  title,
  link_screen: null,
  link_month_offset: null,
  link_url: null,
  ...link,
});
const none = { weekdays: [], month_day: null, week: null, weekday: null, month: null };

type Stored = { status: StepStatus; note: string };
type Record = {
  routine: Omit<Routine, "current" | "next_on" | "history">;
  /** Scheduled dates on or before today, oldest first, then the next one. */
  dates: IsoDate[];
  next: IsoDate | null;
  ticks: Map<string, Map<string, Stored>>;
  skipped: Map<string, string>;
  completed: Map<string, IsoDate>;
};

function seed(): Record[] {
  serial = 0;
  // Weekly on Saturday: Nov 7 is three days overdue, with a miss in the history.
  const saturdays = Array.from({ length: 12 }, (_, i) => addDays("2026-11-07", -7 * (11 - i)));
  const weekly = [
    step("Pay the credit card", { link_url: "https://bank.example.com" }),
    step("Buy index fund", { link_screen: "investments" }),
    step("Process transactions", { link_screen: "inbox" }),
    step("Check checking account", { link_url: "https://bank.example.com" }),
  ];
  // [steps done, skipped note] per Saturday, oldest first; the last is the current one.
  const plan: [number, string?][] = [
    [4],
    [4],
    [2],
    [4],
    [4],
    [0],
    [4],
    [4],
    [4],
    [0, "Away this week"],
    [4],
    [1],
  ];
  const sat: Record = {
    routine: {
      uuid: "a0e1c000-0000-4000-8000-000000000001",
      name: "Saturday money check",
      cadence: { frequency: "weekly", interval: 1, ...none, weekdays: ["sat"] },
      starts_on: "2026-08-01",
      active: true,
      revision: 3,
      steps: weekly,
    },
    dates: saturdays,
    next: "2026-11-14",
    ticks: new Map(),
    skipped: new Map(),
    completed: new Map(),
  };
  saturdays.forEach((on, i) => {
    const [done, skip] = plan[i];
    if (skip !== undefined) sat.skipped.set(on, skip);
    const ticks = new Map<string, Stored>();
    for (const s of weekly.slice(0, done))
      ticks.set(s.uuid, {
        status: "done",
        note: i === 4 && s.title.startsWith("Check") ? "Looked fine; one pending deposit." : "",
      });
    sat.ticks.set(on, ticks);
    if (done === weekly.length) sat.completed.set(on, addDays(on, i % 3));
  });
  // Buy index fund is ticked for Nov 7 already.
  sat.ticks.set("2026-11-07", new Map([[weekly[1].uuid, { status: "done", note: "" }]]));

  const monthlySteps = [
    step("Review last month's budget", { link_screen: "review", link_month_offset: -1 }),
    step("Adjust this month's Plan if needed", { link_screen: "plans" }),
  ];
  const firsts = Array.from({ length: 11 }, (_, i) => `2026-${String(i + 1).padStart(2, "0")}-01`);
  const monthly: Record = {
    routine: {
      uuid: "a0e1c000-0000-4000-8000-000000000002",
      name: "Monthly review",
      cadence: { frequency: "monthly", interval: 1, ...none, month_day: 1 },
      starts_on: "2026-01-01",
      active: true,
      revision: 1,
      steps: monthlySteps,
    },
    dates: firsts,
    next: "2026-12-01",
    ticks: new Map(
      firsts.map((on) => [
        on,
        new Map(monthlySteps.map((s) => [s.uuid, { status: "done" as const, note: "" }])),
      ]),
    ),
    skipped: new Map(),
    completed: new Map(firsts.map((on) => [on, addDays(on, 1)])),
  };

  const yearly: Record = {
    routine: {
      uuid: "a0e1c000-0000-4000-8000-000000000003",
      name: "Year-end money review",
      cadence: { frequency: "yearly", interval: 1, ...none, month: 1, month_day: 15 },
      starts_on: "2027-01-15",
      active: true,
      revision: 1,
      steps: [
        step("Review last year's savings", { link_screen: "savings" }),
        step("Set next year's giving targets", { link_screen: "giving" }),
        step("Copy next year's Plan", { link_screen: "plans" }),
        step("Check loan balances", { link_screen: "loans" }),
        step("Note anything to change next year"),
      ],
    },
    dates: [],
    next: "2027-01-15",
    ticks: new Map(),
    skipped: new Map(),
    completed: new Map(),
  };

  const archived: Record = {
    routine: {
      uuid: "a0e1c000-0000-4000-8000-000000000004",
      name: "Move-in checklist",
      cadence: { frequency: "monthly", interval: 1, ...none, week: 1, weekday: "sat" },
      starts_on: "2026-03-07",
      active: false,
      revision: 2,
      steps: [step("Read the utility meters"), step("Split the shared bills")],
    },
    dates: [],
    next: null,
    ticks: new Map(),
    skipped: new Map(),
    completed: new Map(),
  };
  return [sat, monthly, yearly, archived];
}

function stateOf(r: Record, on: IsoDate): OccurrenceState {
  if (r.skipped.has(on)) return "skipped";
  const ticks = r.ticks.get(on);
  if (ticks && r.routine.steps.every((s) => ticks.has(s.uuid))) return "done";
  if (on > TODAY) return "upcoming";
  if (on === TODAY) return "due";
  const after = r.dates[r.dates.indexOf(on) + 1] ?? r.next;
  return after && after <= TODAY ? "missed" : "overdue";
}
function summary(r: Record, on: IsoDate): OccurrenceSummary {
  return {
    scheduled_on: on,
    state: stateOf(r, on),
    done: r.ticks.get(on)?.size ?? 0,
    total: r.routine.steps.length,
  };
}
function routine(r: Record): Routine {
  const history = r.dates.slice(-12).map((on) => summary(r, on));
  return { ...r.routine, current: history[history.length - 1] ?? null, next_on: r.next, history };
}
function occurrence(r: Record, on: IsoDate): Occurrence {
  const ticks = r.ticks.get(on) ?? new Map<string, Stored>();
  return {
    routine_id: r.routine.uuid,
    scheduled_on: on,
    next_on: r.dates[r.dates.indexOf(on) + 1] ?? r.next,
    state: stateOf(r, on),
    skipped: r.skipped.has(on),
    completed_on: r.completed.get(on) ?? null,
    note: r.skipped.get(on) ?? "",
    revision: ticks.size || r.skipped.has(on) ? 1 : 0,
    steps: r.routine.steps.map((s) => ({
      step_id: s.uuid,
      title: s.title,
      link_screen: s.link_screen,
      link_month_offset: s.link_month_offset,
      link_url: s.link_url,
      status: ticks.get(s.uuid)?.status ?? null,
      note: ticks.get(s.uuid)?.note ?? "",
    })),
  };
}
const missing = () =>
  HttpResponse.json(
    { detail: { code: "routine_not_found", message: "Routine not found." } },
    { status: 404 },
  );

/** Today's date is unchanged; a story can make the Saturday routine due today instead. */
export function routinesApi({ dueToday = false, allDone = false } = {}) {
  let records = seed();
  const sat = records[0];
  if (dueToday) {
    sat.dates = [...sat.dates.slice(1), TODAY];
    sat.ticks.set(TODAY, new Map());
    sat.next = addDays(TODAY, 7);
  }
  if (allDone)
    for (const s of sat.routine.steps)
      sat.ticks.get("2026-11-07")?.set(s.uuid, { status: "done", note: "" });
  const find = (uuid: unknown) => records.find((r) => r.routine.uuid === uuid);
  const settle = (r: Record, on: IsoDate) => {
    if (stateOf(r, on) === "done") {
      if (!r.completed.has(on)) r.completed.set(on, TODAY);
    } else r.completed.delete(on);
  };
  return {
    reset: () => {
      records = seed();
    },
    handlers: [
      http.get(route, () => HttpResponse.json(records.map(routine))),
      http.get(`${route}/:routine/occurrences/:on`, async ({ params }) => {
        const r = find(params.routine);
        await delay(150);
        return r ? HttpResponse.json(occurrence(r, String(params.on))) : missing();
      }),
      http.put(`${route}/:routine/occurrences/:on/steps/:step`, async ({ params, request }) => {
        const r = find(params.routine);
        if (!r) return missing();
        const on = String(params.on);
        const body = (await request.json()) as { status: StepStatus | null; note?: string };
        const ticks = r.ticks.get(on) ?? new Map<string, Stored>();
        r.ticks.set(on, ticks);
        const before = ticks.get(String(params.step));
        if (body.status === null) ticks.delete(String(params.step));
        else
          ticks.set(String(params.step), {
            status: body.status,
            note: body.note ?? before?.note ?? "",
          });
        settle(r, on);
        await delay(250);
        return HttpResponse.json(occurrence(r, on));
      }),
      http.put(`${route}/:routine/occurrences/:on`, async ({ params, request }) => {
        const r = find(params.routine);
        if (!r) return missing();
        const on = String(params.on);
        const body = (await request.json()) as { skipped: boolean; note: string };
        if (body.skipped) r.skipped.set(on, body.note);
        else r.skipped.delete(on);
        await delay(250);
        return HttpResponse.json(occurrence(r, on));
      }),
      http.post(route, async ({ request }) => {
        const body = (await request.json()) as RoutineInput;
        const created: Record = {
          routine: {
            uuid: id("a0e1c000"),
            name: body.name,
            cadence: body.cadence,
            starts_on: body.starts_on,
            active: true,
            revision: 1,
            steps: body.steps.map((s) => ({ ...s, uuid: s.step_id ?? id("5e9b0000") })),
          },
          dates: [],
          next: body.starts_on,
          ticks: new Map(),
          skipped: new Map(),
          completed: new Map(),
        };
        records.push(created);
        return HttpResponse.json(routine(created));
      }),
      http.put(`${route}/:routine`, async ({ params, request }) => {
        const r = find(params.routine);
        if (!r) return missing();
        const body = (await request.json()) as RoutineInput;
        r.routine = {
          ...r.routine,
          name: body.name,
          cadence: body.cadence,
          active: body.active ?? r.routine.active,
          revision: r.routine.revision + 1,
          steps: body.steps.map((s) => ({ ...s, uuid: s.step_id ?? id("5e9b0000") })),
        };
        return HttpResponse.json(routine(r));
      }),
    ],
  };
}
export const ROUTINE_IDS = {
  saturday: "a0e1c000-0000-4000-8000-000000000001",
  monthly: "a0e1c000-0000-4000-8000-000000000002",
};

/** The seeded list, for stories that only read it, such as Home. */
export const routineList = (): Routine[] => seed().map(routine);
