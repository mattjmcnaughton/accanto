import { useEffect, useRef, useState } from "react";
import { type BrowserSession, fetchJson, loadResource } from "../../lib/api";
import { LoadMessage, useLoad } from "../workspace/shared";
interface KeyMetadata {
  id: string;
  name: string;
  created_at: string;
  revoked_at: string | null;
}
export function ApiKeys({
  credentials,
  disabled,
}: { credentials: (signIn?: boolean) => Promise<BrowserSession>; disabled: boolean }) {
  const [attempt, setAttempt] = useState(0);
  const [name, setName] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const state = useLoad(() => loadResource<KeyMetadata[]>("/api/keys", () => false), [attempt]);
  async function change(id?: string) {
    setBusy(true);
    setSecret(null);
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
  return (
    <section>
      <h3>API keys</h3>
      <p>
        Keys give scripts access to your current Entities. Keep them private. Each secret is shown
        only once.
      </p>
      <LoadMessage state={state} retry={() => setAttempt((x) => x + 1)} />
      {message && <output>{message}</output>}
      {secret && (
        <div>
          <label>
            New API key (shown once)
            <input readOnly value={secret} autoComplete="off" spellCheck={false} />
          </label>
          <button type="button" onClick={() => setSecret(null)}>
            Dismiss secret
          </button>
        </div>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void change();
        }}
      >
        <fieldset disabled={disabled || busy}>
          <legend>Create a key</legend>
          <label>
            Key name
            <input
              required
              maxLength={120}
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="off"
            />
          </label>
          <button type="submit">Create API key</button>
        </fieldset>
      </form>
      <button
        type="button"
        disabled={busy || disabled}
        onClick={() => {
          setSecret(null);
          setAttempt((x) => x + 1);
        }}
      >
        Reload key list
      </button>
      <button
        type="button"
        disabled={busy || disabled}
        onClick={async () => {
          setSecret(null);
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
      {state.kind === "ready" &&
        (state.data.length ? (
          <ul>
            {state.data.map((key) => (
              <li key={key.id}>
                <strong>{key.name}</strong> — Created {key.created_at};{" "}
                {key.revoked_at ? `Revoked ${key.revoked_at}` : "Active"}
                {!key.revoked_at && (
                  <button
                    type="button"
                    disabled={busy || disabled}
                    onClick={() => void change(key.id)}
                  >
                    Revoke {key.name}
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p>No API keys have been issued.</p>
        ))}
    </section>
  );
}
