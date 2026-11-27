/**
 * Synthetic Spending alerts for November 2026, the fixture Entity's month, against the fixture
 * Plan version "Everyday balance". Every amount is invented; the API computes them in production.
 */
import type { SpendingAlert, SpendingAlerts } from "../../lib/spendingAlerts";
import { spendingSubcategories } from "./fixtures";

const [eating, books] = spendingSubcategories;
const rule = (
  fields: Partial<SpendingAlert> & Pick<SpendingAlert, "uuid" | "name">,
): SpendingAlert => ({
  category: "spending",
  spending_subcategory_id: null,
  fixed_cost_id: null,
  thresholds: [70, 90],
  revision: 1,
  basis: "planned",
  amount: null,
  recorded: null,
  percent: null,
  reached: null,
  waiting: null,
  dismissed: false,
  ...fields,
});

export function alertList(variant: "reached" | "overspent" | "quiet" = "reached"): SpendingAlerts {
  const eatingRecorded = { reached: "112.50", overspent: "187.50", quiet: "60.00" }[variant];
  const eatingPercent = { reached: 75, overspent: 125, quiet: 40 }[variant];
  return {
    month: "2026-11",
    version: { uuid: "67b4cd39-ea25-4967-bf85-722c4e4e9656", name: "Everyday balance", number: 1 },
    spending_alerts: [
      rule({
        uuid: "a1e70000-0000-4000-8000-000000000001",
        name: "Guilt-free spending",
        amount: "1719.98",
        recorded: variant === "quiet" ? "640.00" : "1238.40",
        // $1,238.40 of $1,719.98 is 72.0%; $640.00 is 37.2%.
        percent: variant === "quiet" ? 37 : 72,
        reached: variant === "quiet" ? null : 70,
      }),
      rule({
        uuid: "a1e70000-0000-4000-8000-000000000002",
        name: eating.name,
        spending_subcategory_id: eating.uuid,
        thresholds: [70, 100, 125],
        basis: "estimate",
        amount: "150.00",
        recorded: eatingRecorded,
        percent: eatingPercent,
        reached: { reached: 70, overspent: 125, quiet: null }[variant],
      }),
      rule({
        uuid: "a1e70000-0000-4000-8000-000000000003",
        name: books.name,
        spending_subcategory_id: books.uuid,
        thresholds: [70],
        basis: "estimate",
        recorded: "42.00",
        waiting: "no_estimate",
      }),
      rule({
        uuid: "a1e70000-0000-4000-8000-000000000004",
        name: "Rent",
        category: "fixed_cost",
        fixed_cost_id: "6e8226b8-189a-433f-b49b-37865af43cf5",
        thresholds: [100],
        amount: "2100.00",
        recorded: "2100.00",
        percent: 100,
        reached: 100,
        dismissed: true,
      }),
    ],
  };
}
