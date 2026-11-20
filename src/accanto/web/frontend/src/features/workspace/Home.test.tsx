import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ComparisonGroup, ReviewResult } from "../../lib/monthly";
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
  accounts: { kind: "empty" as const },
  investments: { kind: "empty" as const },
  loans: { kind: "empty" as const },
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
  expect(saving.textContent).toContain("1 line with no entry");
  expect(screen.getByRole("row", { name: /Giving/ }).textContent).toContain(
    "$50.00 more than planned",
  );
  const needs = screen.getByRole("list", { name: "Needs you" });
  expect(within(needs).getByText("Synthetic goal has no November entry")).toBeDefined();
  const go = vi.fn();
  rerender(<Home {...props(review(group("1000.00", "400.00", "-600.00"), "-600.00"))} go={go} />);
  fireEvent.click(
    within(screen.getByRole("list", { name: "Needs you" })).getByRole("button", {
      name: /Synthetic goal has no November entry/,
    }),
  );
  expect(go).toHaveBeenCalledWith("review");

  // Another month has no today: its figures, without "this month" or a pace marker.
  rerender(
    <Home {...props(review(group("1000.00", "400.00", "-600.00"), "-600.00"), "2026-09")} />,
  );
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
