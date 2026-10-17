import { describe, expect, it } from "vitest";
import {
  type Entry,
  type PlanDraft,
  type Review,
  adjustActual,
  calculate,
  changeCadence,
  editableMonthlyPlan,
  emptyWorkspace,
  goalSavings,
  newDraft,
  reviewSignature,
  saveEntry,
  savingsUsed,
  summarize,
  validatePlan,
} from "./domain";
import { parseWorkspace } from "./storage";

const draft = (): PlanDraft => ({
  ...newDraft("Test plan"),
  model: undefined,
  savingLines: undefined,
  investingLines: undefined,
  givingLines: undefined,
  incomes: [
    {
      id: "salary",
      name: "Salary",
      gross: 500000,
      frequency: "monthly",
      paidDays: 260,
      withholding: 100000,
      payroll: 50000,
    },
    {
      id: "bonus",
      name: "Bonus",
      gross: 120000,
      frequency: "annual",
      paidDays: 260,
      withholding: 0,
      payroll: 0,
    },
  ],
  costs: [{ id: "rent", name: "Rent", amount: 120000, frequency: "monthly" }],
  saving: 20000,
  spending: 40000,
  investing: 50000,
});
const unallocated = {
  id: "unallocated",
  name: "Unallocated",
  accountId: "account",
  role: "unallocated" as const,
  purpose: "ongoing" as const,
  target: 0,
  active: true,
  tag: "",
  opening: 0,
};
function workspace() {
  const state = emptyWorkspace();
  state.accounts = [
    { id: "account", name: "Savings", date: "2026-01-01", opening: 0, active: true },
  ];
  state.goals = [{ ...unallocated }];
  const plan = draft();
  state.plans = [
    {
      id: "plan",
      draft: structuredClone(plan),
      versions: [
        {
          id: "v1",
          number: 1,
          savedAt: "2026-10-01T00:00:00Z",
          plan,
          calculation: calculate(plan),
        },
      ],
    },
  ];
  state.reviews = [{ month: "2026-10", versionId: "v1", note: "" }];
  return state;
}
const entry = (extra: Partial<Entry>): Entry => ({
  id: "entry",
  date: "2026-10-05",
  kind: "income",
  sourceId: "salary",
  label: "",
  amount: 350000,
  note: "",
  tag: "",
  ...extra,
});

