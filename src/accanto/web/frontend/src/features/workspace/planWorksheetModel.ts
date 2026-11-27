import { fmtDate, money as formatCents } from "../../lib/format";
import { USD_AMOUNT } from "../../lib/money";
import type { FixedCostFrequency, PlanInput, PlanRevision } from "../../lib/monthly";
import { parseTimestamp } from "../../lib/timestamp";

/** Fixed-cost frequency labels, their API values and payments per year. */
export const FREQUENCIES = {
  Weekly: ["weekly", 52],
  Biweekly: ["biweekly", 26],
  Monthly: ["monthly", 12],
  Quarterly: ["quarterly", 4],
  Annual: ["annual", 1],
} as const satisfies Record<string, readonly [FixedCostFrequency, number]>;
export type Frequency = keyof typeof FREQUENCIES;
const frequencyLabel = (value: FixedCostFrequency) =>
  (Object.keys(FREQUENCIES) as Frequency[]).find((label) => FREQUENCIES[label][0] === value) ??
  "Monthly";

export type Group = "income" | "funding" | "fixed" | "spending" | "saving" | "investing" | "giving";
export type Line = {
  id: string;
  group: Group;
  name: string;
  amount: string;
  frequency: Frequency;
  reference?: string;
  link?: string;
  monthlyAmount?: string;
};
export type Choice = { id: string; name: string; active: boolean };
export type Catalog = Partial<Record<Group, Choice[]>>;
export type CellEdit = { id: string; col: number; value: string };
/** Optional Spending estimates by subcategory id; a blank estimate is absent, not zero. */
export type Estimates = Record<string, string>;
export type WorksheetDraft = {
  name: string;
  lines: Line[];
  estimates?: Estimates;
  editing: boolean;
  cellEdit: CellEdit | null;
};

// Integer cents keep previews exact. Server results remain authoritative at save boundaries.
export const cents = (value: string): number | null =>
  USD_AMOUNT.test(value.trim())
    ? Number(value.trim().split(".")[0]) * 100 +
      Number((value.trim().split(".")[1] || "").padEnd(2, "0"))
    : null;
export const even = (n: number, d: number) => {
  const q = Math.floor(n / d);
  const r = n % d;
  return q + (r * 2 > d || (r * 2 === d && q % 2 === 1) ? 1 : 0);
};
export const monthlyAmount = (line: Line): number | null => {
  if (line.monthlyAmount !== undefined) return cents(line.monthlyAmount);
  const value = cents(line.amount);
  // Annualize by payments per year, then divide by 12 (half-even), like the server.
  return value === null ? null : even(value * FREQUENCIES[line.frequency][1], 12);
};
/** Cents for display. A missing amount is "Unknown", never zero. */
export const money = (n: number | null) => (n === null ? "Unknown" : formatCents(n));

export const titles: Record<Group, string> = {
  income: "Net income",
  funding: "From savings",
  fixed: "Fixed costs",
  spending: "Guilt-free spending",
  saving: "Saving",
  investing: "Investing",
  giving: "Giving",
};
/** Each group keeps its kit category color on every screen. */
export const kinds: Record<Group, string> = {
  income: "income",
  funding: "save",
  fixed: "fixed",
  spending: "free",
  saving: "save",
  investing: "invest",
  giving: "give",
};
export const allocations = ["fixed", "spending", "saving", "investing", "giving"] as const;
export type GroupAmounts = Record<Group, number | null>;

