import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { describeSchedule } from "../../lib/schedules";
import { SCHEDULE_IDS, scheduleList } from "../../stories/mocks/schedules";
import { Schedules } from "./Schedules";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const entity = { id: "e", name: "Synthetic Entity", today: "2026-11-10", time_zone: "UTC" };

it("names the weekday rules the way people say them", () => {
  const monthly = {
    frequency: "monthly" as const,
    interval: 1,
    weekdays: [],
    week: null,
    weekday: null,
    month: null,
  };
  expect(describeSchedule({ ...monthly, month_day: -1, weekend: "before" })).toMatch(
    /last weekday/,
  );
  expect(describeSchedule({ ...monthly, month_day: 1, weekend: "after" })).toMatch(/first weekday/);
  expect(describeSchedule({ ...monthly, month_day: 15, weekend: "after" })).toMatch(
    /15th, or the weekday after when that is a weekend$/,
  );
});

it("pauses a schedule and skips one date with the schedule's own revision", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(
    async () => new Response(JSON.stringify(scheduleList())),
  );
  const save = vi.fn();
  render(
    <Schedules
      entity={entity}
      concealed={false}
      busy={false}
      refresh={0}
      guard={() => true}
      dirty={() => {}}
      save={save}
    />,
  );
  const row = (await screen.findByText("Payroll 401(k)")).closest("li") as HTMLElement;
  fireEvent.click(within(row).getByRole("button", { name: "Pause" }));
  const [paused] = save.mock.calls[0];
  expect(paused.method).toBe("PUT");
  expect(paused.path).toBe(`/api/entities/e/schedules/${SCHEDULE_IDS.payroll}`);
  expect(paused.body).toMatchObject({ paused: true, expected_revision: 2 });
  expect(paused.body.lines.map((l: { amount: string }) => l.amount)).toEqual([
    "1200.00",
    "1200.00",
  ]);
  const [first] = within(row).getAllByRole("button", { name: /^Skip / });
  fireEvent.click(first);
  const [skipped] = save.mock.calls[1];
  expect(skipped.path).toBe(
    `/api/entities/e/schedules/${SCHEDULE_IDS.payroll}/occurrences/2026-11-30`,
  );
  expect(skipped.body).toEqual({ skipped: true });
});