describe("financial workflow contract", () => {
  it("preserves annual allocations and override when changing cadence", () => {
    const p = { ...draft(), override: 425001 };
    const annual = changeCadence(p, "yearly");
    expect(annual.saving).toBe(p.saving * 12);
    expect(annual.override).toBe(5100012);
    expect(calculate(annual)).toEqual(calculate(p));
    expect(changeCadence(annual, "monthly")).toEqual(p);
  });
  it("uses combined Income, deductible amounts, and every federal bracket", () => {
    const p = draft();
    p.incomes = [
      {
        ...p.incomes[0],
        gross: 25000000 + 1610000,
        frequency: "annual",
        withholding: 0,
        payroll: 0,
      },
    ];
    expect(calculate(p).tax).toBe(5645600);
    p.deductions = [{ id: "d", name: "Deductible", amount: 2000000 }];
    expect(calculate(p).tax).toBe(5520800);
    expect(calculate(p).unassigned).toBe(calculate({ ...p, deductions: [] }).unassigned);
  });
  it("uses an explicit take-home override without hiding the calculated result", () => {
    const p = { ...draft(), override: 300000 };
    const c = calculate(p);
    expect(c.calculated).toBe(360000);
    expect(c.income).toBe(300000);
    expect(c.giving).toBe(30000);
  });
  it("smooths annual costs and rejects impossible payroll inputs", () => {
    const p = draft();
    p.costs = [{ id: "tax", name: "Property tax", amount: 600000, frequency: "annual" }];
    expect(calculate(p).fixed).toBe(50000);
    p.incomes[0].payroll = 500001;
    expect(() => validatePlan(p)).toThrow(/exceed/);
  });
  it("requires paid days for daily Income", () => {
    const p = draft();
    p.incomes[0].frequency = "daily";
    p.incomes[0].paidDays = 0;
    expect(() => validatePlan(p)).toThrow(/paid days/);
  });
  it("keeps an Income total unknown until every included source is known", () => {
    let s = workspace();
    expect(summarize(s, s.reviews[0])[0].actual).toBeNull();
    s = saveEntry(s, entry({}));
    const group = summarize(s, s.reviews[0])[0];
    expect(group.actual).toBe(350000);
    expect(group.incomplete).toBe(true);
    expect(group.known).toBe(350000);
    s = adjustActual(s, "2026-10", "income:bonus", 0);
    expect(summarize(s, s.reviews[0])[0].actual).toBe(350000);
  });
  it("records a delta, keeps later detail additive, and supports edit/delete/undo", () => {
    let s = saveEntry(workspace(), entry({ kind: "spending", sourceId: "", amount: 21000 }));
    s = adjustActual(s, "2026-10", "spending", 25000);
    const adjustment = s.entries[1];
    expect(adjustment).toMatchObject({ adjustment: true, amount: 4000, date: "2026-10-01" });
    expect(s.entries[0].amount).toBe(21000);
    const actual = (state: typeof s) => summarize(state, state.reviews[0])[3].actual;
    expect(actual(s)).toBe(25000);
    s = saveEntry(s, entry({ id: "receipt", kind: "spending", sourceId: "", amount: 4000 }));
    expect(actual(s)).toBe(29000);
    s = saveEntry(s, { ...adjustment, amount: 1000 });
    expect(actual(s)).toBe(26000);
    s = { ...s, entries: s.entries.filter((e) => e.id !== adjustment.id) };
    expect(actual(s)).toBe(25000);
    expect(actual(saveEntry(s, adjustment))).toBe(29000);
  });
  it("retains actual-only sources on retargeting and does not mutate saved versions", () => {
    const s = saveEntry(workspace(), entry({}));
    const p = { ...draft(), incomes: [draft().incomes[1]] };
    s.plans[0].versions.push({
      id: "v2",
      number: 2,
      savedAt: "2026-10-02",
      plan: p,
      calculation: calculate(p),
    });
    s.plans[0].draft.incomes[0].gross = 1;
    expect(s.plans[0].versions[0].plan.incomes[0].gross).toBe(500000);
    const r: Review = { ...s.reviews[0], versionId: "v2" };
    const group = summarize(s, r)[0];
    expect(group.children.find((c) => c.key === "income:salary")?.actualOnly).toBe(true);
    expect(group.known).toBe(350000);
  });
  it("keeps saving progress as dated activity, inherits tags, and protects inactive goals", () => {
    let s = workspace();
    s.goals = [
      {
        id: "g",
        name: "Travel",
        target: 100000,
        tag: "Savings",
        accountId: "account",
        active: true,
      },
      { ...unallocated },
    ];
    s = saveEntry(s, entry({ kind: "saving", sourceId: "g", amount: 10000 }));
    expect(s.entries[0].tag).toBe("Savings");
    s = adjustActual(s, "2026-10", "saving:g", 50000);
    expect(s.entries[0].amount).toBe(10000);
    s.goals[0].active = false;
    s.goals[0].tag = "Renamed";
    expect(() => saveEntry(s, entry({ id: "another", kind: "saving", sourceId: "g" }))).toThrow(
      /active goal/,
    );
    s = saveEntry(s, { ...s.entries[0], note: "Edited" });
    expect(s.entries[0].tag).toBe("Savings");
  });
  it("rolls up both item and category adjustments without masking later activity", () => {
    let s = saveEntry(workspace(), entry({ kind: "fixed", sourceId: "rent", amount: 120001 }));
    s = adjustActual(s, "2026-10", "fixed:rent", 130000);
    s = adjustActual(s, "2026-10", "fixed", 140000);
    const g = summarize(s, s.reviews[0])[1];
    expect(g.actual).toBe(140000);
    expect(g.recorded).toBe(140000);
    expect(g.children[0].actual).toBe(130000);
    expect(s.entries.map((e) => e.amount)).toEqual([120001, 9999, 10000]);
  });
  it("isolates Periods and supports exact-cent corrections and refunds", () => {
    let s = workspace();
    s = saveEntry(s, entry({ kind: "spending", sourceId: "", amount: 1001 }));
    s = saveEntry(s, entry({ id: "refund", kind: "spending", sourceId: "", amount: -201 }));
    s = saveEntry(
      s,
      entry({ id: "next", date: "2026-11-01", kind: "spending", sourceId: "", amount: 10000 }),
    );
    expect(summarize(s, s.reviews[0]).find((g) => g.key === "spending")?.actual).toBe(800);
    s = saveEntry(s, { ...s.entries[0], amount: 1051 });
    expect(summarize(s, s.reviews[0]).find((g) => g.key === "spending")?.actual).toBe(850);
  });
  it("round-trips backups including zero and immutable version snapshots", () => {
    const s = adjustActual(workspace(), "2026-10", "income", 0);
    expect(parseWorkspace(JSON.stringify(s))).toEqual(s);
    expect(() => parseWorkspace('{"schema":1}')).toThrow();
    const broken = { ...s, reviews: [{ ...s.reviews[0], versionId: "missing" }] };
    expect(() => parseWorkspace(JSON.stringify(broken))).toThrow(/references/);
  });
});

