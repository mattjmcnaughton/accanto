import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Plans } from "./Plans";
import type { ScreenProps } from "./shared";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("keeps the full allocation input and flags inactive draft references", async () => {
  const draft = {
    uuid: "draft",
    name: "Synthetic Plan",
    number: 1,
    revision: 3,
    saved: false,
    saved_at: null,
    rule_version: "2",
    incomes: [{ source_id: "income", name: "Income", amount: "4000.00" }],
    fixed_costs: [],
    spending: "2700.00",
    income: "4000.00",
    fixed_cost_total: "0.00",
    tithe_target: "400.00",
    unassigned: "-300.00",
    savings_funding: [{ account_id: "account", account_name: "Savings", amount: "1000.00" }],
    saving_goals: [{ goal_id: "goal", goal_name: "Laptop", amount: "200.00" }],
    investments: [
      { destination_id: "investment", destination_name: "Retirement", amount: "2000.00" },
    ],
    giving: [{ destination_id: "recipient", destination_name: "Community Fund", amount: "400.00" }],
    savings_funding_total: "1000.00",
    funding_total: "5000.00",
    saving_total: "200.00",
    investing_total: "2000.00",
    giving_total: "400.00",
    giving_difference: "0.00",
    allocation_total: "5300.00",
  };
  vi.spyOn(globalThis, "fetch").mockImplementation(async (path) => {
    const url = String(path);
    const data = url.endsWith("/plans")
      ? [{ plan_id: "plan", revisions: [draft] }]
      : url.endsWith("/savings-accounts")
        ? [
            {
              uuid: "account",
              name: "Savings",
              active: true,
              goals: [{ uuid: "goal", name: "Laptop", active: false }],
            },
          ]
        : url.endsWith("/investments")
          ? [{ uuid: "investment", name: "Retirement", active: true }]
          : url.endsWith("/giving-recipients")
            ? [{ uuid: "recipient", name: "Community Fund", active: true }]
            : [];
    return new Response(JSON.stringify(data), { status: 200 });
  });
  const save = vi.fn();
  const props: ScreenProps = {
    entity: { id: "entity", name: "Synthetic Entity", today: "2026-10-18", time_zone: "UTC" },
    concealed: false,
    busy: false,
    refresh: 0,
    guard: () => true,
    dirty: vi.fn(),
    save,
  };
  render(<Plans {...props} />);
  fireEvent.click(await screen.findByRole("button", { name: "Synthetic Plan" }));
  expect(screen.getAllByText("−$300.00").length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("button", { name: "Details for Laptop" }));
  expect(
    await screen.findByText("Inactive or unavailable reference. Review this line."),
  ).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({
      body: expect.objectContaining({
        savings_funding: [{ account_id: "account", amount: "1000.00" }],
        saving_goals: [{ goal_id: "goal", amount: "200.00" }],
        investments: [{ destination_id: "investment", amount: "2000.00" }],
        giving: [{ destination_id: "recipient", amount: "400.00" }],
      }),
    }),
    expect.any(Function),
  );
});

it("reports a failed reference catalog instead of silently offering an empty list", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (path) =>
    String(path).endsWith("/savings-accounts")
      ? new Response(
          JSON.stringify({ detail: { code: "unavailable", message: "Catalog unavailable" } }),
          { status: 503 },
        )
      : new Response(
          JSON.stringify(
            String(path).endsWith("/plans")
              ? [
                  {
                    plan_id: "p",
                    revisions: [
                      {
                        uuid: "d",
                        name: "Catalog Plan",
                        number: 1,
                        revision: 1,
                        saved: false,
                        saved_at: null,
                        rule_version: "2",
                        incomes: [],
                        fixed_costs: [],
                        savings_funding: [
                          { account_id: "account", account_name: "Savings", amount: "100.00" },
                        ],
                        spending: "0.00",
                        income: "0.00",
                        fixed_cost_total: "0.00",
                        tithe_target: "0.00",
                        unassigned: "0.00",
                      },
                    ],
                  },
                ]
              : [],
          ),
          { status: 200 },
        ),
  );
  const props: ScreenProps = {
    entity: { id: "entity", name: "Synthetic Entity", today: "2026-10-18", time_zone: "UTC" },
    concealed: false,
    busy: false,
    refresh: 0,
    guard: () => true,
    dirty: vi.fn(),
    save: vi.fn(),
  };
  render(<Plans {...props} />);
  fireEvent.click(await screen.findByRole("button", { name: "Catalog Plan" }));
  expect(await screen.findByText("Savings accounts and goals")).toBeDefined();
  expect(screen.getByText(/Catalog unavailable/)).toBeDefined();
  expect(screen.getByRole("button", { name: "Try loading again" })).toBeDefined();
  // Unknown is not empty or inactive: the failed catalog must not flag lines or claim none exist.
  expect(screen.queryByText("Review reference")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Details for Savings" }));
  expect(screen.queryByText(/inactive or unavailable/)).toBeNull();
  fireEvent.keyDown(screen.getByRole("cell", { name: "Savings, Item" }), { key: "a" });
  expect(screen.getByText(/Destinations are not loaded/)).toBeDefined();
  expect(screen.queryByText(/No available destinations/)).toBeNull();
});

