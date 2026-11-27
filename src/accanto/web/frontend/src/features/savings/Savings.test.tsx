import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Goal, SavingsAccount, SavingsMovement } from "../../lib/savings";
import type { ScreenProps } from "../workspace/shared";
import { Savings } from "./Savings";

const goal = (overrides: Partial<Goal>): Goal => ({
  uuid: "goal-1",
  name: "Emergency",
  role: "ordinary",
  kind: "ongoing",
  target: null,
  opening_amount: "100.00",
  remaining_saved: "50.00",
  contribution_progress: "0.00",
  funded_status: null,
  revision: 4,
  active: true,
  completed: false,
  archived_by_account: false,
  ...overrides,
});
const unallocated = goal({
  uuid: "goal-u",
  name: "Unallocated",
  role: "unallocated",
  opening_amount: "0.00",
  remaining_saved: "50.00",
  revision: 1,
});
const account = (goals: Goal[], overrides: Partial<SavingsAccount> = {}): SavingsAccount => ({
  uuid: "account-1",
  name: "Synthetic savings",
  opening_date: "2026-09-01",
  opening_amount: "100.00",
  balance: "100.00",
  revision: 7,
  active: true,
  goals,
  ...overrides,
});
const movement: SavingsMovement = {
  uuid: "move-1",
  kind: "reassignment",
  date: "2026-10-10",
  from_goal_id: "goal-1",
  to_goal_id: "goal-u",
  goal_id: null,
  amount: "50.00",
  note: "Synthetic correction",
  revision: 3,
};
const props = (): ScreenProps => ({
  entity: { id: "entity", name: "Synthetic Entity", today: "2026-10-17", time_zone: "UTC" },
  concealed: false,
  busy: false,
  refresh: 0,
  guard: vi.fn(() => true),
  dirty: vi.fn(),
  save: vi.fn(),
});
const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });
function serve(accounts: SavingsAccount[], movements: SavingsMovement[] = []) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (path) =>
    String(path).endsWith("/movements") ? json(movements) : json(accounts),
  );
}
const cell = (grid: string, row: string, col: number) =>
  document.getElementById(`${grid}-${row}-${col}`) as HTMLElement;
const press = (target: Element, key: string, init: KeyboardEventInit = {}) =>
  fireEvent.keyDown(target, { key, ...init });
const savedBody = (p: ScreenProps) => vi.mocked(p.save).mock.lastCall?.[0];
const showView = async (name: "Cards" | "Table") => {
  for (const group of await screen.findAllByRole("group", { name: "View" }))
    fireEvent.click(within(group).getByRole("button", { name }));
};
const loaded = async () => {
  await showView("Table");
  return screen.findByRole("grid", { name: "Savings accounts and goals" });
};

