import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ScreenProps } from "../workspace/shared";
import { Savings } from "./Savings";

const account = {
  uuid: "account-1",
  name: "Synthetic savings",
  opening_date: "2026-09-01",
  opening_amount: "100.00",
  balance: "100.00",
  revision: 1,
  active: true,
  goals: [
    {
      uuid: "goal-1",
      name: "First",
      role: "ordinary",
      kind: "ongoing",
      target: null,
      opening_amount: "100.00",
      remaining_saved: "50.00",
      contribution_progress: "0.00",
      funded_status: null,
      revision: 1,
      active: true,
    },
    {
      uuid: "goal-2",
      name: "Unallocated",
      role: "unallocated",
      kind: "ongoing",
      target: null,
      opening_amount: "0.00",
      remaining_saved: "50.00",
      contribution_progress: "0.00",
      funded_status: null,
      revision: 1,
      active: true,
    },
  ],
};
const movement = {
  uuid: "move-1",
  kind: "reassignment",
  date: "2026-10-10",
  from_goal_id: "goal-1",
  to_goal_id: "goal-2",
  goal_id: null,
  amount: "50.00",
  note: "Synthetic correction",
  revision: 3,
};
const props = (): ScreenProps => ({
  entity: {
    id: "entity",
    name: "Synthetic Entity",
    today: "2026-10-17",
    time_zone: "UTC",
  },
  concealed: false,
  busy: false,
  refresh: 0,
  guard: () => true,
  dirty: vi.fn(),
  save: vi.fn(),
});
const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("keeps movement identity on correction and rejects a transfer within one account", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (path) =>
    String(path).endsWith("/movements") ? json([movement]) : json([account]),
  );
  const p = props();
  render(<Savings {...p} />);
  fireEvent.click(await screen.findByRole("button", { name: "Correct" }));
  fireEvent.change(screen.getByLabelText("Amount to move"), {
    target: { value: "40.00" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(p.save).toHaveBeenCalledWith(
    expect.objectContaining({
      method: "PUT",
      path: "/api/entities/entity/savings-accounts/movements/move-1",
      body: expect.objectContaining({
        kind: "reassignment",
        from_goal_id: "goal-1",
        to_goal_id: "goal-2",
        amount: "40.00",
        expected_revision: 3,
      }),
    }),
    expect.any(Function),
  );
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  vi.mocked(p.save).mockClear();
  fireEvent.click(screen.getByRole("button", { name: "Record movement or reconciliation" }));
  fireEvent.change(screen.getByLabelText("Action"), {
    target: { value: "transfer" },
  });
  fireEvent.change(screen.getByLabelText("From goal"), {
    target: { value: "goal-1" },
  });
  fireEvent.change(screen.getByLabelText("To goal"), {
    target: { value: "goal-2" },
  });
  fireEvent.change(screen.getByLabelText("Amount to move"), {
    target: { value: "10.00" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(screen.getByRole("alert").textContent).toContain("different accounts");
  expect(p.save).not.toHaveBeenCalled();
});
