import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { PlanRevision } from "../../lib/monthly";
import { activityPage } from "../../stories/mocks/activity";
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
/** Serves Activity pages from `entries` and every other read from `other`. */
const serve = (
  entries: () => Parameters<typeof activityPage>[1],
  other: (url: string) => Response = () => json([]),
) =>
  vi.spyOn(globalThis, "fetch").mockImplementation(async (path) => {
    const url = String(path);
    return url.includes("/activity/page") ? json(activityPage(url, entries())) : other(url);
  });
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
  serve(
    () => [],
    (url) =>
      url.endsWith("/plans")
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
  fireEvent.change(screen.getByRole("combobox", { name: "Fixed cost" }), {
    target: { value: "subscription" },
  });
  fireEvent.click(await screen.findByRole("option", { name: "Synthetic subscription" }));
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
  serve(
    () => entries,
    (url) => {
      if (url.endsWith("/investments"))
        return json([{ uuid: "investment-1", name: "Example fund" }]);
      if (url.endsWith("/giving-recipients"))
        return json([{ uuid: "recipient-1", name: "Example recipient" }]);
      return json([]);
    },
  );
  render(<ActivityScreen {...props()} />);
  expect(await screen.findByText("Example fund")).toBeDefined();
  expect(await screen.findByText("Example recipient")).toBeDefined();
  expect(screen.getAllByText("Read only")).toHaveLength(2);
  fireEvent.click(screen.getByRole("gridcell", { name: /Example recipient/ }));
  expect(screen.getByText("Edit the rest in Giving.")).toBeDefined();
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
  serve(
    () => entries,
    (url) => {
      if (url.endsWith("/savings-accounts"))
        return json([
          {
            uuid: "account-1",
            name: "Synthetic cash",
            goals: [{ uuid: "goal-1", name: "Reserve" }],
          },
        ]);
      if (url.endsWith("/giving-recipients"))
        return json([{ uuid: "recipient-1", name: "Example recipient" }]);
      if (url.endsWith("/debts")) return json([{ uuid: "loan-1", name: "Synthetic loan" }]);
      return json([]);
    },
  );
  render(<ActivityScreen {...props()} />);
  const row = (text: string) => screen.getByText(text).closest('[role="row"]');
  await waitFor(() => {
    expect(row("Synthetic service")?.textContent).toContain("Debt: Synthetic loan");
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
  serve(() => (refreshed ? [first, { ...first, uuid: "new" }] : [first]));
  const p = props();
  const view = render(<ActivityScreen {...p} />);
  fireEvent.click(await screen.findByRole("button", { name: "Enter known total" }));
  expect(await screen.findByText(/1 contributing entry captured\./)).toBeDefined();
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
  serve(() => [entry]);
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
  serve(() => [entry, { ...entry, uuid: "snack", note: "Synthetic snack", amount: "3.00" }]);
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
  serve(() => []);
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
  serve(
    () => entries,
    (url) => {
      if (url.endsWith("/tags")) return json(tagRows);
      return json([]);
    },
  );
  const p = props();
  render(<ActivityScreen {...p} />);
  const dinner = await screen.findByRole("gridcell", { name: /Synthetic dinner/ });
  expect(within(dinner).getByText("Italy trip")).toBeDefined();
  fireEvent.change(screen.getByRole("combobox", { name: "Show tag" }), {
    target: { value: "tag-kids" },
  });
  await waitFor(() => expect(screen.queryByText("Synthetic dinner")).toBeNull());
  fireEvent.click(screen.getByRole("gridcell", { name: /Unassigned/ }));
  fireEvent.change(screen.getByRole("combobox", { name: "Add a tag (Tags)" }), {
    target: { value: "italy" },
  });
  fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: "Italy trip" }));
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

