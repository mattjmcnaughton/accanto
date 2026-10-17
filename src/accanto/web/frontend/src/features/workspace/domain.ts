import type { LumpSum } from "./lumpSums";
export type Kind = "income" | "fixed" | "giving" | "spending" | "saving" | "investing";
export type Cadence = "monthly" | "yearly";
export type Frequency = "annual" | "monthly" | "semimonthly" | "weekly" | "daily";
export interface Income {
  net?: number;
  id: string;
  name: string;
  gross: number;
  frequency: Frequency;
  paidDays: number;
  withholding: number;
  payroll: number;
}
export interface Cost {
  debtId?: string;
  id: string;
  name: string;
  amount: number;
  frequency: "annual" | "monthly";
}
export interface Deduction {
  id: string;
  name: string;
  amount: number;
}
export interface AllocationLine {
  id: string;
  name: string;
  amount: number;
}
export interface PlanDraft {
  model?: "net-v1";
  savingsFunding?: AllocationLine[];
  lumpSums?: LumpSum[];
  givingLines?: AllocationLine[];
  savingLines?: AllocationLine[];
  investingLines?: AllocationLine[];
  name: string;
  cadence: Cadence;
  incomes: Income[];
  costs: Cost[];
  deductions: Deduction[];
  taxYear: 2026;
  filingStatus: "single" | "joint";
  override: number | null;
  spending: number;
  saving: number;
  investing: number;
}
export interface Calculation {
  savingsFunding?: number;
  gross: number;
  withholding: number;
  payroll: number;
  calculated: number;
  income: number;
  fixed: number;
  giving: number;
  spending: number;
  saving: number;
  investing: number;
  unassigned: number;
  tax: number;
  annualWithholding: number;
  standard: number;
  itemized: number;
}
export interface Version {
  id: string;
  number: number;
  savedAt: string;
  plan: PlanDraft;
  calculation: Calculation;
}
export interface Plan {
  id: string;
  draft: PlanDraft;
  versions: Version[];
}
export interface Goal {
  accountId?: string;
  role?: "ordinary" | "unallocated";
  purpose?: "finite" | "ongoing";
  completed?: boolean;
  archivedWithAccount?: boolean;
  opening?: number;
  id: string;
  name: string;
  target: number;
  tag: string;
  active: boolean;
}
export interface Destination {
  openingDate?: string;
  openingAmount?: number;
  id: string;
  name: string;
  target: number | null;
  active: boolean;
}
export interface Entry {
  debtId?: string;
  deleted?: boolean;
  order?: number;
  refundOf?: string;
  funding?: { account: string; goalId: string; receiptId?: string };
  adjustment?: boolean;
  id: string;
  date: string;
  kind: Kind;
  sourceId: string;
  label: string;
  amount: number;
  note: string;
  tag: string;
}
export interface Review {
  checkpoint?: { at: string; signature: string };
  month: string;
  versionId: string;
  note: string;
}
export interface Balance {
  opening?: boolean;
  deleted?: boolean;
  debtId?: string;
  investmentId?: string;
  id: string;
  name: string;
  date: string;
  amount: number;
}
export interface SavingsAccount {
  id: string;
  name: string;
  date: string;
  opening: number;
  active: boolean;
}
export interface SavingsMovement {
  id: string;
  date: string;
  order: number;
  kind: "transfer" | "reassignment" | "reconciliation";
  from: string;
  to: string;
  amount: number;
  deleted?: boolean;
}
export interface IncomeEstimate {
  id: string;
  name: string;
  incomes: Income[];
}
export interface Workspace {
  debts?: Destination[];
  accounts?: SavingsAccount[];
  movements?: SavingsMovement[];
  estimates?: IncomeEstimate[];
  audit?: { at: string; before?: unknown; after?: unknown; actor: string; interface: string }[];
  schema: 1;
  name: string;
  plans: Plan[];
  goals: Goal[];
  investments: Destination[];
  recipients: Destination[];
  entries: Entry[];
  reviews: Review[];
  balances: Balance[];
}
export interface ReviewLine {
  key: string;
  name: string;
  planned: number | null;
  recorded: number | null;
  actual: number | null;
  actualOnly: boolean;
  entries: Entry[];
}
export interface ReviewGroup extends ReviewLine {
  children: ReviewLine[];
  incomplete: boolean;
  known: number | null;
  rollup: number | null;
}

