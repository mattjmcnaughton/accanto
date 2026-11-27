import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Loan, PayoffSummary } from "../../lib/balances";
import { activityPage } from "../../stories/mocks/activity";
import { ActivityScreen } from "../workspace/Activity";
import type { ScreenProps } from "../workspace/shared";
import { Balances } from "./Balances";

function payoff(value: Partial<PayoffSummary> & Pick<PayoffSummary, "status">): PayoffSummary {
  return {
    as_of: "2026-10-01",
    balance: "0.00",
    interest_rate_percent: null,
    monthly_payment: null,
    monthly_interest: null,
    months: null,
    payoff_date: null,
    total_interest: null,
    total_paid: null,
    ...value,
  };
}
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
const loans: Loan[] = [
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
    interest_rate_percent: null,
    monthly_payment: null,
    payoff: payoff({ status: "paid_off", as_of: "2026-10-01", balance: "0.00" }),
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
    // $500.00 at 12% (1% a month) paying $200.00: 5.00, 3.05 and 1.08 interest over 3 months.
    interest_rate_percent: "12.00",
    monthly_payment: "200.00",
    payoff: payoff({
      status: "scheduled",
      as_of: "2026-10-01",
      balance: "500.00",
      interest_rate_percent: "12.00",
      monthly_payment: "200.00",
      monthly_interest: "5.00",
      months: 3,
      payoff_date: "2027-01-01",
      total_interest: "9.13",
      total_paid: "509.13",
    }),
    draft_fixed_cost_lines: [],
  },
];
const scheduleB = {
  ...loans[1].payoff,
  rows: [
    {
      month: 1,
      date: "2026-11-01",
      payment: "200.00",
      interest: "5.00",
      principal: "195.00",
      balance: "305.00",
    },
    {
      month: 2,
      date: "2026-12-01",
      payment: "200.00",
      interest: "3.05",
      principal: "196.95",
      balance: "108.05",
    },
    {
      month: 3,
      date: "2027-01-01",
      payment: "109.13",
      interest: "1.08",
      principal: "108.05",
      balance: "0.00",
    },
  ],
};
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
const mock = (debts = loans) =>
  vi.spyOn(globalThis, "fetch").mockImplementation(async (path) => {
    const url = String(path);
    if (url.endsWith("/debts")) return json(debts);
    if (url.endsWith("/debts/loan-b/payoff-schedule")) return json(scheduleB);
    const scheduled = debts.find((loan) => url.endsWith(`/debts/${loan.uuid}/payoff-schedule`));
    if (scheduled) return json({ ...scheduled.payoff, rows: [] });
    if (url.endsWith("/debt-observations")) return json(debts.map((loan) => loan.latest));
    if (url.endsWith("/activity")) return json(entries);
    if (url.includes("/activity/page")) return json(activityPage(url, entries));
    return json([]);
  });
const show = async (view: "Cards" | "Table") =>
  fireEvent.click(
    within(await screen.findByRole("group", { name: "View" })).getByRole("button", { name: view }),
  );
// This jsdom has no localStorage; a fresh store keeps each test's view choice to itself.
beforeEach(() => {
  const stored = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => stored.get(k) ?? null,
      setItem: (k: string, v: string) => void stored.set(k, String(v)),
    },
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("shows each loan's payment history apart from dated observations", async () => {
  mock();
  render(<Balances {...props} />);
  await show("Table");
  const table = await screen.findByRole("grid", { name: "Debts" });
  const loanB = within(table).getByText("Example loan B").closest("tr") as HTMLElement;
  expect(within(loanB).getByText("Active")).toBeDefined();
  expect(within(loanB).getAllByText("$500.00")).toHaveLength(2);
  fireEvent.keyDown(within(table).getByText("Example loan A"), { key: "Enter" });
  const payments = await screen.findByRole("table", { name: "Payments for Example loan A" });
  expect(within(payments).getByText("$300.00")).toBeDefined();
  expect(within(payments).queryByText("$20.00")).toBeNull();
  expect(screen.getByRole("grid", { name: "Amount owed observations" })).toBeDefined();
});

it("archives only at zero owed and asks first", async () => {
  mock();
  render(<Balances {...props} />);
  await show("Table");
  const table = await screen.findByRole("grid", { name: "Debts" });
  fireEvent.click(within(table).getByRole("button", { name: "Details for Example loan B" }));
  expect(screen.getByRole("button", { name: "Archive debt" })).toBeDisabled();
  fireEvent.click(within(table).getByRole("button", { name: "Details for Example loan A" }));
  expect(screen.getByRole("button", { name: "Reopen debt" })).toBeEnabled();

  const zero = { ...loans[1], latest: { ...loans[1].latest, amount: "0.00", is_opening: false } };
  cleanup();
  mock([loans[0], zero]);
  const save = vi.fn();
  render(<Balances {...props} save={save} />);
  await show("Table");
  const again = await screen.findByRole("grid", { name: "Debts" });
  fireEvent.click(within(again).getByRole("button", { name: "Details for Example loan B" }));
  fireEvent.click(screen.getByRole("button", { name: "Archive debt" }));
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(
    within(screen.getByRole("dialog", { name: "Archive Example loan B?" })).getByRole("button", {
      name: "Archive debt",
    }),
  );
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({
      method: "PUT",
      path: "/api/entities/entity/debts/loan-b",
      body: { name: "Example loan B", active: false, expected_revision: 1 },
    }),
    expect.any(Function),
  );
});

