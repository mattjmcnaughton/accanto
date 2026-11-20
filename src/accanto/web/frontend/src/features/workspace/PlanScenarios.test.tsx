import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { PlanGroup, PlanRevision } from "../../lib/monthly";
import { CopyPlan } from "./PlanScenarios";
import { Plans } from "./Plans";
import type { ScreenProps } from "./shared";
const historical: PlanRevision = {
  uuid: "old",
  name: "Historical",
  number: 1,
  revision: 2,
  saved: true,
  saved_at: "2025-01-01",
  updated_at: null,
  rule_version: "older-rule",
  incomes: [{ source_id: "income-a", name: "Synthetic salary", amount: "4000.00" }],
  fixed_costs: [],
  fixed_cost_total: "0.00",
  income: "4000.00",
  spending: "800.00",
  tithe_target: "375.00",
  unassigned: "3199.99",
};
const plans: PlanGroup[] = [
  {
    plan_id: "plan-a",
    revisions: [
      historical,
      { ...historical, uuid: "draft", saved: false, revision: 3, spending: "900.00" },
    ],
  },
  {
    plan_id: "plan-b",
    revisions: [
      {
        ...historical,
        uuid: "new",
        name: "Alternative",
        rule_version: "monthly-net-1",
        spending: "900.00",
        tithe_target: "400.00",
        unassigned: "3100.00",
      },
    ],
  },
];
const props = (): ScreenProps => ({
  entity: { id: "entity", name: "Synthetic", time_zone: "UTC", today: "2026-10-17" },
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
it("copies exactly the explicitly selected saved revision and retains the entered name", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(plans)));
  const p = props();
  render(<Plans {...p} />);
  fireEvent.click(await screen.findByRole("button", { name: "Copy Plan" }));
  fireEvent.change(screen.getByLabelText("Copy from"), { target: { value: "old" } });
  fireEvent.change(screen.getByLabelText("New Plan name"), {
    target: { value: "Independent copy" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create copy" }));
  expect(p.save).toHaveBeenCalledWith(
    expect.objectContaining({
      path: "/api/entities/entity/plans/plan-a/copies",
      body: { name: "Independent copy", source_revision_id: "old", expected_revision: 2 },
    }),
    expect.any(Function),
  );
  expect((screen.getByLabelText("New Plan name") as HTMLInputElement).value).toBe(
    "Independent copy",
  );
});
it("requires explicit reconciliation when the selected source changes during reload", () => {
  const p = props();
  const view = render(<CopyPlan plans={plans} screen={p} copied={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Copy from"), { target: { value: "draft" } });
  fireEvent.change(screen.getByLabelText("New Plan name"), { target: { value: "Keep this name" } });
  view.rerender(
    <CopyPlan
      plans={plans.map((plan) => ({
        ...plan,
        revisions: plan.revisions.map((r) => (r.uuid === "draft" ? { ...r, revision: 4 } : r)),
      }))}
      screen={p}
      copied={vi.fn()}
    />,
  );
  expect((screen.getByRole("button", { name: "Create copy" }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect((screen.getByLabelText("New Plan name") as HTMLInputElement).value).toBe("Keep this name");
  fireEvent.click(screen.getByRole("button", { name: "Use current source revision" }));
  fireEvent.click(screen.getByRole("button", { name: "Create copy" }));
  expect(p.save).toHaveBeenCalledWith(
    expect.objectContaining({
      body: { name: "Keep this name", source_revision_id: "draft", expected_revision: 4 },
    }),
    expect.any(Function),
  );
});
