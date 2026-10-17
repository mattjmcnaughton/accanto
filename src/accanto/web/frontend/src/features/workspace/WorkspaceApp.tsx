import { Link, useBlocker } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Activity } from "./Activity";
import { Destinations } from "./Destinations";
import { EntryEditor } from "./EntryEditor";
import { Goals } from "./Goals";
import { Month } from "./Month";
import { Plans } from "./Plans";
import {
  type Entry,
  type Workspace,
  emptyWorkspace,
  saveEntry,
  storageKey,
  today,
  validateWorkspaceChange,
} from "./domain";
import { download, loadWorkspace, parseWorkspace } from "./storage";
import { Icon, Modal, Notice, type Update } from "./ui";

export type View = "month" | "activity" | "plans" | "goals" | "investments" | "giving";
const destinations: { id: View; label: string }[] = [
  { id: "month", label: "Month" },
  { id: "activity", label: "Activity" },
  { id: "plans", label: "Plans" },
  { id: "goals", label: "Goals" },
  { id: "investments", label: "Investments" },
  { id: "giving", label: "Giving" },
];
export function WorkspaceApp({
  view,
  month,
  navigate,
}: { view: View; month: string; navigate: (view: View, month: string) => void }) {
  const [loaded] = useState(loadWorkspace);
  const [state, setState] = useState(loaded.state);
  const [error, setError] = useState(loaded.error);
  const [blocked, setBlocked] = useState(Boolean(loaded.error));
  const [entry, setEntry] = useState<Entry | "new" | null>(null);
  const [entryInitial, setEntryInitial] = useState<Pick<Entry, "kind" | "sourceId">>();
  const [settings, setSettings] = useState(false);
  const [commands, setCommands] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [toast, setToast] = useState("");
  const [deleted, setDeleted] = useState<Entry | null>(null);
  const storageSnapshot = useRef<string | null>(null);
  useEffect(() => {
    try {
      storageSnapshot.current = localStorage.getItem(storageKey);
    } catch {}
  }, []);
  const update: Update = (next, message) => {
    try {
      if (blocked)
        throw new Error("Resolve the saved-data issue in Settings before making changes.");
      const current = localStorage.getItem(storageKey);
      if (current !== storageSnapshot.current)
        throw new Error(
          "This prototype changed in another tab. Export your current view in Settings, then reload to open the newer version.",
        );
      if (message !== "Backup restored") validateWorkspaceChange(state, next);
      const { audit: _oldAudit, ...before } = state;
      const { audit: _newAudit, ...after } = next;
      const audited = {
        ...next,
        audit: [
          ...(state.audit ?? []),
          {
            at: new Date().toISOString(),
            actor: "prototype user",
            interface: "browser",
            before,
            after,
          },
        ],
      };
      const raw = JSON.stringify(audited);
      localStorage.setItem(storageKey, raw);
      storageSnapshot.current = raw;
      setState(audited);
      setError("");
      if (message) setToast(message);
      return true;
    } catch (e) {
      setError(
        (e as Error).message ||
          "Browser storage is unavailable. Export your work before closing this page.",
      );
      return false;
    }
  };
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const listener = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", listener);
    return () => window.removeEventListener("beforeunload", listener);
  }, [dirty]);
  useBlocker({
    shouldBlockFn: () =>
      dirty && !window.confirm("Leave this Plan and discard unsaved draft changes?"),
    enableBeforeUnload: dirty,
  });
  const go = useCallback(
    (next: View, nextMonth = month) => {
      navigate(next, nextMonth);
      window.scrollTo({ top: 0 });
    },
    [month, navigate],
  );
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).closest(
        "input,textarea,select,[contenteditable=true]",
      );
      const dialog = document.querySelector("dialog[open]");
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k" && !dialog) {
        e.preventDefault();
        setCommands(true);
        return;
      }
      if (typing || dialog || e.metaKey || e.ctrlKey) return;
      if (e.key.toLowerCase() === "n") {
        e.preventDefault();
        setEntryInitial(undefined);
        setEntry("new");
      }
      if (e.altKey && /^[1-6]$/.test(e.key)) {
        const d = destinations[Number(e.key) - 1];
        if (d) {
          e.preventDefault();
          go(d.id);
        }
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [go]);
  const openEntry = (value?: Entry) => {
    setEntryInitial(undefined);
    setEntry(value ?? "new");
  };
  const contribute = (kind: Entry["kind"], sourceId: string) => {
    setEntryInitial({ kind, sourceId });
    setEntry("new");
  };
  const props = { state, update, openEntry };
  return (
    <div className="workspace">
      <button
        type="button"
        className="skip-link"
        onClick={() => document.getElementById("workspace-main")?.focus()}
      >
        Skip to content
      </button>
      <aside className="sidebar">
        <Link className="brand" to="/" search={{ view: "month", month }} aria-label="Accanto home">
          <span className="brand-mark">
            a<span />
          </span>
          accanto
        </Link>
        <button className="entity-switch" type="button" onClick={() => setSettings(true)}>
          <span className="entity-avatar">{state.name.slice(0, 1).toUpperCase()}</span>
          <span>
            {state.name}
            <small>Personal workspace</small>
          </span>
          <Icon name="settings" size={16} />
        </button>
        <nav aria-label="Main navigation">
          {destinations.map((d) => (
            <a
              key={d.id}
              href={`#/?view=${d.id}&month=${month}`}
              className={view === d.id ? "active" : ""}
              aria-current={view === d.id ? "page" : undefined}
              onClick={(e) => {
                e.preventDefault();
                go(d.id);
              }}
            >
              <Icon name={d.id} />
              {d.label}
              {view === d.id && <span className="nav-indicator" />}
            </a>
          ))}
        </nav>
        <button type="button" className="sidebar-command" onClick={() => setCommands(true)}>
          <Icon name="search" size={18} />
          <span>Quick actions</span>
          <kbd>⌘ K</kbd>
        </button>
        <div className="sidebar-bottom">
          <div className="prototype-label">
            <span />
            Design prototype
          </div>
          <p>
            Saved in this browser.
            <br />
            Export to keep a backup.
          </p>
          <button className="sidebar-settings" type="button" onClick={() => setSettings(true)}>
            <Icon name="settings" size={18} />
            Settings & data
          </button>
        </div>
      </aside>
      <div className="workspace-content">
        <div className="topbar">
          <span className="breadcrumb">
            {state.name}
            <Icon name="arrow" size={13} />
            <strong>{destinations.find((d) => d.id === view)?.label}</strong>
          </span>
          <div>
            <span className="save-status">
              <Icon name="check" size={14} />
              Browser storage
            </span>
            <button type="button" className="button primary compact" onClick={() => openEntry()}>
              <Icon name="plus" size={16} />
              Add entry<kbd>N</kbd>
            </button>
            <button
              type="button"
              className="icon-button mobile-settings"
              aria-label="Settings and data"
              onClick={() => setSettings(true)}
            >
              <Icon name="settings" />
            </button>
          </div>
        </div>
        <main id="workspace-main" className="main-content" tabIndex={-1}>
          {error && (
            <div className="global-error">
              <Notice error>
                {error}
                <button type="button" className="text-button" onClick={() => setSettings(true)}>
                  Open Settings
                </button>
              </Notice>
            </div>
          )}
          {view === "month" && (
            <Month
              key={month}
              {...props}
              month={month}
              setMonth={(m) => go("month", m)}
              goPlans={() => go("plans")}
              goActivity={() => go("activity")}
              recordEntry={contribute}
            />
          )}
          {view === "activity" && <Activity {...props} month={month} />}
          {view === "plans" && <Plans {...props} setDirty={setDirty} />}
          {view === "goals" && (
            <Goals {...props} contribute={(sourceId) => contribute("saving", sourceId)} />
          )}
          {(view === "investments" || view === "giving") && (
            <Destinations
              key={view}
              {...props}
              kind={view === "investments" ? "investing" : "giving"}
              contribute={(sourceId) =>
                contribute(view === "investments" ? "investing" : "giving", sourceId)
              }
            />
          )}
        </main>
        <footer className="workspace-footer">
          <span>Accanto · A little more intention.</span>
          <span>
            USD <span className="dot-separator">·</span> Prototype
          </span>
        </footer>
      </div>
      {entry && (
        <EntryEditor
          key={entry === "new" ? "new" : entry.id}
          {...props}
          entry={entry === "new" ? undefined : entry}
          month={month}
          initial={entryInitial}
          onClose={() => setEntry(null)}
          onDeleted={(e) => {
            setDeleted(e);
            setToast("Entry deleted");
          }}
        />
      )}
      {settings && (
        <Settings
          state={state}
          update={update}
          blocked={blocked}
          onClose={() => setSettings(false)}
          recover={() => {
            try {
              localStorage.removeItem(storageKey);
              storageSnapshot.current = null;
              setState(emptyWorkspace());
              setBlocked(false);
              setError("");
              setSettings(false);
            } catch {
              setError("Browser storage is unavailable.");
            }
          }}
        />
      )}
      {commands && (
        <Commands
          onClose={() => setCommands(false)}
          actions={[
            ...destinations.map((d) => ({
              label: `Go to ${d.label}`,
              shortcut: `Alt ${destinations.indexOf(d) + 1}`,
              run: () => go(d.id),
            })),
            { label: "Add entry", shortcut: "N", run: () => openEntry() },
            { label: "Settings & data", shortcut: "", run: () => setSettings(true) },
          ]}
        />
      )}
      {(toast || deleted) && (
        <output className="toast">
          <Icon name="check" size={17} />
          <span>{toast || "Entry deleted"}</span>
          {deleted && (
            <button
              type="button"
              onClick={() => {
                try {
                  if (update(saveEntry(state, { ...deleted, deleted: false }), "Entry restored"))
                    setDeleted(null);
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Undo delete
            </button>
          )}
          <button
            type="button"
            className="toast-close"
            aria-label="Dismiss notification"
            onClick={() => {
              setToast("");
              setDeleted(null);
            }}
          >
            <Icon name="close" size={16} />
          </button>
        </output>
      )}
    </div>
  );
}
function Settings({
  state,
  update,
  onClose,
  blocked,
  recover,
}: {
  state: Workspace;
  update: Update;
  onClose: () => void;
  blocked: boolean;
  recover: () => void;
}) {
  const [name, setName] = useState(state.name);
  const [error, setError] = useState("");
  const file = useRef<HTMLInputElement>(null);
  return (
    <Modal title="Settings & data" onClose={onClose}>
      <div className="modal-body">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) {
              setError("Enter an Entity name.");
              return;
            }
            if (update({ ...state, name: name.trim() }, "Entity renamed")) onClose();
          }}
        >
          <label className="field">
            <span>Entity name</span>
            <input
              maxLength={120}
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <button type="submit" className="button secondary settings-save">
            Save name
          </button>
        </form>
        <div className="settings-section">
          <h3>About this prototype</h3>
          <p>
            Use this to try the workflows and design. Data stays in this browser on this device; it
            does not sync or connect to financial accounts. No sample financial records are added.
          </p>
        </div>
        <div className="settings-section">
          <h3>Keep your work</h3>
          <p>
            Export your Plans, Reviews, activity, goals, investments, and giving recipients. You can
            restore the file in another browser.
          </p>
          <div className="detail-actions">
            <button
              type="button"
              className="button secondary"
              onClick={() =>
                download(JSON.stringify(state, null, 2), `accanto-prototype-${today()}.json`)
              }
            >
              <Icon name="download" size={16} />
              Export data
            </button>
            <button
              className="button secondary"
              type="button"
              onClick={() => file.current?.click()}
            >
              Restore backup
            </button>
          </div>
          <input
            ref={file}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            aria-label="Restore backup file"
            onChange={async (e) => {
              const uploaded = e.target.files?.[0];
              if (!uploaded) return;
              try {
                if (uploaded.size > 10_000_000)
                  throw new Error("Choose a backup smaller than 10 MB.");
                const restored = parseWorkspace(await uploaded.text());
                if (
                  !window.confirm(
                    `Replace this browser’s prototype with “${restored.name}”? Export your current data first if you want to keep it.`,
                  )
                )
                  return;
                if (update(restored, "Backup restored")) onClose();
              } catch {
                setError(
                  "This file is not a valid Accanto prototype backup. Your current data has not changed.",
                );
              } finally {
                e.target.value = "";
              }
            }}
          />
        </div>
        {blocked && (
          <div className="settings-section">
            <h3>Recover stored data</h3>
            <p>
              The existing browser data could not be read. Export the raw copy before resetting it.
            </p>
            <button
              type="button"
              className="button secondary"
              onClick={() => {
                try {
                  download(localStorage.getItem(storageKey) ?? "", "accanto-recovery.json");
                } catch {
                  setError("Stored data is not accessible.");
                }
              }}
            >
              Export stored data
            </button>
          </div>
        )}
        <div className="settings-section">
          <button
            type="button"
            className="button danger-quiet"
            onClick={() => {
              if (
                window.confirm(
                  "Clear this prototype’s data in this browser? Export a backup first to keep your work.",
                )
              )
                recover();
            }}
          >
            Reset prototype
          </button>
        </div>
        {error && <Notice error>{error}</Notice>}
      </div>
    </Modal>
  );
}
function Commands({
  actions,
  onClose,
}: { actions: { label: string; shortcut: string; run: () => void }[]; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const filtered = actions.filter((a) => a.label.toLowerCase().includes(query.toLowerCase()));
  return (
    <Modal title="Quick actions" onClose={onClose}>
      <div className="modal-body command-body">
        <label className="search-field">
          <Icon name="search" />
          <input
            aria-label="Search actions"
            placeholder="Where would you like to go?"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSelected((s) => Math.min(filtered.length - 1, s + 1));
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setSelected((s) => Math.max(0, s - 1));
              }
              if (e.key === "Enter" && filtered[selected]) {
                onClose();
                filtered[selected].run();
              }
            }}
          />
        </label>
        <div className="command-list">
          {filtered.map((a, i) => (
            <button
              className={i === selected ? "active" : ""}
              key={a.label}
              type="button"
              onClick={() => {
                onClose();
                a.run();
              }}
            >
              {a.label}
              {a.shortcut && <kbd>{a.shortcut}</kbd>}
            </button>
          ))}
        </div>
        {!filtered.length && <p className="subtle">No matching actions.</p>}
      </div>
    </Modal>
  );
}
