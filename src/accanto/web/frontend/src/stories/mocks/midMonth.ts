/**
 * A synthetic Review on the 10th of the month: most income and fixed costs are still to come.
 * Every name and amount is invented. `endedReviews` puts the same lines in the month before
 * today, when lines with no entry are past due rather than still to come.
 */
import { decimalToCents, inputMoney } from "../../lib/format";
import type { Activity, ComparisonGroup, ReviewEntry, ReviewResult } from "../../lib/monthly";
import * as data from "./fixtures";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
type Spec = [name: string, planned: string, recorded: string | null];
type Category = keyof NonNullable<ReviewResult["comparison"]>;
const cents = (value: string | null) => (value == null ? 0 : (decimalToCents(value) ?? 0));
const sum = (values: Array<string | null>) => inputMoney(values.reduce((n, v) => n + cents(v), 0));
const difference = (recorded: string, planned: string) =>
  inputMoney(cents(recorded) - cents(planned));

const income: Spec[] = [
  ["Primary pay", "5800.00", "2900.00"],
  ["Partner pay", "2600.00", null],
  ["Smoothed annual bonus", "450.00", null],
  ["Occasional work", "300.00", null],
];
const fixed: Spec[] = [
  ["Rent", "2100.00", "2100.00"],
  ["Electricity", "140.00", "128.40"],
  ["Internet", "70.00", "70.00"],
  ["Phone", "85.00", null],
  ["Childcare", "900.00", null],
  ["Car insurance", "120.02", null],
  ["Gym", "45.00", null],
  ["Streaming", "22.00", "21.99"],
];
const goals: Spec[] = [
  ["Emergency runway", "700.00", null],
  ["New bicycle", "300.00", "300.00"],
];
const spent = ["84.12", "212.40", "61.75", "143.20"];

function entry(n: number, category: Category, amount: string, day: number, name?: string) {
  return {
    uuid: id(9000 + n),
    financial_date: `2026-11-${String(day).padStart(2, "0")}`,
    category,
    amount,
    note: "",
    is_adjustment: false,
    is_refund: false,
    revision: 1,
    source_id: null,
    fixed_cost_id: null,
    debt_account_id: null,
    fixed_cost_name: category === "fixed_cost" ? (name ?? null) : null,
    saving_goal_id: null,
    funding_goal_id: null,
    funding_origin: "income",
    refund_of: null,
    remaining_refundable: null,
  } satisfies Activity;
}
type Line = ComparisonGroup["items"][number] & { id: string; planned: string };
function group(
  category: Category,
  base: number,
  specs: Spec[],
): Omit<ComparisonGroup, "items"> & { items: Line[] } {
  const items = specs.map(
    ([name, planned, recorded], i): Line => ({
      id: id(base + i),
      name,
      planned,
      recorded,
      difference: recorded == null ? null : difference(recorded, planned),
      entries: recorded == null ? [] : [entry(base + i, category, recorded, 1 + i, name)],
    }),
  );
  const incomplete = specs.some(([, , recorded]) => recorded == null);
  return {
    planned: sum(specs.map((s) => s[1])),
    recorded: sum(specs.map((s) => s[2])),
    incomplete,
    difference: incomplete ? null : inputMoney(0),
    items,
    unplanned: [],
    adjustments: [],
  };
}
const spendingEntries = spent.map((amount, i) => entry(400 + i, "spending", amount, 2 + i * 2));
const spendingRecorded = sum(spent);
const totals = {
  income: sum(income.map((s) => s[1])),
  fixed: sum(fixed.map((s) => s[1])),
  spending: "1719.98",
  saving: sum(goals.map((s) => s[1])),
};
const comparison = {
  income: group("income", 100, income),
  fixed_cost: group("fixed_cost", 200, fixed),
  spending: {
    planned: totals.spending,
    recorded: spendingRecorded,
    incomplete: false,
    difference: difference(spendingRecorded, totals.spending),
    items: [],
    unplanned: spendingEntries,
    adjustments: [],
  },
  saving: group("saving", 300, goals),
  investing: group("investing", 500, [["Long-term index fund", "1000.00", "1000.00"]]),
  giving: group("giving", 600, [["Neighborhood food bank", "600.00", "300.00"]]),
};
const template = data.reviews["2026-11-01"];

function midMonthReview(month: string): ReviewResult {
  const c = comparison;
  return {
    ...template,
    review: { ...template.review, month, reviewed_at: null },
    checkpoint_changed: false,
    inbox_waiting: 0,
    metrics: undefined,
    summary: undefined,
    version: {
      ...template.version,
      income: totals.income,
      fixed_cost_total: totals.fixed,
      spending: totals.spending,
      saving_total: totals.saving,
      incomes: income.map(([name, amount], i) => ({ name, amount, source_id: id(100 + i) })),
      fixed_costs: fixed.map(([name, amount], i) => ({
        name,
        amount,
        frequency: "monthly",
        monthly_amount: amount,
        debt_account_name: null,
        fixed_cost_id: id(200 + i),
        canonical_name: name,
        debt_account_id: null,
      })),
    },
    comparison: c,
    entries: [
      ...c.income.items,
      ...c.fixed_cost.items,
      ...c.saving.items,
      ...c.investing.items,
      ...c.giving.items,
    ]
      .flatMap((item) => item.entries)
      .concat(spendingEntries)
      .map(
        ({ source_id, ...rest }) =>
          ({ ...rest, source_uuid: source_id, fixed_cost_uuid: rest.fixed_cost_id }) as ReviewEntry,
      ),
    actual: {
      income_recorded: c.income.recorded,
      income_incomplete: true,
      missing_sources: c.income.items.filter((i) => i.recorded == null).map((i) => i.id),
      spending_recorded: spendingRecorded,
      fixed_cost_recorded: c.fixed_cost.recorded,
      fixed_cost_incomplete: true,
      missing_fixed_costs: c.fixed_cost.items.filter((i) => i.recorded == null).map((i) => i.id),
      saving_recorded: c.saving.recorded,
      investing_recorded: c.investing.recorded,
      giving_recorded: c.giving.recorded,
      savings_used: "0.00",
    },
    income_difference: null,
    fixed_cost_difference: null,
    spending_difference: difference(spendingRecorded, totals.spending),
    expected: {
      savings_funding: "200.00",
      funding: "6800.00",
      allocation: "6800.00",
      saving: totals.saving,
      investing: "1000.00",
      giving: "600.00",
    },
    differences: { saving: null, investing: "0.00", giving: "-300.00" },
    destination_comparisons: {
      saving_goals: c.saving.items.map((i) => ({
        ...i,
        goal_id: i.id,
        goal_name: i.name,
        planned: i.planned,
      })),
      investments: c.investing.items.map((i) => ({
        ...i,
        destination_id: i.id,
        destination_name: i.name,
        planned: i.planned,
      })),
      giving: c.giving.items.map((i) => ({
        ...i,
        destination_id: i.id,
        destination_name: i.name,
        planned: i.planned,
      })),
    },
  };
}
/** Today is 2026-11-10 in the fixtures, so November is the current month. */
export const midMonthReviews = { ...data.reviews, "2026-11-01": midMonthReview("2026-11-01") };
/** The same lines in October, a month that has ended. */
export const endedReviews = { ...data.reviews, "2026-10-01": midMonthReview("2026-10-01") };
