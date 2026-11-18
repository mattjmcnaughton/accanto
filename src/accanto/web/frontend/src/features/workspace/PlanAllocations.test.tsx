import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
  expect(screen.getAllByText("-$300.00").length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("button", { name: "Details for Laptop" }));
  expect(
    screen.getByText(
      "This reference is inactive or unavailable. Review this draft allocation explicitly.",
    ),
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
