import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ComparisonGroup, ReviewResult } from "../../lib/monthly";
import type { Routine } from "../../lib/routines";
import { Home } from "./Home";

afterEach(cleanup);

const group = (
  planned: string,
  recorded: string | null,
  difference: string | null,
  items: ComparisonGroup["items"] = [],
): ComparisonGroup => ({
  planned,
  recorded,
  incomplete: recorded === null || items.some((item) => item.recorded === null),
  difference,
  items,
  unplanned: [],
  adjustments: [],
});
const line = (name: string, planned: string, recorded: string | null) => ({
  id: name,
  name,
  planned,
  recorded,
  difference: null,
  entries: [],
});
const review = (spending: ComparisonGroup, spendingDifference: string | null) =>
  ({
    review: { uuid: "r", month: "2026-11-01", revision: 1, note: "", reviewed_at: null },
    version: { name: "Synthetic Plan", number: 2 },
    comparison: {
      income: group("4000.00", "4000.00", "0.00", [line("Salary", "4000.00", "4000.00")]),
      fixed_cost: group("1200.00", "1200.00", "0.00"),
      spending,
      saving: group("500.00", null, null, [line("Synthetic goal", "500.00", null)]),
      investing: group("0.00", null, null),
      giving: group("400.00", "450.00", "50.00"),
    },
    spending_difference: spendingDifference,
  }) as unknown as ReviewResult;
const props = (result: ReviewResult, month = "2026-11") => ({
  month,
  today: "2026-11-10",
  plans: 1,
  hasVersion: true,
  attention: [],
  recent: [],
  review: { kind: "ready" as const, data: result },
  worth: { kind: "empty" as const },
  open: vi.fn(),
  newPlan: vi.fn(),
  showPlans: vi.fn(),
  go: vi.fn(),
  retry: vi.fn(),
});

it("takes what is left from the API's difference and never shows a missing figure as zero", () => {
  const { rerender } = render(
    <Home {...props(review(group("1000.00", "400.00", "-600.00"), "-600.00"))} />,
  );
  expect(
    screen.getByRole("heading", { name: "$600.00 left to spend freely this month" }),
  ).toBeDefined();
  const saving = screen.getByRole("row", { name: /Saving/ });
  expect(saving.textContent).toContain("Unknown");
  expect(saving.textContent).not.toContain("$0.00");
  // November is running: its line with no entry is still to come, not something that needs you.
  expect(saving.textContent).toContain("1 still to come");
  expect(saving.textContent).not.toContain("no entry");
  expect(screen.getByRole("row", { name: /Giving/ }).textContent).toContain(
    "$50.00 more than planned",
  );
  expect(screen.queryByRole("list", { name: "Needs you" })).toBeNull();

  // An ended month: the same line warns, and Needs you, listed first, opens Review.
  const go = vi.fn();
  rerender(
    <Home
      {...props(review(group("1000.00", "400.00", "-600.00"), "-600.00"), "2026-09")}
      go={go}
    />,
  );
  expect(screen.getByRole("row", { name: /Saving/ }).textContent).toContain("1 line with no entry");
  const needs = screen.getByRole("list", { name: "Needs you" });
  expect(document.querySelector(".screen.home")?.firstElementChild?.contains(needs)).toBe(true);
  fireEvent.click(
    within(needs).getByRole("button", { name: /Synthetic goal has no September entry/ }),
  );
  expect(go).toHaveBeenCalledWith("review");
  // Another month has no today: its figures, without "this month" or a pace marker.
  expect(
    screen.getByRole("heading", { name: "$600.00 left of September's guilt-free plan" }),
  ).toBeDefined();
  expect(screen.queryByText(/Today is day/)).toBeNull();

  // Nothing recorded for spending: the API sends no difference, so Home claims nothing is left.
  rerender(<Home {...props(review(group("1000.00", null, null), null))} />);
  expect(screen.queryByText(/left to spend/)).toBeNull();
  expect(
    screen.getByRole("heading", {
      name: "$1,000.00 is planned for guilt-free spending this month",
    }),
  ).toBeDefined();
});
it("lists due and overdue routines in Needs you, even before the Entity has a Plan", () => {
  const routine = {
    uuid: "r1",
    name: "Synthetic check-in",
    cadence: {
      frequency: "weekly",
      interval: 1,
      weekdays: [4],
      month_day: null,
      week: null,
      weekday: null,
    },
    starts_on: "2026-11-01",
    active: true,
    revision: 1,
    steps: [],
    current: { scheduled_on: "2026-11-10", state: "due", done: 0, total: 1 },
    next_on: "2026-11-17",
    history: [],
  } as unknown as Routine;
  const openRoutine = vi.fn();
  render(
    <Home
      {...props(review(group("1.00", "1.00", "0.00"), "0.00"))}
      plans={0}
      routines={{
        kind: "ready",
        data: [
          routine,
          {
            ...routine,
            uuid: "r2",
            name: "Synthetic review",
            current: { scheduled_on: "2026-11-07", state: "overdue", done: 1, total: 2 },
          },
          {
            ...routine,
            uuid: "r3",
            name: "Synthetic done",
            current: { scheduled_on: "2026-11-10", state: "done", done: 1, total: 1 },
          },
          { ...routine, uuid: "r4", name: "Synthetic archived", active: false },
        ],
      }}
      openRoutine={openRoutine}
    />,
  );
  expect(screen.getByRole("button", { name: "Create your first Plan" })).toBeDefined();
  fireEvent.click(
    within(screen.getByRole("list", { name: "Needs you" })).getByRole("button", {
      name: "Synthetic check-in is due today Open",
    }),
  );
  expect(openRoutine).toHaveBeenCalledWith("r1", "2026-11-10");
  const needs = screen.getByRole("list", { name: "Needs you" });
  expect(
    within(needs)
      .getAllByRole("button")
      .map((b) => b.textContent),
  ).toEqual(["Synthetic check-in is due todayOpen", "Synthetic review is 3 days overdueOpen"]);
});

