import { useEffect, useRef, useState } from "react";
import { type BrowserSession, fetchJson, loadResource } from "../../lib/api";
import { useLoad } from "../workspace/shared";

interface Member {
  id: string | null;
  /** The verified email of their latest sign-in; null until they sign in again. */
  email: string | null;
  name: string | null;
  role: "owner" | "member";
  you: boolean;
}
interface Members {
  role: "owner" | "member";
  members: Member[];
}

/** Who shares this Entity (TDD 19). Only its owner adds people; a member may leave. */
export function EntityMembers({
  entityId,
  credentials,
  disabled,
}: {
  entityId: string;
  credentials: (signIn?: boolean) => Promise<BrowserSession>;
  disabled: boolean;
}) {
  const path = `/api/entities/${entityId}/members`;
  const [attempt, setAttempt] = useState(0);
  const [changed, setChanged] = useState<Members | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const state = useLoad(() => loadResource<Members>(path, () => false), [path, attempt]);
  const loaded = state.kind === "ready" && Array.isArray(state.data?.members) ? state.data : null;
  const data = changed ?? loaded;
  const owner = data?.role === "owner";
  const locked = busy || disabled;

  async function change(remove?: string, leaving = false) {
    setBusy(true);
    setConfirming(null);
    setMessage("");
    try {
      const session = await credentials();
      if (!live.current) return;
      const result = await fetchJson<Members>(remove ? `${path}/${remove}` : path, {
        method: remove ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": session.csrf_token },
        ...(remove ? {} : { body: JSON.stringify({ email: email.trim(), name }) }),
      });
      if (!live.current) return;
      if (leaving) {
        // This Entity is gone for them; start again on what they still have.
        window.location.assign("/");
        return;
      }
      setChanged(result);
      setName("");
      setEmail("");
      setMessage(
        remove
          ? "Removed. They lose access on their next request."
          : "Added. They see this Entity the next time they open Accanto.",
      );
    } catch (error) {
      if (!live.current) return;
      setMessage(
        error instanceof Error && error.message
          ? error.message
          : "The change was not confirmed. Reload the list before trying again.",
      );
    } finally {
      if (live.current) setBusy(false);
    }
  }

  return (
    <section aria-labelledby="members-heading">
      <h2 className="h2" id="members-heading">
        Shared with <span>Everyone here sees and edits this Entity's finances.</span>
      </h2>
      {"error" in state && (
        <div className="banner bad" role="alert">
          <span>Could not load who shares this Entity. {state.error.message}</span>
          <button type="button" className="btn sm" onClick={() => setAttempt((x) => x + 1)}>
            Try loading again
          </button>
        </div>
      )}
      <div className="card">
        {state.kind === "loading" && !data && (
          <output className="setting" aria-label="Loading members">
            <span className="sk set-sk" />
          </output>
        )}
        {data?.members.map((member) => (
          <div className="setting" key={member.id ?? "owner"}>
            <div>
              {member.role === "owner" ? "Owner" : member.name}
              {member.you && <span className="muted"> (you)</span>}
              <small>{member.email ?? "Has not signed in since sharing began"}</small>
            </div>
            {member.role === "owner" ? (
              <span className="chip">Owner</span>
            ) : !member.id || !(owner || member.you) ? (
              <span className="chip">Member</span>
            ) : confirming === member.id ? (
              <span className="set-actions">
                <span className="bad">
                  {member.you ? "Leave this Entity?" : `Remove ${member.name}?`}
                </span>
                <button
                  type="button"
                  className="btn sm danger"
                  disabled={locked}
                  onClick={() => void change(member.id ?? undefined, member.you)}
                >
                  {member.you ? "Leave Entity" : "Remove access"}
                </button>
                <button
                  type="button"
                  className="btn sm"
                  disabled={locked}
                  onClick={() => setConfirming(null)}
                >
                  Cancel
                </button>
              </span>
            ) : (
              <button
                type="button"
                className="btn sm quiet danger"
                aria-label={member.you ? "Leave this Entity" : `Remove ${member.name}`}
                disabled={locked}
                onClick={() => setConfirming(member.id)}
              >
                {member.you ? "Leave" : "Remove"}
              </button>
            )}
          </div>
        ))}
        {owner && (
          <>
            <div className="setting set-howto">
              <div>
                How to add someone
                <ol>
                  <li>
                    The operator allows their email to sign in and provisions their account (without
                    an Entity of its own, if they only share this one).
                  </li>
                  <li>They sign in to Accanto once.</li>
                  <li>
                    Enter their name and the email they sign in with below. They get full access to
                    this Entity, except setting up transaction sources, and the audit history
                    records which of you made each change. Only you add people; they can leave.
                  </li>
                </ol>
              </div>
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void change();
              }}
            >
              <fieldset className="setting set-fieldset" disabled={locked}>
                <div>
                  <label htmlFor="member-name">Add a person</label>
                  <small>Their name as you want to see it, and the email they sign in with.</small>
                </div>
                <div className="set-actions">
                  <input
                    id="member-name"
                    className="input set-key-name"
                    required
                    maxLength={120}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    autoComplete="off"
                    placeholder="Name"
                    aria-label="Name"
                  />
                  <input
                    id="member-email"
                    className="input set-member-email"
                    type="email"
                    required
                    maxLength={320}
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="Email they sign in with"
                    aria-label="Their email"
                  />
                  <button type="submit" className="btn">
                    Add person
                  </button>
                </div>
              </fieldset>
            </form>
          </>
        )}
        {data && !owner && (
          <div className="setting">
            <small>Only the owner adds people or removes others. You can leave at any time.</small>
          </div>
        )}
        {message && (
          <div className="setting">
            <output>{message}</output>
          </div>
        )}
      </div>
    </section>
  );
}