it("searches every month on the server, with the filters, and names a refund's purchase", async () => {
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
      uuid: "bakery-sep",
      financial_date: "2026-09-14",
      category: "spending",
      amount: "8.25",
      note: "Example Bakery",
    },
    {
      ...base,
      uuid: "refund-oct",
      financial_date: "2026-10-05",
      category: "spending",
      amount: "-8.25",
      note: "Bakery return",
      refund_of: "bakery-sep",
    },
    {
      ...base,
      uuid: "rent-oct",
      financial_date: "2026-10-01",
      category: "fixed_cost",
      amount: "1234.50",
      fixed_cost_name: "Synthetic rent",
      note: "Sample Property Co",
    },
  ];
  const fetch = serve(() => entries);
  const searches = (): Record<string, string>[] =>
    fetch.mock.calls.flatMap(([path]) => {
      const query = new URL(String(path), "http://test").searchParams;
      return query.has("q") ? [Object.fromEntries(query)] : [];
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

  // Typing waits for a pause, then one read searches all months, newest first. The refund's
  // purchase is in another month and arrives with the page to name it.
  search("b");
  search("bakery");
  await waitFor(() => expect(titles()).toEqual(["Refund: Example Bakery", "Example Bakery"]));
  expect(searches()).toEqual([{ q: "bakery", limit: "100" }]);
  expect(screen.getByText("2 entries in all months")).toBeDefined();

  // The category filter and the month narrow the search.
  fireEvent.click(screen.getByRole("button", { name: "Fixed costs" }));
  expect(await screen.findByText(/Nothing matches “bakery” with this filter/)).toBeDefined();
  expect(searches().slice(-1)[0]).toEqual({ q: "bakery", category: "fixed_cost", limit: "100" });
  fireEvent.click(screen.getByRole("button", { name: "All" }));
  const months = screen.getByRole("combobox", { name: "Months shown" }) as HTMLSelectElement;
  expect(months.value).toBe("");
  fireEvent.change(months, { target: { value: "2026-11" } });
  expect(await screen.findByText(/Nothing in November matches “bakery”/)).toBeDefined();
  expect(searches().slice(-1)[0]).toEqual({ month: "2026-11-01", q: "bakery", limit: "100" });

  // Esc clears the search at once and returns to the shown month.
  fireEvent.keyDown(input, { key: "Escape" });
  expect(input.value).toBe("");
  expect(months.value).toBe("2026-11");
  expect(await screen.findByText("Nothing is recorded in November yet")).toBeDefined();
});
it("loads the next page at the list's end, from the button or the keys, and keeps it on refresh", async () => {
  const entries = Array.from({ length: 250 }, (_, n) => ({
    uuid: `entry-${n}`,
    financial_date: `2026-11-${String(28 - Math.floor(n / 10)).padStart(2, "0")}`,
    category: "spending",
    amount: `${n + 1}.00`,
    source_id: null,
    fixed_cost_id: null,
    fixed_cost_name: null,
    debt_account_id: null,
    saving_goal_id: null,
    funding_goal_id: null,
    funding_origin: "income",
    note: `Synthetic purchase ${n}`,
    revision: 1,
    is_adjustment: false,
  }));
  const fetch = serve(() => entries);
  const limits = () =>
    fetch.mock.calls.flatMap(([path]) => {
      const query = new URL(String(path), "http://test").searchParams;
      return String(path).includes("/activity/page")
        ? [[query.get("limit"), query.get("cursor")]]
        : [];
    });
  const p = props();
  const view = render(<ActivityScreen {...p} />);
  expect(await screen.findByText("100 of 250 entries")).toBeDefined();
  expect(screen.getByText("November 2026, 250 entries")).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Show more" }));
  expect(await screen.findByText("200 of 250 entries")).toBeDefined();
  expect(limits()).toEqual([
    ["100", null],
    ["100", "entry-99"],
  ]);
  // G moves to the last loaded entry, which reads the rest; then G reaches the very last.
  const firstAmount = screen.getByText("$1.00");
  fireEvent.keyDown(firstAmount, { key: "G" });
  expect(await screen.findByText("250 entries")).toBeDefined();
  expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
  fireEvent.keyDown(document.activeElement as Element, { key: "G" });
  await waitFor(() => expect(document.activeElement?.id).toBe("activity-entry-249-1"));
  // A refresh after a save reloads every entry that was showing in one read.
  view.rerender(<ActivityScreen {...p} refresh={1} />);
  await waitFor(() => expect(limits().slice(-1)[0]).toEqual(["250", null]));
  expect(await screen.findByText("250 entries")).toBeDefined();
  expect(screen.getAllByRole("row")).toHaveLength(250);
});
it("creates a subcategory from the entry editor, then records the entry with it", async () => {
  serve(
    () => [],
    (url) =>
      url.endsWith("/spending-subcategories")
        ? json([{ uuid: "sub-eat", name: "Eating out", active: true, revision: 1, entries: 2 }])
        : json([]),
  );
  const save = vi.fn();
  render(<ActivityScreen {...props()} save={save} />);
  fireEvent.click(await screen.findByRole("button", { name: "Record activity" }));
  const box = screen.getByRole("combobox", { name: "Subcategory" });
  await waitFor(() => {
    fireEvent.change(box, { target: { value: "eat" } });
    screen.getByRole("option", { name: "Eating out" });
  });
  fireEvent.change(box, { target: { value: "Pet supplies" } });
  fireEvent.click(screen.getByRole("option", { name: /Create “Pet supplies”/ }));
  // The new subcategory goes through its own create command; the entry is not saved yet.
  expect(save).toHaveBeenCalledTimes(1);
  expect(save.mock.calls[0][0]).toEqual({
    method: "POST",
    path: "/api/entities/entity/spending-subcategories",
    body: { name: "Pet supplies" },
  });
  act(() => save.mock.calls[0][1]({ uuid: "sub-pets", name: "Pet supplies" }));
  fireEvent.change(screen.getByLabelText("Amount (USD)"), { target: { value: "9.50" } });
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Record" }));
  expect(save).toHaveBeenCalledTimes(2);
  expect(save.mock.calls[1][0].body).toMatchObject({
    category: "spending",
    amount: "9.50",
    spending_subcategory_id: "sub-pets",
  });
});
