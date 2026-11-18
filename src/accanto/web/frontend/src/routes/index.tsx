import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ApiError, type BrowserSession, readSession } from "../lib/api";
import { Workspace } from "../features/workspace/Workspace";
export const Route = createFileRoute("/")({ component: ProductionHome });
export function ProductionHome() {
  const [session, setSession] = useState<BrowserSession | null>(null);
  const [state, setState] = useState("loading");
  const [message, setMessage] = useState("");
  const [attempt, setAttempt] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Retry explicitly starts a fresh session request.
  useEffect(() => {
    let active = true;
    setState("loading");
    void readSession()
      .then((value) => {
        if (active) {
          setSession(value);
          setState("ready");
        }
      })
      .catch((error) => {
        if (active)
          setState(
            error instanceof ApiError && error.kind === "unauthenticated" ? "signedout" : "error",
          );
      });
    return () => {
      active = false;
    };
  }, [attempt]);
  return (
    <div className="app-shell app-shell-dark">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="site-header">
        <div className="brand" aria-label="Accanto">
          <span className="brand-mark" aria-hidden="true">
            a
          </span>
          <span>accanto</span>
        </div>
        <span className="header-label">Your financial companion</span>
      </header>
      <main id="main-content" className={session ? "workspace-main" : "shell-main"}>
        {session && state === "ready" ? (
          <Workspace
            key={session.user.id}
            initial={session}
            signedOut={(notice) => {
              setSession(null);
              setState("signedout");
              setMessage(notice || "");
            }}
          />
        ) : (
          <div className="session-gate data-workspace">
            <h1>Sign in to Accanto</h1>
            {state === "loading" && <output>Checking sign-in…</output>}
            {state === "signedout" && (
              <a className="button primary" href="/api/auth/login">
                Sign in
              </a>
            )}
            {state === "error" && (
              <div role="alert">
                <p>Could not verify your sign-in. No financial workspace has been loaded.</p>
                <button type="button" onClick={() => setAttempt((x) => x + 1)}>
                  Try again
                </button>
              </div>
            )}
            {message && <p role="alert">{message}</p>}
          </div>
        )}
      </main>
      <footer className="site-footer">Plan thoughtfully. Live richly.</footer>
    </div>
  );
}
