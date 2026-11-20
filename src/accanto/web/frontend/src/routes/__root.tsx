import { createRootRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { SCREENS, type Screen, Workspace } from "../features/workspace/Workspace";
import { useTheme } from "../features/workspace/shared";
import { ApiError, type BrowserSession, readSession } from "../lib/api";

// The session gate stays mounted across screens, so retained Plan edits survive navigation.
export const Route = createRootRoute({ component: Root, notFoundComponent: () => null });

function Root() {
  const { screen } = useParams({ strict: false });
  const navigate = useNavigate();
  const known = SCREENS.find((s) => s === screen);
  useEffect(() => {
    if (screen !== undefined && !known) void navigate({ to: "/", replace: true });
  }, [screen, known, navigate]);
  return (
    <ProductionHome
      screen={known ?? "home"}
      navigate={(to, replace) =>
        void (to === "home"
          ? navigate({ to: "/", replace })
          : navigate({ to: "/$screen", params: { screen: to }, replace }))
      }
    />
  );
}

export function ProductionHome({
  screen,
  navigate,
}: { screen?: Screen; navigate?: (to: Screen, replace?: boolean) => void }) {
  useTheme();
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
  if (session && state === "ready")
    return (
      <Workspace
        key={session.user.id}
        initial={session}
        screen={screen}
        navigate={navigate}
        signedOut={(notice) => {
          setSession(null);
          setState("signedout");
          setMessage(notice || "");
        }}
      />
    );
  return (
    <div className="signin">
      <button
        type="button"
        className="btn skip"
        onClick={() => document.getElementById("main")?.focus()}
      >
        Skip to content
      </button>
      <header className="signin-top">
        <span className="logo">
          <i />
          accanto
        </span>
      </header>
      <main id="main" className="signin-main" tabIndex={-1}>
        <div className="card signin-card">
          <h1 className="h1">Sign in to Accanto</h1>
          <p className="sub">Your financial companion for planning a rich life.</p>
          {state === "loading" && <output className="note">Checking sign-in…</output>}
          {state === "signedout" && (
            <a className="btn pri" href="/api/auth/login">
              Sign in
            </a>
          )}
          {state === "error" && (
            <div className="signin-alert" role="alert">
              <p>Could not verify your sign-in. No financial workspace has been loaded.</p>
              <button type="button" className="btn" onClick={() => setAttempt((x) => x + 1)}>
                Try again
              </button>
            </div>
          )}
          {message && (
            <p className="err" role="alert">
              {message}
            </p>
          )}
        </div>
      </main>
      <footer className="signin-foot">Plan thoughtfully. Live richly.</footer>
    </div>
  );
}
