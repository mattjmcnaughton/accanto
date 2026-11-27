import { useState } from "react";
import { type BrowserSession, loadResource } from "../../lib/api";
import {
  PROVIDERS,
  type ProviderKind,
  type TransactionProvider,
  browserCall,
  inbox,
} from "../../lib/inbox";
import { Tip } from "../../ui";
import { type ScreenProps, useLoad } from "../workspace/shared";

/**
 * Where imported transactions come from. The token is posted once, stored encrypted and never
 * shown again; the assistant and MCP clients cannot read or change it (PRD AG-02, AG-05).
 */
export function TransactionProviderSettings(
  p: ScreenProps & {
    credentials: (signIn?: boolean) => Promise<BrowserSession>;
    openInbox?: () => void;
  },
) {
  const path = inbox.providerPath(p.entity.id);
  const [attempt, setAttempt] = useState(0);
  const state = useLoad(
    () => loadResource<TransactionProvider>(path, () => false),
    [path, p.refresh, attempt],
  );
  const [kind, setKind] = useState<ProviderKind | "">("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; bad?: boolean; saved?: boolean }>();
  const current = state.kind === "ready" ? state.data : null;
  const chosen = kind || current?.kind || "";
  const name = PROVIDERS.find((x) => x.kind === chosen)?.name;

  async function change(run: () => Promise<TransactionProvider>, done: string) {
    setBusy(true);
    setMessage(undefined);
    try {
      await run();
      setToken("");
      setKind("");
      setMessage({ text: done, saved: true });
      setAttempt((x) => x + 1);
    } catch (issue) {
      setMessage({
        text: issue instanceof Error ? issue.message : "That did not work. Try again.",
        bad: true,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="provider-settings-heading">
      <h2 className="h2" id="provider-settings-heading">
        Transactions
      </h2>
      {"error" in state && (
        <div className="banner bad" role="alert">
          <span>Could not load transaction settings. {state.error.message}</span>
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
            if (!chosen) return;
            void change(
              () =>
                browserCall(p.credentials, path, "PUT", {
                  kind: chosen,
                  access_token: token,
                  expected_revision: current.revision,
                }),
              `${name} token saved.`,
            );
          }}
        >
          <fieldset className="set-fields" disabled={p.busy || busy}>
            <div className="setting">
              <div>
                <label htmlFor="provider-kind">Transaction provider</label>
                <small id="provider-kind-help">Feeds the Transactions inbox.</small>
              </div>
              <select
                id="provider-kind"
                className="input"
                aria-describedby="provider-kind-help"
                value={chosen}
                onChange={(event) => setKind(event.target.value as ProviderKind | "")}
              >
                <option value="" disabled={Boolean(current.kind)}>
                  Choose a provider
                </option>
                {PROVIDERS.map((x) => (
                  <option key={x.kind} value={x.kind}>
                    {x.name}
                  </option>
                ))}
              </select>
            </div>
            {chosen && (
              <div className="setting">
                <div>
                  <label htmlFor="provider-token">{name} personal access token</label>
                  <small id="provider-token-help">
                    {current.configured && current.kind === chosen
                      ? "Saved. Paste a new one to replace it."
                      : "Create one in YNAB under Account Settings → Developer Settings."}
                    <Tip label="How the token is kept">
                      Checked with {name}, stored encrypted and used only to read transactions. It
                      is never shown again or given to an assistant.
                    </Tip>
                  </small>
                </div>
                <input
                  id="provider-token"
                  className="input"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  required
                  minLength={10}
                  maxLength={400}
                  aria-describedby="provider-token-help"
                  placeholder={current.configured ? "•••••••• saved" : undefined}
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                />
              </div>
            )}
            <div className="setting">
              <div>
                {message && (
                  <small
                    role={message.bad ? "alert" : "status"}
                    className={message.bad ? "bad-text" : undefined}
                  >
                    {message.text}
                  </small>
                )}
              </div>
              <div className="set-actions">
                {current.configured && (
                  <button
                    type="button"
                    className="btn quiet"
                    onClick={() =>
                      void change(
                        () =>
                          browserCall(p.credentials, path, "DELETE", {
                            expected_revision: current.revision,
                          }),
                        "Token removed. Connected plans stop syncing until you save a new one.",
                      )
                    }
                  >
                    Remove token
                  </button>
                )}
                {message?.saved && current.configured && p.openInbox && (
                  <button type="button" className="btn" onClick={p.openInbox}>
                    Open Transactions inbox
                  </button>
                )}
                {chosen && (
                  <button type="submit" className="btn pri">
                    {busy ? "Checking token…" : "Save token"}
                  </button>
                )}
              </div>
            </div>
          </fieldset>
        </form>
      )}
    </section>
  );
}
