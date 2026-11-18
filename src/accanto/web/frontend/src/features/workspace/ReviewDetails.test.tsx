import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { Activity, ComparisonGroup, Metric, PlanRevision } from "../../lib/monthly";
import { Metrics, ReviewDetails, type ReviewView } from "./ReviewDetails";

afterEach(cleanup);
const metric: Metric = {
  key: "fixed",
  basis: "planned",
  label: "Fixed costs ÷ net income",
  numerator_label: "Fixed costs",
  denominator_label: "Net income",
  numerator: "2500.00",
  denominator: "4000.00",
  percentage: "62.50",
  unavailable_reason: null,
  components: [{ name: "Net income", amount: "4000.00" }],
};
const version: PlanRevision = {
  uuid: "v1",
  name: "Baseline",
  number: 1,
  revision: 1,
  saved: true,
  saved_at: "2026-10-01",
  updated_at: null,
  rule_version: "1",
  incomes: [{ source_id: "source", name: "Synthetic source", amount: "4000.00" }],
  fixed_costs: [],
  fixed_cost_total: "0.00",
  income: "4000.00",
  spending: "800.00",
  tithe_target: "400.00",
  unassigned: "3200.00",
};
const base: ReviewView = {
  version,
  entries: [],
  actual: {
    income_recorded: "25.00",
    income_incomplete: true,
    missing_sources: ["source"],
    spending_recorded: null,
    fixed_cost_recorded: "0.00",
    fixed_cost_incomplete: false,
    missing_fixed_costs: [],
  },
  income_difference: null,
  spending_difference: null,
  fixed_cost_difference: "0.00",
};
const row = (name: string) => screen.getByRole("row", { name: new RegExp(name) });

it("discloses planned and actual formulas, component amounts and unavailable reasons independently", () => {
  render(
    <Metrics
      title="Ratios"
      metrics={[
        metric,
        {
          ...metric,
          basis: "actual",
          numerator: "2000.00",
          denominator: null,
          percentage: null,
          unavailable_reason: "Income is incomplete.",
        },
      ]}
    />,
  );
  const [planned, actual] = screen.getAllByRole("row", { name: /Fixed costs ÷ net income/ });
  expect(within(planned).getByText("Planned")).toBeDefined();
  expect(within(planned).getByText("62.50%")).toBeDefined();
  expect(within(planned).getByText("$2500.00 ÷ $4000.00 × 100")).toBeDefined();
  expect(within(actual).getByText("Actual")).toBeDefined();
  expect(within(actual).getByText("Unavailable")).toBeDefined();
  expect(within(actual).getByText("$2000.00 ÷ Unknown × 100")).toBeDefined();
  expect(within(actual).getByText("Unavailable: Income is incomplete.")).toBeDefined();
  const line = within(screen.getByRole("table"));
  expect(line.getAllByText("Net income: $4000.00")).toHaveLength(2);
});

it("keeps missing identities unknown and exposes unplanned contributors and already-included adjustments", () => {
  const entry: Activity = {
    uuid: "entry",
    financial_date: "2026-10-01",
    category: "income",
    amount: "25.00",
    source_id: null,
    fixed_cost_id: null,
    fixed_cost_name: null,
    debt_account_id: null,
    note: "Synthetic correction",
    revision: 1,
    is_adjustment: true,
    funding_origin: "income",
    saving_goal_id: null,
  };
  const empty: ComparisonGroup = {
    planned: "0.00",
    recorded: null,
    incomplete: true,
    difference: null,
    items: [],
    unplanned: [],
    adjustments: [],
  };
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  render(
    <ReviewDetails
      review={{
        ...base,
        comparison: {
          income: {
            ...empty,
            planned: "4000.00",
            recorded: "25.00",
            items: [
              {
                id: "source",
                name: "Synthetic source",
                planned: "4000.00",
                recorded: null,
                difference: null,
                entries: [],
              },
            ],
            unplanned: [entry],
            adjustments: [entry],
          },
          fixed_cost: { ...empty, recorded: "0.00", incomplete: false, difference: "0.00" },
          spending: empty,
          saving: empty,
          investing: empty,
          giving: empty,
        },
        summary: {
          new_saving: "500.00",
          savings_used: "1000.00",
          net_saving: "-500.00",
          total_investing: "2000.00",
          income_funded_investing: "0.00",
          income_funded_fixed_cost: null,
        },
      }}
    />,
  );
  // Recorded $25 stays visible while the group remains incomplete; the missing source is Unknown, not $0.
  expect(row("Net income").textContent).toContain("$25.00");
  expect(row("Net income").textContent).toContain("Incomplete");
  const source = row("Synthetic source");
  expect(source.textContent).toContain("$4000.00");
  expect(within(source).getAllByText("Unknown")).toHaveLength(3);
  expect(source.textContent).not.toContain("$0.00");
  // An explicit zero is known and complete.
  expect(row("Fixed costs").textContent).not.toContain("Unknown");
  // Contributors are collapsed until expanded, then appear once in each list.
  expect(screen.queryByText(/Synthetic correction/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Expand Unplanned activity (1)" }));
  fireEvent.click(screen.getByRole("button", { name: "Expand Adjustments, already included (1)" }));
  expect(
    screen.getAllByText("2026-10-01 · Income-funded · Adjustment · Synthetic correction"),
  ).toHaveLength(2);
  // Listing one entry under two parents must not collide on React keys or cell ids.
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
  const ids = [...document.querySelectorAll("td[id]")].map((cell) => cell.id);
  expect(new Set(ids).size).toBe(ids.length);
  const saving = within(screen.getByLabelText("Same-month saving and funding"));
  expect(saving.getByText("$-500.00")).toBeDefined();
  expect(saving.getByText("$2000.00")).toBeDefined();
  expect(screen.getByText("Destination comparison for this older version: Unknown")).toBeDefined();
});

it("renders older contracts from missing-source ids and month entries without inventing totals", () => {
  render(
    <ReviewDetails
      review={{
        ...base,
        entries: [
          {
            uuid: "e",
            financial_date: "2026-10-04",
            category: "spending",
            amount: "12.00",
            source_uuid: null,
            fixed_cost_uuid: null,
            fixed_cost_id: null,
            fixed_cost_name: null,
            debt_account_id: null,
            note: "Synthetic lunch",
            revision: 1,
            is_adjustment: false,
            funding_origin: "income",
            saving_goal_id: null,
          },
        ],
      }}
    />,
  );
  expect(within(row("Synthetic source")).getAllByText("Unknown").length).toBeGreaterThan(0);
  expect(row("New saving").textContent).toContain("Unknown");
  expect(screen.getByText("Synthetic lunch")).toBeDefined();
  expect(screen.queryByRole("region", { name: "Planned and actual metrics" })).toBeNull();
});