it("shows each reached spending alert once, with amounts, and lets it be dismissed", () => {
  const base = {
    category: "spending" as const,
    spending_subcategory_id: null,
    fixed_cost_id: null,
    revision: 1,
    waiting: null,
    dismissed: false,
  };
  const dismissAlert = vi.fn();
  render(
    <Home
      {...props(review(group("1000.00", "400.00", "-600.00"), "-600.00"))}
      dismissAlert={dismissAlert}
      alerts={{
        kind: "ready",
        data: {
          month: "2026-11",
          version: { uuid: "v", name: "Synthetic Plan", number: 2 },
          spending_alerts: [
            // $187.50 of $150.00 is 125%: $37.50 over, named by its highest threshold.
            {
              ...base,
              uuid: "eat",
              name: "Eating out",
              thresholds: [70, 100, 125],
              basis: "estimate",
              amount: "150.00",
              recorded: "187.50",
              percent: 125,
              reached: 125,
            },
            {
              ...base,
              uuid: "below",
              name: "Books",
              thresholds: [70],
              basis: "estimate",
              amount: "50.00",
              recorded: "34.99",
              percent: 69,
              reached: null,
            },
            {
              ...base,
              uuid: "gone",
              name: "Rent",
              thresholds: [100],
              basis: "planned",
              amount: "900.00",
              recorded: "900.00",
              percent: 100,
              reached: 100,
              dismissed: true,
            },
          ],
        },
      }}
    />,
  );
  const needs = screen.getByRole("list", { name: "Needs you" });
  const items = within(needs).getAllByRole("listitem");
  expect(items).toHaveLength(1);
  expect(items[0].textContent).toContain("Eating out passed 125% of its estimate");
  expect(items[0].textContent).toContain("$187.50 of $150.00 recorded (125%), $37.50 over");
  fireEvent.click(within(items[0]).getByRole("button", { name: /Dismiss/ }));
  expect(dismissAlert).toHaveBeenCalledWith("eat");
});
