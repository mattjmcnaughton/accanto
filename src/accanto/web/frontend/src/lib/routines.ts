/**
 * Routines: per-Entity checklists on a simple cadence. They are not financial records; ticking a
 * step records nothing, and only a person ticks one. The API derives every date and state.
 */
import { type IsoDate, type LoadState, type UUID, loadResource } from "./api";
import type { WriteSpec } from "./monthly";

export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export const WEEKDAYS: [Weekday, string][] = [
  ["mon", "Monday"],
  ["tue", "Tuesday"],
  ["wed", "Wednesday"],
  ["thu", "Thursday"],
  ["fri", "Friday"],
  ["sat", "Saturday"],
  ["sun", "Sunday"],
];
export type Frequency = "weekly" | "monthly" | "yearly";
/**
 * weekly: weekdays. monthly: month_day (1–28, or −1 for the last day), or week (1–4, or −1 for
 * the last) with weekday. yearly: month with month_day. Unused fields are null or empty.
 */
export interface Cadence {
  frequency: Frequency;
  interval: number;
  weekdays: Weekday[];
  month_day: number | null;
  week: number | null;
  weekday: Weekday | null;
  month: number | null;
}
/** The accanto screens a step can open; the three monthly ones also take a month offset. */
export const LINK_SCREENS = [
  ["home", "Home"],
  ["activity", "Activity"],
  ["inbox", "Transactions inbox"],
  ["review", "Review"],
  ["plans", "Plans"],
  ["routines", "Routines"],
  ["savings", "Savings"],
  ["investments", "Investments"],
  ["giving", "Giving"],
  ["loans", "Loans"],
  ["settings", "Settings"],
] as const;
export type LinkScreen = (typeof LINK_SCREENS)[number][0];
export const MONTHLY_SCREENS: LinkScreen[] = ["home", "activity", "review"];

export interface StepInput {
  step_id?: UUID;
  title: string;
  /** At most one of link_screen and link_url. */
  link_screen: LinkScreen | null;
  /** Months from the occurrence's scheduled date, for monthly screens only: −1 is the month before. */
  link_month_offset: number | null;
  /** https only; opens in a new tab. */
  link_url: string | null;
}
export interface RoutineStep extends Omit<StepInput, "step_id"> {
  uuid: UUID;
}
export interface RoutineInput {
  name: string;
  cadence: Cadence;
  starts_on: IsoDate;
  steps: StepInput[];
  active?: boolean;
  expected_revision?: number;
}
/** Derived at read time from the cadence and the Entity's today; done and skipped are stored. */
export type OccurrenceState = "upcoming" | "due" | "overdue" | "missed" | "done" | "skipped";
export interface OccurrenceSummary {
  scheduled_on: IsoDate;
  state: OccurrenceState;
  /** Steps ticked or skipped, of the routine's steps. */
  done: number;
  total: number;
}
export interface Routine {
  uuid: UUID;
  name: string;
  cadence: Cadence;
  starts_on: IsoDate;
  active: boolean;
  revision: number;
  steps: RoutineStep[];
  /** The latest scheduled date on or before today; null before the first one. */
  current: OccurrenceSummary | null;
  /** The first scheduled date after today. */
  next_on: IsoDate | null;
  /** Up to the last 12 scheduled dates on or before today, oldest first, current included. */
  history: OccurrenceSummary[];
}
export type StepStatus = "done" | "skipped";
export interface OccurrenceStep {
  step_id: UUID;
  title: string;
  link_screen: LinkScreen | null;
  link_month_offset: number | null;
  link_url: string | null;
  status: StepStatus | null;
  note: string;
}
export interface Occurrence {
  routine_id: UUID;
  scheduled_on: IsoDate;
  /** The next scheduled date, when this occurrence becomes missed if it is not done. */
  next_on: IsoDate | null;
  state: OccurrenceState;
  /** Skipped means the whole occurrence was skipped; done follows from every step. */
  skipped: boolean;
  completed_on: IsoDate | null;
  note: string;
  /** 0 until the first action stores the occurrence. */
  revision: number;
  steps: OccurrenceStep[];
}

