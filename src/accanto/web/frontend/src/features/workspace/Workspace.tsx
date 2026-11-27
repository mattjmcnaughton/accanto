import { type MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { type BrowserSession, readSession } from "../../lib/api";
import { addMonths, daysInMonth, fmtMonth } from "../../lib/format";
import { observeScreen } from "../../lib/screenTiming";
import type { WriteSpec } from "../../lib/monthly";
import {
  RecoverableWrite,
  confirmInAppNavigation,
  guardUnsavedNavigation,
  logout,
  reauthenticate,
} from "../../lib/recoverableWrite";
import { Dialog, Icon, Mark, useDialogSlot } from "../../ui";
import { AgentPanel } from "../agent/AgentPanel";
import { Balances } from "../balances/Balances";
import { Destinations } from "../destinations/Destinations";
import { Inbox } from "../inbox/Inbox";
import { FIRE_INTERVIEW_PROMPT, Projections } from "../projections/Projections";
import { RecoveryNotice, type RecoveryStatus } from "../recovery/RecoveryNotice";
import { Routines } from "../routines/Routines";
import { Schedules } from "../schedules/Schedules";
import { Savings } from "../savings/Savings";
import { Settings } from "../settings/Settings";
import { ActivityScreen } from "./Activity";
import { type Action, AskBar } from "./AskBar";
import { CreateEntityDialog, EntitySwitcher, createEntity } from "./Entities";
import { MonthlyReview } from "./MonthlyReview";
import { Plans } from "./Plans";
import { WorkspaceLastReads, WorkspaceReads, keysBelongElsewhere, useTheme } from "./shared";

/** Every screen has its own address; "more" is the phone's list of the screens without a tab. */
export const SCREENS = [
  "home",
  "activity",
  "inbox",
  "review",
  "plans",
  "routines",
  "schedules",
  "projections",
  "savings",
  "investments",
  "giving",
  "loans",
  "settings",
  "more",
] as const;
export type Screen = (typeof SCREENS)[number];
/** A month in the address, YYYY-MM; without one the screens show the Entity's current month. */
export const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
/** An Entity's UUID in the address, ?e=…; it is there only when the User has several. */
export const ENTITY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const hrefFor = (screen: Screen, month?: string, entity?: string) => {
  const search = new URLSearchParams();
  if (month) search.set("m", month);
  if (entity) search.set("e", entity);
  const query = search.toString();
  return `${screen === "home" ? "#/" : `#/${screen}`}${query ? `?${query}` : ""}`;
};

// Destinations grouped by job: the month's loop, planning, balances, then what runs on its own.
const NAV: { group: string; items: [Screen, string][] }[] = [
  {
    group: "This month",
    items: [
      ["home", "Home"],
      ["inbox", "Transactions inbox"],
      ["activity", "Activity"],
      ["review", "Review"],
    ],
  },
  {
    group: "Planning",
    items: [
      ["plans", "Plans"],
      ["projections", "Projections"],
    ],
  },
  {
    group: "Balances",
    items: [
      ["savings", "Savings"],
      ["investments", "Investments"],
      ["loans", "Loans"],
      ["giving", "Giving"],
    ],
  },
  {
    group: "Recurring",
    items: [
      ["routines", "Routines"],
      ["schedules", "Schedules"],
    ],
  },
];
const TITLES = Object.fromEntries([
  ...NAV.flatMap((g) => g.items),
  ["settings", "Settings"],
  ["more", "More"],
]) as Record<Screen, string>;
/** Every screen the Ask bar can jump to, in sidebar order. */
const JUMPS: Screen[] = [...NAV.flatMap((g) => g.items.map(([to]) => to)), "settings"];
/** The phone's tabs, by how often they are used; More lists the rest in sidebar groups. */
const TABBED: Screen[] = ["home", "inbox", "activity"];
/** The screens that show one month, chosen in the top bar. */
const MONTHLY: Screen[] = ["home", "activity", "review"];
const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  Boolean(target.closest("input,textarea,select,[contenteditable],[role=textbox]"));
/** Where a screen's own row keys start: a grid's current cell, a Plan, a Review step. */
const ROW_KEYS =
  '[role=grid] [tabindex="0"], [data-keyrow] button:enabled, .disclose[tabindex="0"]';

export function Workspace({
  initial,
  signedOut,
  screen: requested,
  month: requestedMonth,
  navigate,
  entityId,
  requestedEntity,
  switchEntity,
}: {
  initial: BrowserSession;
  signedOut: (message?: string) => void;
  /** The screen in the address. Without it the workspace keeps its own screen, as in tests. */
  screen?: Screen;
  /** The month in the address, YYYY-MM; undefined is the Entity's current month. */
  month?: string;
  /** month: undefined leaves the address without a month. */
  navigate?: (to: Screen, replace?: boolean, month?: string) => void;
  /** The Entity this workspace serves for its whole life; without it, the first one. */
  entityId?: string;
  /** The Entity in the address; a different one is a switch, guarded like any navigation. */
  requestedEntity?: string;
  /**
   * Remount the workspace for another Entity with the latest session. fromAddress: the
   * address already names it (Back or Forward), so there is nothing to navigate.
   */
  switchEntity?: (id: string, session: BrowserSession, fromAddress: boolean) => void;
}) {
  const [session, setSession] = useState(initial);
  const own = (s: BrowserSession) => s.entities.find((e) => e.id === entityId) ?? s.entities[0];
  const thisMonth = own(initial)?.today.slice(0, 7) ?? "";
  const [local, setLocal] = useState<{ screen: Screen; month?: string }>({ screen: "home" });
  const target = requested ?? local.screen;
  const targetMonth = (navigate ? requestedMonth : local.month) ?? thisMonth;
  const [screen, setScreen] = useState<Screen>(target);
  useEffect(() => {
    if (session.screen_timing) return observeScreen(screen, session.csrf_token);
  }, [screen, session.screen_timing, session.csrf_token]);
  const [month, setMonth] = useState(targetMonth);
  // A one-shot request for Activity's entry dialog, from Add activity or the N key.
  const [add, setAdd] = useState(0);
  const approved = useRef<{ to: Screen; month: string; keep: boolean } | null>(null);
  const [palette, setPalette] = useState(false);
  const [assistant, setAssistant] = useState(false);
  /** The Ask bar's latest request to the assistant panel: a question or a tab to show. */
  const [request, setRequest] = useState<{ id: number; ask?: string; tab?: "pending" }>({ id: 0 });
  const toAssistant = (next: { ask?: string; tab?: "pending" }) => {
    setAssistant(true);
    setRequest((r) => ({ id: r.id + 1, ...next }));
  };
  // A one-shot request for the Inbox's flow mode, from /inbox.
  const [flow, setFlow] = useState(0);
  const [shortcuts, setShortcuts] = useState(false);
  const [theme, setTheme] = useTheme();
  const [refresh, setRefresh] = useState(0);
  const [metadataStale, setMetadataStale] = useState(false);
  const [metadataError, setMetadataError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<RecoveryStatus | null>(null);
  const [message, setMessage] = useState("");
  const dirty = useRef(false);
  const planDirty = useRef(false);
  const live = useRef(true);
  const pending = useRef(new RecoverableWrite<unknown>());
  const afterSave = useRef<(data: unknown) => void>(() => {});
  const [concealed, setConcealed] = useState(false);
  const [creating, setCreating] = useState(false);
  const streaming = useRef(false);
  const entity = own(session);
  // A pending read started before a write or credential change cannot satisfy a new load.
  // biome-ignore lint/correctness/useExhaustiveDependencies: A new scope invalidates pending reads.
  const reads = useMemo(() => new Map(), [entity?.id, session.csrf_token, refresh, concealed]);
  // What a screen last showed outlives a refresh, but never a change of Entity, session or User.
  // biome-ignore lint/correctness/useExhaustiveDependencies: A new scope drops what was shown.
  const lastReads = useMemo(() => new Map(), [entity?.id, session.csrf_token, concealed]);
  const changed = () => setRefresh((x) => x + 1);
  // Several Entities: links carry the Entity so a copied or new-tab address opens the same one.
  const linkEntity = session.entities.length > 1 ? entity?.id : undefined;
  useEffect(() => {
    live.current = true;
    const remove = guardUnsavedNavigation(
      () => dirty.current || planDirty.current || pending.current.hasPending(),
    );
    return () => {
      live.current = false;
      pending.current.clear();
      remove();
    };
  }, []);
  // Retained Plan edits live in tab memory across screens, so only the navigated-to screen's own
  // draft and pending write can block its actions. Closing the tab still warns about Plans.
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
      planDirty.current = false;
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
    if (signIn)
      setSession((current) => ({
        ...current,
        csrf_token: next.session.csrf_token,
      }));
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

  // Every screen change, from a link, a key, the palette or Back and Forward, passes this guard.
  // Plan edits remain mounted in tab memory across workspace navigation.
  const canLeave = () => !props.busy && confirmInAppNavigation(() => dirty.current);
  const move = (to: Screen, replace = false, m = month) => {
    const kept = m === thisMonth ? undefined : m;
    if (navigate) navigate(to, replace, kept);
    else setLocal({ screen: to, month: kept });
  };
  /**
   * keep: Home and Plans are one mounted screen, so moving between them keeps its pending write.
   * A change of month is a navigation too, and passes the same guard.
   */
  function go(to: Screen, keep = false, m = month): boolean {
    if ((to === screen && m === month) || concealed || !(keep || canLeave())) return false;
    approved.current = { to, month: m, keep };
    move(to, false, m);
    return true;
  }
  // Home's Continue opens one routine occurrence; any other arrival opens the list.
  const [routineStart, setRoutineStart] = useState<{ routine: string; on: string }>();
  useEffect(() => {
    if (screen !== "routines") setRoutineStart(undefined);
  }, [screen]);
  function addActivity() {
    if (screen === "activity") setAdd((x) => x + 1);
    else if (go("activity")) setAdd(1);
  }
  /**
   * Switching Entities drops this workspace's tab memory: retained Plan drafts, an unconfirmed
   * write and the month. It waits for an in-flight save or assistant reply instead of cutting
   * them off, and asks before discarding unsaved input.
   */
  function canSwitch(): boolean {
    if (concealed) return false;
    if (busy || metadataStale) {
      setMessage("Wait for the current save to finish before switching Entities.");
      return false;
    }
    if (streaming.current) {
      setMessage("Wait for the assistant's reply to finish before switching Entities.");
      return false;
    }
    return confirmInAppNavigation(
      () => dirty.current || planDirty.current || pending.current.hasPending(),
    );
  }
  function leaveFor(id: string, next: BrowserSession, fromAddress: boolean) {
    pending.current.clear();
    dirty.current = false;
    planDirty.current = false;
    switchEntity?.(id, next, fromAddress);
  }
  function switchTo(id: string, next = session): boolean {
    if (!switchEntity || id === entity?.id || !canSwitch()) return false;
    leaveFor(id, next, false);
    return true;
  }
  function create(body: { name: string; time_zone: string }) {
    save(createEntity(body), (created) => {
      setCreating(false);
      void credentials()
        .then((next) => {
          if (!live.current) return;
          setSession(next);
          if (!switchTo(created.id, next))
            setMessage(`Created ${created.name}. Switch to it from the Entity menu.`);
        })
        .catch(() => {
          if (live.current) setMessage(`Created ${created.name}. Reload to switch to it.`);
        });
    });
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: Only a change of address is a switch.
  useEffect(() => {
    if (!requestedEntity || !entity || requestedEntity === entity.id) return;
    if (!session.entities.some((e) => e.id === requestedEntity)) return;
    if (canSwitch()) leaveFor(requestedEntity, session, true);
    else move(screen, true);
  }, [requestedEntity]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Only a change of address is a navigation.
  useEffect(() => {
    if (target === screen && targetMonth === month) return;
    const ok = approved.current?.to === target && approved.current?.month === targetMonth;
    const keep = ok && approved.current?.keep;
    approved.current = null;
    if (ok || (!concealed && canLeave())) {
      if (!keep) {
        pending.current.clear();
        dirty.current = false;
        setStatus(null);
        setMessage("");
      }
      setScreen(target);
      setMonth(targetMonth);
    } else move(screen, true);
  }, [target, targetMonth]);
  useEffect(() => {
    document.title = concealed ? "Accanto" : `${TITLES[screen]} · Accanto`;
    document.documentElement.scrollTop = 0;
  }, [screen, concealed]);
  useEffect(() => {
    if (message !== "Saved.") return;
    const timer = window.setTimeout(() => setMessage(""), 6000);
    return () => window.clearTimeout(timer);
  }, [message]);

  const onKey = (event: KeyboardEvent) => {
    if (concealed || !entity || event.defaultPrevented) return;
    if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "j") {
      if (document.querySelector("dialog[open]")) return;
      event.preventDefault();
      setAssistant((open) => !open);
      return;
    }
    if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "k") {
      if (!palette && document.querySelector("dialog[open]")) return;
      event.preventDefault();
      setPalette(!palette);
      return;
    }
    if (
      event.repeat ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      typing(event.target) ||
      keysBelongElsewhere(event.target)
    )
      return;
    if (event.key === "?") setShortcuts(true);
    else if (event.key === "n") {
      event.preventDefault();
      addActivity();
    } else if (MONTHLY.includes(screen) && (event.key === "[" || event.key === "]")) {
      event.preventDefault();
      if (!props.busy) go(screen, false, addMonths(month, event.key === "[" ? -1 : 1));
    } else if (event.key === "j" || event.key === "k") {
      const rows = [...document.querySelectorAll<HTMLElement>("#main [data-row]")];
      const main = document.querySelector("#main");
      // Screens with their own row keys take j and k once focus is in their rows.
      if (!rows.length && !main?.contains(document.activeElement)) {
        main?.querySelector<HTMLElement>(ROW_KEYS)?.focus();
        return;
      }
      const at = rows.indexOf(document.activeElement as HTMLElement);
      const step = event.key === "j" ? 1 : at < 0 ? 0 : -1;
      rows[Math.max(0, Math.min(rows.length - 1, at + step))]?.focus();
    }
  };
  const keys = useRef(onKey);
  keys.current = onKey;
  useEffect(() => {
    const listener = (event: KeyboardEvent) => keys.current(event);
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, []);

  const link = (to: Screen, label: string) => (
    <a
      key={to}
      className="nav"
      href={hrefFor(to, month === thisMonth ? undefined : month, linkEntity)}
      aria-current={(to === "more" ? !TABBED.includes(screen) : screen === to) ? "page" : undefined}
      onClick={(event: MouseEvent) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
          return;
        event.preventDefault();
        go(to);
      }}
    >
      <Icon name={to} />
      {label}
    </a>
  );
  /** A row on the phone's More screen. */
  const moreRow = (to: Screen) => (
    <a
      key={to}
      className="row"
      href={hrefFor(to, undefined, linkEntity)}
      data-row
      onClick={(e) => {
        e.preventDefault();
        go(to);
      }}
    >
      <Icon name={to} />
      <span className="t">{TITLES[to]}</span>
      <Icon name="right" />
    </a>
  );
  const commands: Action[] = [
    {
      text: "Process my inbox",
      hint: "Inbox flow",
      slash: "/inbox",
      run: () => {
        if (screen === "inbox" || go("inbox")) setFlow((x) => x + 1);
      },
    },
    { text: "Add activity", hint: "Action", slash: "/add", run: addActivity },
    {
      text: "Pending changes",
      hint: "Assistant",
      slash: "/pending",
      run: () => toAssistant({ tab: "pending" }),
    },
    ...JUMPS.map((to) => ({
      text: `Go to ${TITLES[to]}`,
      hint: "Screen",
      run: () => go(to),
    })),
    ...(switchEntity
      ? [
          ...session.entities
            .filter((e) => e.id !== entity?.id)
            .map((e) => ({
              text: `Switch to ${e.name}${e.role === "member" ? " (shared with you)" : ""}`,
              hint: "Entity",
              run: () => void switchTo(e.id),
            })),
          { text: "Create Entity", hint: "Entity", run: () => setCreating(true) },
        ]
      : []),
    ...(month === thisMonth
      ? []
      : [
          {
            text: `Go to ${fmtMonth(thisMonth)}`,
            hint: "Month",
            run: () => go(screen, false, thisMonth),
          },
        ]),
    ...(["light", "dark", "system"] as const)
      .filter((choice) => choice !== theme)
      .map((choice) => ({
        text: choice === "system" ? "Follow the system theme" : `Use the ${choice} theme`,
        hint: "Appearance",
        run: () => setTheme(choice),
      })),
    { text: "Show keyboard shortcuts", hint: "Help", run: () => setShortcuts(true) },
    { text: "Sign out", hint: "Account", run: () => void signOut() },
  ];

  // A modal dialog makes the page behind it inert, so the notice follows into the open dialog.
  const dialogSlot = useDialogSlot();
  const notice = status && (
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
  );

  return (
    <div className={assistant && entity && !concealed ? "app with-agent" : "app"}>
      <button
        type="button"
        className="btn skip"
        onClick={() => document.getElementById("main")?.focus()}
      >
        Skip to content
      </button>
      <aside className="side">
        <a
          className="logo"
          href={hrefFor("home", undefined, linkEntity)}
          onClick={(e) => {
            e.preventDefault();
            go("home");
          }}
        >
          <Mark />
          accanto
        </a>
        {entity && (
          <nav className="side-nav" aria-label="Workspace" hidden={concealed}>
            {NAV.map((g) => (
              <div key={g.group}>
                <div className="navlabel">{g.group}</div>
                {g.items.map(([to, label]) => link(to, label))}
              </div>
            ))}
            <div className="side-foot">{link("settings", "Settings")}</div>
          </nav>
        )}
        <div className="side-user">
          <span>{concealed ? "Account changed" : entity?.name}</span>
          <button type="button" className="btn quiet sm" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </aside>
      <div className="main">
        <header className="top">
          {entity && !concealed && switchEntity && (
            <EntitySwitcher
              className="top-entity"
              entities={session.entities}
              current={entity}
              disabled={props.busy}
              choose={(id) => void switchTo(id)}
              create={() => setCreating(true)}
            />
          )}
          {!concealed &&
            (entity && MONTHLY.includes(screen) ? (
              <div className="month">
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Previous month"
                  aria-keyshortcuts="["
                  disabled={props.busy}
                  onClick={() => go(screen, false, addMonths(month, -1))}
                >
                  <Icon name="left" />
                </button>
                <span aria-live="polite">{fmtMonth(month)}</span>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Next month"
                  aria-keyshortcuts="]"
                  disabled={props.busy}
                  onClick={() => go(screen, false, addMonths(month, 1))}
                >
                  <Icon name="right" />
                </button>
                {month === thisMonth ? (
                  <span className="day">
                    Day {Number(entity.today.slice(8, 10))} of {daysInMonth(month)}
                  </span>
                ) : (
                  <button
                    type="button"
                    className="btn sm"
                    disabled={props.busy}
                    onClick={() => go(screen, false, thisMonth)}
                  >
                    This month
                  </button>
                )}
              </div>
            ) : (
              <span className="top-title">{TITLES[screen]}</span>
            ))}
          <span className="spacer" />
          {entity && !concealed && (
            <>
              <button
                type="button"
                className="jump"
                onClick={() => setPalette(true)}
                aria-label="Ask or jump"
                aria-keyshortcuts="Control+K Meta+K"
              >
                <Icon name="search" />
                <span>Ask or jump</span>
                <span className="kbd">Ctrl K</span>
              </button>
              <button
                type="button"
                className="btn top-agent-btn"
                aria-pressed={assistant}
                aria-keyshortcuts="Control+J Meta+J"
                onClick={() => setAssistant((open) => !open)}
              >
                <Icon name="chat" />
                <span className="top-agent">Assistant</span>
              </button>
              <button type="button" className="btn pri" aria-keyshortcuts="N" onClick={addActivity}>
                <Icon name="plus" />
                <span className="top-add">Add activity</span>
              </button>
            </>
          )}
          {concealed && (
            <button type="button" className="btn top-signout" onClick={() => void signOut()}>
              Sign out
            </button>
          )}
        </header>
        <main id="main" className="content" tabIndex={-1}>
          {!dialogSlot && notice}
          {metadataStale && !concealed && (
            <div className="recovery-notice" aria-live="polite">
              <p>
                {metadataError
                  ? "Settings were saved, but current Entity date defaults could not be refreshed. Refresh before continuing."
                  : "Refreshing Entity date defaults…"}
              </p>
              {metadataError && (
                <div className="recovery-actions">
                  <button
                    type="button"
                    className="btn sm pri"
                    onClick={() => void refreshMetadata()}
                  >
                    Refresh Entity defaults
                  </button>
                  <button
                    type="button"
                    className="btn sm"
                    onClick={() => void refreshMetadata(true)}
                  >
                    Sign in and refresh defaults
                  </button>
                </div>
              )}
            </div>
          )}
          {!entity && (
            <div className="screen">
              <p>No Entity is available yet.</p>
              <p>
                To join someone else's Entity, ask its owner to add the email you sign in with, in
                Settings under Shared with. Then reload this page.
              </p>
            </div>
          )}
          {entity && (
            <WorkspaceReads.Provider value={reads}>
              <WorkspaceLastReads.Provider value={lastReads}>
                <div hidden={screen !== "home" && screen !== "plans"}>
                  <Plans
                    {...props}
                    home={screen === "home"}
                    visible={screen === "home" || screen === "plans"}
                    month={month}
                    showPlans={() => go("plans", true)}
                    go={(to) => go(to)}
                    openRoutine={(routine, on) => {
                      if (go("routines")) setRoutineStart({ routine, on });
                    }}
                    retainedDirty={(value) => {
                      planDirty.current = value;
                    }}
                  />
                </div>
                {screen === "activity" && (
                  <ActivityScreen
                    key={month}
                    {...props}
                    month={month}
                    add={add}
                    added={() => setAdd(0)}
                  />
                )}
                {screen === "review" && (
                  <MonthlyReview key={month} {...props} month={month} go={(to) => go(to)} />
                )}
                {screen === "inbox" && (
                  <Inbox
                    {...props}
                    session={session}
                    credentials={credentials}
                    changed={changed}
                    flow={flow}
                    flowStarted={() => setFlow(0)}
                    openSettings={() => go("settings")}
                    openReview={(m) => go("review", false, m)}
                  />
                )}
                {screen === "routines" && (
                  <Routines
                    {...props}
                    credentials={credentials}
                    start={routineStart}
                    open={(to, m) => go(to, false, m ?? month)}
                  />
                )}
                {screen === "schedules" && <Schedules {...props} />}
                {screen === "projections" && (
                  <Projections
                    {...props}
                    openInvestments={() => go("investments")}
                    interview={() => toAssistant({ ask: FIRE_INTERVIEW_PROMPT })}
                  />
                )}
                {screen === "savings" && <Savings {...props} />}
                {screen === "investments" && <Destinations {...props} kind="investment" />}
                {screen === "giving" && <Destinations {...props} kind="giving" />}
                {screen === "loans" && <Balances {...props} />}
                {screen === "settings" && (
                  <Settings
                    {...props}
                    credentials={credentials}
                    saved={() => void refreshMetadata()}
                    openInbox={() => go("inbox")}
                  />
                )}
                {screen === "more" && !concealed && (
                  <div className="screen">
                    <div>
                      {NAV.map((g) => (
                        <div key={g.group}>
                          <div className="navlabel">{g.group}</div>
                          <div className="card">
                            {g.items
                              .map(([to]) => to)
                              .filter((to) => !TABBED.includes(to))
                              .map(moreRow)}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="card">{moreRow("settings")}</div>
                    <div className="more-user">
                      <span className="note">Signed in to {entity.name}</span>
                      {switchEntity && (
                        <EntitySwitcher
                          className="more-entity"
                          entities={session.entities}
                          current={entity}
                          disabled={props.busy}
                          choose={(id) => void switchTo(id)}
                          create={() => setCreating(true)}
                        />
                      )}
                      <button type="button" className="btn" onClick={() => void signOut()}>
                        Sign out
                      </button>
                    </div>
                  </div>
                )}
              </WorkspaceLastReads.Provider>
            </WorkspaceReads.Provider>
          )}
        </main>
      </div>
      {assistant && entity && !concealed && (
        <AgentPanel
          entity={entity}
          busy={props.busy}
          refresh={refresh}
          screen={screen}
          month={month}
          credentials={credentials}
          save={save}
          close={() => setAssistant(false)}
          streaming={(on) => {
            streaming.current = on;
          }}
          openSettings={() => go("settings")}
          changed={changed}
          settingsChanged={() => void refreshMetadata()}
          request={request}
        />
      )}
      {entity && (
        <nav className="tabs" aria-label="Sections" hidden={concealed}>
          {link("home", "Home")}
          {link("inbox", "Inbox")}
          <button
            type="button"
            className="nav"
            aria-pressed={assistant}
            onClick={() => setAssistant((open) => !open)}
          >
            <Icon name="chat" />
            Assistant
          </button>
          {link("activity", "Activity")}
          {link("more", "More")}
        </nav>
      )}
      {dialogSlot && notice && createPortal(notice, dialogSlot)}
      {palette && entity && !concealed && (
        <AskBar
          entity={entity}
          month={month}
          actions={commands}
          ask={(ask) => toAssistant({ ask })}
          go={(to) => go(to)}
          close={() => setPalette(false)}
        />
      )}
      {shortcuts && !concealed && <Shortcuts close={() => setShortcuts(false)} />}
      {creating && entity && !concealed && (
        <CreateEntityDialog
          zone={entity.time_zone}
          busy={props.busy}
          submit={create}
          close={() => {
            if (!busy) setCreating(false);
          }}
        />
      )}
      {message && !concealed && (
        <output className="toast">
          {message}
          <button type="button" className="x" aria-label="Dismiss" onClick={() => setMessage("")}>
            ×
          </button>
        </output>
      )}
    </div>
  );
}

const Shortcuts = ({ close }: { close: () => void }) => (
  <Dialog title="Keyboard shortcuts" onClose={close}>
    <div className="dlg-b">
      <div className="keys">
        {[
          ["Ctrl K or ⌘ K", "Ask the assistant, jump to a screen, or run a / command"],
          ["Ctrl J or ⌘ J", "Open or close the assistant"],
          ["N", "Add activity"],
          ["[ and ]", "Previous and next month on Home, Activity and Review"],
          ["J and K", "Move through rows, then Enter to open one"],
          ["Esc", "Close a dialog"],
          ["?", "Show this list"],
        ].map(([key, what]) => (
          <div key={key} className="keys-row">
            <span className="kbd">{key}</span>
            <span>{what}</span>
          </div>
        ))}
      </div>
    </div>
  </Dialog>
);
