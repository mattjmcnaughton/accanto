import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Destinations } from "./Destinations";
import type { ScreenProps } from "../workspace/shared";

const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });
const destination = {
  uuid: "investment-1",
  name: "Example fund",
  target: "2000.00",
  active: true,
  revision: 1,
  contribution_progress: "1000.00",
  opening: { date: "2026-01-01", amount: "25000.00" },
};
const entry = {
  uuid: "entry-1",
  financial_date: "2026-02-01",
  category: "investing",
  amount: "1000.00",
  note: "",
  is_adjustment: false,
  revision: 1,
  destination_id: destination.uuid,
};
const props = (): ScreenProps => ({
  entity: { id: "entity", name: "Synthetic Entity", today: "2026-11-10", time_zone: "UTC" },
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

it("shows contribution progress apart from opening value and preserves correction identity", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (path) =>
    String(path).endsWith("/investment-activity")
      ? json([entry])
      : String(path).endsWith("/savings-accounts")
        ? json([])
        : json([destination]),
  );
  const p = props();
  render(<Destinations {...p} />);
  expect(await screen.findByText("Active · Contributions $1000.00")).toBeDefined();
  expect(screen.getByText(/Opening observed value \$25000.00/)).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Correct entry on 2026-02-01" }));
  fireEvent.change(screen.getByLabelText("Amount (USD)"), { target: { value: "900.00" } });
  fireEvent.click(screen.getByRole("button", { name: "Save contribution" }));
  expect(p.save).toHaveBeenCalledWith(
    expect.objectContaining({
      method: "PUT",
      path: "/api/entities/entity/investment-activity/entry-1",
      body: expect.objectContaining({ amount: "900.00", expected_revision: 1 }),
    }),
    expect.any(Function),
  );
});

it("permits a destination without a target or opening", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(json([]));
  const p = props();
  render(<Destinations {...p} />);
  fireEvent.click(await screen.findByRole("button", { name: "Add investment" }));
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Example fund" } });
  expect(
    (screen.getByLabelText("Cumulative contribution target (USD, optional)") as HTMLInputElement)
      .required,
  ).toBe(false);
  expect(
    (screen.getByLabelText("Opening observed value (USD, optional)") as HTMLInputElement).required,
  ).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Save destination" }));
  expect(p.save).toHaveBeenCalledWith(
    expect.objectContaining({ body: { name: "Example fund", target: null, opening: null } }),
    expect.any(Function),
  );
});

it("records an investment contribution from one saving goal", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (path) =>
    String(path).endsWith("/investment-activity")
      ? json([])
      : String(path).endsWith("/savings-accounts")
        ? json([
            {
              uuid: "account-1",
              name: "Synthetic savings",
              active: true,
              opening_date: "2026-01-01",
              goals: [{ uuid: "goal-1", name: "Reserve" }],
            },
          ])
        : json([destination]),
  );
  const p = props();
  render(<Destinations {...p} />);
  fireEvent.click(await screen.findByRole("button", { name: "Record contribution" }));
  fireEvent.change(screen.getByLabelText("Amount (USD)"), { target: { value: "100.00" } });
  fireEvent.change(screen.getByLabelText("Funding origin"), { target: { value: "savings" } });
  await screen.findByRole("option", { name: "Synthetic savings · Reserve" });
  fireEvent.change(screen.getByLabelText("Saving goal"), { target: { value: "goal-1" } });
  fireEvent.click(screen.getByRole("button", { name: "Save contribution" }));
  expect(p.save).toHaveBeenCalledWith(
    expect.objectContaining({
      body: expect.objectContaining({
        funding_origin: "savings",
        saving_goal_id: "goal-1",
        amount: "100.00",
      }),
    }),
    expect.any(Function),
  );
});