// This jsdom has no localStorage; a fresh store keeps each test's view choice to itself.
beforeEach(() => {
  const stored = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => stored.get(k) ?? null,
      setItem: (k: string, v: string) => void stored.set(k, String(v)),
    },
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("moves with Vim keys, keeps an Escaped edit unsaved, and saves only on Ctrl+S", async () => {
  serve([account([goal({}), unallocated])]);
  const p = props();
  render(<Savings {...p} />);
  await loaded();
  const start = cell("goals", "a:account-1", 0);
  press(start, "j");
  await waitFor(() => expect(document.activeElement).toBe(cell("goals", "g:goal-1", 0)));
  press(document.activeElement as Element, "x");
  expect(screen.queryByRole("textbox")).toBeNull();
  press(document.activeElement as Element, "l");
  press(cell("goals", "g:goal-1", 1), "l");
  await waitFor(() => expect(document.activeElement).toBe(cell("goals", "g:goal-1", 2)));
  press(cell("goals", "g:goal-1", 2), "i");
  const target = screen.getByLabelText("Target for Emergency");
  fireEvent.change(target, { target: { value: "12.5" } });
  press(target, "Escape");
  expect(p.save).not.toHaveBeenCalled();
  expect(cell("goals", "g:goal-1", 2).textContent).toBe("$12.50");
  expect(screen.getByText(/Unsaved goal Emergency/)).toBeTruthy();
  expect(p.dirty).toHaveBeenLastCalledWith(true);
  press(cell("goals", "g:goal-1", 2), "s", { ctrlKey: true });
  expect(savedBody(p)).toMatchObject({
    method: "PUT",
    path: "/api/entities/entity/savings-accounts/account-1/goals/goal-1",
    body: {
      name: "Emergency",
      kind: "ongoing",
      target: "12.5",
      active: true,
      expected_revision: 4,
    },
  });
});

it("keeps invalid input open and blocks finite goals without a target", async () => {
  serve([account([goal({}), unallocated])]);
  const p = props();
  render(<Savings {...p} />);
  await loaded();
  press(cell("goals", "g:goal-1", 2), "Enter");
  const target = screen.getByLabelText("Target for Emergency");
  fireEvent.change(target, { target: { value: "1.234" } });
  press(target, "Escape");
  expect(screen.getByLabelText("Target for Emergency")).toHaveProperty("value", "1.234");
  expect(screen.getByRole("alert").textContent).toContain("positive target");
  fireEvent.change(target, { target: { value: "" } });
  press(target, "Enter");
  press(cell("goals", "g:goal-1", 1), "i");
  const kind = screen.getByLabelText("Type for Emergency");
  fireEvent.change(kind, { target: { value: "finite" } });
  press(kind, "Enter");
  press(cell("goals", "g:goal-1", 1), "s", { ctrlKey: true });
  expect(p.save).not.toHaveBeenCalled();
  expect(screen.getByRole("alert").textContent).toContain("finite goal needs a positive target");
});

it("adds a goal with a/A against the account revision and an ongoing blank target as null", async () => {
  serve([account([goal({}), unallocated])]);
  const p = props();
  render(<Savings {...p} />);
  await loaded();
  press(cell("goals", "g:goal-u", 0), "A");
  const name = await screen.findByLabelText("Goal for New goal");
  fireEvent.change(name, { target: { value: "Bike" } });
  press(name, "Enter");
  press(cell("goals", "new-goal", 1), "i");
  const kind = screen.getByLabelText("Type for Bike");
  fireEvent.change(kind, { target: { value: "ongoing" } });
  press(kind, "Escape");
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(savedBody(p)).toMatchObject({
    method: "POST",
    path: "/api/entities/entity/savings-accounts/account-1/goals",
    body: { name: "Bike", kind: "ongoing", target: null, expected_account_revision: 7 },
  });
});

it("corrects ordinary opening designations and shows the live Unallocated remainder", async () => {
  serve([account([goal({}), unallocated])]);
  const p = props();
  render(<Savings {...p} />);
  await loaded();
  expect(cell("goals", "g:goal-u", 0).textContent).toBe("Unallocated");
  press(cell("goals", "g:goal-u", 3), "i");
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.getByText("Unallocated is protected.")).toBeTruthy();
  press(cell("goals", "g:goal-1", 3), "i");
  const opening = screen.getByLabelText("Opening for Emergency");
  fireEvent.change(opening, { target: { value: "120.00" } });
  press(opening, "Enter");
  expect(cell("goals", "g:goal-u", 3).textContent).toBe("−$20.00");
  press(cell("goals", "g:goal-1", 3), "s", { ctrlKey: true });
  expect(p.save).not.toHaveBeenCalled();
  expect(screen.getByRole("alert").textContent).toContain("must fit within");
  press(cell("goals", "g:goal-1", 3), "i");
  fireEvent.change(screen.getByLabelText("Opening for Emergency"), { target: { value: "60.00" } });
  press(screen.getByLabelText("Opening for Emergency"), "Enter");
  expect(cell("goals", "g:goal-u", 3).textContent).toBe("$40.00");
  press(cell("goals", "g:goal-1", 3), "s", { ctrlKey: true });
  expect(savedBody(p)).toMatchObject({
    method: "PUT",
    path: "/api/entities/entity/savings-accounts/account-1",
    body: {
      name: "Synthetic savings",
      opening_date: "2026-09-01",
      opening_amount: "100.00",
      expected_revision: 7,
      designations: [{ goal_id: "goal-1", opening_amount: "60.00" }],
    },
  });
});

