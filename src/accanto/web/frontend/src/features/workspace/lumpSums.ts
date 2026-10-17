import { type Entry, type PlanDraft, type Workspace, shiftMonth } from "./domain";

export interface LumpSum {
  id: string;
  name: string;
  expectedDate: string;
  expectedAmount: number;
  amount: number;
  months: number;
  start: string;
  account: string;
  receipt?: { id: string; date: string; amount: number };
}

export function validateLumpSum(lump: LumpSum) {
  if (!lump.name.trim() || !lump.account.trim())
    throw new Error("Name the lump sum and its savings account.");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(lump.expectedDate) ||
    Number.isNaN(Date.parse(lump.expectedDate)) ||
    new Date(`${lump.expectedDate}T12:00:00Z`).toISOString().slice(0, 10) !== lump.expectedDate
  )
    throw new Error("Choose a valid expected receipt date.");
  if (
    !Number.isSafeInteger(lump.expectedAmount) ||
    lump.expectedAmount <= 0 ||
    !Number.isSafeInteger(lump.amount) ||
    lump.amount <= 0
  )
    throw new Error("Lump-sum amounts must be positive amounts in whole cents.");
  if (!Number.isInteger(lump.months) || lump.months < 1 || lump.months > 120)
    throw new Error("Choose between 1 and 120 months for this prototype.");
  if (
    !/^\d{4}-(0[1-9]|1[0-2])$/.test(lump.start) ||
    lump.start <= (lump.receipt?.date ?? lump.expectedDate).slice(0, 7)
  )
    throw new Error("Start spreading in a month after receipt.");
  if (lump.amount > (lump.receipt?.amount ?? lump.expectedAmount))
    throw new Error("The spread cannot exceed the lump sum.");
}

export function installment(lump: LumpSum, month: string) {
  if (!Number.isInteger(lump.months) || lump.months < 1 || !lump.start) return 0;
  const index =
    (Number(month.slice(0, 4)) - Number(lump.start.slice(0, 4))) * 12 +
    Number(month.slice(5)) -
    Number(lump.start.slice(5));
  if (index < 0 || index >= lump.months) return 0;
  const base = Math.floor(lump.amount / lump.months);
  return base + (index === lump.months - 1 ? lump.amount % lump.months : 0);
}

export function lumpFunding(plan: PlanDraft, month: string) {
  return (plan.lumpSums ?? []).reduce(
    (sum, lump) => sum + (lump.receipt ? installment(lump, month) : 0),
    0,
  );
}

export function receiptStatus(state: Workspace, lump: LumpSum, month: string) {
  const receipt = state.entries.find(
    (e) => e.id === lump.receipt?.id && e.kind === "income" && !e.adjustment,
  );
  const matches =
    !!receipt && receipt.amount === lump.receipt?.amount && receipt.date === lump.receipt.date;
  const used = state.entries
    .filter(
      (e) =>
        e.kind !== "income" &&
        e.funding?.receiptId === lump.receipt?.id &&
        e.funding?.receiptId &&
        e.date.slice(0, 7) <= month,
    )
    .reduce((sum, e) => sum + e.amount, 0);
  return {
    matches,
    remaining: receipt && receipt.date.slice(0, 7) <= month ? receipt.amount - used : null,
    used: state.entries
      .filter(
        (e) =>
          e.kind !== "income" &&
          e.funding?.receiptId &&
          e.funding.receiptId === lump.receipt?.id &&
          e.date.startsWith(month),
      )
      .reduce((sum, e) => sum + e.amount, 0),
  };
}

export function linkReceipt(lump: LumpSum, entry?: Entry): LumpSum {
  return {
    ...lump,
    receipt: entry ? { id: entry.id, date: entry.date, amount: entry.amount } : undefined,
    start: shiftMonth((entry?.date ?? lump.expectedDate).slice(0, 7), 1),
  };
}
