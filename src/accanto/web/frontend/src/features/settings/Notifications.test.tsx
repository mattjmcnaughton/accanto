import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { type PushPlatform, pushState } from "../../lib/push";
import { Notifications } from "./Notifications";

const entity = { id: "entity", name: "Synthetic", time_zone: "UTC", today: "2026-11-28" };
const session = { user: { id: "owner" }, entities: [entity], csrf_token: "synthetic-csrf" };
const defaults = {
  hour: 9,
  routines_due: true,
  scheduled_entries: true,
  transactions_waiting: false,
};
const subscription = {
  endpoint: "https://web.push.apple.com/synthetic",
  keys: { p256dh: "synthetic-p256dh", auth: "synthetic-auth" },
};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

function platform(over: Partial<PushPlatform> = {}): PushPlatform {
  return {
    supported: () => true,
    needsHomeScreen: () => false,
    permission: () => "default",
    requestPermission: vi.fn(async () => "granted" as const),
    subscribe: vi.fn(async () => subscription),
    getSubscription: vi.fn(async () => null),
    unsubscribe: vi.fn(async () => {}),
    ...over,
  };
}
const props = () => ({
  entity,
  concealed: false,
  busy: false,
  refresh: 0,
  guard: () => true,
  dirty: vi.fn(),
  save: vi.fn(),
  credentials: vi.fn().mockResolvedValue(session),
  userId: "owner",
});

function serve(configured = true) {
  const calls: Array<{ path: string; method: string; body?: string }> = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (path, init) => {
    const call = { path: String(path), method: init?.method ?? "GET", body: init?.body as string };
    calls.push(call);
    if (call.path === "/api/notifications/config")
      return configured ? json({ public_key: "AQID" }) : json({}, 404);
    if (call.path === "/api/notifications/preferences") return json(defaults);
    if (call.path === "/api/notifications/devices") return json({ id: "device-1" });
    return json({}, 404);
  });
  return calls;
}

// This jsdom may have no localStorage; a fresh store keeps each test's Device to itself.
beforeEach(() => {
  const stored = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => stored.get(k) ?? null,
      setItem: (k: string, v: string) => void stored.set(k, String(v)),
      removeItem: (k: string) => void stored.delete(k),
      clear: () => stored.clear(),
    },
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("derives this device's state, Home Screen first on an iPhone tab", () => {
  const base = { supported: true, needsHomeScreen: false, hasDevice: false };
  expect(
    pushState({ ...base, needsHomeScreen: true, supported: false, permission: "default" }),
  ).toBe("needs_home_screen");
  expect(pushState({ ...base, supported: false, permission: "default" })).toBe("unsupported");
  expect(pushState({ ...base, permission: "denied", hasDevice: true })).toBe("blocked");
  expect(pushState({ ...base, permission: "granted" })).toBe("off");
  expect(pushState({ ...base, permission: "granted", hasDevice: true })).toBe("on");
});

it("hides everything when the server has no push key", async () => {
  const calls = serve(false);
  const view = render(<Notifications {...props()} platform={platform()} />);
  await waitFor(() => expect(calls.some((c) => c.path.endsWith("/config"))).toBe(true));
  expect(view.container).toBeEmptyDOMElement();
  expect(calls.some((c) => c.path.endsWith("/preferences"))).toBe(false);
});

it("turns on from a tap: permission, subscription, then this browser's Device", async () => {
  const calls = serve();
  const push = platform();
  render(<Notifications {...props()} platform={push} />);
  fireEvent.click(await screen.findByRole("button", { name: "Turn on" }));
  expect(push.requestPermission).toHaveBeenCalledOnce();
  await screen.findByText("Notifications are on for this device.");
  expect(push.subscribe).toHaveBeenCalledWith("AQID");
  const device = calls.find((c) => c.path === "/api/notifications/devices");
  expect(JSON.parse(device?.body ?? "{}")).toEqual(subscription);
  expect(localStorage.getItem("accanto:push-device:owner")).toBe("device-1");
  expect(screen.getByRole("button", { name: "Send a test" })).toBeEnabled();
});

it("refused permission registers nothing", async () => {
  const calls = serve();
  const push = platform({ requestPermission: vi.fn(async () => "denied" as const) });
  render(<Notifications {...props()} platform={push} />);
  fireEvent.click(await screen.findByRole("button", { name: "Turn on" }));
  await waitFor(() => expect(push.requestPermission).toHaveBeenCalled());
  await screen.findByText(/blocked for Accanto/);
  expect(push.subscribe).not.toHaveBeenCalled();
  expect(calls.some((c) => c.path === "/api/notifications/devices")).toBe(false);
});

it("shows the quiet defaults and saves a changed choice through the workspace save", async () => {
  serve();
  const p = props();
  render(<Notifications {...p} platform={platform()} />);
  expect(await screen.findByLabelText("Routines due")).toBeChecked();
  expect(screen.getByLabelText("Scheduled entries waiting")).toBeChecked();
  expect(screen.getByLabelText("Transactions waiting")).not.toBeChecked();
  expect(screen.getByLabelText("Send at")).toHaveDisplayValue("9 AM");
  fireEvent.click(screen.getByLabelText("Transactions waiting"));
  fireEvent.change(screen.getByLabelText("Send at"), { target: { value: "8" } });
  fireEvent.click(screen.getByRole("button", { name: "Save notification settings" }));
  expect(p.save).toHaveBeenCalledWith(
    {
      method: "PUT",
      path: "/api/notifications/preferences",
      body: { ...defaults, transactions_waiting: true, hour: 8 },
    },
    expect.any(Function),
  );
});

it("tells an iPhone Safari tab to add Accanto to the Home Screen", async () => {
  serve();
  render(<Notifications {...props()} platform={platform({ needsHomeScreen: () => true })} />);
  await screen.findByText(/Add to Home Screen/);
  expect(screen.queryByRole("button", { name: "Turn on" })).toBeNull();
});