it("guards switching to another record and keeps the pending one when declined", async () => {
  const second = goal({ uuid: "goal-2", name: "Travel", revision: 2 });
  serve([account([goal({}), second, unallocated])]);
  const p = props();
  vi.mocked(p.guard).mockReturnValue(false);
  render(<Savings {...p} />);
  await loaded();
  press(cell("goals", "g:goal-1", 0), "i");
  fireEvent.change(screen.getByLabelText("Goal for Emergency"), { target: { value: "Rainy day" } });
  press(screen.getByLabelText("Goal for Emergency"), "Enter");
  press(cell("goals", "g:goal-2", 0), "i");
  expect(p.guard).toHaveBeenCalled();
  expect(screen.queryByLabelText("Goal for Travel")).toBeNull();
  expect(cell("goals", "g:goal-1", 0).textContent).toContain("Rainy day");
});

it("creates an account from details only when designations fit the opening amount", async () => {
  serve([]);
  const p = props();
  render(<Savings {...p} />);
  await screen.findByText("No savings accounts yet");
  fireEvent.click(screen.getByRole("button", { name: "New account" }));
  const details = screen.getByRole("dialog", { name: "New savings account" });
  fireEvent.change(within(details).getByLabelText("Account name"), {
    target: { value: "Reserve" },
  });
  fireEvent.change(within(details).getByLabelText("Holds today (USD)"), {
    target: { value: "10.00" },
  });
  fireEvent.click(within(details).getByRole("button", { name: "Add opening goal" }));
  fireEvent.change(within(details).getByLabelText("Goal name"), { target: { value: "Laptop" } });
  fireEvent.change(within(details).getByLabelText("Target (required)"), {
    target: { value: "900.00" },
  });
  fireEvent.change(within(details).getByLabelText("Opening designation"), {
    target: { value: "10.01" },
  });
  expect(within(details).getByText("Unallocated opening −$0.01")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(p.save).not.toHaveBeenCalled();
  fireEvent.change(within(details).getByLabelText("Opening designation"), {
    target: { value: "4.00" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(savedBody(p)).toMatchObject({
    method: "POST",
    path: "/api/entities/entity/savings-accounts",
    body: {
      name: "Reserve",
      opening_date: "2026-10-17",
      opening_amount: "10.00",
      goals: [{ name: "Laptop", kind: "finite", target: "900.00", opening_amount: "4.00" }],
    },
  });
});

it("previews completion return and submits the displayed revision and amount", async () => {
  serve([account([goal({ kind: "finite", target: "100.00" }), unallocated])]);
  const p = props();
  render(<Savings {...p} />);
  await loaded();
  press(cell("goals", "g:goal-1", 6), "Enter");
  fireEvent.click(screen.getByRole("button", { name: "Complete Emergency…" }));
  expect(screen.getByText(/Returns \$50.00 to Unallocated · account total unchanged/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Confirm complete" }));
  expect(savedBody(p)).toMatchObject({
    method: "POST",
    path: "/api/entities/entity/savings-accounts/account-1/goals/goal-1/complete",
    body: { date: "2026-10-17", expected_revision: 4, expected_return: "50.00" },
  });
});

it("keeps completed goals with money visible and returns them without reactivation", async () => {
  const completed = goal({ kind: "finite", target: "100.00", active: false, completed: true });
  const spent = goal({
    uuid: "goal-3",
    name: "Old trip",
    kind: "finite",
    target: "10.00",
    remaining_saved: "0.00",
    completed: true,
    active: false,
  });
  serve([account([completed, spent, unallocated])]);
  const p = props();
  render(<Savings {...p} />);
  await loaded();
  expect(screen.queryByText("Old trip")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Show archived (1)" }));
  expect(screen.getByText("Old trip")).toBeTruthy();
  press(cell("goals", "g:goal-1", 0), "i");
  expect(screen.queryByRole("textbox")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Return Emergency to Unallocated…" }));
  expect(screen.getByText(/goal stays completed/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Confirm return" }));
  expect(savedBody(p)).toMatchObject({
    path: "/api/entities/entity/savings-accounts/movements",
    body: { kind: "reassignment", from_goal_id: "goal-1", to_goal_id: "goal-u", amount: "50.00" },
  });
});

it("keeps movement identity on correction and rejects a transfer within one account", async () => {
  serve([account([goal({}), unallocated])], [movement]);
  const p = props();
  render(<Savings {...p} />);
  await showView("Table");
  await screen.findByText("Synthetic correction");
  press(cell("moves", "m:move-1", 1), "i");
  expect(screen.getByText(/recorded action cannot change/)).toBeTruthy();
  press(cell("moves", "m:move-1", 4), "i");
  const amount = screen.getByLabelText("Amount for Reassign on Oct 10, 2026");
  fireEvent.change(amount, { target: { value: "40.00" } });
  press(amount, "Enter");
  press(cell("moves", "m:move-1", 4), "s", { ctrlKey: true });
  expect(savedBody(p)).toMatchObject({
    method: "PUT",
    path: "/api/entities/entity/savings-accounts/movements/move-1",
    body: {
      kind: "reassignment",
      from_goal_id: "goal-1",
      to_goal_id: "goal-u",
      amount: "40.00",
      expected_revision: 3,
    },
  });
  vi.mocked(p.save).mockClear();
  vi.spyOn(window, "confirm").mockReturnValue(true);
  fireEvent.click(screen.getByRole("button", { name: "Discard" }));
  await waitFor(() => expect(document.activeElement).toBe(cell("moves", "m:move-1", 4)));
  press(cell("moves", "m:move-1", 0), "a");
  const action = await screen.findByLabelText("Action for New savings record");
  fireEvent.change(action, { target: { value: "transfer" } });
  press(action, "Enter");
  for (const [col, label, value] of [
    [2, "From / goal", "goal-1"],
    [3, "To", "goal-u"],
    [4, "Amount", "10.00"],
  ] as const) {
    press(cell("moves", "new-move", col), "i");
    const input = screen.getByLabelText(`${label} for New savings record`);
    fireEvent.change(input, { target: { value } });
    press(input, "Enter");
  }
  press(cell("moves", "new-move", 4), "s", { ctrlKey: true });
  expect(p.save).not.toHaveBeenCalled();
  expect(screen.getByRole("alert").textContent).toContain("different accounts");
});

it("deletes a movement with dd only after confirmation and never deletes goals", async () => {
  serve([account([goal({}), unallocated])], [movement]);
  const p = props();
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  render(<Savings {...p} />);
  await showView("Table");
  await screen.findByText("Synthetic correction");
  press(cell("goals", "g:goal-1", 0), "d");
  press(cell("goals", "g:goal-1", 0), "d");
  expect(confirm).not.toHaveBeenCalled();
  expect(screen.getByText(/archived from Details, not deleted/)).toBeTruthy();
  press(cell("moves", "m:move-1", 0), "d");
  press(cell("moves", "m:move-1", 0), "d");
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(p.save).not.toHaveBeenCalled();
  confirm.mockReturnValue(true);
  press(cell("moves", "m:move-1", 0), "d");
  press(cell("moves", "m:move-1", 0), "d");
  expect(savedBody(p)).toMatchObject({
    method: "DELETE",
    path: "/api/entities/entity/savings-accounts/movements/move-1",
    body: { kind: "reassignment", expected_revision: 3 },
  });
});

it("never replaces or discards attempted values while a write is busy", async () => {
  const second = goal({ uuid: "goal-2", name: "Travel", revision: 2 });
  serve([account([goal({}), second, unallocated])], [movement]);
  const p = props();
  const view = render(<Savings {...p} />);
  await loaded();
  press(cell("goals", "g:goal-1", 0), "i");
  fireEvent.change(screen.getByLabelText("Goal for Emergency"), { target: { value: "Rainy day" } });
  press(screen.getByLabelText("Goal for Emergency"), "Enter");
  view.rerender(<Savings {...p} busy />);
  press(cell("goals", "g:goal-2", 0), "i");
  press(cell("goals", "g:goal-2", 0), "a");
  press(cell("moves", "m:move-1", 0), "a");
  press(cell("moves", "m:move-1", 0), "s", { ctrlKey: true });
  fireEvent.click(screen.getByRole("button", { name: "Discard" }));
  fireEvent.click(screen.getByRole("button", { name: "New account" }));
  expect(p.guard).not.toHaveBeenCalled();
  expect(p.save).not.toHaveBeenCalled();
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.queryByRole("combobox")).toBeNull();
  expect(cell("goals", "g:goal-1", 0).textContent).toContain("Rainy day");
  press(cell("goals", "g:goal-1", 6), "Enter");
  expect(
    within(screen.getByRole("dialog", { name: "Emergency" }))
      .getByLabelText("Goal name")
      .matches(":disabled"),
  ).toBe(true);
  view.rerender(<Savings {...p} busy={false} />);
  press(cell("goals", "g:goal-1", 0), "i");
  expect(screen.getByLabelText("Goal for Rainy day")).toHaveProperty("value", "Rainy day");
});

it("gives each Savings dialog a unique accessible title", async () => {
  serve([account([goal({}), unallocated])]);
  const p = props();
  render(
    <>
      <Savings {...p} />
      <Savings {...p} />
    </>,
  );
  await waitFor(() => expect(screen.getAllByRole("group", { name: "View" })).toHaveLength(2));
  await showView("Table");
  await waitFor(() =>
    expect(screen.getAllByRole("grid", { name: "Savings accounts and goals" })).toHaveLength(2),
  );
  const titles = screen
    .getAllByText("Keyboard shortcuts", { selector: "h2" })
    .map((heading) => heading.id);
  expect(new Set(titles).size).toBe(2);
  for (const dialog of document.querySelectorAll("dialog"))
    expect(document.getElementById(dialog.getAttribute("aria-labelledby") ?? "")?.textContent).toBe(
      "Keyboard shortcuts",
    );
});

it("moves saved money from a goal card through the dialog", async () => {
  serve([account([goal({}), unallocated])]);
  const p = props();
  const view = render(<Savings {...p} />);
  fireEvent.click(await screen.findByRole("button", { name: "Move money from Emergency" }));
  const dialog = screen.getByRole("dialog", { name: "Move saved money" });
  expect(within(dialog).getByLabelText("From")).toHaveProperty("value", "goal-1");
  fireEvent.change(within(dialog).getByLabelText("To"), { target: { value: "goal-u" } });
  fireEvent.change(within(dialog).getByLabelText("Amount (USD)"), { target: { value: "0" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  expect(p.save).not.toHaveBeenCalled();
  expect(within(dialog).getByRole("alert").textContent).toContain("positive amount");
  fireEvent.change(within(dialog).getByLabelText("Amount (USD)"), { target: { value: "12.00" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  expect(savedBody(p)).toMatchObject({
    method: "POST",
    path: "/api/entities/entity/savings-accounts/movements",
    body: { kind: "reassignment", from_goal_id: "goal-1", to_goal_id: "goal-u", amount: "12.00" },
  });
  // An unconfirmed new record stays in its dialog, where the shell shows a failed save's notice.
  fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
  expect(screen.getByRole("dialog", { name: "Move saved money" })).toBeTruthy();
  view.rerender(<Savings {...p} busy />);
  fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
  expect(screen.getByRole("dialog", { name: "Move saved money" })).toBeTruthy();
  expect(within(dialog).getByLabelText("Amount (USD)")).toHaveProperty("value", "12.00");
  await showView("Table");
  expect(screen.getByRole("row", { name: /New savings record/ })).toBeTruthy();
});