it("lists active spending subcategories under guilt-free spending without planned amounts", async () => {
  const draft = {
    uuid: "draft",
    name: "Subcategory Plan",
    number: 1,
    revision: 2,
    saved: false,
    saved_at: null,
    rule_version: "2",
    incomes: [{ source_id: "income", name: "Income", amount: "3000.00" }],
    fixed_costs: [],
    spending: "900.00",
    income: "3000.00",
    fixed_cost_total: "0.00",
    tithe_target: "300.00",
    unassigned: "2100.00",
  };
  const subcategory = (uuid: string, name: string, active: boolean) => ({
    uuid,
    name,
    active,
    revision: 1,
    entries: 0,
  });
  vi.spyOn(globalThis, "fetch").mockImplementation(async (path) => {
    const url = String(path);
    const data = url.endsWith("/plans")
      ? [{ plan_id: "plan", revisions: [draft] }]
      : url.endsWith("/spending-subcategories")
        ? [
            subcategory("books", "Books", true),
            subcategory("old", "Retired hobby", false),
            subcategory("eating", "Eating out", true),
          ]
        : [];
    return new Response(JSON.stringify(data), { status: 200 });
  });
  const save = vi.fn();
  render(
    <Plans
      entity={{ id: "entity", name: "Synthetic Entity", today: "2026-10-18", time_zone: "UTC" }}
      concealed={false}
      busy={false}
      refresh={0}
      guard={() => true}
      dirty={vi.fn()}
      save={save}
    />,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Subcategory Plan" }));
  const books = await screen.findByText("Books");
  const grid = screen.getByRole("grid", { name: "Monthly Plan worksheet" });
  const rows = Array.from(grid.querySelectorAll("tbody tr")).map((row) => row.id);
  const spendingRow = rows.indexOf("row-spending");
  // Subcategories follow guilt-free spending directly, active ones only, before saving.
  expect(rows.slice(spendingRow + 1, spendingRow + 3)).toEqual([
    "row-subcategory-books",
    "row-subcategory-eating",
  ]);
  expect(rows[spendingRow + 3]).toBe("row-group-saving");
  expect(screen.queryByText("Retired hobby")).toBeNull();
  expect(books.closest("tr")?.textContent).not.toMatch(/\$/);
  expect(document.getElementById("cell-spending-3")?.textContent).toBe("$900.00");

  fireEvent.click(screen.getByRole("button", { name: "Add Guilt-free spending subcategory" }));
  fireEvent.change(screen.getByRole("textbox", { name: "New subcategory name" }), {
    target: { value: "Hobbies" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add subcategory" }));
  expect(save).toHaveBeenLastCalledWith(
    {
      method: "POST",
      path: "/api/entities/entity/spending-subcategories",
      body: { name: "Hobbies" },
    },
    expect.any(Function),
  );
  fireEvent.click(screen.getByRole("button", { name: "Done" }));

  fireEvent.click(screen.getByRole("button", { name: "Rename or archive Eating out" }));
  const manager = screen.getByRole("list", { name: "Spending subcategories" });
  expect(manager.textContent).toContain("Retired hobby");
  expect(screen.getAllByRole("button", { name: "Rename" }).length).toBe(3);
});

it("creates an investment from a new investing line's Destination, then saves the draft with it", async () => {
  const draft = {
    uuid: "draft",
    name: "Synthetic Plan",
    number: 1,
    revision: 3,
    saved: false,
    saved_at: null,
    rule_version: "2",
    incomes: [{ source_id: "income", name: "Income", amount: "4000.00" }],
    fixed_costs: [],
    spending: "800.00",
    income: "4000.00",
    fixed_cost_total: "0.00",
    tithe_target: "400.00",
    unassigned: "3200.00",
  };
  vi.spyOn(globalThis, "fetch").mockImplementation(async (path) => {
    const data = String(path).endsWith("/plans") ? [{ plan_id: "plan", revisions: [draft] }] : [];
    return new Response(JSON.stringify(data), { status: 200 });
  });
  const save = vi.fn();
  const props: ScreenProps = {
    entity: { id: "entity", name: "Synthetic Entity", today: "2026-10-18", time_zone: "UTC" },
    concealed: false,
    busy: false,
    refresh: 0,
    guard: () => true,
    dirty: vi.fn(),
    save,
  };
  render(<Plans {...props} />);
  fireEvent.click(await screen.findByRole("button", { name: "Synthetic Plan" }));
  // No investments yet: the line still opens, asking for one to be chosen or created.
  fireEvent.click(await screen.findByRole("button", { name: "Add Investing line" }));
  const box = await screen.findByRole("combobox", { name: "Destination" });
  fireEvent.change(box, { target: { value: "Example index fund" } });
  fireEvent.click(screen.getByRole("option", { name: /Create “Example index fund”/ }));
  expect(save.mock.calls[0][0]).toEqual({
    method: "POST",
    path: "/api/entities/entity/investments",
    body: { name: "Example index fund", target: null },
  });
  act(() => save.mock.calls[0][1]({ uuid: "inv-new", name: "Example index fund" }));
  fireEvent.change(screen.getByLabelText("Monthly amount"), { target: { value: "250.00" } });
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  expect(save.mock.calls[1][0].body.investments).toEqual([
    { destination_id: "inv-new", amount: "250.00" },
  ]);
});
