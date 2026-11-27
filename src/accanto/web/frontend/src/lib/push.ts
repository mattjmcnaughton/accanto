/**
 * Notifications on this browser (TDD 20): permission, the push subscription and its Device.
 * The browser APIs sit behind PushPlatform so the rules can be tested without a browser.
 */
import { type BrowserSession, fetchJson } from "./api";

export interface Preferences {
  hour: number;
  routines_due: boolean;
  scheduled_entries: boolean;
  transactions_waiting: boolean;
  /** Spending alerts (TDD 23): each threshold once a month, from the hour on. */
  spending_alerts: boolean;
}

export interface PushPlatform {
  supported(): boolean;
  /** An iPhone or iPad Safari tab: push needs the Home Screen app there. */
  needsHomeScreen(): boolean;
  permission(): NotificationPermission;
  requestPermission(): Promise<NotificationPermission>;
  subscribe(publicKey: string): Promise<PushSubscriptionJSON>;
  getSubscription(): Promise<PushSubscriptionJSON | null>;
  unsubscribe(): Promise<void>;
}

export type DeviceState = "unsupported" | "needs_home_screen" | "blocked" | "off" | "on";

export function pushState(input: {
  supported: boolean;
  needsHomeScreen: boolean;
  permission: NotificationPermission;
  hasDevice: boolean;
}): DeviceState {
  if (input.needsHomeScreen) return "needs_home_screen";
  if (!input.supported) return "unsupported";
  if (input.permission === "denied") return "blocked";
  return input.permission === "granted" && input.hasDevice ? "on" : "off";
}

async function registration(): Promise<ServiceWorkerRegistration> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Service worker unavailable")), 10000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function keyBytes(key: string): Uint8Array<ArrayBuffer> {
  const binary = atob(key.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export const browserPush: PushPlatform = {
  supported: () =>
    "serviceWorker" in navigator && "PushManager" in window && "Notification" in window,
  needsHomeScreen: () => {
    const apple = /iPhone|iPad|iPod/.test(navigator.userAgent);
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      (navigator as { standalone?: boolean }).standalone === true;
    return apple && !standalone;
  },
  permission: () => ("Notification" in window ? Notification.permission : "denied"),
  requestPermission: () => Notification.requestPermission(),
  async subscribe(publicKey) {
    const reg = await registration();
    const subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(publicKey),
    });
    return subscription.toJSON();
  },
  async getSubscription() {
    return (await (await registration()).pushManager.getSubscription())?.toJSON() ?? null;
  },
  async unsubscribe() {
    const reg = await navigator.serviceWorker.getRegistration();
    await (await reg?.pushManager.getSubscription())?.unsubscribe();
  },
};

/** Convenience only: the server owns which Devices exist. */
const deviceKey = (user: string) => `accanto:push-device:${user}`;
export const storedDevice = (user: string) => {
  try {
    return localStorage.getItem(deviceKey(user));
  } catch {
    return null;
  }
};
function storeDevice(user: string, id: string | null) {
  try {
    if (id) localStorage.setItem(deviceKey(user), id);
    else localStorage.removeItem(deviceKey(user));
  } catch {
    // Storage is optional.
  }
}

const write = (session: BrowserSession, method: string, body?: unknown) => ({
  method,
  headers: { "Content-Type": "application/json", "X-CSRF-Token": session.csrf_token },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

async function register(session: BrowserSession, subscription: PushSubscriptionJSON) {
  const device = await fetchJson<{ id: string }>(
    "/api/notifications/devices",
    write(session, "POST", { endpoint: subscription.endpoint, keys: subscription.keys }),
  );
  storeDevice(session.user.id, device.id);
  return device.id;
}

/** After permission was granted from a tap: subscribe and register this browser's Device. */
export async function enable(
  session: BrowserSession,
  publicKey: string,
  platform: PushPlatform = browserPush,
  permission: NotificationPermission = platform.permission(),
): Promise<NotificationPermission> {
  if (permission !== "granted") return permission;
  const subscription = (await platform.getSubscription()) ?? (await platform.subscribe(publicKey));
  await register(session, subscription);
  return permission;
}

/**
 * iOS can drop a subscription without telling the page. On each start of the app, when this
 * browser had a Device, subscribe again if needed and register it (the server upserts).
 */
export async function refresh(
  session: BrowserSession,
  platform: PushPlatform = browserPush,
): Promise<void> {
  if (!storedDevice(session.user.id) || !platform.supported()) return;
  if (platform.permission() !== "granted") return;
  const config = await fetchJson<{ public_key: string }>("/api/notifications/config");
  const subscription =
    (await platform.getSubscription()) ?? (await platform.subscribe(config.public_key));
  await register(session, subscription);
}

/** Turning off and signing out: each step is best effort and none blocks the other. */
export async function disable(
  session: BrowserSession,
  platform: PushPlatform = browserPush,
): Promise<void> {
  const id = storedDevice(session.user.id);
  storeDevice(session.user.id, null);
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, 3000));
  await Promise.all(
    [
      id
        ? fetchJson(`/api/notifications/devices/${id}`, write(session, "DELETE"))
        : Promise.resolve(),
      platform.supported() ? platform.unsubscribe() : Promise.resolve(),
    ].map((step) => Promise.race([step.catch(() => {}), timeout])),
  );
}

export const sendTest = (session: BrowserSession, id: string) =>
  fetchJson<{ outcome: string }>(`/api/notifications/devices/${id}/test`, write(session, "POST"));

export const savePreferences = (session: BrowserSession, preferences: Preferences) =>
  fetchJson<Preferences>("/api/notifications/preferences", write(session, "PUT", preferences));