it("keeps named and unassigned investing and giving in monthly totals", () => {
  let state = workspace();
  state.investments = [{ id: "broker", name: "Brokerage", target: null, active: true }];
  state.recipients = [{ id: "charity", name: "Food bank", target: 100000, active: true }];
  for (const [kind, sourceId] of [
    ["investing", "broker"],
    ["giving", "charity"],
  ] as const) {
    state = saveEntry(state, entry({ id: `${kind}-named`, kind, sourceId, amount: 20000 }));
    state = saveEntry(state, entry({ id: `${kind}-old`, kind, sourceId: "", amount: 5000 }));
    const group = summarize(state, state.reviews[0]).find((g) => g.key === kind);
    expect(group?.actual).toBe(25000);
    expect(group?.children.map((c) => c.actual)).toEqual([20000, 5000]);
    const replaced = adjustActual(state, "2026-10", `${kind}:${sourceId}`, 30000);
    expect(summarize(replaced, replaced.reviews[0]).find((g) => g.key === kind)?.actual).toBe(
      35000,
    );
    expect(replaced.entries.slice(0, -1)).toEqual(state.entries);
    expect(replaced.entries[replaced.entries.length - 1]?.amount).toBe(10000);
  }
  state.balances = [
    {
      id: "balance",
      investmentId: "broker",
      name: "Brokerage",
      date: "2026-10-11",
      amount: 500000,
    },
  ];
  expect(summarize(state, state.reviews[0]).find((g) => g.key === "investing")?.actual).toBe(25000);
});

it("keeps inactive destination history editable but blocks new contributions", () => {
  let state = workspace();
  state.investments = [{ id: "broker", name: "Brokerage", target: null, active: true }];
  const contribution = entry({
    id: "contribution",
    kind: "investing",
    sourceId: "broker",
    amount: 10000,
  });
  state = saveEntry(state, contribution);
  state.investments[0].active = false;
  expect(() => saveEntry(state, { ...contribution, id: "new" })).toThrow("active destination");
  expect(saveEntry(state, { ...contribution, amount: 12000 }).entries[0].amount).toBe(12000);
});

it("reads earlier backups without inventing investment or giving identities", () => {
  const { investments, recipients, ...old } = workspace();
  const loaded = parseWorkspace(JSON.stringify(old));
  expect(loaded.investments).toEqual([]);
  expect(loaded.recipients).toEqual([]);
  expect(loaded.plans).toEqual(old.plans);
});

