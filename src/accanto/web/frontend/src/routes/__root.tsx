import { createRootRoute, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { lastEntity, rememberEntity } from "../features/workspace/Entities";
import { ENTITY, MONTH, SCREENS, type Screen, Workspace } from "../features/workspace/Workspace";
import { useTheme } from "../features/workspace/shared";
import { ApiError, type BrowserSession, readSession } from "../lib/api";
import { Mark } from "../ui";

// The session gate stays mounted across screens, so retained Plan edits survive navigation.
// ?m=YYYY-MM is the month Home, Activity and Review show; ?e= is the Entity, when the User
// has several. Anything else is dropped.
export const Route = createRootRoute({
  component: Root,
  notFoundComponent: () => null,
  validateSearch: (search: Record<string, unknown>): { m?: string; e?: string } => ({
    ...(typeof search.m === "string" && MONTH.test(search.m) ? { m: search.m } : {}),
    ...(typeof search.e === "string" && ENTITY.test(search.e) ? { e: search.e } : {}),
  }),
});

function Root() {
  const { screen } = useParams({ strict: false });
  const { m, e } = useSearch({ strict: false });
  const navigate = useNavigate();
  const known = SCREENS.find((s) => s === screen);
  useEffect(() => {
    if (screen !== undefined && !known) void navigate({ to: "/", replace: true });
  }, [screen, known, navigate]);
  return (
    <ProductionHome
      screen={known ?? "home"}
      month={m}
      entity={e}
      navigate={(to, replace, month, entity) =>
        void (to === "home"
          ? navigate({ to: "/", search: { m: month, e: entity }, replace })
          : navigate({
              to: "/$screen",
              params: { screen: to },
              search: { m: month, e: entity },
              replace,
            }))
      }
    />
  );
}

export function ProductionHome({
  screen,
  month,
  entity: requested,
  navigate,
}: {
  screen?: Screen;
  month?: string;
  /** The Entity in the address. */
  entity?: string;
  navigate?: (to: Screen, replace?: boolean, month?: string, entity?: string) => void;
}) {
  useTheme();
  const [session, setSession] = useState<BrowserSession | null>(null);
  const [state, setState] = useState("loading");
  const [message, setMessage] = useState(() =>
    // The sign-in callback sends a refused person back here with a reason.
    new URLSearchParams(window.location.search).get("refused") === "not_invited"
      ? "This email isn't invited yet. Ask the person who runs Accanto to add it, then sign in again."
      : "",
  );
  const [attempt, setAttempt] = useState(0);
  // The Entity the workspace is mounted for. A switch remounts it, which clears its tab memory.
  const [current, setCurrent] = useState<string | null>(null);
  // Until the address names a newly chosen Entity, its old month does not apply.
  const [fresh, setFresh] = useState<string | null>(null);
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
  const known = (id?: string | null) => session?.entities.find((x) => x.id === id)?.id;
  const several = (session?.entities.length ?? 0) > 1;
  const selected =
    known(current) ??
    known(requested) ??
    (several ? known(lastEntity()) : undefined) ??
    session?.entities[0]?.id;
  const inAddress = several ? selected : undefined;
  // biome-ignore lint/correctness/useExhaustiveDependencies: Settle the Entity once per session.
  useEffect(() => {
    if (!selected || state !== "ready") return;
    if (current === null) setCurrent(selected);
    if (fresh !== null && requested === fresh) setFresh(null);
    if (several) rememberEntity(selected);
    // Name the Entity in the address, or drop an unknown one.
    if (navigate && requested !== inAddress && (current === null || !known(requested)))
      navigate(screen ?? "home", true, month, inAddress);
  }, [selected, state, requested, several]);
  if (session && state === "ready")
    return (
      <Workspace
        key={`${session.user.id}:${selected}`}
        initial={session}
        entityId={selected}
        requestedEntity={requested}
        switchEntity={(id, latest, fromAddress) => {
          setSession(latest);
          setCurrent(id);
          rememberEntity(id);
          // A new Entity starts on its own current month.
          if (!fromAddress && navigate) {
            setFresh(id);
            navigate(screen ?? "home", false, undefined, id);
          }
        }}
        screen={screen}
        month={fresh === selected ? undefined : month}
        navigate={navigate && ((to, replace, m) => navigate(to, replace, m, inAddress))}
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
          <Mark />
          accanto
        </span>
      </header>
      <main id="main" className="signin-main" tabIndex={-1}>
        <div className="card signin-card">
          <h1 className="h1">Sign in to Accanto</h1>
          <p className="sub">Your financial companion for planning a rich life.</p>
          {state === "loading" && <output className="note">Checking sign-in…</output>}
          {state === "signedout" && (
            <a className="btn pri" href={signInHref()}>
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

/** A first sign-in creates the person's own Entity in this browser's time zone. */
function signInHref() {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return zone ? `/api/auth/login?tz=${encodeURIComponent(zone)}` : "/api/auth/login";
}
