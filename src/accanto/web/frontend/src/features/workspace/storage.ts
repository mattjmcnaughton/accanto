import { z } from "zod";
import { type Workspace, emptyWorkspace, storageKey, validateWorkspaceChange } from "./domain";
import { validateLumpSum } from "./lumpSums";

const amount = z.number().int().min(0).max(100_000_000_000);
const signed = z.number().int().min(-100_000_000_000).max(100_000_000_000);
const name = z.string().min(1).max(120);
const id = z.string().min(1).max(100);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !Number.isNaN(Date.parse(v)) && new Date(`${v}T12:00:00Z`).toISOString().slice(0, 10) === v,
  );
const lumpSum = z
  .object({
    id,
    name,
    expectedDate: date,
    expectedAmount: amount.positive(),
    amount: amount.positive(),
    months: z.number().int().min(1).max(120),
    start: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    account: name,
    receipt: z.object({ id, date, amount: amount.positive() }).optional(),
  })
  .superRefine((value, ctx) => {
    try {
      validateLumpSum(value);
    } catch (e) {
      ctx.addIssue({ code: "custom", message: (e as Error).message });
    }
  });
const plan = z.object({
  model: z.literal("net-v1").optional(),
  savingsFunding: z.array(z.object({ id, name, amount })).optional(),
  lumpSums: z.array(lumpSum).optional(),
  name,
  cadence: z.enum(["monthly", "yearly"]),
  taxYear: z.literal(2026),
  filingStatus: z.enum(["single", "joint"]),
  override: amount.nullable(),
  spending: amount,
  saving: amount,
  investing: amount,
  givingLines: z.array(z.object({ id: z.string().max(100), name, amount })).optional(),
  savingLines: z.array(z.object({ id: z.string().max(100), name, amount })).optional(),
  investingLines: z.array(z.object({ id: z.string().max(100), name, amount })).optional(),
  incomes: z.array(
    z.object({
      id,
      name,
      net: amount.optional(),
      gross: amount,
      frequency: z.enum(["annual", "monthly", "semimonthly", "weekly", "daily"]),
      paidDays: z.number().int().min(0).max(366),
      withholding: amount,
      payroll: amount,
    }),
  ),
  costs: z.array(
    z.object({ id, name, amount, frequency: z.enum(["annual", "monthly"]), debtId: id.optional() }),
  ),
  deductions: z.array(z.object({ id, name, amount })),
});
const calculation = z.object({
  savingsFunding: amount.optional(),
  gross: signed,
  withholding: signed,
  payroll: signed,
  calculated: signed,
  income: signed,
  fixed: signed,
  giving: signed,
  spending: signed,
  saving: signed,
  investing: signed,
  unassigned: signed,
  tax: amount,
  annualWithholding: amount,
  standard: amount,
  itemized: amount,
});
const destination = z.object({
  id,
  name,
  target: amount.positive().nullable(),
  active: z.boolean(),
  openingDate: date.optional(),
  openingAmount: amount.optional(),
});
const schema = z.object({
  accounts: z.array(z.object({ id, name, date, opening: amount, active: z.boolean() })).optional(),
  movements: z
    .array(
      z.object({
        id,
        date,
        order: z.number().int(),
        kind: z.enum(["transfer", "reassignment", "reconciliation"]),
        from: z.string(),
        to: id,
        amount: signed,
        deleted: z.boolean().optional(),
      }),
    )
    .optional(),
  estimates: z.array(z.object({ id, name, incomes: plan.shape.incomes })).optional(),
  audit: z
    .array(
      z.object({
        at: z.string(),
        before: z.unknown(),
        after: z.unknown(),
        actor: z.string(),
        interface: z.string(),
      }),
    )
    .optional(),
  debts: z.array(destination).optional(),
  schema: z.literal(1),
  name,
  plans: z.array(
    z.object({
      id,
      draft: plan,
      versions: z.array(
        z.object({
          id,
          number: z.number().int().positive(),
          savedAt: z.string(),
          plan,
          calculation,
        }),
      ),
    }),
  ),
  entries: z.array(
    z.object({
      id,
      deleted: z.boolean().optional(),
      order: z.number().int().nonnegative().optional(),
      refundOf: id.optional(),
      debtId: id.optional(),
      adjustment: z.boolean().optional(),
      funding: z
        .object({ account: name, receiptId: z.string().optional(), goalId: z.string() })
        .optional(),
      date,
      kind: z.enum(["income", "fixed", "giving", "spending", "saving", "investing"]),
      sourceId: z.string(),
      label: z.string().max(120),
      tag: z.string().max(120),
      amount: signed,
      note: z.string().max(2000),
    }),
  ),
  investments: z.array(destination).default([]),
  recipients: z.array(destination).default([]),
  goals: z.array(
    z.object({
      id,
      name,
      target: amount,
      tag: z.string().max(120),
      active: z.boolean(),
      accountId: id.optional(),
      role: z.enum(["ordinary", "unallocated"]).optional(),
      purpose: z.enum(["finite", "ongoing"]).optional(),
      completed: z.boolean().optional(),
      archivedWithAccount: z.boolean().optional(),
      opening: amount.optional(),
    }),
  ),
  reviews: z.array(
    z.object({
      checkpoint: z.object({ at: z.string(), signature: z.string() }).optional(),
      month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
      versionId: id,

      note: z.string().max(4000),
    }),
  ),
  balances: z.array(
    z.object({
      id,
      name,
      date,
      amount,
      investmentId: z.string().optional(),
      debtId: id.optional(),
      opening: z.boolean().optional(),
      deleted: z.boolean().optional(),
    }),
  ),
});
export function parseWorkspace(text: string): Workspace {
  const raw = JSON.parse(text);
  if (
    Array.isArray(raw?.reviews) &&
    raw.reviews.some(
      (r: { replacements?: Record<string, unknown> }) =>
        r.replacements && Object.keys(r.replacements).length,
    )
  )
    throw new Error(
      "This backup contains legacy Replacement totals. Preserve it and convert those totals to adjustment entries before restoring.",
    );
  const state = schema.parse(raw);
  for (const draft of state.plans.flatMap((p) => [p.draft, ...p.versions.map((v) => v.plan)]))
    for (const lines of [draft.savingLines, draft.investingLines, draft.givingLines])
      if (lines && new Set(lines.map((r) => r.id)).size !== lines.length)
        throw new Error("The backup contains duplicate allocation destinations.");
  const versionIds = new Set(state.plans.flatMap((p) => p.versions.map((v) => v.id)));
  for (const rows of [
    state.plans,
    state.goals,
    state.investments,
    state.recipients,
    state.entries,
    state.balances,
    state.plans.flatMap((p) => p.versions),
  ])
    if (new Set(rows.map((r) => r.id)).size !== rows.length)
      throw new Error("The backup contains duplicate records.");
  if (
    new Set(state.reviews.map((r) => r.month)).size !== state.reviews.length ||
    state.reviews.some((r) => !versionIds.has(r.versionId))
  )
    throw new Error("The backup contains invalid Review references.");
  for (const entry of state.entries) {
    if (
      entry.funding &&
      (entry.kind === "income" ||
        !entry.funding.account.trim() ||
        (entry.funding.goalId && !state.goals.some((g) => g.id === entry.funding?.goalId)) ||
        (entry.kind === "saving" && entry.sourceId === entry.funding.goalId))
    )
      throw new Error("The backup contains an invalid funding origin.");
  }
  validateWorkspaceChange(state, state);
  return state;
}
export function loadWorkspace(): { state: Workspace; error: string } {
  try {
    const raw = localStorage.getItem(storageKey);
    return { state: raw ? parseWorkspace(raw) : emptyWorkspace(), error: "" };
  } catch (error) {
    return {
      state: emptyWorkspace(),
      error: `Your saved prototype could not be opened. It has not been overwritten. Export the stored data from Settings before starting again. ${error instanceof Error ? error.message : ""}`,
    };
  }
}
export function download(data: string, filename: string) {
  const url = URL.createObjectURL(new Blob([data], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