it("a review checkpoint detects edits, deletion, retargeting and adjustments only in its month", () => {
  let state = workspace();
  state = saveEntry(state, entry({}));
  const review = state.reviews[0];
  const signature = reviewSignature(state, review);
  const restored = parseWorkspace(JSON.stringify(state));
  expect(reviewSignature(restored, restored.reviews[0])).toBe(signature);
  expect(
    reviewSignature(saveEntry(state, entry({ id: "next-month", date: "2026-11-05" })), review),
  ).toBe(signature);
  expect(reviewSignature(saveEntry(state, entry({ amount: 350001 })), review)).not.toBe(signature);
  expect(reviewSignature({ ...state, entries: [] }, review)).not.toBe(signature);
  expect(reviewSignature(state, { ...review, versionId: "v2" })).not.toBe(signature);
  expect(reviewSignature(adjustActual(state, review.month, "income", 0), review)).not.toBe(
    signature,
  );
  expect(reviewSignature(state, { ...review, note: "A takeaway" })).not.toBe(signature);
});

it("annualizes twice-monthly pay and deductions as 24 payments and preserves backups", () => {
  const monthly = draft();
  const twiceMonthly = structuredClone(monthly);
  twiceMonthly.incomes[0] = {
    ...monthly.incomes[0],
    frequency: "semimonthly",
    gross: monthly.incomes[0].gross / 2,
    withholding: monthly.incomes[0].withholding / 2,
    payroll: monthly.incomes[0].payroll / 2,
  };
  expect(calculate(twiceMonthly)).toEqual(calculate(monthly));
  const state = workspace();
  state.plans[0].draft = twiceMonthly;
  state.plans[0].versions[0].plan = twiceMonthly;
  state.plans[0].versions[0].calculation = calculate(twiceMonthly);
  const restored = parseWorkspace(JSON.stringify(state));
  expect(restored.plans[0].draft.incomes[0].frequency).toBe("semimonthly");
  expect(summarize(restored, restored.reviews[0])[0].children[0].planned).toBe(350000);
});

it("records unplanned income and expenses without changing Plans or creating expectations from other Plans", () => {
  let s = workspace();
  const plans = structuredClone(s.plans);
  s = saveEntry(s, entry({ id: "extra", sourceId: "", amount: 50000, note: "Freelance work" }));
  s = saveEntry(
    s,
    entry({ id: "repair", kind: "fixed", sourceId: "", amount: 20000, note: "Unexpected repair" }),
  );
  expect(s.plans).toEqual(plans);
  const groups = summarize(s, s.reviews[0]);
  expect(groups[0].actual).toBe(50000);
  expect(groups[0].incomplete).toBe(true);
  expect(groups[1].actual).toBe(20000);
  expect(groups[1].incomplete).toBe(true);
  expect(groups[1].children.find((c) => c.key === "fixed:")?.actualOnly).toBe(true);
  s.plans.push({
    id: "scenario",
    draft: { ...draft(), incomes: [{ ...draft().incomes[0], id: "hypothetical" }] },
    versions: [],
  });
  expect(summarize(s, s.reviews[0])).toEqual(groups);
});

it("keeps category adjustments from hiding unknown items and deletes explicit zeros back to unknown", () => {
  let s = adjustActual(workspace(), "2026-10", "income", 50000);
  expect(summarize(s, s.reviews[0])[0].incomplete).toBe(true);
  s = adjustActual(s, "2026-10", "income:bonus", 0);
  const zero = s.entries[s.entries.length - 1];
  expect(zero.amount).toBe(0);
  expect(summarize(s, s.reviews[0])[0].children.find((c) => c.key === "income:bonus")?.actual).toBe(
    0,
  );
  s.entries = s.entries.filter((e) => e.id !== zero.id);
  expect(
    summarize(s, s.reviews[0])[0].children.find((c) => c.key === "income:bonus")?.actual,
  ).toBeNull();
});

it("supports negative corrections and refuses to silently discard legacy totals", () => {
  let s = saveEntry(workspace(), entry({}));
  s = adjustActual(s, "2026-10", "income:salary", 300000);
  expect(s.entries[s.entries.length - 1]?.amount).toBe(-50000);
  expect(parseWorkspace(JSON.stringify(s))).toEqual(s);
  expect(() => saveEntry(s, entry({ amount: -1 }))).toThrow();
  const old = { ...s, reviews: [{ ...s.reviews[0], replacements: { income: 99 }, manual: true }] };
  expect(() => parseWorkspace(JSON.stringify(old))).toThrow(/legacy Replacement/);
});

