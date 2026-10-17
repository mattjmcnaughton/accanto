import { useState } from "react";
import { type BrowserSession, loadResource } from "../../lib/api";
import { LoadMessage, type ScreenProps, useLoad } from "../workspace/shared";
import { ApiKeys } from "./ApiKeys";
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
    <section className="workspace-section">
      <h2>Settings</h2>
      <LoadMessage state={state} retry={() => setAttempt((x) => x + 1)} />
      {current && (
        <form
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
            <legend>Entity settings</legend>
            <label>
              Entity name
              <input
                required
                maxLength={120}
                value={current.name}
                onChange={(event) => {
                  setForm({ ...current, name: event.target.value });
                  p.dirty(true);
                }}
              />
            </label>
            <label>
              Time zone
              <input
                required
                value={current.time_zone}
                onChange={(event) => {
                  setForm({ ...current, time_zone: event.target.value });
                  p.dirty(true);
                }}
                placeholder="America/Los_Angeles"
              />
            </label>
            <p>
              Use an IANA time zone, such as America/Los_Angeles or UTC. New date defaults follow
              this zone. Existing financial dates and Reviews stay unchanged.
            </p>
            <button type="submit">Save settings</button>
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
          </fieldset>
        </form>
      )}
      <ApiKeys credentials={p.credentials} disabled={p.busy} />
    </section>
  );
}
