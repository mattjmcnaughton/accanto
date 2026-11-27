import { useEffect, useRef, useState } from "react";
import { type BrowserSession, fetchJson, loadResource } from "../../lib/api";
import { fmtDate } from "../../lib/format";
import { parseTimestamp } from "../../lib/timestamp";
import { useLoad } from "../workspace/shared";

interface KeyMetadata {
  id: string;
  name: string;
  created_at: string;
  revoked_at: string | null;
}
/** An API timestamp as the calendar day it falls on for the person reading it. */
function Day({ value }: { value: string }) {
  const ms = parseTimestamp(value);
  return ms === null ? (
    <>{value}</>
  ) : (
    <time dateTime={value}>{fmtDate(new Date(ms).toLocaleDateString("en-CA"))}</time>
  );
}
export function ApiKeys({
  credentials,
  disabled,
}: { credentials: (signIn?: boolean) => Promise<BrowserSession>; disabled: boolean }) {
  const [attempt, setAttempt] = useState(0);
  const [name, setName] = useState("");
  const [secret, setSecret] = useState<{ name: string; value: string } | null>(null);
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
      setSecret(result.key ? { name: name.trim(), value: result.key } : null);
      setName("");
      setAttempt((x) => x + 1);
      setMessage(id ? "API key revoked." : "");
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
      await navigator.clipboard.writeText(secret.value);
      if (live.current) setMessage("Key copied. It cannot be shown again after you dismiss it.");
    } catch {
      if (live.current) setMessage("Could not copy. Show the key and copy it manually.");
    }
  }
  return (
    <section aria-labelledby="api-keys-heading">
      <h2 className="h2" id="api-keys-heading">
        API keys <span>Shown once, when created</span>
      </h2>
      {"error" in state && (
        <div className="banner bad" role="alert">
          <span>Could not load API keys. {state.error.message}</span>
          <button type="button" className="btn sm" onClick={() => setAttempt((x) => x + 1)}>
            Try loading again
          </button>
        </div>
      )}
      <div className="card">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void change();
          }}
        >
          <fieldset className="setting set-fieldset" disabled={locked}>
            <div>
              <label htmlFor="api-key-name">New key name</label>
              <small>Name it after what will use it, so you know which one to revoke later.</small>
            </div>
            <div className="set-actions">
              <input
                id="api-key-name"
                className="input set-key-name"
                required
                maxLength={120}
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoComplete="off"
                placeholder="Budget script"
              />
              <button type="submit" className="btn">
                Create key
              </button>
            </div>
          </fieldset>
        </form>
        {message && (
          <div className="setting">
            <output>{message}</output>
          </div>
        )}
        {secret && (
          <div className="setting set-secret">
            <div>
              Copy the key for “{secret.name}” now
              <small>It will not be shown again.</small>
            </div>
            <div className="set-secret-body">
              <label className="sr-only" htmlFor="new-key-value">
                New API key (shown once)
              </label>
              <input
                id="new-key-value"
                className="input keyval"
                type={shown ? "text" : "password"}
                readOnly
                value={secret.value}
                autoComplete="off"
                spellCheck={false}
              />
              <div className="set-actions">
                <button type="button" className="btn sm pri" onClick={() => void copy()}>
                  Copy key
                </button>
                <button
                  type="button"
                  className="btn sm"
                  aria-pressed={shown}
                  onClick={() => setShown((x) => !x)}
                >
                  {shown ? "Hide key" : "Show key"}
                </button>
                <button type="button" className="btn sm quiet" onClick={clearSecret}>
                  Dismiss secret
                </button>
              </div>
            </div>
          </div>
        )}
        {state.kind === "loading" && (
          <output className="setting" aria-label="Loading API keys">
            <span className="sk set-sk" />
          </output>
        )}
        {state.kind === "ready" &&
          state.data.map((key) => (
            <div
              className="setting"
              key={key.id}
              onKeyDown={(event) => {
                if (event.key === "Escape" && confirming === key.id) {
                  event.preventDefault();
                  cancelRevoke(key.id);
                }
              }}
            >
              <div>
                {key.name}
                <small>
                  Created <Day value={key.created_at} />
                  {key.revoked_at && (
                    <>
                      , revoked <Day value={key.revoked_at} />
                    </>
                  )}
                </small>
              </div>
              {key.revoked_at ? (
                <span className="chip">Revoked</span>
              ) : confirming === key.id ? (
                <span className="set-actions">
                  <span className="bad">Revoke {key.name}?</span>
                  <button
                    type="button"
                    className="btn sm danger"
                    disabled={locked}
                    onClick={() => void change(key.id)}
                  >
                    Revoke key
                  </button>
                  <button
                    type="button"
                    className="btn sm"
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
                  className="btn sm quiet danger"
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
              )}
            </div>
          ))}
        {state.kind === "ready" && state.data.length === 0 && !secret && (
          <div className="setting">
            <span className="muted">No keys yet.</span>
          </div>
        )}
        <div className="setting">
          <div />
          <div className="set-actions">
            <button
              type="button"
              className="btn sm quiet"
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
              className="btn sm quiet"
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
      </div>
    </section>
  );
}
