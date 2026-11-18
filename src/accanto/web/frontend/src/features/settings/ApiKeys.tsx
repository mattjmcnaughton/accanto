import { useEffect, useRef, useState } from "react";
import { type BrowserSession, fetchJson, loadResource } from "../../lib/api";
import { LoadMessage, useLoad } from "../workspace/shared";
import { Help } from "./Help";
interface KeyMetadata {
  id: string;
  name: string;
  created_at: string;
  revoked_at: string | null;
}
const formatDate = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
function Timestamp({ value }: { value: string }) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? (
    <>{value}</>
  ) : (
    <time dateTime={value} title={date.toLocaleString()}>
      {formatDate.format(date)}
    </time>
  );
}
export function ApiKeys({
  credentials,
  disabled,
}: { credentials: (signIn?: boolean) => Promise<BrowserSession>; disabled: boolean }) {
  const [attempt, setAttempt] = useState(0);
  const [name, setName] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const live = useRef(true);
  const revokeButtons = useRef(new Map<string, HTMLButtonElement>());
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const state = useLoad(() => loadResource<KeyMetadata[]>("/api/keys", () => false), [attempt]);
  const locked = busy || disabled;
  function clearSecret() {
    setSecret(null);
    setShown(false);
  }
  function cancelRevoke(id: string) {
    setConfirming(null);
    requestAnimationFrame(() => revokeButtons.current.get(id)?.focus());
  }
  async function change(id?: string) {
    setBusy(true);
    clearSecret();
    setConfirming(null);
    setMessage("");
    let sent = false;
    try {
      const session = await credentials();
      if (!live.current) return;
      sent = true;
      const result = await fetchJson<{ key?: string }>(id ? `/api/keys/${id}` : "/api/keys", {
        method: id ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": session.csrf_token },
        ...(id ? {} : { body: JSON.stringify({ name }) }),
      });
      if (!live.current) return;
      setSecret(result.key || null);
      setName("");
      setAttempt((x) => x + 1);
      setMessage(id ? "API key revoked." : "Copy this key now. It cannot be shown again.");
    } catch {
      if (!live.current) return;
      setMessage(
        !sent
          ? "Could not verify your account. Sign in again before trying this action."
          : id
            ? "Revocation was not confirmed. Reload the key list before trying again."
            : "Creation was not confirmed. A key may have been created. Reload the key list and revoke any unwanted key before deliberately creating another. Lost secrets cannot be recovered.",
      );
    } finally {
      if (live.current) setBusy(false);
    }
  }
  async function copy() {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      if (live.current) setMessage("Key copied. It cannot be shown again after you dismiss it.");
    } catch {
      if (live.current) setMessage("Could not copy. Show the key and copy it manually.");
    }
  }
  return (
    <section className="settings-section api-keys" aria-labelledby="api-keys-heading">
      <div className="api-keys-heading">
        <h3 id="api-keys-heading">API keys</h3>
        <Help label="About API keys">
          Keys give scripts access to your current Entities. Keep them private. Each secret is shown
          only once.
        </Help>
        <div className="api-keys-tools">
          <button
            type="button"
            className="text-button"
            disabled={locked}
            onClick={() => {
              clearSecret();
              setAttempt((x) => x + 1);
            }}
          >
            Reload key list
          </button>
          <button
            type="button"
            className="text-button"
            disabled={locked}
            onClick={async () => {
              clearSecret();
              setBusy(true);
              try {
                await credentials(true);
                if (live.current) {
                  setAttempt((x) => x + 1);
                  setMessage("Sign-in verified. Review the list before choosing another action.");
                }
              } catch {
                if (live.current) setMessage("Sign-in was not completed for this account.");
              } finally {
                if (live.current) setBusy(false);
              }
            }}
          >
            Sign in again for key access
          </button>
        </div>
      </div>
      <LoadMessage state={state} retry={() => setAttempt((x) => x + 1)} />
      {message && <output className="api-keys-message">{message}</output>}
      {secret && (
        <div className="api-key-secret">
          <label htmlFor="new-key-value">New API key (shown once)</label>
          <input
            id="new-key-value"
            type={shown ? "text" : "password"}
            readOnly
            value={secret}
            autoComplete="off"
            spellCheck={false}
          />
          <div className="api-key-secret-actions">
            <button type="button" className="primary" onClick={() => void copy()}>
              Copy key
            </button>
            <button type="button" aria-pressed={shown} onClick={() => setShown((x) => !x)}>
              {shown ? "Hide key" : "Show key"}
            </button>
            <button type="button" onClick={clearSecret}>
              Dismiss secret
            </button>
          </div>
        </div>
      )}
      <form
        className="api-key-create"
        onSubmit={(event) => {
          event.preventDefault();
          void change();
        }}
      >
        <fieldset disabled={locked}>
          <legend className="sr-only">Create a key</legend>
          <label htmlFor="api-key-name">Key name</label>
          <input
            id="api-key-name"
            required
            maxLength={120}
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="off"
          />
          <button type="submit">Create API key</button>
        </fieldset>
      </form>
      {state.kind === "ready" &&
        (state.data.length ? (
          <div className="data-table-scroll">
            <table className="data-grid api-key-table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Created</th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {state.data.map((key) => (
                  <tr
                    key={key.id}
                    className={key.revoked_at ? "muted" : undefined}
                    onKeyDown={(event) => {
                      if (event.key === "Escape" && confirming === key.id) {
                        event.preventDefault();
                        cancelRevoke(key.id);
                      }
                    }}
                  >
                    <th scope="row">{key.name}</th>
                    <td>
                      <Timestamp value={key.created_at} />
                    </td>
                    <td>
                      {key.revoked_at ? (
                        <>
                          Revoked <Timestamp value={key.revoked_at} />
                        </>
                      ) : (
                        <span className="badge">Active</span>
                      )}
                    </td>
                    <td className="action-cell">
                      {!key.revoked_at &&
                        (confirming === key.id ? (
                          <span className="api-key-confirm">
                            <span className="danger">Revoke {key.name}?</span>
                            <button
                              type="button"
                              className="danger-button"
                              disabled={locked}
                              onClick={() => void change(key.id)}
                            >
                              Revoke key
                            </button>
                            <button
                              type="button"
                              // biome-ignore lint/a11y/noAutofocus: Focus moves only after the user chose Revoke; Cancel is the safe default.
                              autoFocus
                              disabled={locked}
                              onClick={() => cancelRevoke(key.id)}
                            >
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="text-button"
                            ref={(node) => {
                              if (node) revokeButtons.current.set(key.id, node);
                              else revokeButtons.current.delete(key.id);
                            }}
                            aria-label={`Revoke ${key.name}`}
                            disabled={locked}
                            onClick={() => setConfirming(key.id)}
                          >
                            Revoke
                          </button>
                        ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">No API keys have been issued.</p>
        ))}
    </section>
  );
}