it("names the debt account beside a fixed-cost payment in Activity", async () => {
  mock();
  render(<ActivityScreen {...props} />);
  expect(await screen.findByText("Debt: Example loan A")).toBeDefined();
  expect(screen.getByText("Debt: Example loan B")).toBeDefined();
  expect(screen.queryByText("Debt: Ordinary cost")).toBeNull();
});

it("closes an untouched new record panel with Close and with Escape", async () => {
  mock();
  render(<Balances {...props} />);
  await show("Table");
  await screen.findByRole("grid", { name: "Debts" });
  fireEvent.click(screen.getByRole("button", { name: "Add debt" }));
  const panel = await screen.findByRole("dialog", { name: "Add debt" });
  fireEvent.click(within(panel).getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByText("Enter a name.")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Record observation" }));
  const observation = await screen.findByRole("dialog", { name: "Record amount owed" });
  fireEvent.keyDown(within(observation).getByLabelText("Observation date"), { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByText("Choose a debt.")).toBeNull();
});

it("keeps an invalid edited panel open on Escape and shows the problem", async () => {
  mock();
  render(<Balances {...props} />);
  await show("Table");
  await screen.findByRole("grid", { name: "Debts" });
  fireEvent.click(screen.getByRole("button", { name: "Add debt" }));
  const panel = await screen.findByRole("dialog");
  fireEvent.change(within(panel).getByLabelText("Name"), { target: { value: "  " } });
  fireEvent.keyDown(within(panel).getByLabelText("Name"), { key: "Escape" });
  expect(await within(panel).findByText("Enter a name.")).toBeDefined();
});

it("retains a valid observation edit on Escape and writes only on Ctrl+S, trimmed", async () => {
  mock();
  const save = vi.fn();
  render(<Balances {...props} save={save} />);
  await show("Table");
  await screen.findByRole("grid", { name: "Debts" });
  fireEvent.click(screen.getByRole("button", { name: "Record observation" }));
  const panel = await screen.findByRole("dialog");
  fireEvent.change(within(panel).getByLabelText("Debt"), { target: { value: "loan-b" } });
  fireEvent.change(within(panel).getByLabelText("Observation date"), {
    target: { value: "2026-10-03" },
  });
  fireEvent.change(within(panel).getByLabelText(/Amount owed \(USD\)/), {
    target: { value: " 450.25 " },
  });
  fireEvent.keyDown(within(panel).getByLabelText(/Amount owed \(USD\)/), { key: "Escape" });
  expect(save).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByText(/Unsaved edit/)).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Review" }));
  const reopened = await screen.findByRole("dialog");
  expect((within(reopened).getByLabelText(/Amount owed \(USD\)/) as HTMLInputElement).value).toBe(
    " 450.25 ",
  );
  fireEvent.keyDown(reopened, { key: "s", ctrlKey: true });
  expect(save).toHaveBeenCalledOnce();
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({
      method: "POST",
      path: "/api/entities/entity/debt-observations",
      body: { date: "2026-10-03", amount: "450.25", account_id: "loan-b" },
    }),
    expect.any(Function),
  );
});

it("corrects an observation against its loaded revision and refuses an invalid amount", async () => {
  mock();
  const save = vi.fn();
  render(<Balances {...props} save={save} />);
  await show("Table");
  const grid = await screen.findByRole("grid", { name: "Amount owed observations" });
  fireEvent.keyDown(grid.querySelector('[data-cell="0-0"]') as HTMLElement, { key: "Enter" });
  const panel = await screen.findByRole("dialog");
  const amount = within(panel).getByLabelText(/Amount owed \(USD\)/);
  fireEvent.change(amount, { target: { value: "12.345" } });
  fireEvent.click(within(panel).getByRole("button", { name: "Save observation" }));
  expect(save).not.toHaveBeenCalled();
  fireEvent.change(amount, { target: { value: "12.30" } });
  fireEvent.click(within(panel).getByRole("button", { name: "Save observation" }));
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({
      method: "PUT",
      path: "/api/entities/entity/debt-observations/obs-a",
      body: { date: "2026-10-01", amount: "12.30", account_id: "loan-a", expected_revision: 1 },
    }),
    expect.any(Function),
  );
});