describe("saved-money funding", () => {
  it("keeps the laptop expense once, preserves income and contribution history, and recalculates edits and deletion", () => {
    let state = workspace();
    state.goals = [
      {
        id: "laptop",
        name: "Laptop",
        target: 100000,
        tag: "Savings",
        accountId: "account",
        active: true,
      },
      { ...unallocated },
    ];
    state = saveEntry(
      state,
      entry({
        id: "saved",
        kind: "saving",
        sourceId: "laptop",
        date: "2026-09-01",
        amount: 100000,
      }),
    );
    state = saveEntry(state, entry({ id: "salary" }));
    const purchase = entry({
      id: "purchase",
      kind: "spending",
      sourceId: "",
      amount: 100000,
      funding: { account: "Savings", goalId: "laptop" },
    });
    state = saveEntry(state, purchase);
    expect(goalSavings(state, "laptop")).toEqual({
      contributed: 100000,
      used: 100000,
      remaining: 0,
    });
    const groups = summarize(state, state.reviews[0]);
    expect(groups.find((g) => g.key === "spending")?.actual).toBe(100000);
    expect(groups.find((g) => g.key === "income")?.recorded).toBe(350000);
    expect(groups.find((g) => g.key === "income")?.incomplete).toBe(true);
    expect(savingsUsed(groups.find((g) => g.key === "spending")?.entries ?? [])).toBe(100000);
    const signature = reviewSignature(state, state.reviews[0]);
    state = saveEntry(state, { ...purchase, funding: undefined });
    expect(reviewSignature(state, state.reviews[0])).not.toBe(signature);
    expect(goalSavings(state, "laptop").remaining).toBe(100000);
    state = saveEntry(state, { ...purchase, amount: 90000 });
    expect(goalSavings(state, "laptop").remaining).toBe(10000);
    state = adjustActual(state, "2026-10", "spending", 85000, purchase.funding);
    expect(goalSavings(state, "laptop").remaining).toBe(15000);
    expect(parseWorkspace(JSON.stringify(state))).toEqual(state);
    state.entries = state.entries.filter((e) => e.id === "saved" || e.id === "salary");
    expect(goalSavings(state, "laptop").remaining).toBe(100000);
  });
  it("keeps savings-funded investments in destination progress and refunds restore the origin", () => {
    let state = workspace();
    state.goals = [
      {
        id: "reserve",
        name: "Reserve",
        opening: 100000,
        target: 100000,
        tag: "Savings",
        accountId: "account",
        active: true,
      },
      { ...unallocated },
    ];
    state.investments = [{ id: "brokerage", name: "Brokerage", target: null, active: true }];
    state = saveEntry(
      state,
      entry({
        id: "investment",
        kind: "investing",
        sourceId: "brokerage",
        amount: 100000,
        funding: { account: "Savings", goalId: "reserve" },
      }),
    );
    const investing = summarize(state, state.reviews[0]).find((g) => g.key === "investing");
    expect(investing?.actual).toBe(100000);
    expect((investing?.actual ?? 0) - savingsUsed(investing?.entries ?? [])).toBe(0);
    expect(state.entries.find((e) => e.sourceId === "brokerage")?.amount).toBe(100000);
    state = saveEntry(
      state,
      entry({
        adjustment: true,
        id: "refund",
        kind: "spending",
        sourceId: "",
        amount: -10000,
        funding: { account: "Savings", goalId: "reserve" },
      }),
    );
    expect(goalSavings(state, "reserve").used).toBe(90000);
    expect(() => saveEntry(state, entry({ funding: { account: "Savings", goalId: "" } }))).toThrow(
      /Income receipts/,
    );
    expect(() =>
      saveEntry(state, entry({ kind: "spending", funding: { account: "", goalId: "" } })),
    ).toThrow(/Name the savings/);
    expect(() =>
      saveEntry(
        state,
        entry({
          kind: "saving",
          sourceId: "reserve",
          funding: { account: "Savings", goalId: "reserve" },
        }),
      ),
    ).toThrow(/different goal/);
  });
});