export const kinds: Kind[] = ["income", "fixed", "giving", "spending", "saving", "investing"];
export const labels: Record<Kind, string> = {
  income: "Take-home income",
  fixed: "Fixed costs",
  giving: "Giving",
  spending: "Guilt-free spending",
  saving: "Saving",
  investing: "Investing",
};
export const entryLabels: Record<Kind, string> = {
  income: "Income received",
  fixed: "Fixed cost",
  giving: "Giving",
  spending: "Guilt-free spending",
  saving: "Saving contribution",
  investing: "Investment contribution",
};
export const id = () =>
  `${Date.now().toString(36)}-${Array.from(crypto.getRandomValues(new Uint32Array(2)), (n) => n.toString(36)).join("")}`;
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export const money = (value: number | null, cents = false) =>
  value === null
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: cents || value % 100 !== 0 ? 2 : 0,
        maximumFractionDigits: 2,
      }).format(value / 100);
export const monthLabel = (month: string) =>
  new Date(`${month}-01T12:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" });
export const dateLabel = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
export const shiftMonth = (month: string, delta: number) => {
  const d = new Date(`${month}-01T12:00:00`);
  d.setMonth(d.getMonth() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
export const emptyWorkspace = (): Workspace => ({
  schema: 1,
  name: "My entity",
  plans: [],
  goals: [],
  investments: [],
  recipients: [],
  entries: [],
  reviews: [],
  balances: [],
});
export const newDraft = (name = "My plan"): PlanDraft => ({
  name,
  model: "net-v1",
  savingsFunding: [],
  savingLines: [],
  investingLines: [],
  givingLines: [],
  cadence: "monthly",
  incomes: [],
  costs: [],
  deductions: [],
  taxYear: 2026,
  filingStatus: "single",
  override: null,
  spending: 0,
  saving: 0,
  investing: 0,
});
export const annualCount = (row: Income) =>
  ({ annual: 1, monthly: 12, semimonthly: 24, weekly: 52, daily: row.paidDays })[row.frequency];
export const roundDivide = (amount: number, by: number) => {
  const n = Math.abs(amount);
  const floor = Math.floor(n / by);
  const remainder = n % by;
  return (
    Math.sign(amount) *
    (floor + (remainder * 2 > by || (remainder * 2 === by && floor % 2 === 1) ? 1 : 0))
  );
};
export const monthlyNet = (row: Income) =>
  row.net ?? roundDivide((row.gross - row.withholding - row.payroll) * annualCount(row), 12);

export function calculate(plan: PlanDraft): Calculation {
  if (plan.model === "net-v1") {
    const income = plan.incomes.reduce((s, r) => s + (r.net ?? 0), 0);
    const fixed = plan.costs.reduce(
      (s, r) => s + (r.frequency === "annual" ? roundDivide(r.amount, 12) : r.amount),
      0,
    );
    const saving = allocationTotal(plan, "saving");
    const investing = allocationTotal(plan, "investing");
    const giving = (plan.givingLines ?? []).reduce((s, r) => s + r.amount, 0);
    const savingsFunding = (plan.savingsFunding ?? []).reduce((s, r) => s + r.amount, 0);
    return {
      income,
      fixed,
      saving,
      investing,
      giving,
      spending: plan.spending,
      savingsFunding,
      unassigned: income + savingsFunding - fixed - saving - investing - giving - plan.spending,
      gross: 0,
      withholding: 0,
      payroll: 0,
      calculated: income,
      tax: 0,
      annualWithholding: 0,
      standard: 0,
      itemized: 0,
    };
  }
  const gross = plan.incomes.reduce((s, r) => s + r.gross * annualCount(r), 0);
  const withholding = plan.incomes.reduce((s, r) => s + r.withholding * annualCount(r), 0);
  const payroll = plan.incomes.reduce((s, r) => s + r.payroll * annualCount(r), 0);
  const divisor = plan.cadence === "yearly" ? 12 : 1;
  const calculated = roundDivide(gross - withholding - payroll, 12);
  const income = plan.override === null ? calculated : roundDivide(plan.override, divisor);
  const fixed = roundDivide(
    plan.costs.reduce((s, r) => s + r.amount * (r.frequency === "annual" ? 1 : 12), 0),
    12,
  );
  const giving = plan.givingLines
    ? roundDivide(
        plan.givingLines.reduce((s, r) => s + r.amount, 0),
        divisor,
      )
    : roundDivide(income, 10);
  const standard = (plan.filingStatus === "joint" ? 32200 : 16100) * 100;
  const itemized = plan.deductions.reduce((s, r) => s + r.amount, 0);
  const taxable = Math.max(0, gross - Math.max(standard, itemized));
  const thresholds =
    plan.filingStatus === "joint"
      ? [24800, 100800, 211400, 403550, 512450, 768700]
      : [12400, 50400, 105700, 201775, 256225, 640600];
  let floor = 0;
  let tax = 0;
  for (const [i, ceiling] of [...thresholds.map((n) => n * 100), taxable].entries()) {
    tax += Math.max(0, Math.min(taxable, ceiling) - floor) * [10, 12, 22, 24, 32, 35, 37][i];
    floor = ceiling;
  }
  const saving = roundDivide(allocationTotal(plan, "saving"), divisor);
  const spending = roundDivide(plan.spending, divisor);
  const investing = roundDivide(allocationTotal(plan, "investing"), divisor);
  return {
    gross: roundDivide(gross, 12),
    withholding: roundDivide(withholding, 12),
    payroll: roundDivide(payroll, 12),
    calculated,
    income,
    fixed,
    giving,
    saving,
    spending,
    investing,
    unassigned: income - fixed - giving - saving - spending - investing,
    tax: roundDivide(tax, 100),
    annualWithholding: withholding,
    standard,
    itemized,
  };
}

export function changeCadence(plan: PlanDraft, cadence: Cadence): PlanDraft {
  if (cadence === plan.cadence) return plan;
  const convert = (value: number) => (cadence === "yearly" ? value * 12 : roundDivide(value, 12));
  return {
    ...plan,
    cadence,
    saving: convert(plan.saving),
    ...(plan.givingLines && {
      givingLines: plan.givingLines.map((r) => ({ ...r, amount: convert(r.amount) })),
    }),
    ...(plan.savingLines && {
      savingLines: plan.savingLines.map((r) => ({ ...r, amount: convert(r.amount) })),
    }),
    ...(plan.investingLines && {
      investingLines: plan.investingLines.map((r) => ({ ...r, amount: convert(r.amount) })),
    }),
    spending: convert(plan.spending),
    investing: convert(plan.investing),
    override: plan.override === null ? null : convert(plan.override),
  };
}

export function validatePlan(plan: PlanDraft, publish = true) {
  for (const kind of ["saving", "investing", "giving"] as const) {
    const lines = plan[`${kind}Lines`] ?? [];
    if (new Set(lines.map((r) => r.id)).size !== lines.length)
      throw new Error("Include each allocation destination only once.");
    if (lines.some((r) => !r.name.trim() || !Number.isSafeInteger(r.amount) || r.amount < 0))
      throw new Error("Allocation lines need a name and a nonnegative amount in whole cents.");
  }
  if (!plan.name.trim()) throw new Error("Give this Plan a name.");
  if (publish && !plan.incomes.length && !plan.savingsFunding?.length && !plan.lumpSums?.length)
    throw new Error("Add an Income source before saving a version.");
  for (const row of [...plan.incomes, ...plan.costs, ...plan.deductions])
    if (!row.name.trim()) throw new Error("Give every line a name, or remove the unused line.");
  for (const line of plan.savingsFunding ?? [])
    if (!line.name.trim() || !Number.isSafeInteger(line.amount) || line.amount < 0)
      throw new Error("Choose an account and nonnegative savings funding amount.");
  for (const row of plan.incomes) {
    if (plan.model === "net-v1" && (!Number.isSafeInteger(row.net) || (row.net ?? -1) < 0))
      throw new Error("Enter monthly net income in nonnegative cents.");
    if (
      row.frequency === "daily" &&
      (!Number.isInteger(row.paidDays) || row.paidDays < 1 || row.paidDays > 366)
    )
      throw new Error("Daily Income needs between 1 and 366 paid days per year.");
    if (row.withholding + row.payroll > row.gross)
      throw new Error(`Withholding and payroll deductions exceed gross Income for ${row.name}.`);
  }
}

export function versions(state: Workspace) {
  return state.plans.flatMap((p) => p.versions);
}
export function references(state: Workspace, kind: Kind): { id: string; name: string }[] {
  if (kind === "saving") return state.goals;
  if (kind === "investing") return state.investments;
  if (kind === "giving") return state.recipients;
  const rows = new Map<string, string>();
  for (const p of state.plans)
    for (const plan of [...p.versions.map((v) => v.plan), p.draft]) {
      for (const row of kind === "income" ? plan.incomes : kind === "fixed" ? plan.costs : [])
        rows.set(row.id, row.name);
    }
  return [...rows].map(([id, name]) => ({ id, name }));
}

export function summarize(state: Workspace, review: Review): ReviewGroup[] {
  const version = versions(state).find((v) => v.id === review.versionId);
  if (!version) return [];
  const entries = state.entries.filter((e) => !e.deleted && e.date.startsWith(review.month));
  return kinds.map((kind) => {
    const matching = entries.filter((e) => e.kind === kind);
    const expected =
      kind === "income"
        ? version.plan.incomes
        : kind === "fixed"
          ? version.plan.costs
          : kind === "saving" || kind === "investing" || kind === "giving"
            ? (version.plan[`${kind}Lines`] ?? [])
            : [];
    const rows = new Map(expected.map((r) => [r.id, r.name]));
    for (const entry of matching)
      if (entry.sourceId && !rows.has(entry.sourceId)) rows.set(entry.sourceId, entry.label);
    if (matching.some((e) => !e.sourceId) && !rows.has("")) rows.set("", "Unassigned");
    const children: ReviewLine[] = [...rows].map(([sourceId, name]) => {
      const itemEntries = matching.filter((e) => e.sourceId === sourceId);
      const recorded = itemEntries.length ? itemEntries.reduce((s, e) => s + e.amount, 0) : null;
      const key = `${kind}:${sourceId}`;
      let planned: number | null = null;
      const income = version.plan.incomes.find((r) => r.id === sourceId);
      const cost = version.plan.costs.find((r) => r.id === sourceId);
      if (kind === "income" && income) planned = monthlyNet(income);
      if (kind === "fixed" && cost)
        planned = cost.frequency === "annual" ? roundDivide(cost.amount, 12) : cost.amount;
      if (kind === "saving" || kind === "investing" || kind === "giving") {
        const allocation = version.plan[`${kind}Lines`]?.find((r) => r.id === sourceId);
        if (allocation)
          planned = roundDivide(allocation.amount, version.plan.cadence === "yearly" ? 12 : 1);
      }
      return {
        key,
        name,
        planned,
        recorded,
        actual: recorded,
        actualOnly: !expected.some((r) => r.id === sourceId),
        entries: itemEntries,
      };
    });
    const knownValues = children.filter((c) => c.actual !== null);
    const recorded = matching.length ? matching.reduce((s, e) => s + e.amount, 0) : null;
    const known = children.length
      ? knownValues.length
        ? knownValues.reduce((s, c) => s + (c.actual ?? 0), 0)
        : null
      : recorded;
    const incomplete =
      ["income", "fixed", "saving", "investing", "giving"].includes(kind) &&
      children.some((c) => c.actual === null);
    const rollup = known;
    return {
      key: kind,
      name: labels[kind],
      planned: version.calculation[kind],
      recorded,
      rollup,
      actual: rollup,
      actualOnly: false,
      entries: matching,
      children,
      incomplete,
      known,
    };
  });
}

export function saveEntry(state: Workspace, input: Entry): Workspace {
  let entry = { ...input };
  const old = state.entries.find((e) => e.id === input.id);
  entry.order = old?.order ?? input.order ?? nextOrder(state);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(entry.date) ||
    Number.isNaN(Date.parse(entry.date)) ||
    new Date(`${entry.date}T12:00:00Z`).toISOString().slice(0, 10) !== entry.date
  )
    throw new Error("Choose a valid date.");
  if (!Number.isSafeInteger(entry.amount))
    throw new Error("Enter an amount with no more than two decimal places.");
  if (
    !entry.adjustment &&
    ["income", "saving", "investing"].includes(entry.kind) &&
    entry.amount < 0
  )
    throw new Error("Receipts and contributions cannot be negative.");
  if (entry.funding) {
    if (entry.kind === "income") throw new Error("Income receipts cannot use savings funding.");
    if (entry.funding.receiptId) {
      const receipt = state.entries.find(
        (e) => e.id === entry.funding?.receiptId && e.kind === "income" && !e.adjustment,
      );
      if (!receipt || receipt.date > entry.date)
        throw new Error("Choose an income receipt recorded on or before this outflow.");
      if (entry.funding.goalId)
        throw new Error("Choose either a receipt reserve or a goal as the funding origin.");
    }
    const account = entry.funding.account.trim();
    if (!account || account.length > 120)
      throw new Error("Name the savings account (up to 120 characters).");
    if (entry.funding.goalId && !state.goals.some((g) => g.id === entry.funding?.goalId))
      throw new Error("Choose an existing funding goal.");
    if (entry.kind === "saving" && entry.sourceId === entry.funding.goalId)
      throw new Error("Choose a different goal as the funding origin.");
    entry.funding = { ...entry.funding, account };
  }
  const previous = state.entries.find((e) => e.id === entry.id);
  if (["income", "fixed", "saving"].includes(entry.kind) && entry.sourceId) {
    const source = references(state, entry.kind).find((r) => r.id === entry.sourceId);
    if (!source) throw new Error("Choose a source, category, or goal.");
    entry = { ...entry, label: source.name, tag: "" };
    if (entry.kind === "saving") {
      const goal = state.goals.find((g) => g.id === entry.sourceId);
      if (
        !goal?.active &&
        !entry.adjustment &&
        !(previous?.kind === "saving" && previous.sourceId === entry.sourceId)
      )
        throw new Error("Choose an active goal for a new contribution.");
      entry.tag =
        previous?.sourceId === entry.sourceId && previous.kind === "saving"
          ? previous.tag
          : (goal?.tag ?? "");
    }
  } else if (["investing", "giving"].includes(entry.kind) && entry.sourceId) {
    const destination = (entry.kind === "investing" ? state.investments : state.recipients).find(
      (r) => r.id === entry.sourceId,
    );
    if (!destination) throw new Error("Choose an investment or giving recipient.");
    if (
      !destination.active &&
      !entry.adjustment &&
      !(previous?.kind === entry.kind && previous.sourceId === entry.sourceId)
    )
      throw new Error("Choose an active destination for a new entry.");
    entry = { ...entry, label: destination.name, tag: "" };
  } else {
    if (entry.kind === "saving") throw new Error("Choose an active goal.");
    entry = { ...entry, sourceId: "", label: entry.label.trim() || labels[entry.kind], tag: "" };
  }
  const next = { ...state, entries: [...state.entries.filter((e) => e.id !== entry.id), entry] };
  validateEntryChange(state, next, entry);
  return next;
}

export function adjustActual(
  state: Workspace,
  month: string,
  key: string,
  total: number,
  funding?: Entry["funding"],
  date = `${month}-01`,
  savingGoalId?: string,
): Workspace {
  if (!Number.isSafeInteger(total)) throw new Error("Enter a total in whole cents.");
  const review = state.reviews.find((r) => r.month === month);
  if (!review) throw new Error("Choose a Review first.");
  const line = summarize(state, review)
    .flatMap((g) => [g, ...g.children])
    .find((l) => l.key === key);
  if (!line) throw new Error("Choose a Review item.");
  const [kind, sourceId = ""] = key.split(":") as [Kind, string?];
  if (["income", "saving", "investing"].includes(kind) && total < 0)
    throw new Error("Receipts and contributions cannot total less than zero.");
  return saveEntry(state, {
    id: id(),
    date,
    kind,
    sourceId: kind === "saving" ? (savingGoalId ?? sourceId) : sourceId,
    label: line.name,
    amount: total - (line.recorded ?? 0),
    adjustment: true,
    funding,
    note: "Adjustment to recorded total",
    tag: "",
  });
}

export const storageKey = "accanto-workspace-prototype-v1";

export function reviewSignature(state: Workspace, review: Review) {
  return JSON.stringify({
    versionId: review.versionId,
    note: review.note,
    entries: state.entries
      .filter((e) => !e.deleted && e.date.startsWith(review.month))
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((e) => [
        e.id,
        e.date,
        e.kind,
        e.sourceId,
        e.label,
        e.amount,
        e.note,
        e.tag,
        e.adjustment ?? false,
        e.funding ?? null,
      ]),
  });
}

export const savingsUsed = (entries: Entry[]) =>
  entries
    .filter((e) => !e.deleted && e.kind !== "income" && e.funding)
    .reduce((s, e) => s + e.amount, 0);

export function goalSavings(state: Workspace, goalId: string) {
  const contributed = state.entries
    .filter((e) => !e.deleted && e.kind === "saving" && e.sourceId === goalId)
    .reduce((s, e) => s + e.amount, 0);
  const used = savingsUsed(state.entries.filter((e) => e.funding?.goalId === goalId));
  const goal = state.goals.find((g) => g.id === goalId);
  const moved = (state.movements ?? [])
    .filter((m) => !m.deleted)
    .reduce((s, m) => s + (m.to === goalId ? m.amount : 0) - (m.from === goalId ? m.amount : 0), 0);
  return { contributed, used, remaining: (goal?.opening ?? 0) + contributed - used + moved };
}

export function fundingLabel(state: Workspace, entry: Entry) {
  if (!entry.funding) return "Current income";
  const goal = state.goals.find((g) => g.id === entry.funding?.goalId);
  return `${entry.funding.account}${goal ? ` · ${goal.name}` : ""}`;
}

export function allocationTotal(plan: PlanDraft, kind: "saving" | "investing" | "giving") {
  return (
    plan[`${kind}Lines`]?.reduce((sum, row) => sum + row.amount, 0) ??
    (kind === "giving" ? calculate(plan).giving * (plan.cadence === "yearly" ? 12 : 1) : plan[kind])
  );
}

export function editableMonthlyPlan(plan: PlanDraft): PlanDraft {
  const monthly = changeCadence(structuredClone(plan), "monthly");
  for (const kind of ["saving", "investing", "giving"] as const) {
    const amount = allocationTotal(monthly, kind);
    monthly[`${kind}Lines`] ??= amount ? [{ id: "", name: "Legacy unallocated", amount }] : [];
    if (kind !== "giving") monthly[kind] = allocationTotal(monthly, kind);
  }
  return monthly;
}

export const nextOrder = (state: Workspace) =>
  1 +
  Math.max(
    0,
    ...state.entries.map((e) => e.order ?? 0),
    ...(state.movements ?? []).map((m) => m.order),
  );
export function validateSavingsHistory(state: Workspace) {
  const balances = new Map(
    state.goals.filter((g) => g.accountId).map((g) => [g.id, g.opening ?? 0]),
  );
  const events = [
    ...state.entries
      .filter((e) => !e.deleted)
      .map((e, i) => ({
        date: e.date,
        order: e.order ?? i,
        effects: [
          ...(e.kind === "saving" ? [[e.sourceId, e.amount] as const] : []),
          ...(e.funding ? [[e.funding.goalId, -e.amount] as const] : []),
        ],
      })),
    ...(state.movements ?? [])
      .filter((m) => !m.deleted)
      .map((m) => ({
        date: m.date,
        order: m.order,
        effects: [
          [m.from, -m.amount],
          [m.to, m.amount],
        ] as (readonly [string, number])[],
      })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);
  for (const event of events)
    for (const [goalId, delta] of event.effects) {
      if (!balances.has(goalId)) continue; // Legacy label-only records retain their original meaning.
      const goal = state.goals.find((g) => g.id === goalId);
      if (!goal) throw new Error("Goal missing.");
      const account = state.accounts?.find((a) => a.id === goal.accountId);
      if (!account || event.date < account.date)
        throw new Error(`Activity for ${goal.name} cannot precede its account opening.`);
      const balance = (balances.get(goalId) ?? 0) + delta;
      if (balance < 0)
        throw new Error(
          `${goal.name} is short ${money(-balance)} on ${event.date}. Record legitimate funding first.`,
        );
      balances.set(goalId, balance);
    }
}
function validateEntryChange(before: Workspace, next: Workspace, entry: Entry) {
  const old = before.entries.find((e) => e.id === entry.id);
  const linkedAccount = entry.debtId
    ? next.debts?.find((d) => d.id === entry.debtId)
    : entry.kind === "investing"
      ? next.investments.find((d) => d.id === entry.sourceId)
      : undefined;
  if (entry.debtId && (entry.kind !== "fixed" || !linkedAccount))
    throw new Error("Debt payments are fixed costs linked to an existing debt account.");
  if (
    linkedAccount &&
    ((entry.debtId && !linkedAccount.active) ||
      (linkedAccount.openingDate && entry.date < linkedAccount.openingDate))
  )
    throw new Error("Reopen the account and use a date on or after its opening.");
  if (!entry.deleted && entry.funding && entry.amount < 0 && !entry.adjustment && !entry.refundOf)
    throw new Error("Record a linked refund from its original purchase.");
  const refunds = next.entries.filter((e) => !e.deleted && e.refundOf === entry.id);
  if (refunds.length) {
    if (entry.deleted) throw new Error("Delete linked refunds first.");
    if (refunds.some((r) => r.kind !== entry.kind || r.sourceId !== entry.sourceId))
      throw new Error(
        "Delete linked refunds before changing the purchase category or destination.",
      );
    if (JSON.stringify(old?.funding) !== JSON.stringify(entry.funding))
      throw new Error("Delete linked refunds before changing funding origin.");
    if (
      refunds.some((r) => r.date < entry.date) ||
      refunds.reduce((s, r) => s - r.amount, 0) > entry.amount
    )
      throw new Error("Purchase date or amount conflicts with its linked refunds.");
  }
  if (!entry.deleted && entry.refundOf) {
    const purchase = next.entries.find((e) => e.id === entry.refundOf && !e.deleted);
    if (
      !purchase ||
      !["fixed", "giving", "spending"].includes(purchase.kind) ||
      purchase.amount <= 0 ||
      purchase.refundOf ||
      entry.amount >= 0 ||
      entry.kind !== purchase.kind ||
      entry.sourceId !== purchase.sourceId ||
      entry.date < purchase.date ||
      JSON.stringify(entry.funding) !== JSON.stringify(purchase.funding)
    )
      throw new Error(
        "Refund must follow its purchase date, category and original funding origin.",
      );
    const refunded = next.entries
      .filter((e) => !e.deleted && e.refundOf === purchase.id)
      .reduce((s, e) => s - e.amount, 0);
    if (refunded > purchase.amount)
      throw new Error(
        `Refund exceeds remaining refundable amount ${money(purchase.amount - (refunded + entry.amount))}.`,
      );
  }
  for (const goalId of [entry.kind === "saving" ? entry.sourceId : "", entry.funding?.goalId]) {
    if (!goalId) continue;
    const goal = next.goals.find((g) => g.id === goalId);
    if (!goal?.accountId) {
      if (!old || JSON.stringify(old) !== JSON.stringify(entry))
        throw new Error(
          "Legacy savings history is preserved. Use a tracked account and goal for new activity.",
        );
      continue;
    }
    const account = next.accounts?.find((a) => a.id === goal.accountId);
    if (!account?.active) throw new Error("Reopen the savings account before changing activity.");
    if (
      (!old || old.deleted) &&
      !goal.active &&
      !(entry.refundOf && goal.completed) &&
      !(entry.adjustment && !goal.completed)
    )
      throw new Error("Choose an active goal; completed goals accept only linked refunds.");
  }
  if (entry.funding && !entry.deleted && !entry.funding.goalId)
    throw new Error("Select a savings goal, including Unallocated.");
  if (entry.funding && entry.kind === "saving")
    throw new Error("Use a reassignment or transfer to move existing savings.");
  validateSavingsHistory(next);
}
export function deleteEntry(state: Workspace, entry: Entry): Workspace {
  const deleted = { ...entry, deleted: true };
  const next = { ...state, entries: state.entries.map((e) => (e.id === entry.id ? deleted : e)) };
  validateEntryChange(state, next, deleted);
  return next;
}
export function createSavingsAccount(
  state: Workspace,
  name: string,
  date: string,
  opening: number,
): Workspace {
  if (!name.trim() || !Number.isSafeInteger(opening) || opening < 0 || !validDate(date))
    throw new Error("Enter an account name, opening date and nonnegative cents.");
  const account = { id: id(), name: name.trim(), date, opening, active: true };
  return {
    ...state,
    accounts: [...(state.accounts ?? []), account],
    goals: [
      ...state.goals,
      {
        id: id(),
        name: `${account.name} · Unallocated`,
        accountId: account.id,
        opening,
        role: "unallocated",
        purpose: "ongoing",
        target: 0,
        active: true,
        tag: "",
      },
    ],
  };
}
export function saveMovement(state: Workspace, movement: SavingsMovement): Workspace {
  const old = state.movements?.find((m) => m.id === movement.id);
  const m = { ...movement, order: old?.order ?? nextOrder(state) };
  if (!validDate(m.date)) throw new Error("Choose a valid date.");
  if (m.kind === "reconciliation" && m.from)
    throw new Error("Reconciliation targets only one goal.");
  const from = state.goals.find((g) => g.id === m.from);
  const to = state.goals.find((g) => g.id === m.to);
  if (!Number.isSafeInteger(m.amount) || (m.kind !== "reconciliation" && m.amount <= 0))
    throw new Error("Enter a positive exact amount.");
  if (!to?.accountId || (m.kind !== "reconciliation" && (!from?.accountId || from.id === to.id)))
    throw new Error("Select the savings goals explicitly.");
  if (m.kind === "reassignment" && from?.accountId !== to.accountId)
    throw new Error("Reassign within one account.");
  if (m.kind === "transfer" && from?.accountId === to.accountId)
    throw new Error("Transfer between different accounts.");
  for (const g of [from, to].filter(Boolean) as Goal[]) {
    if (!state.accounts?.find((a) => a.id === g.accountId)?.active)
      throw new Error("Reopen the account first.");
    if (
      !g.active &&
      !(g === from && g.completed && to.role === "unallocated" && m.kind === "reassignment")
    )
      throw new Error("Select active goals, or return a completed goal's refund to Unallocated.");
  }
  const next = {
    ...state,
    movements: [...(state.movements ?? []).filter((r) => r.id !== m.id), m],
  };
  validateSavingsHistory(next);
  return next;
}
export function archiveAccount(state: Workspace, accountId: string): Workspace {
  const account = state.accounts?.find((a) => a.id === accountId);
  if (!account) throw new Error("Account not found.");
  if (
    account.active &&
    state.goals.some((g) => g.accountId === accountId && goalSavings(state, g.id).remaining !== 0)
  )
    throw new Error("Transfer or use all remaining savings before archival.");
  return {
    ...state,
    accounts: state.accounts?.map((a) => (a.id === accountId ? { ...a, active: !a.active } : a)),
    goals: state.goals.map((g) =>
      g.accountId !== accountId
        ? g
        : account.active
          ? { ...g, archivedWithAccount: g.active, active: false }
          : { ...g, active: g.archivedWithAccount === true, archivedWithAccount: false },
    ),
  };
}
export function completeGoal(state: Workspace, goalId: string, date: string): Workspace {
  const goal = state.goals.find((g) => g.id === goalId);
  if (!goal?.active || goal.role === "unallocated" || goal.purpose !== "finite")
    throw new Error("Only an active finite goal can be completed.");
  const to = state.goals.find((g) => g.accountId === goal.accountId && g.role === "unallocated");
  if (!to) throw new Error("Unallocated goal missing.");
  const amount = goalSavings(state, goalId).remaining;
  const next = amount
    ? saveMovement(state, {
        id: id(),
        date,
        order: nextOrder(state),
        kind: "reassignment",
        from: goalId,
        to: to.id,
        amount,
      })
    : state;
  return {
    ...next,
    goals: next.goals.map((g) => (g.id === goalId ? { ...g, active: false, completed: true } : g)),
  };
}

export function saveBalance(state: Workspace, balance: Balance): Workspace {
  if (
    !balance.name.trim() ||
    !Number.isSafeInteger(balance.amount) ||
    balance.amount < 0 ||
    !validDate(balance.date)
  )
    throw new Error("Enter a name, valid date and nonnegative exact amount.");
  const account = balance.debtId
    ? state.debts?.find((d) => d.id === balance.debtId)
    : state.investments.find((d) => d.id === balance.investmentId);
  if (account && (!account.active || (account.openingDate && balance.date < account.openingDate)))
    throw new Error("Reopen the account and use a date on or after its opening.");
  if (
    state.balances.some(
      (b) =>
        !b.deleted &&
        b.id !== balance.id &&
        b.date === balance.date &&
        ((balance.debtId && b.debtId === balance.debtId) ||
          (balance.investmentId && b.investmentId === balance.investmentId)),
    )
  )
    throw new Error("An observation exists for this account and date. Correct it explicitly.");
  const old = state.balances.find((b) => b.id === balance.id);
  if (old?.opening) throw new Error("Opening positions are protected. Record a later observation.");
  return { ...state, balances: [...state.balances.filter((b) => b.id !== balance.id), balance] };
}
export const validDate = (date: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(date) &&
  !Number.isNaN(Date.parse(date)) &&
  new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) === date;

export function validateWorkspaceChange(before: Workspace, next: Workspace) {
  for (const p of before.plans)
    for (const v of p.versions) {
      if (
        JSON.stringify(
          next.plans.find((n) => n.id === p.id)?.versions.find((n) => n.id === v.id),
        ) !== JSON.stringify(v)
      )
        throw new Error("Saved Plan versions cannot be changed or removed.");
    }
  for (const account of next.accounts ?? []) {
    const goals = next.goals.filter((g) => g.accountId === account.id);
    const unallocated = goals.filter((g) => g.role === "unallocated");
    if (
      unallocated.length !== 1 ||
      unallocated[0].target !== 0 ||
      unallocated[0].purpose !== "ongoing" ||
      unallocated[0].completed ||
      unallocated[0].active !== account.active
    )
      throw new Error("Each account requires its protected ongoing Unallocated goal.");
    if (goals.reduce((s, g) => s + (g.opening ?? 0), 0) !== account.opening)
      throw new Error("Opening designations must equal the account opening amount.");
    const old = before.accounts?.find((a) => a.id === account.id);
    if (old && (old.date !== account.date || old.opening !== account.opening))
      throw new Error("Opening positions are protected; use dated reconciliation.");
  }
  for (const g of next.goals) {
    const old = before.goals.find((o) => o.id === g.id);
    if (
      old?.accountId &&
      (old.accountId !== g.accountId || old.opening !== g.opening || old.role !== g.role)
    )
      throw new Error("A goal's account, opening and reserved role are protected.");
  }
  validateSavingsHistory(next);
}
