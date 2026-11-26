import { useState } from "react";
import { loadResource } from "../../lib/api";
import {
  AGENT_MODES,
  type AgentMode,
  type AgentSettings as Settings,
  agent,
} from "../../lib/agentStream";
import { type ScreenProps, useLoad } from "../workspace/shared";

/**
 * Opt-in, Agent mode and AGENT.md for one Entity. Only a browser session can change these;
 * the assistant and MCP clients cannot reach them (PRD AG-05, AG-07).
 */
export function AgentSettings(p: ScreenProps) {
  const path = agent.settingsPath(p.entity.id);
  const [attempt, setAttempt] = useState(0);
  const [form, setForm] = useState<Settings | null>(null);
  const state = useLoad(
    () => loadResource<Settings>(path, () => false),
    [path, p.refresh, attempt],
  );
  const current = form ?? (state.kind === "ready" ? state.data : null);
  const change = (next: Partial<Settings>) => {
    if (!current) return;
    setForm({ ...current, ...next });
    p.dirty(true);
  };
  return (
    <section aria-labelledby="agent-settings-heading">
      <h2 className="h2" id="agent-settings-heading">
        Assistant
      </h2>
      {"error" in state && (
        <div className="banner bad" role="alert">
          <span>Could not load assistant settings. {state.error.message}</span>
          <button type="button" className="btn sm" onClick={() => setAttempt((x) => x + 1)}>
            Try loading again
          </button>
        </div>
      )}
      {current && (
        <form
          className="card"
          onSubmit={(event) => {
            event.preventDefault();
            p.save<Settings>(
              {
                method: "PUT",
                path,
                body: {
                  enabled: current.enabled,
                  mode: current.mode,
                  instructions: current.instructions,
                  expected_revision: current.revision,
                },
              },
              () => {
                setForm(null);
                p.dirty(false);
                setAttempt((x) => x + 1);
              },
            );
          }}
        >
          <fieldset className="set-fields" disabled={p.busy}>
            <div className="setting">
              <div>
                <label htmlFor="agent-enabled">Use the assistant for this Entity</label>
                <small id="agent-disclosure">
                  Model: {current.provider}. Each message sends the model your message, any images
                  you attach, and what the assistant's tools read from this Entity, including notes,
                  payees and names. API keys, source tokens, audit history and other Entities are
                  never sent. Conversations are kept for {current.retention_days} days after the
                  last message or until you clear them; images are never stored. Up to{" "}
                  {current.daily_message_cap} messages a day.
                </small>
              </div>
              <input
                id="agent-enabled"
                type="checkbox"
                aria-describedby="agent-disclosure"
                checked={current.enabled}
                onChange={(event) => change({ enabled: event.target.checked })}
              />
            </div>
            <fieldset className="setting">
              <div>
                <legend>Agent mode</legend>
                <small>
                  Applies to the assistant and to MCP clients using your API keys. Applying or
                  dismissing a pending change yourself works in every mode.
                </small>
              </div>
              <div>
                {(
                  Object.entries(AGENT_MODES) as Array<[AgentMode, { label: string; help: string }]>
                ).map(([mode, { label, help }]) => (
                  <label key={mode} className="agent-radio">
                    <input
                      type="radio"
                      name="agent-mode"
                      value={mode}
                      checked={current.mode === mode}
                      onChange={() => change({ mode })}
                    />
                    <span>
                      <b>{label}</b> <small>{help}</small>
                    </span>
                  </label>
                ))}
                <small>
                  Deleting a savings movement or a balance observation always waits for you.
                </small>
              </div>
            </fieldset>
            <div className="setting">
              <div>
                <label htmlFor="agent-md">AGENT.md</label>
                <small id="agent-md-help">
                  Standing instructions for the assistant, such as “Sample Warehouse Club is
                  groceries unless over $300”. They cannot change what it may do, the mode, or the
                  Entity.
                </small>
              </div>
              <textarea
                id="agent-md"
                className="input"
                rows={6}
                maxLength={20000}
                aria-describedby="agent-md-help"
                value={current.instructions}
                onChange={(event) => change({ instructions: event.target.value })}
              />
            </div>
            <div className="setting">
              <div />
              <div className="set-actions">
                <button type="submit" className="btn pri">
                  Save assistant settings
                </button>
              </div>
            </div>
          </fieldset>
        </form>
      )}
    </section>
  );
}
