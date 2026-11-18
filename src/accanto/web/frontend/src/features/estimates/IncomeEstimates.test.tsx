import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { IncomeEstimates } from "./IncomeEstimates";
import type { ScreenProps } from "../workspace/shared";
import { Workspace } from "../workspace/Workspace";

const entity = { id: "entity", name: "Synthetic Entity", today: "2026-10-17", time_zone: "UTC" };
const line = (uuid: string, name: string, gross: string, withholding: string, payroll: string) => ({
  uuid,
  name,
  gross,
  withholding,
  payroll,
  frequency: "monthly",
  paid_days: null,
});
// CONTEXT.md Decision 11: 6000 − 1200 − 300 = 4500 and 4000 − 800 − 200 = 3000 monthly.
const saved = {
  uuid: "estimate-1",
  name: "Two roles",
  revision: 2,
  monthly_total: "7500.00",
  lines: [
    { ...line("line-1", "Role A", "6000.00", "1200.00", "300.00"), monthly_net: "4500.00" },
    { ...line("line-2", "Role B", "4000.00", "800.00", "200.00"), monthly_net: "3000.00" },
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
const cell = (row: number, col: number) =>
  document.getElementById(`estimate-cell-${row}-${col}`) as HTMLElement;
const press = (key: string, init: KeyboardEventInit = {}) =>
  fireEvent.keyDown(document.activeElement as Element, { key, ...init });
function editCell(row: number, col: number, label: string, value: string) {
  fireEvent.doubleClick(cell(row, col));
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
  press("Escape");
}
async function openSaved(record = saved) {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(json([record]));
  const p = props();
  render(<IncomeEstimates {...p} />);
  fireEvent.click(await screen.findByRole("button", { name: `Open ${record.name}` }));
  await waitFor(() => expect(document.activeElement).toBe(cell(0, 0)));
  return p;
}
const combined = () => screen.getByRole("cell", { name: "Combined monthly net" });
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("shows saved line results and assumed pays, then edits and saves by keyboard alone", async () => {
  const p = await openSaved();
  expect(cell(0, 6).textContent).toBe("$4,500.00");
  expect(cell(1, 6).textContent).toBe("$3,000.00");
  expect(combined().textContent).toBe("$7,500.00");
  expect(cell(0, 2).textContent).toBe("12 assumed");

  press("j");
  await waitFor(() => expect(document.activeElement).toBe(cell(1, 0)));
  for (const _ of [1, 2, 3]) press("l");
  await waitFor(() => expect(document.activeElement).toBe(cell(1, 3)));
  press("i");
  fireEvent.change(screen.getByLabelText("Gross per payment 2"), { target: { value: "4100.00" } });
  press("Escape");
  await waitFor(() => expect(document.activeElement).toBe(cell(1, 3)));
  expect(screen.queryByLabelText("Gross per payment 2")).toBeNull();
  expect(cell(1, 3).textContent).toBe("$4,100.00");
  // The draft is not calculated client-side: only the unchanged line keeps its saved result.
  expect(cell(0, 6).textContent).toBe("$4,500.00");
  expect(cell(1, 6).textContent).toMatch(/^—/);
  expect(combined().textContent).toBe("—");
  expect(screen.getByText(/Last saved combined: \$7,500.00/)).toBeDefined();

  fireEvent.keyDown(document.body, { key: "s", ctrlKey: true });
  expect(p.save).not.toHaveBeenCalled();
  press("s", { ctrlKey: true });
  expect(p.save).toHaveBeenCalledWith(
    expect.objectContaining({
      method: "PUT",
      path: "/api/entities/entity/income-estimates/estimate-1",
      body: expect.objectContaining({
        expected_revision: 2,
        lines: [
          expect.objectContaining({ line_id: "line-1", gross: "6000.00" }),
          expect.objectContaining({ line_id: "line-2", gross: "4100.00" }),
        ],
      }),
    }),
    expect.any(Function),
  );
});

it("keeps invalid input in insert mode instead of retaining or saving it", async () => {
  const p = await openSaved();
  editCell(0, 4, "Withholding per payment 1", "12.345");
  expect(screen.getByRole("alert").textContent).toMatch(/two decimals/);
  expect(screen.getByLabelText("Withholding per payment 1")).toBeDefined();
  press("s", { metaKey: true });
  expect(p.save).not.toHaveBeenCalled();
});

it("adds with a or A, removes with confirmed dd, and keeps at least one line", async () => {
  const p = await openSaved();
  press("A");
  const name = await screen.findByLabelText("Income line 3");
  fireEvent.change(name, { target: { value: "Role C" } });
  press("Escape");
  await waitFor(() => expect(document.activeElement).toBe(cell(2, 0)));

  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  press("k");
  await waitFor(() => expect(document.activeElement).toBe(cell(1, 0)));
  press("d");
  press("d");
  expect(confirm).toHaveBeenCalledOnce();
  await waitFor(() => expect(document.activeElement?.textContent).toBe("Role C"));
  press("d");
  press("d");
  await waitFor(() => expect(document.activeElement).toBe(cell(0, 0)));
  press("d");
  press("d");
  expect(document.getElementById("estimate-notice")?.textContent).toBe(
    "Keep at least one income line.",
  );
  expect(cell(0, 0).textContent).toBe("Role A");
  expect(p.dirty).toHaveBeenLastCalledWith(true);
});

it("requires explicit daily paid days, permits zero, and never infers workdays", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(json([]));
  const p = props();
  render(<IncomeEstimates {...p} />);
  fireEvent.click(screen.getByRole("button", { name: "New estimate" }));
  fireEvent.change(screen.getByLabelText("Estimate name"), { target: { value: "Daily" } });
  editCell(0, 0, "Income line 1", "Day role");
  editCell(0, 3, "Gross per payment 1", "100");
  fireEvent.doubleClick(cell(0, 2));
  expect(document.getElementById("estimate-notice")?.textContent).toMatch(/Choose Daily/);
  editCell(0, 1, "Payment frequency 1", "daily");
  expect(cell(0, 2).textContent).toBe("— entered");
  fireEvent.click(screen.getByRole("button", { name: "Save estimate" }));
  expect(p.save).not.toHaveBeenCalled();
  expect(cell(0, 2).className).toMatch(/estimates-invalid/);
  // Trailing whitespace is accepted when validating, so it must not reach the API.
  editCell(0, 2, "Paid days per year 1", "0 ");
  fireEvent.click(screen.getByRole("button", { name: "Save estimate" }));
  expect(p.save).toHaveBeenCalledWith(
    expect.objectContaining({
      method: "POST",
      body: {
        name: "Daily",
        lines: [
          {
            name: "Day role",
            gross: "100",
            withholding: "0.00",
            payroll: "0.00",
            frequency: "daily",
            paid_days: "0",
          },
        ],
      },
    }),
    expect.any(Function),
  );
  expect(combined().textContent).toBe("—");
});

it("marks negative saved results and duplicates through the API with an explicit name", async () => {
  const negative = {
    ...saved,
    monthly_total: "-125.00",
    lines: [
      { ...line("line-1", "Short role", "100.00", "250.00", "0.00"), monthly_net: "-125.00" },
    ],
  };
  const p = await openSaved(negative);
  expect(cell(0, 6).querySelector(".negative")?.textContent).toBe("-$125.00");
  expect(within(combined()).getByText("-$125.00").className).toBe("negative");
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

it("cannot replace an attempted draft while a write is pending", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(json([saved]));
  const p = props();
  const { rerender } = render(<IncomeEstimates {...p} />);
  fireEvent.click(await screen.findByRole("button", { name: "Open Two roles" }));
  editCell(1, 3, "Gross per payment 2", "4100.00");
  // The Workspace marks a failed or stale write as busy while its retry is pending.
  rerender(<IncomeEstimates {...p} busy />);
  fireEvent.click(screen.getByRole("button", { name: "New estimate" }));
  fireEvent.click(screen.getByRole("button", { name: "Open Two roles" }));
  cell(1, 3).focus();
  press("Enter");
  press("a");
  expect(cell(1, 3).textContent).toBe("$4,100.00");
  expect(screen.queryByLabelText("Gross per payment 2")).toBeNull();
  expect(document.querySelectorAll(".estimates-lines tbody tr")).toHaveLength(2);
  expect(screen.getByDisplayValue("Two roles")).toBeDefined();
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
  fireEvent.click(screen.getByRole("button", { name: /^Income estimates/ }));
  fireEvent.click(screen.getByRole("button", { name: "New estimate" }));
  fireEvent.change(screen.getByLabelText("Estimate name"), {
    target: { value: "Attempted scenario" },
  });
  editCell(0, 0, "Income line 1", "Role A");
  editCell(0, 3, "Gross per payment 1", "6000.00");
  fireEvent.click(screen.getByRole("button", { name: "Save estimate" }));
  fireEvent.click(await screen.findByRole("button", { name: "Retry save" }));
  await waitFor(() => expect(writes).toHaveLength(2));
  expect(writes[0].body).toBe(writes[1].body);
  expect(new Headers(writes[0].headers).get("Idempotency-Key")).toBe(
    new Headers(writes[1].headers).get("Idempotency-Key"),
  );
  expect(screen.getByDisplayValue("Attempted scenario")).toBeDefined();
});