describe("destination Plan allocations", () => {
  it("sums lines and compares only linked destinations, preserving zero and unplanned actuals", () => {
    const state = workspace();
    const plan = state.plans[0].versions[0].plan;
    plan.savingLines = [
      { id: "emergency", name: "Emergency fund", amount: 30000 },
      { id: "laptop", name: "Laptop", amount: 20000 },
    ];
    plan.investingLines = [
      { id: "retirement", name: "Retirement", amount: 70000 },
      { id: "brokerage", name: "Brokerage", amount: 30000 },
    ];
    plan.givingLines = [{ id: "church", name: "Church", amount: 15000 }];
    state.plans[0].versions[0].calculation = calculate(plan);
    expect(calculate(plan)).toMatchObject({ saving: 50000, investing: 100000, giving: 15000 });
    state.entries = [
      entry({ id: "saved", kind: "saving", sourceId: "emergency", amount: 25000 }),
      entry({
        id: "unexpected",
        kind: "saving",
        sourceId: "holiday",
        label: "Holiday",
        amount: 10000,
      }),
    ];
    let saving = summarize(state, state.reviews[0]).find((g) => g.key === "saving");
    expect(saving).toMatchObject({ actual: 35000, planned: 50000, incomplete: true });
    expect(saving?.children.find((r) => r.key === "saving:holiday")).toMatchObject({
      planned: null,
      actualOnly: true,
      actual: 10000,
    });
    state.entries.push(entry({ id: "zero", kind: "saving", sourceId: "laptop", amount: 0 }));
    saving = summarize(state, state.reviews[0]).find((g) => g.key === "saving");
    expect(saving).toMatchObject({ actual: 35000, incomplete: false });
    const snapshot = JSON.stringify(state.plans[0].versions[0]);
    state.goals.push({
      id: "other",
      name: "Other plan goal",
      target: 100000,
      tag: "",
      active: true,
    });
    state.plans[0].draft = editableMonthlyPlan(plan);
    state.plans[0].draft.savingLines = [{ id: "other", name: "Other plan goal", amount: 500 }];
    expect(JSON.stringify(state.plans[0].versions[0])).toBe(snapshot);
    expect(summarize(state, state.reviews[0]).find((g) => g.key === "saving")).toMatchObject({
      planned: 50000,
      incomplete: false,
    });
    expect(parseWorkspace(JSON.stringify(state)).plans[0].versions[0].plan.savingLines).toEqual(
      plan.savingLines,
    );
  });
  it("preserves legacy yearly snapshots and explicit unallocated amounts when editing", () => {
    const old = { ...draft(), cadence: "yearly" as const, saving: 600000, investing: 1200000 };
    const before = JSON.stringify(old);
    const editable = editableMonthlyPlan(old);
    expect(editable.cadence).toBe("monthly");
    expect(editable.savingLines).toEqual([{ id: "", name: "Legacy unallocated", amount: 50000 }]);
    expect(editable.investingLines).toEqual([
      { id: "", name: "Legacy unallocated", amount: 100000 },
    ]);
    expect(calculate(editable)).toEqual(calculate(old));
    expect(JSON.stringify(old)).toBe(before);
    editable.savingLines?.push({ id: "", name: "Duplicate", amount: 1 });
    expect(() => validatePlan(editable)).toThrow(/only once/);
  });
});

it("allows an explicit-zero correction for a planned destination made inactive", () => {
  let state = workspace();
  state.goals = [
    {
      id: "inactive",
      name: "Old goal",
      target: 100000,
      tag: "",
      accountId: "account",
      active: false,
    },
    { ...unallocated },
  ];
  state.plans[0].versions[0].plan.savingLines = [
    { id: "inactive", name: "Old goal", amount: 10000 },
  ];
  state = adjustActual(state, "2026-10", "saving:inactive", 0);
  expect(summarize(state, state.reviews[0]).find((g) => g.key === "saving")).toMatchObject({
    actual: 0,
    incomplete: false,
  });
  expect(() =>
    saveEntry(state, entry({ id: "new", kind: "saving", sourceId: "inactive" })),
  ).toThrow(/active goal/);
});
