import { useState } from "react";
import { type BrowserSession, loadResource } from "../../lib/api";
import { Head, Tip } from "../../ui";
import { type ScreenProps, useLoad } from "../workspace/shared";
import "./settings.css";
import { AgentSettings } from "../agent/AgentSettings";
import { ApiKeys } from "./ApiKeys";
import { TransactionProviderSettings } from "./TransactionProviderSettings";

interface EntitySettings {
  id: string;
  name: string;
  time_zone: string;
  /** Projection assumption: an annual percent, 6.00 for a new Entity. */
  default_return_percent: string;
  revision: number;
  today?: string;
}
const PERCENT = /^-?\d{1,2}(\.\d{1,2})?$/;
export interface SettingsProps extends ScreenProps {
  credentials: (signIn?: boolean) => Promise<BrowserSession>;
  saved: () => void;
  openInbox?: () => void;
}
// Suggestions only; the server remains the time zone validator.
const zones =
  (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];

export function Settings(p: SettingsProps) {
  const [attempt, setAttempt] = useState(0);
  const [form, setForm] = useState<EntitySettings | null>(null);
  const path = `/api/entities/${p.entity.id}/settings`;
  const state = useLoad(
    () => loadResource<EntitySettings>(path, () => false),
    [path, p.refresh, attempt],
  );
  const current = form || (state.kind === "ready" ? state.data : null);
  if (p.concealed) return null;
  return (
    <section className="screen set-screen" aria-label="Settings">
      <Head title="Settings" />
      {state.kind === "loading" && !current && (
        <output className="card pad sk-card" aria-label="Loading settings">
          <div className="sk set-sk" />
          <div className="sk set-sk" />
        </output>
      )}
      {"error" in state && (
        <div className="banner bad" role="alert">
          <span>Could not load settings. {state.error.message}</span>
          <button type="button" className="btn sm" onClick={() => setAttempt((x) => x + 1)}>
            Try loading again
          </button>
        </div>
      )}
      {current && (
        <section aria-labelledby="entity-settings-heading">
          <h2 className="h2" id="entity-settings-heading">
            Workspace
          </h2>
          <form
            className="card"
            onKeyDown={(event) => {
              // Ctrl/⌘+S is the same explicit save, scoped to this form only.
              if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
                event.preventDefault();
                if (!p.busy) event.currentTarget.requestSubmit();
              }
            }}
            onSubmit={(event) => {
              event.preventDefault();
              p.save<EntitySettings>(
                {
                  method: "PUT",
                  path,
                  body: {
                    name: current.name,
                    time_zone: current.time_zone,
                    default_return_percent: current.default_return_percent.trim(),
                    expected_revision: current.revision,
                  },
                },
                (result) => {
                  setForm(result);
                  p.saved();
                },
              );
            }}
          >
            <fieldset className="set-fields" disabled={p.busy}>
              <div className="setting">
                <div>
                  <label htmlFor="entity-name">Entity name</label>
                </div>
                <input
                  id="entity-name"
                  className="input"
                  required
                  maxLength={120}
                  value={current.name}
                  onChange={(event) => {
                    setForm({ ...current, name: event.target.value });
                    p.dirty(true);
                  }}
                />
              </div>
              <div className="setting">
                <div>
                  <label htmlFor="entity-time-zone">Time zone</label>
                  <small id="time-zone-help">IANA name, such as UTC.</small>
                </div>
                <input
                  id="entity-time-zone"
                  className="input"
                  required
                  list="time-zone-options"
                  spellCheck={false}
                  autoComplete="off"
                  value={current.time_zone}
                  onChange={(event) => {
                    setForm({ ...current, time_zone: event.target.value });
                    p.dirty(true);
                  }}
                  placeholder="America/Los_Angeles"
                  aria-describedby="time-zone-help"
                />
                <datalist id="time-zone-options">
                  {zones.map((zone) => (
                    <option key={zone} value={zone} />
                  ))}
                </datalist>
              </div>
              <div className="setting">
                <div>
                  <label htmlFor="entity-default-return">Default expected return (% a year)</label>
                  <small id="default-return-help">
                    For investments without their own.
                    <Tip label="About the default return">
                      6 is a cautious figure for a diversified stock and bond portfolio.
                    </Tip>
                  </small>
                </div>
                <input
                  id="entity-default-return"
                  className="input set-percent"
                  required
                  inputMode="decimal"
                  aria-describedby="default-return-help"
                  aria-invalid={!PERCENT.test(current.default_return_percent.trim())}
                  value={current.default_return_percent}
                  onChange={(event) => {
                    setForm({ ...current, default_return_percent: event.target.value });
                    p.dirty(true);
                  }}
                />
              </div>
              <div className="setting">
                <div aria-hidden="true">
                  <small>
                    <kbd className="kbd">Ctrl</kbd>
                    {" + "}
                    <kbd className="kbd">S</kbd> saves
                  </small>
                </div>
                <div className="set-actions">
                  <button
                    type="button"
                    className="btn quiet"
                    onClick={() => {
                      if (p.guard()) {
                        setForm(null);
                        p.dirty(false);
                        setAttempt((x) => x + 1);
                      }
                    }}
                  >
                    Reload current settings
                  </button>
                  <button type="submit" className="btn pri" aria-keyshortcuts="Control+S Meta+S">
                    Save settings
                  </button>
                </div>
              </div>
            </fieldset>
          </form>
        </section>
      )}
      <AgentSettings {...p} />
      <TransactionProviderSettings {...p} />
      <ApiKeys credentials={p.credentials} disabled={p.busy} />
    </section>
  );
}
