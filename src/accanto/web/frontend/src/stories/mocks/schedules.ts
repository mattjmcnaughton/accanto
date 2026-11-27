/**
 * Synthetic entry schedules for stories, relative to the fixture Entity's today, Tue 2026-11-10.
 * Names and amounts are invented; references point at the fixture workspace's records.
 */
import type { Schedule, ScheduleCadence } from "../../lib/schedules";

const monthlyOn = (
  month_day: number,
  weekend: ScheduleCadence["weekend"] = null,
): ScheduleCadence => ({
  frequency: "monthly",
  interval: 1,
  weekdays: [],
  month_day,
  week: null,
  weekday: null,
  month: null,
  weekend,
});
const ids = (n: number) =>
  Array.from({ length: n }, (_, i) => `5c4ed000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`);

export const SCHEDULE_IDS = {
  payroll: "5c4e0000-0000-4000-8000-000000000001",
  index: "5c4e0000-0000-4000-8000-000000000002",
  kitchen: "5c4e0000-0000-4000-8000-000000000003",
  loan: "5c4e0000-0000-4000-8000-000000000004",
};

export const scheduleList = (): Schedule[] => [
  {
    uuid: SCHEDULE_IDS.payroll,
    name: "Payroll 401(k)",
    cadence: monthlyOn(-1, "before"),
    starts_on: "2026-09-01",
    ends_on: null,
    paused: false,
    revision: 2,
    lines: [
      {
        category: "income",
        amount: "1200.00",
        note: "401(k) deferral",
        assignment: "8fa97fe8-4901-41cc-8796-cf84eaf97119",
        assignment_name: "Primary pay",
        funding: null,
        funding_name: null,
        tag_ids: [],
      },
      {
        category: "investing",
        amount: "1200.00",
        note: "401(k) contribution",
        assignment: "848f2d7d-0096-42de-a4e1-c492fba6f588",
        assignment_name: "Fixture long-term fund",
        funding: "income",
        funding_name: null,
        tag_ids: [],
      },
    ],
    state: "active",
    next_on: "2026-11-30",
    upcoming: [
      { scheduled_on: "2026-11-30", skipped: false },
      { scheduled_on: "2026-12-31", skipped: true },
      { scheduled_on: "2027-01-29", skipped: false },
    ],
    recent: [
      {
        scheduled_on: "2026-10-30",
        status: "staged",
        rejection: null,
        items: [
          { id: ids(2)[0], status: "recorded" },
          { id: ids(2)[1], status: "recorded" },
        ],
        staged_at: "2026-10-30T01:04:00Z",
      },
      {
        scheduled_on: "2026-09-30",
        status: "staged",
        rejection: null,
        items: [
          { id: ids(2)[0], status: "recorded" },
          { id: ids(2)[1], status: "recorded" },
        ],
        staged_at: "2026-09-30T01:02:00Z",
      },
    ],
  },
  {
    uuid: SCHEDULE_IDS.index,
    name: "Index fund from reserve",
    cadence: monthlyOn(15, "after"),
    starts_on: "2026-10-01",
    ends_on: null,
    paused: false,
    revision: 1,
    lines: [
      {
        category: "investing",
        amount: "250.00",
        note: "Monthly buy",
        assignment: "f2d5cf5d-2b35-441e-b763-21f417f9e1ed",
        assignment_name: "Fixture index fund",
        funding: "86a0ed21-6634-4dd1-b687-a9f654c80402",
        funding_name: "Fixture reserve · Unallocated",
        tag_ids: [],
      },
    ],
    state: "active",
    next_on: "2026-11-16",
    upcoming: [
      { scheduled_on: "2026-11-16", skipped: false },
      { scheduled_on: "2026-12-15", skipped: false },
      { scheduled_on: "2027-01-15", skipped: false },
    ],
    recent: [
      {
        scheduled_on: "2026-10-15",
        status: "failed",
        rejection: {
          code: "invalid_line",
          message: "Entry 1: the funding goal is unavailable.",
        },
        items: [],
        staged_at: null,
      },
    ],
  },
  {
    uuid: SCHEDULE_IDS.kitchen,
    name: "Community kitchen",
    cadence: {
      frequency: "monthly",
      interval: 1,
      weekdays: [],
      month_day: null,
      week: 1,
      weekday: "sun",
      month: null,
      weekend: null,
    },
    starts_on: "2026-08-01",
    ends_on: null,
    paused: true,
    revision: 3,
    lines: [
      {
        category: "giving",
        amount: "40.00",
        note: "",
        assignment: "adfc1a96-d20b-42f9-b488-c0d1f2f0fa00",
        assignment_name: "Fixture community kitchen",
        funding: "income",
        funding_name: null,
        tag_ids: [],
      },
    ],
    state: "paused",
    next_on: null,
    upcoming: [],
    recent: [
      {
        scheduled_on: "2026-10-04",
        status: "staged",
        rejection: null,
        items: [{ id: ids(1)[0], status: "recorded" }],
        staged_at: "2026-10-04T01:03:00Z",
      },
    ],
  },
  {
    uuid: SCHEDULE_IDS.loan,
    name: "Education loan payment",
    cadence: monthlyOn(5),
    starts_on: "2026-01-05",
    ends_on: "2026-08-31",
    paused: false,
    revision: 4,
    lines: [
      {
        category: "fixed_cost",
        amount: "210.00",
        note: "",
        assignment: null,
        assignment_name: null,
        funding: "income",
        funding_name: null,
        tag_ids: [],
      },
    ],
    state: "ended",
    next_on: null,
    upcoming: [],
    recent: [
      {
        scheduled_on: "2026-08-05",
        status: "staged",
        rejection: null,
        items: [{ id: ids(1)[0], status: "recorded" }],
        staged_at: "2026-08-05T01:01:00Z",
      },
    ],
  },
];