it("adds a loan with optional fixed-rate terms, refusing an out-of-range rate", async () => {
  mock();
  const save = vi.fn();
  render(<Balances {...props} save={save} />);
  await show("Table");
  await screen.findByRole("grid", { name: "Debts" });
  fireEvent.click(screen.getByRole("button", { name: "Add debt" }));
  const panel = await screen.findByRole("dialog", { name: "Add debt" });
  fireEvent.change(within(panel).getByLabelText("Name"), { target: { value: "Example loan C" } });
  fireEvent.change(within(panel).getByLabelText(/Opening amount owed/), {
    target: { value: "1200" },
  });
  const rate = within(panel).getByLabelText(/Fixed interest rate/);
  fireEvent.change(rate, { target: { value: "40.5" } });
  fireEvent.click(within(panel).getByRole("button", { name: "Save debt" }));
  expect(save).not.toHaveBeenCalled();
  expect(within(panel).getByRole("alert").textContent).toMatch(/from 0 to 40/);
  fireEvent.change(rate, { target: { value: " 6.5 " } });
  fireEvent.change(within(panel).getByLabelText(/Monthly payment/), {
    target: { value: "110" },
  });
  fireEvent.click(within(panel).getByRole("button", { name: "Save debt" }));
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({
      method: "POST",
      body: {
        name: "Example loan C",
        opening: { date: "2026-10-02", amount: "1200" },
        interest_rate_percent: "6.5",
        monthly_payment: "110",
      },
    }),
    expect.any(Function),
  );
});

it("shows the payoff on each card and flags a payment under the interest", async () => {
  const stuck = {
    ...loans[1],
    monthly_payment: "5.00",
    payoff: {
      ...loans[1].payoff,
      status: "interest_not_covered" as const,
      monthly_payment: "5.00",
    },
  };
  mock([loans[1], { ...stuck, uuid: "loan-c", name: "Example loan C" }]);
  render(<Balances {...props} />);
  expect(await screen.findByText("Paid off January 2027, $9.13 interest left")).toBeDefined();
  expect(
    screen.getByText(
      "The $5.00 payment does not cover $5.00 monthly interest, so this debt never pays down.",
    ),
  ).toBeDefined();
  await show("Table");
  const grid = await screen.findByRole("grid", { name: "Debts" });
  const row = within(grid).getByText("Example loan C").closest("tr") as HTMLElement;
  expect(within(row).getByText("Payment under interest")).toBeDefined();
});

it("shows the schedule in details and saves terms and a moved opening date", async () => {
  mock();
  const save = vi.fn();
  render(<Balances {...props} save={save} />);
  await show("Table");
  const grid = await screen.findByRole("grid", { name: "Debts" });
  fireEvent.click(within(grid).getByRole("button", { name: "Details for Example loan B" }));
  const rows = await screen.findByRole("table", {
    name: "Payoff schedule rows for Example loan B",
  });
  const all = within(rows).getAllByRole("row");
  const last = all[all.length - 1];
  expect(within(last).getByText("$109.13")).toBeDefined();
  expect(within(last).getByText("$0.00")).toBeDefined();
  expect(screen.getByText("Jan 1, 2027, in 3 payments")).toBeDefined();
  expect(
    screen.getByRole("img", { name: "Example loan B: $500.00 principal, $9.13 interest" }),
  ).toBeDefined();
  const owed = screen.getByRole("slider", { name: "Example loan B, amount owed by month" });
  fireEvent.keyDown(owed, { key: "Home" });
  expect(owed.getAttribute("aria-valuetext")).toBe("Now: Owed $500.00");
  // Bars group payments by calendar year: two in 2026, one in 2027.
  const years = screen.getByRole("slider", {
    name: "Example loan B, interest and principal by year",
  });
  expect(years.getAttribute("aria-valuetext")).toBe(
    "2027, 1 payment: Principal $108.05, Interest $1.08, Interest 1%",
  );
  fireEvent.keyDown(years, { key: "Home" });
  expect(years.getAttribute("aria-valuetext")).toBe(
    "2026, 2 payments: Principal $391.95, Interest $8.05, Interest 2%",
  );
  const terms = screen.getByRole("form", { name: "Terms for Example loan B" });
  fireEvent.change(within(terms).getByLabelText(/Monthly payment/), { target: { value: "" } });
  fireEvent.change(within(terms).getByLabelText("Opening date"), {
    target: { value: "2023-10-01" },
  });
  fireEvent.click(within(terms).getByRole("button", { name: "Save debt" }));
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({
      method: "PUT",
      path: "/api/entities/entity/debts/loan-b",
      body: {
        name: "Example loan B",
        active: true,
        expected_revision: 1,
        interest_rate_percent: "12.00",
        monthly_payment: null,
        opening_date: "2023-10-01",
      },
    }),
    expect.any(Function),
  );
});

it("shows cards or the table, never both, and remembers the choice on reload", async () => {
  mock();
  render(<Balances {...props} />);
  // Cards by default: the loan cards without the record tables.
  await screen.findByRole("button", { name: "Example loan B details" });
  expect(screen.queryByRole("grid")).toBeNull();
  await show("Table");
  expect(await screen.findByRole("grid", { name: "Debts" })).toBeDefined();
  expect(screen.queryByRole("button", { name: "Example loan B details" })).toBeNull();
  cleanup();
  render(<Balances {...props} />);
  expect(await screen.findByRole("grid", { name: "Debts" })).toBeDefined();
  expect(screen.queryByRole("button", { name: "Example loan B details" })).toBeNull();
  await show("Cards");
  await screen.findByRole("button", { name: "Example loan B details" });
  expect(screen.queryByRole("grid")).toBeNull();
});
