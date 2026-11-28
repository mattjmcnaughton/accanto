import { useEffect, useRef, useState } from "react";
import { type BrowserSession, loadResource } from "../../lib/api";
import {
  type DeviceState,
  type Preferences,
  type PushPlatform,
  browserPush,
  disable,
  enable,
  pushState,
  sendTest,
  storedDevice,
} from "../../lib/push";
import { type ScreenProps, useLoad } from "../workspace/shared";

const KINDS: Array<[keyof Omit<Preferences, "hour">, string, string]> = [
  ["routines_due", "Routines due", "On the day a routine is due, with its name."],
  [
    "scheduled_entries",
    "Scheduled entries waiting",
    "When an entry schedule puts entries in the inbox that day, with how many.",
  ],
  [
    "transactions_waiting",
    "Transactions waiting",
    "Each day that synced transactions are still waiting in the inbox, with how many.",
  ],
  [
    "spending_alerts",
    "Spending alerts",
    "When a spending alert passes a threshold, with its name and percentage, once a month each. Sent from the hour below on.",
  ],
];
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const hourLabel = (hour: number) =>
  new Date(2026, 0, 1, hour).toLocaleTimeString("en-US", { hour: "numeric" });

const DEVICE_COPY: Record<DeviceState, string> = {
  on: "This device gets notifications.",
  off: "This device does not get notifications yet.",
  blocked:
    "Notifications are blocked for Accanto in this browser. On an iPhone, turn them on in Settings → Notifications → Accanto.",
  needs_home_screen:
    "On an iPhone, notifications need Accanto on the Home Screen: tap Share, then Add to Home Screen, open Accanto from its icon and come back here.",
  unsupported: "This browser cannot get notifications.",
};

export interface NotificationsProps extends ScreenProps {
  userId: string;
  credentials: (signIn?: boolean) => Promise<BrowserSession>;
  platform?: PushPlatform;
}

/**
 * Notifications (TDD 20): this device's state and what to send. Hidden when the server has
 * no push key. Notifications carry counts and routine names only, never amounts or payees.
 */
export function Notifications({ platform = browserPush, ...p }: NotificationsProps) {
  const [attempt, setAttempt] = useState(0);
  const [form, setForm] = useState<Preferences | null>(null);
  const [device, setDevice] = useState(() => storedDevice(p.userId));
  const [permission, setPermission] = useState(() =>
    platform.supported() ? platform.permission() : "default",
  );
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const config = useLoad(
    () => loadResource<{ public_key: string }>("/api/notifications/config", () => false),
    [],
  );
  const preferences = useLoad(
    () => loadResource<Preferences>("/api/notifications/preferences", () => false),
    [p.refresh, attempt],
    { enabled: config.kind === "ready" },
  );
  if (config.kind !== "ready") return null;
  const current = form ?? (preferences.kind === "ready" ? preferences.data : null);
  const state = pushState({
    supported: platform.supported(),
    needsHomeScreen: platform.needsHomeScreen(),
    permission,
    hasDevice: Boolean(device),
  });
  const locked = working || p.busy;
  const change = (next: Partial<Preferences>) => {
    if (!current) return;
    setForm({ ...current, ...next });
    p.dirty(true);
  };

  async function act(run: (session: BrowserSession) => Promise<string>) {
    setWorking(true);
    setMessage("");
    try {
      const text = await run(await p.credentials());
      if (live.current) setMessage(text);
    } catch {
      if (live.current) setMessage("That did not work. Check your connection and try again.");
    } finally {
      if (live.current) {
        setDevice(storedDevice(p.userId));
        setWorking(false);
      }
    }
  }

  return (
    <section aria-labelledby="notifications-heading">
      <h2 className="h2" id="notifications-heading">
        Notifications <span>Counts and names only, never amounts or payees.</span>
      </h2>
      <div className="card">
        <div className="setting">
          <div>
            This device
            <small id="device-state">{DEVICE_COPY[state]}</small>
          </div>
          <div className="set-actions">
            {state === "off" && (
              <button
                type="button"
                className="btn pri"
                disabled={locked}
                onClick={() => {
                  // Asked inside the tap, before any await: iOS refuses it otherwise.
                  const asked =
                    platform.permission() === "default"
                      ? platform.requestPermission()
                      : Promise.resolve(platform.permission());
                  void act(async (session) => {
                    const result = await asked;
                    if (live.current) setPermission(result);
                    if (result !== "granted") return "";
                    await enable(session, config.data.public_key, platform, result);
                    return "Notifications are on for this device.";
                  });
                }}
              >
                Turn on
              </button>
            )}
            {state === "on" && device && (
              <>
                <button
                  type="button"
                  className="btn"
                  disabled={locked}
                  onClick={() =>
                    void act(async (session) => {
                      const { outcome } = await sendTest(session, device);
                      return outcome === "delivered"
                        ? "Test sent. It should arrive in a few seconds."
                        : "The push service did not accept the test. Turn notifications off and on again.";
                    })
                  }
                >
                  Send a test
                </button>
                <button
                  type="button"
                  className="btn quiet"
                  disabled={locked}
                  onClick={() =>
                    void act(async (session) => {
                      await disable(session, platform);
                      return "Notifications are off for this device.";
                    })
                  }
                >
                  Turn off
                </button>
              </>
            )}
          </div>
        </div>
        {message && (
          <div className="setting">
            <output>{message}</output>
          </div>
        )}
      </div>
      {"error" in preferences && (
        <div className="banner bad" role="alert">
          <span>Could not load notification settings. {preferences.error.message}</span>
          <button type="button" className="btn sm" onClick={() => setAttempt((x) => x + 1)}>
            Try loading again
          </button>
        </div>
      )}
      {current && (
        <form
          className="card"
          aria-label="What to send"
          onSubmit={(event) => {
            event.preventDefault();
            p.save<Preferences>(
              { method: "PUT", path: "/api/notifications/preferences", body: current },
              () => {
                setForm(null);
                p.dirty(false);
                setAttempt((x) => x + 1);
              },
            );
          }}
        >
          <fieldset className="set-fields" disabled={p.busy}>
            {KINDS.map(([kind, label, help]) => (
              <div className="setting" key={kind}>
                <div>
                  <label htmlFor={`notify-${kind}`}>{label}</label>
                  <small id={`notify-${kind}-help`}>{help}</small>
                </div>
                <input
                  id={`notify-${kind}`}
                  type="checkbox"
                  aria-describedby={`notify-${kind}-help`}
                  checked={current[kind]}
                  onChange={(event) => change({ [kind]: event.target.checked })}
                />
              </div>
            ))}
            <div className="setting">
              <div>
                <label htmlFor="notify-hour">Send at</label>
                <small id="notify-hour-help">
                  Once a day, in each Entity's time zone. Nothing is sent at other times.
                </small>
              </div>
              <select
                id="notify-hour"
                className="input"
                aria-describedby="notify-hour-help"
                value={current.hour}
                onChange={(event) => change({ hour: Number(event.target.value) })}
              >
                {HOURS.map((hour) => (
                  <option key={hour} value={hour}>
                    {hourLabel(hour)}
                  </option>
                ))}
              </select>
            </div>
            <div className="setting">
              <div>
                <small>These apply to every device where notifications are on.</small>
              </div>
              <div className="set-actions">
                <button type="submit" className="btn pri">
                  Save notification settings
                </button>
              </div>
            </div>
          </fieldset>
        </form>
      )}
    </section>
  );
}
