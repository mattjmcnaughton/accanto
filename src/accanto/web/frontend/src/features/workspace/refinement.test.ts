import { expect, it } from "vitest";
import {
  type Entry,
  archiveAccount,
  calculate,
  completeGoal,
  createSavingsAccount,
  deleteEntry,
  emptyWorkspace,
  goalSavings,
  newDraft,
  nextOrder,
  roundDivide,
  saveBalance,
  saveEntry,
  saveMovement,
} from "./domain";
import { parseWorkspace } from "./storage";
const entry = (extra: Partial<Entry>): Entry => ({
  id: "purchase",
  date: "2026-10-16",
  kind: "spending",
  amount: 100000,
  sourceId: "",
  label: "Purchase",
  note: "",
  tag: "",
  ...extra,
});
function fixture() {
  const s = createSavingsAccount(emptyWorkspace(), "Savings", "2026-10-01", 80000);
  s.goals.push({
    id: "laptop",
    name: "Laptop",
    accountId: s.accounts?.[0].id,
    role: "ordinary",
    purpose: "finite",
    target: 100000,
    active: true,
    tag: "",
  });
  return saveMovement(s, {
    id: "assign",
    date: "2026-10-01",
    order: 1,
    kind: "reassignment",
    from: s.goals[0].id,
    to: "laptop",
    amount: 80000,
  });
}
it("requires funding first, preserves order on edits and validates deletion against later uses", () => {
  let s = fixture();
  const purchase = entry({ funding: { account: "Savings", goalId: "laptop" } });
  expect(() => saveEntry(s, purchase)).toThrow(/short \$200/);
  s = saveEntry(s, entry({ id: "fund", kind: "saving", sourceId: "laptop", amount: 20000 }));
  s = saveEntry(s, purchase);
  expect(goalSavings(s, "laptop").remaining).toBe(0);
  const fund = s.entries.find((e) => e.id === "fund") as Entry;
  expect(() => deleteEntry(s, fund)).toThrow(/short/);
  expect(() => saveEntry(s, { ...fund, date: "2026-10-17" })).toThrow(/short/);
  expect(() => saveEntry(s, { ...purchase, date: "2026-09-30" })).toThrow(/opening/);
  expect(
    saveEntry(s, { ...purchase, note: "Correct note" }).entries.find((e) => e.id === "purchase")
      ?.order,
  ).toBe(s.entries.find((e) => e.id === "purchase")?.order);
});
it("caps and dates linked refunds, preserves origin and allows completed-goal returns", () => {
  let s = fixture();
  s = saveEntry(s, entry({ amount: 80000, funding: { account: "Savings", goalId: "laptop" } }));
  s = completeGoal(s, "laptop", "2026-10-16");
  const refund = entry({
    id: "refund",
    amount: -20000,
    date: "2026-11-01",
    refundOf: "purchase",
    funding: { account: "Savings", goalId: "laptop" },
  });
  s = saveEntry(s, refund);
  expect(goalSavings(s, "laptop")).toEqual({ contributed: 0, used: 60000, remaining: 20000 });
  expect(s.goals.find((g) => g.id === "laptop")?.completed).toBe(true);
  expect(() => saveEntry(s, { ...refund, id: "extra", amount: -60001 })).toThrow(
    /remaining refundable/,
  );
  expect(() => saveEntry(s, { ...refund, date: "2026-10-15" })).toThrow(/date/);
  expect(() => deleteEntry(s, s.entries[0])).toThrow(/refunds/);
  expect(() => saveEntry(s, { ...s.entries[0], funding: undefined })).toThrow(/funding origin/);
  s = saveMovement(s, {
    id: "return",
    date: "2026-11-01",
    order: nextOrder(s),
    kind: "reassignment",
    from: "laptop",
    to: s.goals[0].id,
    amount: 20000,
  });
  expect(() => deleteEntry(s, s.entries.find((e) => e.id === "refund") as Entry)).toThrow(/short/);
  expect(goalSavings(s, "laptop").remaining).toBe(0);
  expect(parseWorkspace(JSON.stringify(s))).toEqual(s);
});
it("transfers conserve savings, reconciliation is goal-specific, archival preserves lifecycle provenance", () => {
  let s = fixture();
  s = createSavingsAccount(s, "Other", "2026-10-01", 0);
  const destination = s.goals[s.goals.length - 1]?.id ?? "";
  s = saveMovement(s, {
    id: "transfer",
    date: "2026-10-16",
    order: nextOrder(s),
    kind: "transfer",
    from: "laptop",
    to: destination,
    amount: 80000,
  });
  expect(s.goals.reduce((v, g) => v + goalSavings(s, g.id).remaining, 0)).toBe(80000);
  s = completeGoal(s, "laptop", "2026-10-16");
  s = archiveAccount(s, s.accounts?.[0].id ?? "");
  s = archiveAccount(s, s.accounts?.[0].id ?? "");
  expect(s.goals.find((g) => g.id === "laptop")?.active).toBe(false);
  expect(s.goals[0].active).toBe(true);
  s = saveMovement(s, {
    id: "reconcile",
    date: "2026-10-17",
    order: nextOrder(s),
    kind: "reconciliation",
    from: "",
    to: destination,
    amount: -10000,
  });
  expect(goalSavings(s, destination).remaining).toBe(70000);
  expect(s.entries).toHaveLength(0);
  expect(() =>
    saveMovement(s, {
      id: "bad",
      date: "2026-10-17",
      order: nextOrder(s),
      kind: "reconciliation",
      from: "",
      to: destination,
      amount: -70001,
    }),
  ).toThrow(/short/);
});
it("separates funding from income and rounds each annual line half-even", () => {
  const p = newDraft();
  p.incomes = [
    {
      id: "salary",
      name: "Salary",
      net: 400000,
      gross: 0,
      withholding: 0,
      payroll: 0,
      frequency: "monthly",
      paidDays: 0,
    },
  ];
  p.savingsFunding = [{ id: "a", name: "Savings", amount: 100000 }];
  p.costs = [1, 2, 3].map((n) => ({
    id: String(n),
    name: "Annual cost",
    amount: 10000,
    frequency: "annual",
  }));
  p.spending = 500000;
  expect(calculate(p)).toMatchObject({
    income: 400000,
    savingsFunding: 100000,
    fixed: 2499,
    unassigned: -2499,
  });
  expect(roundDivide(1005, 10)).toBe(100);
  expect(roundDivide(-1015, 10)).toBe(-102);
});
it("observation duplicates reject; correction changes no contributions", () => {
  let s = emptyWorkspace();
  s.investments = [
    {
      id: "i",
      name: "Retirement",
      active: true,
      target: null,
      openingDate: "2026-10-01",
      openingAmount: 5000000,
    },
  ];
  const b = { id: "b", name: "Retirement", investmentId: "i", date: "2026-10-31", amount: 5000000 };
  s = saveBalance(s, b);
  expect(() => saveBalance(s, { ...b, id: "duplicate" })).toThrow(/exists/);
  s = saveBalance(s, { ...b, amount: 5020000 });
  expect(s.balances).toHaveLength(1);
  expect(s.entries).toHaveLength(0);
});
