import { type MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { type BrowserSession, readSession } from "../../lib/api";
import { addMonths, daysInMonth, fmtMonth } from "../../lib/format";
import type { WriteSpec } from "../../lib/monthly";
import {
  RecoverableWrite,
  confirmInAppNavigation,
  guardUnsavedNavigation,
  logout,
  reauthenticate,
} from "../../lib/recoverableWrite";
import { Dialog, Icon, useDialogSlot } from "../../ui";
import { AgentPanel } from "../agent/AgentPanel";
import { Balances } from "../balances/Balances";
import { Destinations } from "../destinations/Destinations";
import { IncomeEstimates } from "../estimates/IncomeEstimates";
import { Inbox } from "../inbox/Inbox";
import { RecoveryNotice, type RecoveryStatus } from "../recovery/RecoveryNotice";
import { Savings } from "../savings/Savings";
import { Settings } from "../settings/Settings";
import { ActivityScreen } from "./Activity";
import { MonthlyReview } from "./MonthlyReview";
import { Plans } from "./Plans";
import { useTheme } from "./shared";

/** Every screen has its own address; "more" is the phone's list of the screens without a tab. */
export const SCREENS = [
  "home",
  "activity",
  "inbox",
  "review",
  "plans",
  "estimates",
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
export const hrefFor = (screen: Screen, month?: string) =>
  `${screen === "home" ? "#/" : `#/${screen}`}${month ? `?m=${month}` : ""}`;

// Destinations grouped by job instead of nine numbered tabs.
const NAV: { group: string; items: [Screen, string][] }[] = [
  {
    group: "This month",
    items: [
      ["home", "Home"],
      ["activity", "Activity"],
      ["inbox", "Transactions inbox"],
      ["review", "Review"],
    ],
  },
  {
    group: "Planning",
    items: [
      ["plans", "Plans"],
      ["estimates", "Income estimates"],
    ],
  },
  {
    group: "Balances",
    items: [
      ["savings", "Savings"],
      ["investments", "Investments"],
      ["giving", "Giving"],
      ["loans", "Loans"],
    ],
  },
];
const TITLES = Object.fromEntries([
  ...NAV.flatMap((g) => g.items),
  ["settings", "Settings"],
  ["more", "More"],
]) as Record<Screen, string>;
/**
 * Sidebar order; keys 1 to 9 jump to the first nine. The inbox has no number: it uses 1 to 6
 * itself for categories, and leaving it out keeps every other screen's number unchanged.
 */
const ORDER: Screen[] = [
  ...NAV.flatMap((g) => g.items.map(([to]) => to)).filter((to) => to !== "inbox"),
  "settings",
];
const TABBED: Screen[] = ["home", "activity", "review", "plans"];
/** The screens that show one month, chosen in the top bar. */
const MONTHLY: Screen[] = ["home", "activity", "review"];
const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  Boolean(target.closest("input,textarea,select,[contenteditable],[role=textbox]"));

export function Workspace({
  initial,
  signedOut,
  screen: requested,
  month: requestedMonth,
  navigate,
}: {
  initial: BrowserSession;
  signedOut: (message?: string) => void;
  /** The screen in the address. Without it the workspace keeps its own screen, as in tests. */
  screen?: Screen;
  /** The month in the address, YYYY-MM; undefined is the Entity's current month. */
  month?: string;
  /** month: undefined leaves the address without a month. */
  navigate?: (to: Screen, replace?: boolean, month?: string) => void;
}) {
  const [session, setSession] = useState(initial);
  const thisMonth = initial.entities[0]?.today.slice(0, 7) ?? "";
  const [local, setLocal] = useState<{ screen: Screen; month?: string }>({ screen: "home" });
  const target = requested ?? local.screen;
  const targetMonth = (navigate ? requestedMonth : local.month) ?? thisMonth;
  const [screen, setScreen] = useState<Screen>(target);
  const [month, setMonth] = useState(targetMonth);
  // A one-shot request for Activity's entry dialog, from Add activity or the N key.
  const [add, setAdd] = useState(0);
  const approved = useRef<{ to: Screen; month: string; keep: boolean } | null>(null);
  const [palette, setPalette] = useState(false);
  const [assistant, setAssistant] = useState(false);
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
  const entity = session.entities[0];
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
  function addActivity() {
    if (screen === "activity") setAdd((x) => x + 1);
    else if (go("activity")) setAdd(1);
  }
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
      document.querySelector("dialog[open]")
    )
      return;
    if (/^[1-9]$/.test(event.key)) {
      event.preventDefault();
      go(ORDER[Number(event.key) - 1]);
    } else if (event.key === "?") setShortcuts(true);
    else if (event.key === "n") {
      event.preventDefault();
      addActivity();
    } else if (MONTHLY.includes(screen) && (event.key === "[" || event.key === "]")) {
      event.preventDefault();
      if (!props.busy) go(screen, false, addMonths(month, event.key === "[" ? -1 : 1));
    } else if (event.key === "j" || event.key === "k") {
      const rows = [...document.querySelectorAll<HTMLElement>("#main [data-row]")];
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
      href={hrefFor(to, month === thisMonth ? undefined : month)}
      aria-current={(to === "more" ? !TABBED.includes(screen) : screen === to) ? "page" : undefined}
      aria-keyshortcuts={
        ORDER.indexOf(to) >= 0 && ORDER.indexOf(to) < 9 ? String(ORDER.indexOf(to) + 1) : undefined
      }
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
  const commands: Command[] = [
    ...[...ORDER, "inbox" as const].map((to) => ({
      text: `Go to ${TITLES[to]}`,
      hint: "Screen",
      run: () => go(to),
    })),
    { text: "Add activity", hint: "Action", run: addActivity },
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
          href={hrefFor("home")}
          onClick={(e) => {
            e.preventDefault();
            go("home");
          }}
        >
          <i />
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
                aria-label="Search or jump"
                aria-keyshortcuts="Control+K Meta+K"
              >
                <Icon name="search" />
                <span>Search or jump</span>
                <span className="kbd">Ctrl K</span>
              </button>
              <button
                type="button"
                className="btn"
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
              <p>No Entity is available. Contact the operator to complete setup.</p>
            </div>
          )}
          {entity && (
            <>
              <div hidden={screen !== "home" && screen !== "plans"}>
                <Plans
                  {...props}
                  home={screen === "home"}
                  visible={screen === "home" || screen === "plans"}
                  month={month}
                  showPlans={() => go("plans", true)}
                  go={(to) => go(to)}
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
              {screen === "inbox" && <Inbox {...props} credentials={credentials} />}
              {screen === "estimates" && <IncomeEstimates {...props} />}
              {screen === "savings" && <Savings {...props} />}
              {screen === "investments" && <Destinations {...props} kind="investment" />}
              {screen === "giving" && <Destinations {...props} kind="giving" />}
              {screen === "loans" && <Balances {...props} />}
              {screen === "settings" && (
                <Settings
                  {...props}
                  credentials={credentials}
                  saved={() => void refreshMetadata()}
                />
              )}
              {screen === "more" && !concealed && (
                <div className="screen">
                  <div className="card">
                    {(
                      [
                        "inbox",
                        "estimates",
                        "savings",
                        "investments",
                        "giving",
                        "loans",
                        "settings",
                      ] as const
                    ).map((to) => (
                      <a
                        key={to}
                        className="row"
                        href={hrefFor(to)}
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
                    ))}
                  </div>
                  <div className="more-user">
                    <span className="note">Signed in to {entity.name}</span>
                    <button type="button" className="btn" onClick={() => void signOut()}>
                      Sign out
                    </button>
                  </div>
                </div>
              )}
            </>
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
          openSettings={() => go("settings")}
          changed={() => setRefresh((x) => x + 1)}
        />
      )}
      {entity && (
        <nav className="tabs" aria-label="Sections" hidden={concealed}>
          {link("home", "Home")}
          {link("activity", "Activity")}
          {link("review", "Review")}
          {link("plans", "Plans")}
          {link("more", "More")}
        </nav>
      )}
      {dialogSlot && notice && createPortal(notice, dialogSlot)}
      {palette && !concealed && <Palette commands={commands} close={() => setPalette(false)} />}
      {shortcuts && !concealed && <Shortcuts close={() => setShortcuts(false)} />}
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

type Command = { text: string; hint: string; run: () => void };
function Palette({ commands: all, close }: { commands: Command[]; close: () => void }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const commands = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return all.filter((c) => words.every((w) => c.text.toLowerCase().includes(w)));
  }, [all, query]);
  const at = Math.min(selected, commands.length - 1);
  const run = (command: Command) => {
    close();
    command.run();
  };
  return (
    <Dialog title="Search or jump" className="pal" onClose={close}>
      <input
        // biome-ignore lint/a11y/noAutofocus: The palette exists to take typing at once.
        autoFocus
        placeholder="Jump to a screen or run an action"
        aria-label="Search or jump"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setSelected(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setSelected(
              (at + (e.key === "ArrowDown" ? 1 : commands.length - 1)) %
                Math.max(1, commands.length),
            );
          } else if (e.key === "Enter" && commands[at]) {
            // Without this, the same key press lands on whatever opens next.
            e.preventDefault();
            run(commands[at]);
          }
        }}
      />
      {commands.length ? (
        <div className="pal-list">
          {commands.map((c, i) => (
            <button
              type="button"
              key={c.text}
              aria-current={i === at ? "true" : undefined}
              onClick={() => run(c)}
              ref={i === at ? (el) => el?.scrollIntoView?.({ block: "nearest" }) : undefined}
            >
              {c.text}
              <small>{c.hint}</small>
            </button>
          ))}
        </div>
      ) : (
        <div className="pal-none">Nothing matches "{query}". Try a screen name or an action.</div>
      )}
    </Dialog>
  );
}

const Shortcuts = ({ close }: { close: () => void }) => (
  <Dialog title="Keyboard shortcuts" onClose={close}>
    <div className="dlg-b">
      <div className="keys">
        {[
          ["Ctrl K or ⌘ K", "Search, jump to a screen, or run an action"],
          ["Ctrl J or ⌘ J", "Open or close the assistant"],
          ["1 to 9", "Go to a screen, in sidebar order"],
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
