import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { fetchJson } from "../../lib/api";
import { pathTemplate, reportContext } from "../../lib/bugReport";
import { Workspace } from "../workspace/Workspace";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const session = (report_bug: boolean) => ({
  user: { id: "u" },
  csrf_token: "test",
  report_bug,
  entities: [{ id: "e", name: "Synthetic Entity", today: "2026-11-10", time_zone: "UTC" }],
});

it("keeps identifiers and values out of API paths", () => {
  expect(
    pathTemplate(
      "/api/entities/0b6c1a4e-6f1d-4c55-9f0e-6a1b2c3d4e5f/activity/2026-11?q=Example%20Grocer",
    ),
  ).toBe("/api/entities/:id/activity/2026-11");
  // Anything that is not a lower-case route word, a date or a UUID is a value.
  expect(pathTemplate("/api/payees/Example Grocer/45.10")).toBe("/api/payees/:value/:value");
});

it("carries only the call's shape, never its error message", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
      JSON.stringify({ detail: { code: "stale_revision", message: "Example Grocer $45.10" } }),
      { status: 409 },
    ),
  );
  await expect(fetchJson("/api/entities/e/inbox?search=Example")).rejects.toThrow();
  const context = reportContext("inbox", null);
  expect(context.api[context.api.length - 1]).toMatchObject({
    method: "GET",
    path: "/api/entities/e/inbox",
    status: 409,
    code: "stale_revision",
  });
  expect(JSON.stringify(context)).not.toMatch(/Example|45\.10/);
});

it("appears only for an opted-in User", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("[]"));
  const view = render(<Workspace initial={session(false)} signedOut={vi.fn()} />);
  await screen.findAllByText("Synthetic Entity");
  expect(screen.queryByRole("button", { name: "Report bug" })).toBeNull();
  fireEvent.keyDown(document, { key: ".", ctrlKey: true });
  expect(screen.queryByRole("form", { name: "Report bug" })).toBeNull();
  view.unmount();
  render(<Workspace initial={session(true)} signedOut={vi.fn()} />);
  expect(await screen.findByRole("button", { name: "Report bug" })).toBeTruthy();
});

it("opens with Ctrl+., keeps the note when a save fails and saves it on retry", async () => {
  let fail = true;
  const posts: unknown[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (path, init) => {
    if (path === "/api/auth/session") return new Response(JSON.stringify(session(true)));
    if (path === "/api/bug-reports" && init?.method === "POST") {
      if (fail) return new Response("{}", { status: 503 });
      posts.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ id: "r" }));
    }
    return new Response("[]");
  });
  render(<Workspace initial={session(true)} signedOut={vi.fn()} />);
  await screen.findByRole("button", { name: "Report bug" });
  fireEvent.keyDown(document, { key: ".", metaKey: true });
  const form = await screen.findByRole("form", { name: "Report bug" });
  const note = within(form).getByLabelText("What happened, or what should change?");
  fireEvent.change(note, { target: { value: "Pairing missed a match" } });
  fireEvent.click(within(form).getByRole("button", { name: "Idea" }));
  fireEvent.keyDown(note, { key: "Enter", ctrlKey: true });
  expect((await within(form).findByRole("alert")).textContent).toMatch(/not saved/);
  expect((note as HTMLTextAreaElement).value).toBe("Pairing missed a match");

  fail = false;
  fireEvent.click(within(form).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.queryByRole("form", { name: "Report bug" })).toBeNull());
  expect(posts).toEqual([
    expect.objectContaining({
      kind: "idea",
      note: "Pairing missed a match",
      context: expect.objectContaining({ screen: "home", month: "2026-11", build: "dev" }),
    }),
  ]);
  expect(screen.getByText("Report saved.")).toBeTruthy();
});
