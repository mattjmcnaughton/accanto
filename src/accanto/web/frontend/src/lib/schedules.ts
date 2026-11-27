/**
 * Entry schedules (TDD 18): entries that come back on a cadence, such as a paycheck and the
 * 401(k) contribution it funds. The hourly job stages each due date once as waiting Transactions
 * inbox items with the planned completion as their proposal; accepting them records them.
 */
import type { DecimalString, IsoDate, LoadState, UUID } from "./api";
import { loadResource } from "./api";
import type { InboxCategory, InboxStatus, Rejection } from "./inbox";
import type { WriteSpec } from "./monthly";
import { type Cadence, describeCadence } from "./routines";

/** Moves a date that falls on a weekend to the weekday before or after, within its month. */
export type Weekend = "before" | "after" | null;
export interface ScheduleCadence extends Cadence {
  weekend: Weekend;
}
export interface ScheduleLineInput {
  category: InboxCategory;
  /** Positive, exact cents. */
  amount: DecimalString;
  note: string;
  /** A record id, or "unassigned"; saving always names a goal. */
  assignment: string | null;
  /** Outflows to spend, invest or give: "income" (the default) or a saving goal id. */
  funding: string | null;
  tag_ids: UUID[];
}
export interface ScheduleLine extends ScheduleLineInput {
  /** Names resolved at read time; null for Unassigned. */
  assignment_name: string | null;
  funding_name: string | null;
}
export interface ScheduleInput {
  name: string;
  cadence: ScheduleCadence;
  starts_on: IsoDate;
  ends_on: IsoDate | null;
  paused: boolean;
  lines: ScheduleLineInput[];
  expected_revision?: number;
}
export type ScheduleState = "active" | "paused" | "ended";
export type OccurrenceStatus = "staged" | "skipped" | "failed";
export interface ScheduleOccurrence {
  scheduled_on: IsoDate;
  status: OccurrenceStatus;
  /** Why a failed date was not staged; the job tries it again every hour. */
  rejection: Rejection | null;
  /** The date's inbox items and where each one is now. */
  items: Array<{ id: UUID; status: InboxStatus }>;
  staged_at: string | null;
}
export interface Schedule {
  uuid: UUID;
  name: string;
  cadence: ScheduleCadence;
  starts_on: IsoDate;
  ends_on: IsoDate | null;
  paused: boolean;
  revision: number;
  lines: ScheduleLine[];
  state: ScheduleState;
  /** The next date the job will stage, after any skipped ones; null when paused or ended. */
  next_on: IsoDate | null;
  /** The next few scheduled dates, skipped ones included. */
  upcoming: Array<{ scheduled_on: IsoDate; skipped: boolean }>;
  /** The latest stored occurrences, newest first. */
  recent: ScheduleOccurrence[];
}

const root = (entityId: UUID) => `/api/entities/${encodeURIComponent(entityId)}/schedules`;
const target = (id: string) => encodeURIComponent(id);

export const schedules = {
  list: (entityId: UUID): Promise<LoadState<Schedule[]>> =>
    loadResource(root(entityId), (records) => records.length === 0),
  create: (entityId: UUID, body: ScheduleInput): WriteSpec<Schedule> => ({
    method: "POST",
    path: root(entityId),
    body,
  }),
  edit: (entityId: UUID, id: UUID, body: ScheduleInput): WriteSpec<Schedule> => ({
    method: "PUT",
    path: `${root(entityId)}/${target(id)}`,
    body,
  }),
  /** Skips one upcoming date (or a failed one), or puts a skipped upcoming date back. */
  skip: (entityId: UUID, id: UUID, on: IsoDate, skipped: boolean): WriteSpec<Schedule> => ({
    method: "PUT",
    path: `${root(entityId)}/${target(id)}/occurrences/${target(on)}`,
    body: { skipped },
  }),
};

/** The input that saves a schedule unchanged except for `next`. */
export function inputOf(s: Schedule, next: Partial<ScheduleInput> = {}): ScheduleInput {
  return {
    name: s.name,
    cadence: s.cadence,
    starts_on: s.starts_on,
    ends_on: s.ends_on,
    paused: s.paused,
    lines: s.lines.map(({ category, amount, note, assignment, funding, tag_ids }) => ({
      category,
      amount,
      note,
      assignment,
      funding,
      tag_ids,
    })),
    expected_revision: s.revision,
    ...next,
  };
}

/** "Monthly on the last day, or the weekday before". */
export function describeSchedule(c: ScheduleCadence): string {
  const base = describeCadence(c);
  if (!c.weekend) return base;
  const monthly = c.frequency === "monthly" && c.week === null;
  if (monthly && c.month_day === -1 && c.weekend === "before")
    return base.replace("last day", "last weekday");
  if (monthly && c.month_day === 1 && c.weekend === "after")
    return base.replace("1st", "first weekday");
  return `${base}, or the weekday ${c.weekend} when that is a weekend`;
}
