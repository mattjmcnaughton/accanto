import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ProductionHome } from "../../routes/__root";
import { activityPage } from "../../stories/mocks/activity";
import { Workspace } from "./Workspace";
import { previousMonth, sourceChoices } from "./shared";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("uses the immediately previous calendar month across years", () => {
  expect(previousMonth("2027-01")).toBe("2026-12-01");
});
it("keeps distinct UUIDs even when sources have the same name", () => {
  const revisions = [
    {
      name: "Plan",
      incomes: [
        { source_id: "a", name: "Salary" },
        { source_id: "b", name: "Salary" },
      ],
    },
  ];
  expect(sourceChoices([{ plan_id: "p", revisions }] as never).map((x) => x.id)).toEqual([
    "a",
    "b",
  ]);
});
it("shows signed-out state rather than a financial empty workspace", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 401 }));
  render(<ProductionHome />);
  expect((await screen.findByRole("link", { name: "Sign in" })).getAttribute("href")).toBe(
    "/api/auth/login",
  );
});
it("clears the workspace before logout completes and ignores late reads", async () => {
  let finishRead: (value: Response) => void = () => {};
  vi.spyOn(globalThis, "fetch").mockImplementation(async (path) => {
    if (path === "/api/auth/session")
      return new Response(
        JSON.stringify({
          user: { id: "u" },
          csrf_token: "test",
          entities: [{ id: "e", name: "Synthetic Entity", today: "2026-10-17", time_zone: "UTC" }],
        }),
      );
    if (String(path).endsWith("/plans"))
      return new Promise((resolve) => {
        finishRead = resolve;
      });
    return new Promise(() => {});
  });
  render(<ProductionHome />);
  fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
  await waitFor(() => expect(screen.queryByText("Synthetic Entity")).toBeNull());
  finishRead(
    new Response(
      JSON.stringify([
        { plan_id: "p", revisions: [{ name: "Private late Plan", saved: false, incomes: [] }] },
      ]),
    ),
  );
  await waitFor(() => expect(screen.queryByText("Private late Plan")).toBeNull());
});
it("returns the address to the current screen when Back or Forward would abandon a pending save", async () => {
  const session = {
    user: { id: "u" },
    csrf_token: "test",
    entities: [{ id: "e", name: "Synthetic Entity", today: "2026-10-17", time_zone: "UTC" }],
  };
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_path, init) =>
    init?.method ? new Promise(() => {}) : new Response("[]"),
  );
  const navigate = vi.fn();
  const view = render(
    <Workspace initial={session} signedOut={vi.fn()} screen="plans" navigate={navigate} />,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Create your first Plan" }));
  fireEvent.change(screen.getByLabelText("Plan name"), { target: { value: "Pending Plan" } });
  fireEvent.click(screen.getByRole("button", { name: "Create and open" }));
  view.rerender(
    <Workspace initial={session} signedOut={vi.fn()} screen="activity" navigate={navigate} />,
  );
  await waitFor(() => expect(navigate).toHaveBeenCalledWith("plans", true, undefined));
  expect(screen.queryByRole("button", { name: "Record activity" })).toBeNull();
  expect(screen.getByDisplayValue("Pending Plan")).toBeDefined();
});
it("keeps the save notice reachable by moving it into an open dialog", async () => {
  const session = {
    user: { id: "u" },
    csrf_token: "test",
    entities: [{ id: "e", name: "Synthetic Entity", today: "2026-10-17", time_zone: "UTC" }],
  };
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_path, init) =>
    init?.method ? new Response("{}", { status: 503 }) : new Response("[]"),
  );
  render(<Workspace initial={session} signedOut={vi.fn()} screen="plans" navigate={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Create your first Plan" }));
  fireEvent.change(screen.getByLabelText("Plan name"), { target: { value: "Attempted Plan" } });
  fireEvent.click(screen.getByRole("button", { name: "Create and open" }));
  const main = screen.getByRole("main");
  await waitFor(() => expect(within(main).getByRole("alert")).toBeDefined());
  // A modal dialog makes the page behind it inert, so the notice must be inside the dialog.
  fireEvent.keyDown(document, { key: "k", ctrlKey: true });
  const dialog = screen.getByRole("dialog", { name: "Ask or jump" });
  expect(within(dialog).getByRole("button", { name: "Retry save" })).toBeDefined();
  expect(within(main).queryByRole("alert")).toBeNull();
  fireEvent(dialog, new Event("cancel", { cancelable: true }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(within(main).getByRole("button", { name: "Retry save" })).toBeDefined();
});
it("opens the entry dialog from any screen and shares one month across Home, Activity and Review", async () => {
  const session = {
    user: { id: "u" },
    csrf_token: "test",
    entities: [{ id: "e", name: "Synthetic Entity", today: "2026-10-17", time_zone: "UTC" }],
  };
  vi.spyOn(globalThis, "fetch").mockImplementation(async (path) =>
    String(path).includes("/activity/page")
      ? new Response(JSON.stringify(activityPage(String(path), [])))
      : new Response("[]"),
  );
  const navigate = vi.fn();
  const view = render(
    <Workspace initial={session} signedOut={vi.fn()} screen="settings" navigate={navigate} />,
  );
  expect(screen.queryByRole("button", { name: "Next month" })).toBeNull();
  fireEvent.keyDown(document, { key: "n" });
  expect(navigate).toHaveBeenLastCalledWith("activity", false, undefined);
  view.rerender(
    <Workspace initial={session} signedOut={vi.fn()} screen="activity" navigate={navigate} />,
  );
  const dialog = await screen.findByRole("dialog", { name: "Record activity" });
  expect(within(dialog).getByLabelText("Amount (USD)")).toBeDefined();
  fireEvent(dialog, new Event("cancel", { cancelable: true }));
  // Closing a new entry nothing was typed into discards it, so leaving does not ask.
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  // The request is one-shot: coming back to Activity later does not reopen the dialog.
  view.rerender(
    <Workspace initial={session} signedOut={vi.fn()} screen="review" navigate={navigate} />,
  );
  view.rerender(
    <Workspace initial={session} signedOut={vi.fn()} screen="activity" navigate={navigate} />,
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByText("Unsaved")).toBeNull();
  const top = screen.getByRole("banner");
  expect(within(top).getByText("October 2026")).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Next month" }));
  expect(navigate).toHaveBeenLastCalledWith("activity", false, "2026-11");
  expect(confirm).not.toHaveBeenCalled();
  view.rerender(
    <Workspace
      initial={session}
      signedOut={vi.fn()}
      screen="activity"
      month="2026-11"
      navigate={navigate}
    />,
  );
  expect(within(top).getByText("November 2026")).toBeDefined();
  const nav = screen.getByRole("navigation", { name: "Workspace" });
  expect(within(nav).getByRole("link", { name: "Review" }).getAttribute("href")).toBe(
    "#/review?m=2026-11",
  );
  fireEvent.click(screen.getByRole("button", { name: "This month" }));
  expect(navigate).toHaveBeenLastCalledWith("activity", false, undefined);
});
it("sends free text from the Ask bar to the assistant and runs / commands without it", async () => {
  const session = {
    user: { id: "u" },
    csrf_token: "test",
    entities: [{ id: "e", name: "Synthetic Entity", today: "2026-11-10", time_zone: "UTC" }],
  };
  const asked: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (path, init) => {
    const url = String(path);
    if (url.endsWith("/auth/session")) return new Response(JSON.stringify(session));
    if (url.endsWith("/agent/settings"))
      return new Response(
        JSON.stringify({ enabled: true, mode: "ask_first", instructions: "", revision: 1 }),
      );
    if (url.endsWith("/messages") && init?.method === "POST") {
      asked.push(String((init.body as FormData).get("content")));
      return new Response(new ReadableStream({ start: (c) => c.close() }));
    }
    return new Response("[]");
  });
  const navigate = vi.fn();
  render(<Workspace initial={session} signedOut={vi.fn()} screen="home" navigate={navigate} />);

  fireEvent.keyDown(document, { key: "k", ctrlKey: true });
  let bar = screen.getByRole("textbox", { name: "Ask or jump" });
  // A / command lists only commands, and Enter runs it here: no question reaches the model.
  fireEvent.change(bar, { target: { value: "/inb" } });
  const dialog = screen.getByRole("dialog", { name: "Ask or jump" });
  expect(within(dialog).queryByText(/^Ask:/)).toBeNull();
  fireEvent.keyDown(bar, { key: "Enter" });
  expect(navigate).toHaveBeenLastCalledWith("inbox", false, undefined);
  expect(screen.queryByRole("dialog", { name: "Ask or jump" })).toBeNull();

  fireEvent.keyDown(document, { key: "k", ctrlKey: true });
  bar = screen.getByRole("textbox", { name: "Ask or jump" });
  fireEvent.change(bar, { target: { value: "How much went to Example Bistro?" } });
  fireEvent.keyDown(bar, { key: "Enter" });
  await waitFor(() => expect(asked).toEqual(["How much went to Example Bistro?"]));
  expect(screen.getByRole("complementary", { name: "Assistant" })).toBeDefined();
});
it("gives the phone tabs to daily screens and groups the rest in More", async () => {
  const session = {
    user: { id: "u" },
    csrf_token: "test",
    entities: [{ id: "e", name: "Synthetic Entity", today: "2026-11-10", time_zone: "UTC" }],
  };
  vi.spyOn(globalThis, "fetch").mockImplementation(async (path) =>
    String(path).includes("/activity/page")
      ? new Response(JSON.stringify(activityPage(String(path), [])))
      : new Response("[]"),
  );
  const navigate = vi.fn();
  render(
    <Workspace initial={session} signedOut={vi.fn()} screen="schedules" navigate={navigate} />,
  );
  const bar = screen.getByRole("navigation", { name: "Sections" });
  const tabs = within(bar);
  expect(Array.from(bar.children, (tab) => tab.textContent)).toEqual([
    "Home",
    "Inbox",
    "Assistant",
    "Activity",
    "More",
  ]);
  // Schedules has no tab, so More stays current on it.
  expect(tabs.getByRole("link", { name: "More" }).getAttribute("aria-current")).toBe("page");
  fireEvent.click(tabs.getByRole("link", { name: "Inbox" }));
  expect(navigate).toHaveBeenLastCalledWith("inbox", false, undefined);
  fireEvent.click(tabs.getByRole("button", { name: "Assistant" }));
  expect(await screen.findByRole("complementary", { name: "Assistant" })).toBeDefined();
  cleanup();

  render(<Workspace initial={session} signedOut={vi.fn()} screen="more" navigate={navigate} />);
  const main = within(screen.getByRole("main"));
  expect(main.getAllByRole("link").map((row) => row.textContent)).toEqual([
    "Review",
    "Plans",
    "Projections",
    "Savings",
    "Investments",
    "Loans",
    "Giving",
    "Routines",
    "Schedules",
    "Settings",
  ]);
  // More keeps the sidebar's groups, in the sidebar's order.
  expect(
    Array.from(document.querySelectorAll("main .navlabel"), (label) => label.textContent),
  ).toEqual(["This month", "Planning", "Balances", "Recurring"]);
});
it("returns focus after a dialog and starts j in a screen's own rows", async () => {
  const session = {
    user: { id: "u" },
    csrf_token: "test",
    entities: [{ id: "e", name: "Synthetic Entity", today: "2026-11-10", time_zone: "UTC" }],
  };
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
    String(path).includes("/activity/page")
      ? new Response(JSON.stringify(activityPage(String(path), [entry])))
      : new Response("[]"),
  );
  render(<Workspace initial={session} signedOut={vi.fn()} screen="activity" navigate={vi.fn()} />);
  await screen.findByText("Synthetic lunch");
  const link = within(screen.getByRole("navigation", { name: "Workspace" })).getByRole("link", {
    name: "Activity",
  });
  link.focus();
  fireEvent.keyDown(link, { key: "k", ctrlKey: true });
  expect(document.activeElement?.getAttribute("aria-label")).toBe("Ask or jump");
  fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(link);
  // Activity's rows are a grid with its own keys, so j lands on its current cell.
  fireEvent.keyDown(link, { key: "j" });
  const cell = document.activeElement as HTMLElement;
  expect(cell.closest("[role=grid]")).not.toBeNull();
  expect(cell.closest("[role=row]")?.textContent).toContain("Synthetic lunch");
});
