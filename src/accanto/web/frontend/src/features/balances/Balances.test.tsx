import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ActivityScreen } from "../workspace/Activity";
import type { ScreenProps } from "../workspace/shared";
import { Balances } from "./Balances";

const entity = { id: "entity", name: "Synthetic Entity", today: "2026-10-02", time_zone: "UTC" };
const props: ScreenProps = {
  entity,
  concealed: false,
  busy: false,
  refresh: 0,
  guard: () => true,
  dirty: vi.fn(),
  save: vi.fn(),
};
const loans = [
  {
    uuid: "loan-a",
    name: "Example loan A",
    active: false,
    revision: 2,
    opening: { date: "2026-10-01", amount: "300.00" },
    latest: {
      uuid: "obs-a",
      account_id: "loan-a",
      financial_date: "2026-10-01",
      amount: "0.00",
      is_opening: false,
      revision: 1,
      deleted: false,
    },
    draft_fixed_cost_lines: [],
  },
  {
    uuid: "loan-b",
    name: "Example loan B",
    active: true,
    revision: 1,
    opening: { date: "2026-10-01", amount: "500.00" },
    latest: {
      uuid: "obs-b",
      account_id: "loan-b",
      financial_date: "2026-10-01",
      amount: "500.00",
      is_opening: true,
      revision: 1,
      deleted: false,
    },
    draft_fixed_cost_lines: [],
  },
];
const entries = [
  {
    uuid: "payment-a",
    financial_date: "2026-10-01",
    category: "fixed_cost",
    amount: "300.00",
    debt_account_id: "loan-a",
    fixed_cost_name: "Example cost A",
    fixed_cost_id: "cost-a",
    source_id: null,
    saving_goal_id: null,
    funding_origin: "income",
    destination_id: null,
    note: "",
    revision: 1,
    is_adjustment: false,
  },
  {
    uuid: "payment-b",
    financial_date: "2026-10-02",
    category: "fixed_cost",
    amount: "20.00",
    debt_account_id: "loan-b",
    fixed_cost_name: "Example cost B",
    fixed_cost_id: "cost-b",
    source_id: null,
    saving_goal_id: null,
    funding_origin: "income",
    destination_id: null,
    note: "",
    revision: 1,
    is_adjustment: false,
  },
  {
    uuid: "ordinary",
    financial_date: "2026-10-02",
    category: "fixed_cost",
    amount: "5.00",
    debt_account_id: null,
    fixed_cost_name: "Ordinary cost",
    fixed_cost_id: null,
    source_id: null,
    saving_goal_id: null,
    funding_origin: "income",
    destination_id: null,
    note: "",
    revision: 1,
    is_adjustment: false,
  },
];
const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });
const mock = () =>
  vi.spyOn(globalThis, "fetch").mockImplementation(async (path) => {
    const url = String(path);
    if (url.endsWith("/debts")) return json(loans);
    if (url.endsWith("/debt-observations")) return json([loans[0].latest, loans[1].latest]);
    if (url.endsWith("/activity")) return json(entries);
    return json([]);
  });
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("shows each loan's payment history apart from dated observations", async () => {
  mock();
  render(<Balances {...props} />);
  const loanA = (await screen.findByRole("heading", { name: /Example loan A/ })).closest("article");
  const loanB = (await screen.findByRole("heading", { name: /Example loan B/ })).closest("article");
  expect(loanA).not.toBeNull();
  expect(loanB).not.toBeNull();
  expect(within(loanA as HTMLElement).getByText(/\$300.00 payment/)).toBeDefined();
  expect(within(loanA as HTMLElement).queryByText(/\$20.00 payment/)).toBeNull();
  expect(within(loanB as HTMLElement).getByText(/\$20.00 payment/)).toBeDefined();
  expect(screen.getByRole("heading", { name: "Amount owed observations" })).toBeDefined();
});

it("names the debt account beside a fixed-cost payment in Activity", async () => {
  mock();
  render(<ActivityScreen {...props} />);
  expect(await screen.findByText("Loan: Example loan A")).toBeDefined();
  expect(screen.getByText("Loan: Example loan B")).toBeDefined();
  expect(screen.queryByText("Loan: Ordinary cost")).toBeNull();
});
