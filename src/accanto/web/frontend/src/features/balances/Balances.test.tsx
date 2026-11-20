import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
const mock = (debts = loans) =>
  vi.spyOn(globalThis, "fetch").mockImplementation(async (path) => {
    const url = String(path);
    if (url.endsWith("/debts")) return json(debts);
    if (url.endsWith("/debt-observations")) return json(debts.map((loan) => loan.latest));
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
  const table = await screen.findByRole("grid", { name: "Loans" });
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
  const table = await screen.findByRole("grid", { name: "Loans" });
  fireEvent.click(within(table).getByRole("button", { name: "Details for Example loan B" }));
  expect(screen.getByRole("button", { name: "Archive loan" })).toBeDisabled();
  fireEvent.click(within(table).getByRole("button", { name: "Details for Example loan A" }));
  expect(screen.getByRole("button", { name: "Reopen loan" })).toBeEnabled();

  const zero = { ...loans[1], latest: { ...loans[1].latest, amount: "0.00", is_opening: false } };
  cleanup();
  mock([loans[0], zero]);
  const save = vi.fn();
  render(<Balances {...props} save={save} />);
  const again = await screen.findByRole("grid", { name: "Loans" });
  fireEvent.click(within(again).getByRole("button", { name: "Details for Example loan B" }));
  fireEvent.click(screen.getByRole("button", { name: "Archive loan" }));
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(
    within(screen.getByRole("dialog", { name: "Archive Example loan B?" })).getByRole("button", {
      name: "Archive loan",
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
  expect(await screen.findByText("Loan: Example loan A")).toBeDefined();
  expect(screen.getByText("Loan: Example loan B")).toBeDefined();
  expect(screen.queryByText("Loan: Ordinary cost")).toBeNull();
});

it("closes an untouched new record panel with Close and with Escape", async () => {
  mock();
  render(<Balances {...props} />);
  await screen.findByRole("grid", { name: "Loans" });
  fireEvent.click(screen.getByRole("button", { name: "Add loan" }));
  const panel = await screen.findByRole("dialog", { name: "Add loan" });
  fireEvent.click(within(panel).getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByText("Enter a name.")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Record observation" }));
  const observation = await screen.findByRole("dialog", { name: "Record amount owed" });
  fireEvent.keyDown(within(observation).getByLabelText("Observation date"), { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByText("Choose a loan.")).toBeNull();
});

it("keeps an invalid edited panel open on Escape and shows the problem", async () => {
  mock();
  render(<Balances {...props} />);
  await screen.findByRole("grid", { name: "Loans" });
  fireEvent.click(screen.getByRole("button", { name: "Add loan" }));
  const panel = await screen.findByRole("dialog");
  fireEvent.change(within(panel).getByLabelText("Name"), { target: { value: "  " } });
  fireEvent.keyDown(within(panel).getByLabelText("Name"), { key: "Escape" });
  expect(await within(panel).findByText("Enter a name.")).toBeDefined();
});

it("retains a valid observation edit on Escape and writes only on Ctrl+S, trimmed", async () => {
  mock();
  const save = vi.fn();
  render(<Balances {...props} save={save} />);
  await screen.findByRole("grid", { name: "Loans" });
  fireEvent.click(screen.getByRole("button", { name: "Record observation" }));
  const panel = await screen.findByRole("dialog");
  fireEvent.change(within(panel).getByLabelText("Loan"), { target: { value: "loan-b" } });
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
