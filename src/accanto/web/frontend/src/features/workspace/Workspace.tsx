import { useEffect, useRef, useState } from "react";
import { type BrowserSession, readSession } from "../../lib/api";
import { Settings } from "../settings/Settings";
import type { WriteSpec } from "../../lib/monthly";
import {
  RecoverableWrite,
  confirmInAppNavigation,
  guardUnsavedNavigation,
  logout,
  reauthenticate,
} from "../../lib/recoverableWrite";
import { RecoveryNotice, type RecoveryStatus } from "../recovery/RecoveryNotice";
import { Plans } from "./Plans";
import { ActivityScreen } from "./Activity";
import { MonthlyReview } from "./MonthlyReview";
import { IncomeEstimates } from "../estimates/IncomeEstimates";

export function Workspace({
  initial,
  signedOut,
}: { initial: BrowserSession; signedOut: (message?: string) => void }) {
  const [session, setSession] = useState(initial);
  const [screen, setScreen] = useState<
    "Plans" | "Activity" | "Monthly Review" | "Income estimates" | "Settings"
  >("Plans");
  const [refresh, setRefresh] = useState(0);
  const [metadataStale, setMetadataStale] = useState(false);
  const [metadataError, setMetadataError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<RecoveryStatus | null>(null);
  const [message, setMessage] = useState("");
  const dirty = useRef(false);
  const live = useRef(true);
  const pending = useRef(new RecoverableWrite<unknown>());
  const afterSave = useRef<(data: unknown) => void>(() => {});
  const [concealed, setConcealed] = useState(false);
  const entity = session.entities[0];
  useEffect(() => {
    live.current = true;
    const remove = guardUnsavedNavigation(() => dirty.current || pending.current.hasPending());
    return () => {
      live.current = false;
      pending.current.clear();
      remove();
    };
  }, []);
  const guard = () =>
    !busy &&
    !metadataStale &&
    confirmInAppNavigation(() => dirty.current || pending.current.hasPending());
  async function submit(credentials: BrowserSession) {
    setBusy(true);
    setMessage("");
    const result = await pending.current.submit(credentials);
    if (!live.current) return;
    setBusy(false);
    if (result.kind === "confirmed") {
      setStatus(null);
      dirty.current = false;
      afterSave.current(result.data);
      setRefresh((x) => x + 1);
      setMessage("Saved.");
    } else if (result.kind !== "superseded" && result.kind !== "idle") {
      const kind = result.kind;
      if (kind === "wrong_user") setConcealed(true);
      setStatus(kind === "not_found" || kind === "error" ? "unavailable" : kind);
      if ("error" in result) setMessage(result.error.message);
    }
  }
  function save<T>(spec: WriteSpec<T>, confirmed: (data: T) => void) {
    if (pending.current.hasPending() || busy) return;
    pending.current.prepare(session.user.id, spec);
    afterSave.current = (data) => confirmed(data as T);
    void submit(session);
  }
  function discard() {
    pending.current.clear();
    setStatus(null);
    setMessage("Pending request discarded. Your form is still here; review it before saving.");
  }
  async function signIn() {
    setBusy(true);
    const result = await reauthenticate(initial.user.id);
    if (!live.current) return;
    setBusy(false);
    if (result.kind === "ready") {
      setConcealed(false);
      setSession(result.session);
      setStatus(null);
      await submit(result.session);
    } else {
      if (result.kind === "wrong_user") setConcealed(true);
      setStatus(result.kind);
    }
  }
  async function signOut() {
    await logout(session, () => {
      pending.current.clear();
      dirty.current = false;
      live.current = false;
      signedOut();
    }).catch(() =>
      signedOut(
        "The workspace was cleared, but sign-out was not confirmed. Try signing out again after reconnecting.",
      ),
    );
  }
  async function credentials(signIn = false) {
    const next = signIn
      ? await reauthenticate(initial.user.id)
      : { kind: "ready" as const, session: await readSession() };
    if (!live.current) throw new Error("Workspace closed");
    if (
      next.kind === "wrong_user" ||
      (next.kind === "ready" && next.session.user.id !== initial.user.id)
    ) {
      setConcealed(true);
      setStatus("wrong_user");
      throw new Error("Account changed");
    }
    if (next.kind !== "ready") throw new Error("Sign-in incomplete");
    if (signIn) setSession((current) => ({ ...current, csrf_token: next.session.csrf_token }));
    return next.session;
  }
  async function refreshMetadata(signIn = false) {
    setMetadataStale(true);
    setMetadataError(false);
    try {
      const current = await credentials(signIn);
      if (live.current) {
        setSession(current);
        setMetadataStale(false);
      }
    } catch {
      if (live.current) setMetadataError(true);
    }
  }
  const props = {
    entity,
    concealed,
    busy: busy || pending.current.hasPending() || metadataStale,
    refresh,
    guard,
    dirty: (value: boolean) => {
      dirty.current = value;
    },
    save,
  };
  return (
    <>
      <header className="workspace-heading">
        <div>
          <p className="entity-name">{concealed ? "Account changed" : entity?.name}</p>
          <h1>Your financial workspace</h1>
        </div>
        <button type="button" onClick={() => void signOut()}>
          Sign out
        </button>
      </header>
      {status && (
        <RecoveryNotice
          status={concealed ? "wrong_user" : status}
          onRetry={() => void submit(session)}
          onSignIn={() => void signIn()}
          onDiscard={discard}
          onReconcile={() => {
            discard();
            setRefresh((x) => x + 1);
            setMessage(
              "Reloading current records. Your attempted input is still in the form. Wait for the records to load, then compare before choosing to reload that record.",
            );
          }}
        />
      )}
      {message && !concealed && <output>{message}</output>}
      {metadataStale && !concealed && (
        <div aria-live="polite">
          <p>
            {metadataError
              ? "Settings were saved, but current Entity date defaults could not be refreshed. Refresh before continuing."
              : "Refreshing Entity date defaults…"}
          </p>
          {metadataError && (
            <>
              <button type="button" onClick={() => void refreshMetadata()}>
                Refresh Entity defaults
              </button>
              <button type="button" onClick={() => void refreshMetadata(true)}>
                Sign in and refresh defaults
              </button>
            </>
          )}
        </div>
      )}
      {!entity && <p>No Entity is available. Contact the operator to complete setup.</p>}
      {entity && (
        <>
          <nav className="workspace-nav" aria-label="Workspace" hidden={concealed}>
            {(["Plans", "Activity", "Monthly Review", "Income estimates", "Settings"] as const).map(
              (item) => (
                <button
                  type="button"
                  key={item}
                  aria-current={screen === item ? "page" : undefined}
                  onClick={() => {
                    if (item !== screen && guard()) {
                      pending.current.clear();
                      dirty.current = false;
                      setStatus(null);
                      setMessage("");
                      setScreen(item);
                    }
                  }}
                >
                  {item}
                </button>
              ),
            )}
          </nav>
          {screen === "Plans" && <Plans {...props} />}
          {screen === "Activity" && <ActivityScreen {...props} />}
          {screen === "Monthly Review" && <MonthlyReview {...props} />}
          {screen === "Income estimates" && <IncomeEstimates {...props} />}
          {screen === "Settings" && (
            <Settings {...props} credentials={credentials} saved={() => void refreshMetadata()} />
          )}
        </>
      )}
    </>
  );
}
