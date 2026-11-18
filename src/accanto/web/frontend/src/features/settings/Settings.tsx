import { useState } from "react";
import { type BrowserSession, loadResource } from "../../lib/api";
import { LoadMessage, type ScreenProps, useLoad } from "../workspace/shared";
import "../workspace/worksheet-ui.css";
import "./settings.css";
import { ApiKeys } from "./ApiKeys";
import { Help } from "./Help";
interface EntitySettings {
  id: string;
  name: string;
  time_zone: string;
  revision: number;
  today?: string;
}
export interface SettingsProps extends ScreenProps {
  credentials: (signIn?: boolean) => Promise<BrowserSession>;
  saved: () => void;
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
    <section className="data-workspace settings-screen">
      <header className="data-toolbar">
        <h2>Settings</h2>
      </header>
      <div className="settings-body">
        <LoadMessage state={state} retry={() => setAttempt((x) => x + 1)} />
        {current && (
          <form
            className="settings-section"
            aria-labelledby="entity-settings-heading"
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
            <fieldset disabled={p.busy}>
              <legend id="entity-settings-heading">Entity</legend>
              <div className="settings-grid">
                <label htmlFor="entity-name">Entity name</label>
                <input
                  id="entity-name"
                  required
                  maxLength={120}
                  value={current.name}
                  onChange={(event) => {
                    setForm({ ...current, name: event.target.value });
                    p.dirty(true);
                  }}
                />
                <label htmlFor="entity-time-zone">Time zone</label>
                <div className="settings-field">
                  <input
                    id="entity-time-zone"
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
                  <Help label="About time zone" id="time-zone-help">
                    IANA zone, such as America/Los_Angeles or UTC. Sets today and this month for new
                    entries. Existing financial dates and Reviews do not move.
                  </Help>
                </div>
              </div>
              <div className="settings-actions">
                <button type="submit" className="primary" aria-keyshortcuts="Control+S Meta+S">
                  Save settings
                </button>
                <button
                  type="button"
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
                <span className="muted settings-hint" aria-hidden="true">
                  <kbd>Ctrl</kbd>+<kbd>S</kbd> saves
                </span>
              </div>
            </fieldset>
          </form>
        )}
        <ApiKeys credentials={p.credentials} disabled={p.busy} />
      </div>
    </section>
  );
}
