import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ProductionHome } from "../../routes/__root";
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
  await waitFor(() => expect(navigate).toHaveBeenCalledWith("plans", true));
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
  const dialog = screen.getByRole("dialog", { name: "Search or jump" });
  expect(within(dialog).getByRole("button", { name: "Retry save" })).toBeDefined();
  expect(within(main).queryByRole("alert")).toBeNull();
  fireEvent(dialog, new Event("cancel", { cancelable: true }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(within(main).getByRole("button", { name: "Retry save" })).toBeDefined();
});
