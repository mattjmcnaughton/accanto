import { USD_AMOUNT } from "../../lib/money";
import type { PlanInput, PlanRevision } from "../../lib/monthly";
import { parseTimestamp } from "../../lib/timestamp";

export type Group = "income" | "funding" | "fixed" | "spending" | "saving" | "investing" | "giving";
export type Line = {
  id: string;
  group: Group;
  name: string;
  amount: string;
  frequency: "Monthly" | "Annual";
  reference?: string;
  link?: string;
  monthlyAmount?: string;
};
export type Choice = { id: string; name: string; active: boolean };
export type Catalog = Partial<Record<Group, Choice[]>>;
export type CellEdit = { id: string; col: number; value: string };
export type WorksheetDraft = {
  name: string;
  lines: Line[];
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
  return value === null ? null : line.frequency === "Annual" ? even(value, 12) : value;
};
export const money = (n: number | null) =>
  n === null
    ? "Unknown"
    : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n / 100);
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
      frequency: line.frequency === "annual" ? ("Annual" as const) : ("Monthly" as const),
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

export function planInput(name: string, lines: Line[], revision?: number): PlanInput {
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
      frequency: line.frequency === "Annual" ? "annual" : "monthly",
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
  };
}

export function versionLabel(version: PlanRevision, versions: PlanRevision[], timeZone: string) {
  const savedAt = parseTimestamp(version.saved_at);
  if (savedAt === null) return `Version ${version.number}`;
  const day = (ms: number) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(new Date(ms))
      .filter((part) => ["year", "month", "day"].includes(part.type));
  const date = (ms: number) => {
    const parts = day(ms);
    return ["year", "month", "day"]
      .map((type) => parts.find((part) => part.type === type)?.value)
      .join(".");
  };
  const savedDay = date(savedAt);
  const sameDay = versions
    .map((item) => ({ item, at: parseTimestamp(item.saved_at) }))
    .filter((entry) => entry.at !== null && date(entry.at) === savedDay)
    .sort((a, b) => (a.at ?? 0) - (b.at ?? 0) || a.item.number - b.item.number)
    .map((entry) => entry.item);
  return `${savedDay}.${String(sameDay.findIndex((item) => item.uuid === version.uuid) + 1).padStart(2, "0")}`;
}