const root = (entityId: UUID) => `/api/entities/${encodeURIComponent(entityId)}/routines`;
const target = (id: string) => encodeURIComponent(id);
const occurrence = (entityId: UUID, id: UUID, on: IsoDate) =>
  `${root(entityId)}/${target(id)}/occurrences/${target(on)}`;

export const routines = {
  list: (entityId: UUID): Promise<LoadState<Routine[]>> =>
    loadResource(root(entityId), (records) => records.length === 0),
  occurrence: (entityId: UUID, id: UUID, on: IsoDate): Promise<LoadState<Occurrence>> =>
    loadResource(occurrence(entityId, id, on), () => false),
  create: (entityId: UUID, body: RoutineInput): WriteSpec<Routine> => ({
    method: "POST",
    path: root(entityId),
    body,
  }),
  edit: (entityId: UUID, id: UUID, body: RoutineInput): WriteSpec<Routine> => ({
    method: "PUT",
    path: `${root(entityId)}/${target(id)}`,
    body,
  }),
  /** Ticks, skips or clears (status null) one step. Runs directly: it records nothing financial. */
  setStep: (
    entityId: UUID,
    id: UUID,
    on: IsoDate,
    stepId: UUID,
    body: { status: StepStatus | null; note?: string },
  ): WriteSpec<Occurrence> => ({
    method: "PUT",
    path: `${occurrence(entityId, id, on)}/steps/${target(stepId)}`,
    body,
  }),
  /** Skips or reopens the whole occurrence, or edits its note. */
  setOccurrence: (
    entityId: UUID,
    id: UUID,
    on: IsoDate,
    body: { skipped: boolean; note: string; expected_revision: number },
  ): WriteSpec<Occurrence> => ({
    method: "PUT",
    path: occurrence(entityId, id, on),
    body,
  }),
};

const ORDINAL = ["", "first", "second", "third", "fourth"];
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
const dayName = (day: Weekday | null) => WEEKDAYS.find(([value]) => value === day)?.[1] ?? "";
export const ordinalDay = (n: number) =>
  `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th")}`;
const list = (items: string[]) =>
  items.length <= 2
    ? items.join(" and ")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

/** "Weekly on Saturday", "Every 2 weeks on Monday and Thursday", "Monthly on the last day". */
export function describeCadence(c: Cadence): string {
  const unit = { weekly: "week", monthly: "month", yearly: "year" }[c.frequency];
  const every =
    c.interval === 1
      ? { weekly: "Weekly", monthly: "Monthly", yearly: "Yearly" }[c.frequency]
      : `Every ${c.interval} ${unit}s`;
  if (c.frequency === "weekly")
    return `${every} on ${list(WEEKDAYS.filter(([d]) => c.weekdays.includes(d)).map(([, n]) => n))}`;
  if (c.frequency === "monthly") {
    if (c.week !== null && c.weekday)
      return `${every} on the ${c.week === -1 ? "last" : ORDINAL[c.week]} ${dayName(c.weekday)}`;
    return `${every} on the ${c.month_day === -1 ? "last day" : ordinalDay(c.month_day ?? 1)}`;
  }
  const month = MONTHS[(c.month ?? 1) - 1];
  return c.month_day === -1
    ? `${every} on the last day of ${month}`
    : `${every} on ${month.slice(0, 3)} ${c.month_day ?? 1}`;
}

const SHORT_DAY = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
/** "Sat Nov 7", with the year when it is not the year of `today`. */
export function dayLabel(iso: IsoDate, today: IsoDate): string {
  const label = SHORT_DAY.format(new Date(`${iso}T00:00:00Z`)).replace(",", "");
  return iso.slice(0, 4) === today.slice(0, 4) ? label : `${label}, ${iso.slice(0, 4)}`;
}

/** The month a step's link opens: the occurrence's month moved by the offset, YYYY-MM. */
export function linkMonth(scheduledOn: IsoDate, offset: number): string {
  const [year, month] = scheduledOn.split("-").map(Number);
  const index = year * 12 + (month - 1) + offset;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}
