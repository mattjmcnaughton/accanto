import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Settings } from "./Settings";
const entity = { id: "entity", name: "Synthetic", time_zone: "UTC", today: "2026-11-01" };
const session = { user: { id: "owner" }, entities: [entity], csrf_token: "synthetic" };
const json = (data: unknown) => new Response(JSON.stringify(data));
const props = () => ({
  entity,
  concealed: false,
  busy: false,
  refresh: 0,
  guard: () => true,
  dirty: vi.fn(),
  save: vi.fn(),
  credentials: vi.fn().mockResolvedValue(session),
  saved: vi.fn(),
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("submits loaded revision and preserves attempted settings through refreshed records", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (path) =>
    json(String(path).endsWith("/keys") ? [] : { ...entity, revision: 4 }),
  );
  const p = props();
  const view = render(<Settings {...p} />);
  fireEvent.change(await screen.findByLabelText("Entity name"), { target: { value: "Changed" } });
  fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
  expect(p.save).toHaveBeenCalledWith(
    expect.objectContaining({ body: { name: "Changed", time_zone: "UTC", expected_revision: 4 } }),
    expect.any(Function),
  );
  view.rerender(<Settings {...p} refresh={1} />);
  await waitFor(() => expect(screen.getByLabelText("Entity name")).toHaveValue("Changed"));
});
it("clears a one-time secret on dismiss and navigation", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (path, init) =>
    json(
      init?.method === "POST"
        ? { id: "key", name: "Script", key: "deliberately-synthetic-secret" }
        : String(path).endsWith("/keys")
          ? []
          : { ...entity, revision: 1 },
    ),
  );
  const view = render(<Settings {...props()} />);
  fireEvent.change(await screen.findByLabelText("Key name"), { target: { value: "Script" } });
  fireEvent.click(screen.getByRole("button", { name: "Create API key" }));
  const secret = await screen.findByLabelText("New API key (shown once)");
  expect(secret).toHaveAttribute("type", "password");
  fireEvent.click(screen.getByRole("button", { name: "Show key" }));
  expect(secret).toHaveAttribute("type", "text");
  fireEvent.click(screen.getByRole("button", { name: "Dismiss secret" }));
  expect(screen.queryByLabelText("New API key (shown once)")).not.toBeInTheDocument();
  view.unmount();
  render(<Settings {...props()} />);
  expect(screen.queryByLabelText("New API key (shown once)")).not.toBeInTheDocument();
});
it("saves settings with Ctrl+S only from the Entity form", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (path) =>
    json(String(path).endsWith("/keys") ? [] : { ...entity, revision: 2 }),
  );
  const p = props();
  render(<Settings {...p} />);
  fireEvent.keyDown(await screen.findByLabelText("Key name"), { key: "s", ctrlKey: true });
  expect(p.save).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByLabelText("Time zone"), { key: "s", metaKey: true });
  expect(p.save).toHaveBeenCalledOnce();
});
it("revokes a key only after confirmation; Escape cancels and restores focus", async () => {
  const deletes: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (path, init) => {
    if (init?.method === "DELETE") {
      deletes.push(String(path));
      return json({});
    }
    return json(
      String(path).endsWith("/keys")
        ? [
            { id: "k1", name: "Nightly", created_at: "2026-10-01T12:00:00Z", revoked_at: null },
            { id: "k2", name: "Backup", created_at: "2026-10-02T12:00:00Z", revoked_at: null },
          ]
        : { ...entity, revision: 1 },
    );
  });
  render(<Settings {...props()} />);
  const revoke = await screen.findByRole("button", { name: "Revoke Backup" });
  fireEvent.click(revoke);
  const cancel = screen.getByRole("button", { name: "Cancel" });
  await waitFor(() => expect(cancel).toHaveFocus());
  fireEvent.keyDown(cancel, { key: "Escape" });
  expect(screen.queryByRole("button", { name: "Revoke key" })).toBeNull();
  await waitFor(() => expect(screen.getByRole("button", { name: "Revoke Backup" })).toHaveFocus());
  expect(deletes).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: "Revoke Backup" }));
  fireEvent.click(screen.getByRole("button", { name: "Revoke key" }));
  await screen.findByText("API key revoked.");
  expect(deletes).toEqual(["/api/keys/k2"]);
});
it("keeps a new shown-once secret when a revoke is started and cancelled", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (path, init) =>
    json(
      init?.method === "POST"
        ? { id: "key", name: "Script", key: "deliberately-synthetic-secret" }
        : String(path).endsWith("/keys")
          ? [{ id: "k1", name: "Nightly", created_at: "2026-10-01T12:00:00Z", revoked_at: null }]
          : { ...entity, revision: 1 },
    ),
  );
  render(<Settings {...props()} />);
  fireEvent.change(await screen.findByLabelText("Key name"), { target: { value: "Script" } });
  fireEvent.click(screen.getByRole("button", { name: "Create API key" }));
  await screen.findByLabelText("New API key (shown once)");
  fireEvent.click(await screen.findByRole("button", { name: "Revoke Nightly" }));
  expect(screen.getByLabelText("New API key (shown once)")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByLabelText("New API key (shown once)")).toBeInTheDocument();
});
it("does not automatically retry uncertain issuance", async () => {
  let creates = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (path, init) => {
    if (init?.method === "POST") {
      creates++;
      throw new TypeError("network");
    }
    return json(String(path).endsWith("/keys") ? [] : { ...entity, revision: 1 });
  });
  render(<Settings {...props()} />);
  fireEvent.change(await screen.findByLabelText("Key name"), { target: { value: "Script" } });
  fireEvent.click(screen.getByRole("button", { name: "Create API key" }));
  expect(await screen.findByText(/Creation was not confirmed/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Reload key list" }));
  await waitFor(() => expect(creates).toBe(1));
});
it("ignores a secret response after the screen is concealed", async () => {
  let resolve!: (value: Response) => void;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (path, init) =>
    init?.method === "POST"
      ? new Promise<Response>((r) => {
          resolve = r;
        })
      : json(String(path).endsWith("/keys") ? [] : { ...entity, revision: 1 }),
  );
  const p = props();
  const view = render(<Settings {...p} />);
  fireEvent.change(await screen.findByLabelText("Key name"), { target: { value: "Script" } });
  fireEvent.click(screen.getByRole("button", { name: "Create API key" }));
  await waitFor(() => expect(resolve).toBeDefined());
  view.rerender(<Settings {...p} concealed />);
  resolve(json({ id: "key", name: "Script", key: "deliberately-synthetic-secret" }));
  view.rerender(<Settings {...p} />);
  await waitFor(() =>
    expect(screen.queryByLabelText("New API key (shown once)")).not.toBeInTheDocument(),
  );
});

