import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { IncomeEstimates } from "./IncomeEstimates";
import type { ScreenProps } from "../workspace/shared";
import { Workspace } from "../workspace/Workspace";

const entity = { id: "entity", name: "Synthetic Entity", today: "2026-10-17", time_zone: "UTC" };
const saved = {
  uuid: "estimate-1",
  name: "Two roles",
  revision: 2,
  monthly_total: "7500.00",
  lines: [
    {
      uuid: "line-1",
      name: "Role A",
      gross: "6000.00",
      withholding: "1200.00",
      payroll: "300.00",
      frequency: "monthly",
      paid_days: null,
      monthly_net: "4500.00",
    },
    {
      uuid: "line-2",
      name: "Role B",
      gross: "4000.00",
      withholding: "800.00",
      payroll: "200.00",
      frequency: "monthly",
      paid_days: null,
      monthly_net: "3000.00",
    },
  ],
};
const props = (): ScreenProps => ({
  entity,
  concealed: false,
  busy: false,
  refresh: 0,
  guard: () => true,
  dirty: vi.fn(),
  save: vi.fn(),
});
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("reopens stored assumptions and submits stable line IDs with the expected revision", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(json([saved]));
  const p = props();
  render(<IncomeEstimates {...p} />);
  fireEvent.click(await screen.findByRole("button", { name: "Open Two roles" }));
  expect(screen.getByText(/Combined: \$7,500.00/)).toBeDefined();
  fireEvent.change(screen.getByLabelText("Gross per payment 1"), {
    target: { value: "6100.00" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save estimate" }));
  expect(p.save).toHaveBeenCalledWith(
    expect.objectContaining({
      method: "PUT",
      path: "/api/entities/entity/income-estimates/estimate-1",
      body: expect.objectContaining({
        expected_revision: 2,
        lines: expect.arrayContaining([
          expect.objectContaining({ line_id: "line-1", gross: "6100.00" }),
        ]),
      }),
    }),
    expect.any(Function),
  );
});

it("duplicates into independent identity via the API with an explicit name", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(json([saved]));
  const p = props();
  render(<IncomeEstimates {...p} />);
  fireEvent.click(await screen.findByRole("button", { name: "Open Two roles" }));
  fireEvent.change(screen.getByLabelText("New estimate name"), {
    target: { value: "Alternative" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Duplicate estimate" }));
  expect(p.save).toHaveBeenCalledWith(
    expect.objectContaining({
      path: "/api/entities/entity/income-estimates/estimate-1/duplicate",
      body: { name: "Alternative", expected_revision: 2 },
    }),
    expect.any(Function),
  );
});

it("requires explicit daily paid days and permits zero without inferring workdays", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(json([]));
  const p = props();
  render(<IncomeEstimates {...p} />);
  fireEvent.click(screen.getByRole("button", { name: "New estimate" }));
  fireEvent.change(screen.getByLabelText("Estimate name"), { target: { value: "Daily" } });
  fireEvent.change(screen.getByLabelText("Income line 1"), { target: { value: "Day role" } });
  fireEvent.change(screen.getByLabelText("Gross per payment 1"), {
    target: { value: "100.00" },
  });
  fireEvent.change(screen.getByLabelText("Withholding per payment 1"), {
    target: { value: "0" },
  });
  fireEvent.change(screen.getByLabelText("Payroll deductions per payment 1"), {
    target: { value: "0" },
  });
  fireEvent.change(screen.getByLabelText("Payment frequency 1"), {
    target: { value: "daily" },
  });
  fireEvent.change(screen.getByLabelText("Paid days per year 1"), { target: { value: "0" } });
  fireEvent.click(screen.getByRole("button", { name: "Save estimate" }));
  expect(p.save).toHaveBeenCalledWith(
    expect.objectContaining({
      body: expect.objectContaining({
        lines: [expect.objectContaining({ frequency: "daily", paid_days: "0" })],
      }),
    }),
    expect.any(Function),
  );
});

it("distinguishes empty from failed loads and hides content for a different User", async () => {
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(json([]));
  const p = props();
  const { rerender } = render(<IncomeEstimates {...p} />);
  await screen.findByText(/No estimates yet/);
  fetch.mockResolvedValue(json({ detail: { code: "storage_unavailable", message: "Retry" } }, 503));
  rerender(<IncomeEstimates {...p} refresh={1} />);
  await screen.findByRole("alert");
  expect(screen.queryByText(/No estimates yet/)).toBeNull();
  rerender(<IncomeEstimates {...p} concealed refresh={1} />);
  await waitFor(() => expect(screen.queryByText("Two roles")).toBeNull());
  expect(screen.queryByRole("button", { name: "New estimate" })).toBeNull();
});

it("retains estimate inputs and exact request identity after an uncertain save", async () => {
  const writes: RequestInit[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_path, init) => {
    if (!init?.method) return json([]);
    writes.push(init);
    if (writes.length === 1)
      return json({ detail: { code: "storage_unavailable", message: "Try again" } }, 503);
    return json({ ...saved, uuid: "new-estimate", name: "Attempted scenario" });
  });
  render(
    <Workspace
      initial={{ user: { id: "user" }, entities: [entity], csrf_token: "synthetic" }}
      signedOut={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Income estimates" }));
  fireEvent.click(screen.getByRole("button", { name: "New estimate" }));
  fireEvent.change(screen.getByLabelText("Estimate name"), {
    target: { value: "Attempted scenario" },
  });
  fireEvent.change(screen.getByLabelText("Income line 1"), { target: { value: "Role A" } });
  fireEvent.change(screen.getByLabelText("Gross per payment 1"), {
    target: { value: "6000.00" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save estimate" }));
  fireEvent.click(await screen.findByRole("button", { name: "Retry save" }));
  await waitFor(() => expect(writes).toHaveLength(2));
  expect(writes[0].body).toBe(writes[1].body);
  expect(new Headers(writes[0].headers).get("Idempotency-Key")).toBe(
    new Headers(writes[1].headers).get("Idempotency-Key"),
  );
  expect(screen.getByDisplayValue("Attempted scenario")).toBeDefined();
});