/** The stored, server-computed group totals of a revision. */
export const storedGroups = (r: PlanRevision): GroupAmounts => ({
  income: storedCents(r.income),
  funding: storedCents(r.savings_funding_total ?? (r.savings_funding?.length ? null : "0.00")),
  fixed: storedCents(r.fixed_cost_total),
  spending: storedCents(r.spending),
  saving: storedCents(r.saving_total ?? (r.saving_goals?.length ? null : "0.00")),
  investing: storedCents(r.investing_total ?? (r.investments?.length ? null : "0.00")),
  giving: storedCents(r.giving_total ?? (r.giving?.length ? null : "0.00")),
});
export const lineGroups = (lines: Line[] | null): GroupAmounts => {
  const of = (group: Group) =>
    lines === null ? null : sum(lines.filter((line) => line.group === group));
  return {
    income: of("income"),
    funding: of("funding"),
    fixed: of("fixed"),
    spending: of("spending"),
    saving: of("saving"),
    investing: of("investing"),
    giving: of("giving"),
  };
};
/** Band segments for the allocation, or null when any allocation is unknown. */
export function allocationBand(amounts: GroupAmounts, unassigned: number | null) {
  if (allocations.some((group) => amounts[group] === null)) return null;
  const parts: { key: string; kind: string; weight: number; title: string }[] = allocations.map(
    (group) => ({
      key: group,
      kind: kinds[group],
      weight: amounts[group] ?? 0,
      title: `${titles[group]}: ${money(amounts[group])}`,
    }),
  );
  if (unassigned !== null && unassigned > 0)
    parts.push({
      key: "none",
      kind: "none",
      weight: unassigned,
      title: `Unassigned: ${money(unassigned)}`,
    });
  return parts;
}
/** Whether every dollar has a job, in words and a status tone. */
export function balance(stats: { funding: number | null; unassigned: number | null }) {
  if (stats.unassigned === null) return { tone: "", text: "Totals unknown" };
  if (stats.unassigned < 0)
    return { tone: "bad", text: `${money(-stats.unassigned)} overallocated` };
  if (stats.unassigned > 0) return { tone: "warn", text: `${money(stats.unassigned)} unassigned` };
  return stats.funding
    ? { tone: "good", text: "Every dollar assigned" }
    : { tone: "", text: "No funding yet" };
}
export const sum = (lines: Line[]): number | null => {
  let total = 0;
  for (const line of lines) {
    const amount = monthlyAmount(line);
    if (amount === null) return null;
    total += amount;
  }
  return total;
};
export const totals = (lines: Line[]) => {
  const funding = sum(lines.filter((line) => line.group === "income" || line.group === "funding"));
  const allocated = sum(
    lines.filter((line) => line.group !== "income" && line.group !== "funding"),
  );
  return {
    funding,
    allocated,
    unassigned: funding === null || allocated === null ? null : funding - allocated,
  };
};
export const storedCents = (value: string | null | undefined): number | null => {
  if (value == null || !/^-?\d{1,12}(\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.replace(/^-/, "").split(".");
  const parsed = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return value.startsWith("-") ? -parsed : parsed;
};
export const storedTotals = (revision: PlanRevision) => ({
  funding: storedCents(revision.funding_total),
  allocated: storedCents(revision.allocation_total),
  unassigned: storedCents(revision.unassigned),
});

export function revisionLines(revision: PlanRevision): Line[] {
  return [
    ...revision.incomes.map((line) => ({
      id: line.source_id,
      reference: line.source_id,
      group: "income" as const,
      name: line.name,
      amount: line.amount,
      frequency: "Monthly" as const,
    })),
    ...(revision.savings_funding ?? []).map((line) => ({
      id: `funding-${line.account_id}`,
      reference: line.account_id,
      group: "funding" as const,
      name: line.account_name,
      amount: line.amount,
      frequency: "Monthly" as const,
    })),
    ...revision.fixed_costs.map((line) => ({
      id: line.fixed_cost_id,
      reference: line.fixed_cost_id,
      group: "fixed" as const,
      name: line.name,
      amount: line.amount,
      frequency: frequencyLabel(line.frequency),
      link: line.debt_account_id ?? undefined,
      ...(revision.saved ? { monthlyAmount: line.monthly_amount } : {}),
    })),
    {
      id: "spending",
      group: "spending",
      name: "Guilt-free spending",
      amount: revision.spending,
      frequency: "Monthly",
    },
    ...(revision.saving_goals ?? []).map((line) => ({
      id: `saving-${line.goal_id}`,
      reference: line.goal_id,
      group: "saving" as const,
      name: line.goal_name,
      amount: line.amount,
      frequency: "Monthly" as const,
    })),
    ...(revision.investments ?? []).map((line) => ({
      id: `investing-${line.destination_id}`,
      reference: line.destination_id,
      group: "investing" as const,
      name: line.destination_name,
      amount: line.amount,
      frequency: "Monthly" as const,
    })),
    ...(revision.giving ?? []).map((line) => ({
      id: `giving-${line.destination_id}`,
      reference: line.destination_id,
      group: "giving" as const,
      name: line.destination_name,
      amount: line.amount,
      frequency: "Monthly" as const,
    })),
  ];
}

export const revisionEstimates = (revision: PlanRevision): Estimates =>
  Object.fromEntries(
    (revision.spending_estimates ?? []).map((line) => [line.spending_subcategory_id, line.amount]),
  );

export function planInput(
  name: string,
  lines: Line[],
  revision?: number,
  estimates: Estimates = {},
): PlanInput {
  const group = (value: Group) => lines.filter((line) => line.group === value);
  return {
    name: name.trim(),
    expected_revision: revision,
    incomes: group("income").map((line) => ({
      source_id: line.reference,
      name: line.name,
      amount: line.amount,
    })),
    fixed_costs: group("fixed").map((line) => ({
      fixed_cost_id: line.reference,
      debt_account_id: line.link ?? null,
      name: line.name,
      amount: line.amount,
      frequency: FREQUENCIES[line.frequency][0],
    })),
    spending: group("spending")[0].amount,
    savings_funding: group("funding").map((line) => ({
      account_id: line.reference ?? "",
      amount: line.amount,
    })),
    saving_goals: group("saving").map((line) => ({
      goal_id: line.reference ?? "",
      amount: line.amount,
    })),
    investments: group("investing").map((line) => ({
      destination_id: line.reference ?? "",
      amount: line.amount,
    })),
    giving: group("giving").map((line) => ({
      destination_id: line.reference ?? "",
      amount: line.amount,
    })),
    spending_estimates: Object.entries(estimates).map(([id, amount]) => ({
      spending_subcategory_id: id,
      amount,
    })),
  };
}

/** Revisions as people read them: the unsaved draft first, then saved versions newest first. */
export function newestFirst<T extends Pick<PlanRevision, "saved_at" | "number">>(revisions: T[]) {
  const at = (r: T) => parseTimestamp(r.saved_at) ?? Number.POSITIVE_INFINITY;
  return [...revisions].sort((a, b) => at(b) - at(a) || b.number - a.number);
}

/** "Version 2, saved Nov 20, 2026", with the save date in the Entity time zone. */
export function savedLabel(version: PlanRevision, timeZone: string) {
  const savedAt = parseTimestamp(version.saved_at);
  if (savedAt === null) return `Version ${version.number}`;
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(savedAt));
  return `Version ${version.number}, saved ${fmtDate(day)}`;
}
