import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { Activity, ComparisonGroup, Metric } from "../../lib/monthly";
import { Metrics, ReviewDetails } from "./ReviewDetails";

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
  expect(screen.getByText("Planned · Fixed costs ÷ net income: 62.50%")).toBeDefined();
  expect(screen.getByText("Actual · Fixed costs ÷ net income: Unavailable")).toBeDefined();
  expect(screen.getByText("$2500.00 ÷ $4000.00 × 100")).toBeDefined();
  expect(screen.getByText("$2000.00 ÷ Unknown × 100")).toBeDefined();
  expect(screen.getByText("Unavailable: Income is incomplete.")).toBeDefined();
  expect(screen.getAllByText("Net income: $4000.00")).toHaveLength(2);
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
  render(
    <ReviewDetails
      review={{
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
          fixed_cost: empty,
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
  const income = within(screen.getByRole("region", { name: "Net income details" }));
  expect(
    income.getByText("Synthetic source · Planned $4000.00 · Recorded Unknown · Difference Unknown"),
  ).toBeDefined();
  expect(
    income.getByText("Planned $4000.00 · Recorded $25.00 (incomplete) · Difference Unknown"),
  ).toBeDefined();
  expect(income.getByText("Unplanned Net income activity")).toBeDefined();
  expect(income.getByText("Contributing adjustments (already included)")).toBeDefined();
  expect(
    screen.getByText("New saving $500.00 − savings used $1000.00 = net saving $-500.00."),
  ).toBeDefined();
  expect(
    screen.getByText(
      "Total investment contributions: $2000.00. Income-funded investment contributions: $0.00.",
    ),
  ).toBeDefined();
});
it("renders older optional contracts without inventing totals", () => {
  const { container } = render(<ReviewDetails review={{}} />);
  expect(container.textContent).toBe("");
});
