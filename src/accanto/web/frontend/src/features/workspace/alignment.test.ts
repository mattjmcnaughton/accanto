import { expect, it } from "vitest";
import {
  type Entry,
  createSavingsAccount,
  emptyWorkspace,
  goalSavings,
  saveBalance,
  saveEntry,
  saveMovement,
  today,
  validateWorkspaceChange,
} from "./domain";
import { parseWorkspace } from "./storage";

const payment = (fields: Partial<Entry> = {}): Entry => ({
  id: "payment",
  date: "2026-10-16",
  kind: "spending",
  amount: 10000,
  sourceId: "",
  label: "Purchase",
  note: "",
  tag: "",
  ...fields,
});
it("uses the Entity time zone for defaults without moving stored financial dates", () => {
  const instant = new Date("2026-11-01T01:00:00Z");
  expect(today("America/New_York", instant)).toBe("2026-10-31");
  expect(today("Asia/Tokyo", instant)).toBe("2026-11-01");
  const state = { ...emptyWorkspace(), timeZone: "America/New_York", entries: [payment()] };
  expect(parseWorkspace(JSON.stringify(state)).timeZone).toBe("America/New_York");
  expect(parseWorkspace(JSON.stringify({ ...state, timeZone: "Asia/Tokyo" })).entries[0].date).toBe(
    "2026-10-16",
  );
});
it("designates opening savings once without inventing contributions or movements", () => {
  const state = createSavingsAccount(emptyWorkspace(), "Savings", "2026-10-01", 1000000, [
    { name: "Emergency", amount: 500000, target: 500000, purpose: "finite" },
    { name: "Laptop", amount: 100000, target: 100000, purpose: "finite" },
  ]);
  expect(state.goals.map((g) => goalSavings(state, g.id).remaining).sort((a, b) => a - b)).toEqual([
    100000, 400000, 500000,
  ]);
  expect(state.entries).toEqual([]);
  expect(state.movements ?? []).toEqual([]);
  expect(() => validateWorkspaceChange(emptyWorkspace(), state)).not.toThrow();
  expect(parseWorkspace(JSON.stringify(state))).toEqual(state);
  expect(() =>
    createSavingsAccount(emptyWorkspace(), "Savings", "2026-10-01", 100, [
      { name: "Too much", amount: 101, target: 200, purpose: "finite" },
    ]),
  ).toThrow(/opening/i);
});
it("requires a purchase link for new refunds while preserving legacy negative records", () => {
  expect(() => saveEntry(emptyWorkspace(), payment({ amount: -100 }))).toThrow(/linked refund/i);
  const legacy = { ...emptyWorkspace(), entries: [payment({ amount: -100 })] };
  expect(parseWorkspace(JSON.stringify(legacy)).entries).toEqual(legacy.entries);
  expect(
    saveEntry(legacy, { ...legacy.entries[0], note: "Correct legacy note" }).entries[0].amount,
  ).toBe(-100);
});
it("cannot bypass an archived origin by editing a payment into an income-funded one", () => {
  let state = createSavingsAccount(emptyWorkspace(), "Savings", "2026-10-01", 10000);
  const goal = state.goals[0];
  state = saveEntry(state, payment({ funding: { account: "Savings", goalId: goal.id } }));
  state.accounts = state.accounts?.map((a) => ({ ...a, active: false }));
  state.goals = state.goals.map((g) => ({ ...g, active: false }));
  expect(() => saveEntry(state, { ...state.entries[0], funding: undefined })).toThrow(/reopen/i);
});
it("corrections and deletion on inactive goals retain movement order and validate later balances", () => {
  let state = createSavingsAccount(emptyWorkspace(), "Savings", "2026-10-01", 10000, [
    { name: "Reserve", amount: 0, target: 0, purpose: "ongoing" },
  ]);
  const from = state.goals.find((g) => g.role === "unallocated")?.id ?? "";
  const to = state.goals.find((g) => g.name === "Reserve")?.id ?? "";
  state = saveMovement(state, {
    id: "move",
    from,
    to,
    date: "2026-10-16",
    kind: "reassignment",
    amount: 10000,
    order: 1,
  });
  state.goals = state.goals.map((g) => (g.id === to ? { ...g, active: false } : g));
  const movement = state.movements?.[0];
  if (!movement) throw new Error("Fixture movement missing");
  const corrected = saveMovement(state, { ...movement, amount: 9000, order: 999 });
  expect(corrected.movements?.[0].order).toBe(movement.order);
  expect(goalSavings(corrected, to).remaining).toBe(9000);
});
it("rejects independently reactivating a goal in an archived account", () => {
  const state = createSavingsAccount(emptyWorkspace(), "Savings", "2026-10-01", 0, [
    { name: "Reserve", amount: 0, target: 0, purpose: "ongoing" },
  ]);
  state.accounts = state.accounts?.map((a) => ({ ...a, active: false }));
  state.goals = state.goals.map((g) => ({ ...g, active: false }));
  const next = {
    ...state,
    goals: state.goals.map((g) => (g.role === "ordinary" ? { ...g, active: true } : g)),
  };
  expect(() => validateWorkspaceChange(state, next)).toThrow(/archived account/i);
});

it("preserves a loan association on linked refunds and cannot move an archived observation", () => {
  let state = emptyWorkspace();
  state.debts = [{ id: "loan", name: "Loan", active: true, target: null }];
  state = saveEntry(state, payment({ kind: "fixed", debtId: "loan" }));
  expect(() =>
    saveEntry(state, payment({ id: "refund", kind: "fixed", refundOf: "payment", amount: -1000 })),
  ).toThrow(/original/i);
  state = saveEntry(
    state,
    payment({ id: "refund", kind: "fixed", refundOf: "payment", debtId: "loan", amount: -1000 }),
  );
  expect(() => saveEntry(state, { ...state.entries[0], debtId: undefined })).toThrow(/refund/i);
  state = saveBalance(state, {
    id: "observation",
    name: "Loan",
    date: "2026-10-16",
    amount: 0,
    debtId: "loan",
  });
  state.debts = state.debts?.map((d) => ({ ...d, active: false }));
  expect(() => saveBalance(state, { ...state.balances[0], debtId: undefined })).toThrow(/reopen/i);
});
