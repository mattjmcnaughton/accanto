import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ProductionHome } from "../../routes/index";
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