it("refreshes Entity defaults after confirmed settings and uses them for new activity", async () => {
  const { Workspace } = await import("../workspace/Workspace");
  const nextEntity = {
    ...entity,
    name: "Renamed",
    time_zone: "Pacific/Kiritimati",
    today: "2026-11-02",
  };
  vi.spyOn(globalThis, "fetch").mockImplementation(async (path, init) => {
    if (String(path) === "/api/auth/session") return json({ ...session, entities: [nextEntity] });
    if (String(path).endsWith("/settings"))
      return json({ ...nextEntity, revision: init?.method === "PUT" ? 2 : 1 });
    return json([]);
  });
  render(<Workspace initial={session} signedOut={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  fireEvent.click(await screen.findByRole("button", { name: "Save settings" }));
  await waitFor(() => expect(screen.getByText("Renamed")).toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "Activity" }));
  fireEvent.click(await screen.findByRole("button", { name: "Record activity" }));
  expect(screen.getByLabelText("Financial date")).toHaveValue("2026-11-02");
});
it("conceals settings and prevents key issuance when fresh credentials belong to another User", async () => {
  const { Workspace } = await import("../workspace/Workspace");
  let writes = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (path, init) => {
    if (init?.method === "POST") writes++;
    if (String(path) === "/api/auth/session") return json({ ...session, user: { id: "other" } });
    if (String(path).endsWith("/settings")) return json({ ...entity, revision: 1 });
    return json([]);
  });
  render(<Workspace initial={session} signedOut={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  fireEvent.change(await screen.findByLabelText("Key name"), { target: { value: "Script" } });
  fireEvent.click(screen.getByRole("button", { name: "Create API key" }));
  await screen.findByText("Account changed");
  expect(screen.queryByLabelText("Entity name")).not.toBeInTheDocument();
  expect(writes).toBe(0);
});
it("blocks stale date defaults until metadata refresh succeeds", async () => {
  const { Workspace } = await import("../workspace/Workspace");
  let fail = true;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (path) => {
    if (String(path) === "/api/auth/session") {
      if (fail) throw new TypeError("network");
      return json(session);
    }
    if (String(path).endsWith("/settings")) return json({ ...entity, revision: 1 });
    return json([]);
  });
  render(<Workspace initial={session} signedOut={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  fireEvent.click(await screen.findByRole("button", { name: "Save settings" }));
  await screen.findByRole("button", { name: "Refresh Entity defaults" });
  fireEvent.click(screen.getByRole("button", { name: "Activity" }));
  expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
  fail = false;
  fireEvent.click(screen.getByRole("button", { name: "Refresh Entity defaults" }));
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Refresh Entity defaults" })).toBeNull(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Activity" }));
  expect(await screen.findByRole("heading", { name: "Activity" })).toBeInTheDocument();
});
it("reauthenticates after a confirmed save when refreshing defaults encounters session expiry", async () => {
  const { Workspace } = await import("../workspace/Workspace");
  const recovery = await import("../../lib/recoverableWrite");
  vi.spyOn(recovery, "reauthenticate").mockResolvedValue({
    kind: "ready",
    session: { ...session, entities: [{ ...entity, today: "2026-11-03" }] },
  });
  vi.spyOn(globalThis, "fetch").mockImplementation(async (path) => {
    if (String(path) === "/api/auth/session") return new Response("{}", { status: 401 });
    if (String(path).endsWith("/settings")) return json({ ...entity, revision: 1 });
    return json([]);
  });
  render(<Workspace initial={session} signedOut={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  fireEvent.click(await screen.findByRole("button", { name: "Save settings" }));
  fireEvent.click(await screen.findByRole("button", { name: "Sign in and refresh defaults" }));
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Refresh Entity defaults" })).toBeNull(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Activity" }));
  fireEvent.click(await screen.findByRole("button", { name: "Record activity" }));
  expect(screen.getByLabelText("Financial date")).toHaveValue("2026-11-03");
});
it("does not let a delayed key credential read overwrite refreshed Entity defaults", async () => {
  const { Workspace } = await import("../workspace/Workspace");
  let finish!: (response: Response) => void;
  let reads = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (path, init) => {
    if (String(path) === "/api/auth/session") {
      reads++;
      if (reads === 1)
        return new Promise<Response>((resolve) => {
          finish = resolve;
        });
      return json({ ...session, entities: [{ ...entity, today: "2026-11-04" }] });
    }
    if (String(path).endsWith("/settings")) return json({ ...entity, revision: 1 });
    if (init?.method === "POST")
      return json({ id: "key", name: "Script", key: "deliberately-synthetic-secret" });
    return json([]);
  });
  render(<Workspace initial={session} signedOut={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  fireEvent.change(await screen.findByLabelText("Key name"), { target: { value: "Script" } });
  fireEvent.click(screen.getByRole("button", { name: "Create API key" }));
  await waitFor(() => expect(finish).toBeDefined());
  fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
  await waitFor(() => expect(reads).toBe(2));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Save settings" })).not.toBeDisabled(),
  );
  finish(json(session));
  await screen.findByLabelText("New API key (shown once)");
  fireEvent.click(screen.getByRole("button", { name: "Activity" }));
  fireEvent.click(await screen.findByRole("button", { name: "Record activity" }));
  expect(screen.getByLabelText("Financial date")).toHaveValue("2026-11-04");
});
