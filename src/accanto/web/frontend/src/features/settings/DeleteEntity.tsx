import { useEffect, useRef, useState } from "react";
import { ApiError, type BrowserSession, fetchJson } from "../../lib/api";
import { Dialog, Field } from "../../ui";

/**
 * Delete Entity (TDD 22): its owner, from a signed-in browser, types its exact name.
 * Afterwards the workspace starts again on another Entity, or on none.
 */
export function DeleteEntity({
  entityId,
  name,
  credentials,
  disabled,
}: {
  entityId: string;
  /** The saved name the owner types to confirm. */
  name: string;
  credentials: (signIn?: boolean) => Promise<BrowserSession>;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const matches = typed.trim() === name;

  async function remove() {
    setBusy(true);
    setMessage("");
    try {
      const session = await credentials();
      if (!live.current) return;
      await fetchJson(`/api/entities/${entityId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": session.csrf_token },
        body: JSON.stringify({ confirm_name: typed.trim() }),
      });
    } catch (error) {
      // A retry after a lost reply finds it already gone: the same outcome.
      const gone = error instanceof ApiError && error.code === "entity_not_found";
      if (!gone) {
        if (live.current) {
          setMessage(
            error instanceof Error && error.message
              ? error.message
              : "The delete was not confirmed. Reload before trying again.",
          );
          setBusy(false);
        }
        return;
      }
    }
    // Start again on what this person still has: another Entity, or none.
    window.location.assign("/");
  }

  return (
    <section aria-labelledby="delete-entity-heading">
      <h2 className="h2" id="delete-entity-heading">
        Delete Entity
      </h2>
      <div className="card">
        <div className="setting">
          <div>
            Delete {name}
            <small>For you and everyone it's shared with. This can't be undone.</small>
          </div>
          <button
            type="button"
            className="btn danger"
            disabled={disabled}
            onClick={() => {
              setTyped("");
              setMessage("");
              setOpen(true);
            }}
          >
            Delete Entity…
          </button>
        </div>
      </div>
      {open && (
        <Dialog
          title={`Delete ${name}?`}
          onClose={() => {
            if (!busy) setOpen(false);
          }}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (matches && !busy) void remove();
            }}
          >
            <fieldset className="dlg-b" disabled={busy}>
              <p className="note">
                Everything in {name} goes for everyone who shares it: Plans, activity, balances,
                inbox, schedules, routines, its YNAB connection and assistant conversations. You
                can't undo this.
              </p>
              <Field label={`Type ${name} to confirm`}>
                <input
                  className="input"
                  required
                  autoComplete="off"
                  spellCheck={false}
                  value={typed}
                  onChange={(event) => setTyped(event.target.value)}
                  aria-invalid={typed !== "" && !matches}
                />
              </Field>
              {message && (
                <p className="bad" role="alert">
                  {message}
                </p>
              )}
            </fieldset>
            <div className="dlg-f">
              <button
                type="button"
                className="btn quiet"
                disabled={busy}
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
              <button type="submit" className="btn danger" disabled={busy || !matches}>
                {busy ? "Deleting…" : "Delete permanently"}
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </section>
  );
}
