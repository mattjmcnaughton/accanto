import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { PlanRevision } from "../../lib/monthly";
import { ActivityScreen } from "./Activity";
import type { ScreenProps } from "./shared";
const entity = { id: "entity", name: "Synthetic Entity", today: "2026-11-10", time_zone: "UTC" };
const version: PlanRevision = {
  uuid: "v1",
  name: "Baseline",
  number: 1,
  revision: 1,
  saved: true,
  saved_at: "2026-10-01",
  updated_at: null,
  rule_version: "1",
  incomes: [{ source_id: "source", name: "Salary", amount: "4000.00" }],
  fixed_costs: [],
  fixed_cost_total: "0.00",
  income: "4000.00",
  spending: "800.00",
  tithe_target: "400.00",
  unassigned: "3200.00",
};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const props = (): ScreenProps => ({
  entity,
  concealed: false,
  busy: false,
  refresh: 0,
  guard: () => true,
  dirty: vi.fn(),
  save: vi.fn(),
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("records a payment assigned to a saved cost removed from the current draft", async () => {
  const fixedVersion = {
    ...version,
    fixed_costs: [
      {
        fixed_cost_id: "fixed-a",
        name: "Synthetic subscription",
        canonical_name: "Synthetic subscription",
        amount: "100.00",
        frequency: "annual" as const,
        monthly_amount: "8.33",
      },
    ],
  };
  vi.spyOn(globalThis, "fetch").mockImplementation(async (path) =>
    String(path).endsWith("/plans")
      ? json([
          {
            plan_id: "fixed-plan",
            revisions: [
              fixedVersion,
              { ...fixedVersion, uuid: "draft", saved: false, fixed_costs: [] },
            ],
          },
        ])
      : json([]),
  );
  const save = vi.fn();
  render(<ActivityScreen {...props()} save={save} />);
  fireEvent.click(await screen.findByRole("button", { name: "Record activity" }));
  fireEvent.change(screen.getByLabelText("Category"), { target: { value: "fixed_cost" } });
  await screen.findByRole("option", { name: "Synthetic subscription" });
  fireEvent.change(screen.getByLabelText("Fixed cost"), { target: { value: "fixed-a" } });
  fireEvent.change(screen.getByLabelText("Amount (USD)"), { target: { value: "12.00" } });
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Record" }));
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({
      body: expect.objectContaining({
        category: "fixed_cost",
        fixed_cost_id: "fixed-a",
        amount: "12.00",
        funding_goal_id: null,
      }),
    }),
    expect.any(Function),
  );
});
it("shows named investment and giving destinations in shared Activity", async () => {
  const entries = [
    {
      uuid: "investment-entry",
      financial_date: "2026-11-03",
      category: "investing",
      amount: "100.00",
      source_id: null,
      saving_goal_id: null,
      funding_goal_id: null,
      investment_id: "investment-1",
      funding_origin: "income",
      note: "",
      revision: 1,
      is_adjustment: false,
    },
    {
      uuid: "giving-entry",
      financial_date: "2026-11-04",
      category: "giving",
      amount: "50.00",
      source_id: null,
      saving_goal_id: null,
      funding_goal_id: null,
      giving_recipient_id: "recipient-1",
      funding_origin: "income",
      note: "",
      revision: 1,
      is_adjustment: false,
    },
  ];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (path) => {
    const url = String(path);
    if (url.endsWith("/activity")) return json(entries);
    if (url.endsWith("/investments")) return json([{ uuid: "investment-1", name: "Example fund" }]);
    if (url.endsWith("/giving-recipients"))
      return json([{ uuid: "recipient-1", name: "Example recipient" }]);
    return json([]);
  });
  render(<ActivityScreen {...props()} />);
  expect(await screen.findByText("Example fund")).toBeDefined();
  expect(await screen.findByText("Example recipient")).toBeDefined();
  expect(screen.getAllByText("Read only")).toHaveLength(2);
  fireEvent.click(screen.getByRole("gridcell", { name: /Example recipient/ }));
  expect(screen.getByText("Change its tags here. Correct anything else in Giving.")).toBeDefined();
  expect(screen.queryByRole("button", { name: /Save/ })).toBeNull();
});
it("shows both the destination and savings origin for funded outflows", async () => {
  const entries = [
    {
      uuid: "fixed-entry",
      financial_date: "2026-11-03",
      category: "fixed_cost",
      amount: "100.00",
      fixed_cost_name: "Synthetic service",
      debt_account_id: "loan-1",
      funding_goal_id: "goal-1",
      funding_origin: "savings",
      note: "",
      revision: 1,
      is_adjustment: false,
    },
    {
      uuid: "giving-entry",
      financial_date: "2026-11-04",
      category: "giving",
      amount: "50.00",
      giving_recipient_id: "recipient-1",
      funding_goal_id: "goal-1",
      funding_origin: "savings",
      note: "",
      revision: 1,
      is_adjustment: false,
    },
    {
      uuid: "spending-entry",
      financial_date: "2026-11-05",
      category: "spending",
      amount: "25.00",
      funding_origin: "income",
      note: "",
      revision: 1,
      is_adjustment: false,
    },
    {
      uuid: "books-entry",
      financial_date: "2026-11-06",
      category: "spending",
      amount: "18.40",
      funding_origin: "income",
      note: "Synthetic paperback",
      spending_subcategory_id: "sub-books",
      spending_subcategory_name: "Books",
      revision: 1,
      is_adjustment: false,
    },
  ];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (path) => {
    const url = String(path);
    if (url.endsWith("/activity")) return json(entries);
    if (url.endsWith("/savings-accounts"))
      return json([
        { uuid: "account-1", name: "Synthetic cash", goals: [{ uuid: "goal-1", name: "Reserve" }] },
      ]);
    if (url.endsWith("/giving-recipients"))
      return json([{ uuid: "recipient-1", name: "Example recipient" }]);
    if (url.endsWith("/debts")) return json([{ uuid: "loan-1", name: "Synthetic loan" }]);
    return json([]);
  });
  render(<ActivityScreen {...props()} />);
  const row = (text: string) => screen.getByText(text).closest('[role="row"]');
  await waitFor(() => {
    expect(row("Synthetic service")?.textContent).toContain("Loan: Synthetic loan");
    expect(row("Synthetic service")?.textContent).toContain("from Synthetic cash · Reserve");
  });
  await screen.findByText("Example recipient");
  expect(row("Example recipient")?.textContent).toContain("from Synthetic cash · Reserve");
  // Income-funded spending names no saving goal and is not an unassigned line.
  const spending = row("$25.00");
  expect(spending?.textContent).toContain("Guilt-free spending");
  expect(spending?.textContent).not.toContain("from");
  expect(spending?.textContent).not.toContain("Unassigned");
  // An assigned entry names its Spending subcategory.
  expect(row("Synthetic paperback")?.textContent).toContain("Guilt-free spending, Books");
});
it("keeps the viewed contributing-entry fingerprint through a background refresh", async () => {
  let refreshed = false;
  const first = {
    uuid: "first",
    financial_date: "2026-11-03",
    category: "spending",
    amount: "210.00",
    source_id: null,
    note: "",
    revision: 1,
    is_adjustment: false,
  };
  vi.spyOn(globalThis, "fetch").mockImplementation(async (path) =>
    String(path).endsWith("/activity")
      ? json(refreshed ? [first, { ...first, uuid: "new" }] : [first])
      : json([]),
  );
  const p = props();
  const view = render(<ActivityScreen {...p} />);
  fireEvent.click(await screen.findByRole("button", { name: "Enter known total" }));
  expect(screen.getByText(/1 contributing entry was captured for this total\./)).toBeDefined();
  refreshed = true;
  view.rerender(<ActivityScreen {...p} refresh={1} />);
  await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(2));
  fireEvent.change(screen.getByLabelText("Known total (USD)"), { target: { value: "250" } });
  fireEvent.click(screen.getByRole("button", { name: "Save adjustment" }));
  expect(p.save).toHaveBeenCalledWith(
    expect.objectContaining({
      body: expect.objectContaining({ contributing_entries: [{ uuid: "first", revision: 1 }] }),
    }),
    expect.any(Function),
  );
});
it("keeps valid cell edits local on Escape, holds invalid input, and saves one record on Ctrl+S", async () => {
  const entry = {
    uuid: "lunch",
    financial_date: "2026-11-03",
    category: "spending",
    amount: "12.00",
    source_id: null,
    fixed_cost_id: null,
    fixed_cost_name: null,
    debt_account_id: null,
    saving_goal_id: null,
    funding_origin: "income",
    note: "Synthetic lunch",
    revision: 4,
    is_adjustment: false,
  };
  vi.spyOn(globalThis, "fetch").mockImplementation(async (path) =>
    String(path).endsWith("/activity") ? json([entry]) : json([]),
  );
  const p = props();
  render(<ActivityScreen {...p} />);
  await screen.findByText("Synthetic lunch");
  const amount = screen.getByText("$12.00");
  fireEvent.keyDown(amount, { key: "i" });
  const input = screen.getByLabelText("Amount for Synthetic lunch on Nov 3, 2026");
  fireEvent.change(input, { target: { value: "12.345" } });
  fireEvent.keyDown(input, { key: "Escape" });
  // Invalid input stays in insert mode with an error; nothing is sent.
  expect(screen.getByRole("alert").textContent).toContain("two decimal places");
  expect((input as HTMLInputElement).value).toBe("12.345");
  fireEvent.change(input, { target: { value: "13.50" } });
  fireEvent.keyDown(input, { key: "Escape" });
  expect(screen.queryByLabelText("Amount for Synthetic lunch on Nov 3, 2026")).toBeNull();
  expect(screen.getByText("$13.50")).toBeDefined();
  expect(screen.getByText("Unsaved")).toBeDefined();
  expect(p.save).not.toHaveBeenCalled();
  expect(p.dirty).toHaveBeenLastCalledWith(true);
  fireEvent.keyDown(screen.getByText("$13.50"), { key: "s", ctrlKey: true });
  await waitFor(() => expect(p.save).toHaveBeenCalledTimes(1));
  expect(p.save).toHaveBeenCalledWith(
    expect.objectContaining({
      method: "PUT",
      body: expect.objectContaining({
        amount: "13.50",
        expected_revision: 4,
        note: "Synthetic lunch",
        date: "2026-11-03",
      }),
    }),
    expect.any(Function),
  );
});
it("keeps the attempted record while a write is pending instead of opening or discarding another", async () => {
  const entry = {
    uuid: "lunch",
    financial_date: "2026-11-03",
    category: "spending",
    amount: "12.00",
    source_id: null,
    fixed_cost_id: null,
    fixed_cost_name: null,
    debt_account_id: null,
    saving_goal_id: null,
    funding_origin: "income",
    note: "Synthetic lunch",
    revision: 4,
    is_adjustment: false,
  };
  vi.spyOn(globalThis, "fetch").mockImplementation(async (path) =>
    String(path).endsWith("/activity")
      ? json([entry, { ...entry, uuid: "snack", note: "Synthetic snack", amount: "3.00" }])
      : json([]),
  );
  const p = props();
  const view = render(<ActivityScreen {...p} />);
  const amount = await screen.findByText("$12.00");
  fireEvent.keyDown(amount, { key: "i" });
  const input = screen.getByLabelText("Amount for Synthetic lunch on Nov 3, 2026");
  fireEvent.change(input, { target: { value: "13.50" } });
  fireEvent.keyDown(input, { key: "Enter" });
  // A failed save leaves the write pending; the shell reports that as busy.
  view.rerender(<ActivityScreen {...p} busy />);
  const other = screen.getByText("$3.00");
  fireEvent.keyDown(other, { key: "i" });
  fireEvent.keyDown(other, { key: "a" });
  fireEvent.keyDown(other, { key: "Escape" });
  expect(screen.queryByLabelText(/Amount for Synthetic/)).toBeNull();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByText("$13.50")).toBeDefined();
  // The attempted record stays on its row and opens read-only for review while the write is pending.
  fireEvent.keyDown(screen.getByText("$13.50"), { key: "Enter" });
  const dialog = within(screen.getByRole("dialog", { name: "Edit activity" }));
  expect((dialog.getByLabelText("Amount (USD)") as HTMLInputElement).value).toBe("13.50");
  expect(dialog.getByRole("button", { name: "Discard changes" }).matches(":disabled")).toBe(true);
});
it("records guilt-free spending from one line and keeps the text until the save is confirmed", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => json([]));
  const p = props();
  render(<ActivityScreen {...p} />);
  const line = await screen.findByLabelText(/Record guilt-free spending/);
  fireEvent.change(line, { target: { value: "groceries 42" } });
  fireEvent.submit(line);
  expect(screen.getByRole("alert").textContent).toContain("Start with an amount");
  expect(p.save).not.toHaveBeenCalled();
  fireEvent.change(line, { target: { value: "$1,042.5 weekly groceries" } });
  fireEvent.submit(line);
  expect(p.save).toHaveBeenCalledWith(
    expect.objectContaining({
      method: "POST",
      body: expect.objectContaining({
        date: "2026-11-10",
        category: "spending",
        amount: "1042.50",
        note: "Weekly groceries",
        funding_goal_id: null,
      }),
    }),
    expect.any(Function),
  );
  expect((line as HTMLInputElement).value).toBe("$1,042.5 weekly groceries");
});
it("shows tags, filters by one, and saves a contribution's tags label-only", async () => {
  const tagRows = [
    { uuid: "tag-trip", name: "Italy trip", active: true, revision: 1, entries: 1 },
    { uuid: "tag-kids", name: "Kids", active: true, revision: 1, entries: 1 },
  ];
  const base = {
    source_id: null,
    fixed_cost_id: null,
    fixed_cost_name: null,
    debt_account_id: null,
    saving_goal_id: null,
    funding_origin: "income",
    revision: 3,
    is_adjustment: false,
  };
  const entries = [
    {
      ...base,
      uuid: "dinner",
      financial_date: "2026-11-02",
      category: "spending",
      amount: "90.00",
      note: "Synthetic dinner",
      tag_ids: ["tag-trip"],
    },
    {
      ...base,
      uuid: "gift",
      financial_date: "2026-11-04",
      category: "giving",
      amount: "50.00",
      note: "",
      giving_recipient_id: null,
      tag_ids: ["tag-kids"],
    },
  ];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (path) => {
    const url = String(path);
    if (url.endsWith("/activity")) return json(entries);
    if (url.endsWith("/tags")) return json(tagRows);
    return json([]);
  });
  const p = props();
  render(<ActivityScreen {...p} />);
  const dinner = await screen.findByRole("gridcell", { name: /Synthetic dinner/ });
  expect(within(dinner).getByText("Italy trip")).toBeDefined();
  fireEvent.change(screen.getByRole("combobox", { name: "Show tag" }), {
    target: { value: "tag-kids" },
  });
  expect(screen.queryByText("Synthetic dinner")).toBeNull();
  fireEvent.click(screen.getByRole("gridcell", { name: /Unassigned/ }));
  fireEvent.change(screen.getByRole("combobox", { name: "Add a tag (Tags)" }), {
    target: { value: "tag-trip" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Remove tag Kids" }));
  fireEvent.click(screen.getByRole("button", { name: "Save tags" }));
  expect(p.save).toHaveBeenCalledWith(
    {
      method: "POST",
      path: "/api/entities/entity/activity/tags",
      body: { entries: [{ entry_id: "gift", expected_revision: 3, tag_ids: ["tag-trip"] }] },
    },
    expect.any(Function),
  );
});

it("searches every month by payee, line, subcategory, tag and exact amount, with the filters", async () => {
  const base = {
    source_id: null,
    fixed_cost_id: null,
    fixed_cost_name: null,
    debt_account_id: null,
    saving_goal_id: null,
    funding_goal_id: null,
    funding_origin: "income",
    revision: 1,
    is_adjustment: false,
    tag_ids: [] as string[],
  };
  const entries = [
    {
      ...base,
      uuid: "bakery-oct",
      financial_date: "2026-10-03",
      category: "spending",
      amount: "12.00",
      note: "Example Bakery · Oat loaf",
      spending_subcategory_id: "sub-eat",
      spending_subcategory_name: "Eating out",
      tag_ids: ["tag-trip"],
    },
    {
      ...base,
      uuid: "refund-oct",
      financial_date: "2026-10-05",
      category: "spending",
      amount: "-12.00",
      note: "Café Ünder return",
      refund_of: "bakery-oct",
    },
    {
      ...base,
      uuid: "rent-sep",
      financial_date: "2026-09-01",
      category: "fixed_cost",
      amount: "1234.50",
      fixed_cost_id: "fc-rent",
      fixed_cost_name: "Synthetic rent",
      note: "Sample Property Co",
    },
    {
      ...base,
      uuid: "bakery-sep",
      financial_date: "2026-09-14",
      category: "spending",
      amount: "8.25",
      note: "Example Bakery",
    },
  ];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (path) => {
    const url = String(path);
    if (url.endsWith("/activity")) return json(entries);
    if (url.endsWith("/tags"))
      return json([
        { uuid: "tag-trip", name: "Italy trip", active: true, revision: 1, entries: 1 },
      ]);
    return json([]);
  });
  // November has no entries yet; search still reaches the earlier months.
  render(<ActivityScreen {...props()} month="2026-11" />);
  expect(await screen.findByText("Nothing is recorded in November yet")).toBeDefined();
  const input = screen.getByRole("searchbox", { name: "Search activity" }) as HTMLInputElement;
  fireEvent.keyDown(document.body, { key: "/" });
  expect(document.activeElement).toBe(input);
  const titles = () =>
    screen.queryAllByRole("gridcell").flatMap((cell) => {
      const title = cell.querySelector(".ar-title");
      return title ? [title.firstChild?.textContent] : [];
    });
  const search = (value: string) => fireEvent.change(input, { target: { value } });

  search("bakery"); // the payee kept in the note, across months, newest first
  expect(titles()).toEqual([
    "Refund: Example Bakery · Oat loaf",
    "Example Bakery · Oat loaf",
    "Example Bakery",
  ]);
  expect(screen.getByText("3 entries in all months")).toBeDefined();
  search("eating"); // subcategory
  expect(titles()).toEqual(["Example Bakery · Oat loaf"]);
  search("italy"); // tag
  expect(titles()).toEqual(["Example Bakery · Oat loaf"]);
  search("$1,234.5"); // exact amount as typed
  expect(titles()).toEqual(["Synthetic rent"]);
  search("rent property"); // the fixed cost's line and its note; every word, any order
  expect(titles()).toEqual(["Synthetic rent"]);
  search("12"); // unsigned: the purchase and its refund
  expect(titles()).toEqual(["Refund: Example Bakery · Oat loaf", "Example Bakery · Oat loaf"]);
  search("-12"); // signed: only the refund
  expect(titles()).toEqual(["Refund: Example Bakery · Oat loaf"]);
  search("cafe under"); // its own note, without accents
  expect(titles()).toEqual(["Refund: Example Bakery · Oat loaf"]);
  search("8.25"); // an amount matches exactly, not a prefix
  expect(titles()).toEqual(["Example Bakery"]);
  search("8.2");
  expect(titles()).toEqual([]);

  // The category filter and the month narrow the search.
  search("bakery");
  fireEvent.click(screen.getByRole("button", { name: "Fixed costs" }));
  expect(screen.getByText(/Nothing matches “bakery” with this filter/)).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "All" }));
  const months = screen.getByRole("combobox", { name: "Months shown" }) as HTMLSelectElement;
  expect(months.value).toBe("");
  fireEvent.change(months, { target: { value: "2026-11" } });
  expect(screen.getByText(/Nothing in November matches “bakery”/)).toBeDefined();

  // Esc clears the search and returns to the shown month.
  fireEvent.keyDown(input, { key: "Escape" });
  expect(input.value).toBe("");
  expect(months.value).toBe("2026-11");
  expect(screen.getByText("Nothing is recorded in November yet")).toBeDefined();
});
