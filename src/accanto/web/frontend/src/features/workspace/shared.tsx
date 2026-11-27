import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { type BrowserSession, type LoadState, loading } from "../../lib/api";
import type { PlanGroup, WriteSpec } from "../../lib/monthly";
import { Wait } from "../../ui";

export type Entity = BrowserSession["entities"][number];
export interface ScreenProps {
  entity: Entity;
  concealed: boolean;
  busy: boolean;
  refresh: number;
  guard: () => boolean;
  dirty: (value: boolean) => void;
  save: <T>(spec: WriteSpec<T>, confirmed: (data: T) => void) => void;
}
export function previousMonth(month: string): string {
  const [year, number] = month.split("-").map(Number);
  return `${number === 1 ? year - 1 : year}-${String(number === 1 ? 12 : number - 1).padStart(2, "0")}-01`;
}
export function sourceChoices(plans: PlanGroup[]) {
  const sources = new Map<string, { id: string; label: string }>();
  for (const plan of plans)
    for (const revision of [...plan.revisions].reverse()) {
      for (const line of revision.incomes)
        if (!sources.has(line.source_id)) {
          sources.set(line.source_id, {
            id: line.source_id,
            label: `${line.name} (${revision.name})`,
          });
        }
    }
  return [...sources.values()];
}
export type ThemeChoice = "system" | "light" | "dark";
// Tab memory only: the choice is not written to browser storage and resets on reload.
let themeChoice: ThemeChoice = "system";
const themeListeners = new Set<() => void>();
const systemDark = () => window.matchMedia?.("(prefers-color-scheme: dark)");
function applyTheme() {
  const dark = themeChoice === "system" ? Boolean(systemDark()?.matches) : themeChoice === "dark";
  if (dark) document.documentElement.dataset.theme = "dark";
  else delete document.documentElement.dataset.theme;
}
/** Follows the system until the User picks Light or Dark; `<html data-theme="dark">` is dark. */
export function useTheme(): [ThemeChoice, (choice: ThemeChoice) => void] {
  const choice = useSyncExternalStore(
    (notify) => {
      themeListeners.add(notify);
      const media = systemDark();
      media?.addEventListener("change", applyTheme);
      return () => {
        themeListeners.delete(notify);
        media?.removeEventListener("change", applyTheme);
      };
    },
    () => themeChoice,
  );
  useEffect(applyTheme, []);
  return [
    choice,
    (next) => {
      themeChoice = next;
      applyTheme();
      for (const notify of themeListeners) notify();
    },
  ];
}
/** Enter or Escape that confirms an input-method candidate must not commit or leave the field. */
export const composing = (event: { nativeEvent: KeyboardEvent }) =>
  event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229;

/**
 * One owner for the keyboard: a screen's single-key shortcuts stand back while a dialog is open
 * or while focus is in a region that owns its keys, such as the assistant panel. Without this,
 * a key pressed on a button in the panel acted on the screen behind it.
 */
export const keysBelongElsewhere = (target: EventTarget | null) =>
  Boolean(document.querySelector("dialog[open]")) ||
  (target instanceof Element && Boolean(target.closest("[data-own-keys]")));

/** Share pending reads only. A later visit still checks authorization and gets fresh data. */
export const WorkspaceReads = createContext<Map<string, Promise<LoadState<unknown>>> | null>(null);
/**
 * The last data each shared read returned in this workspace scope (Entity, session and User).
 * A later visit shows it while its own read refetches, instead of a placeholder that collapses.
 */
export const WorkspaceLastReads = createContext<Map<string, LoadState<unknown>> | null>(null);

/** Disposed reads cannot populate a new screen, User or month. */
export function useLoad<T>(
  load: () => Promise<LoadState<T>>,
  dependencies: unknown[],
  { enabled = true, share }: { enabled?: boolean; share?: string } = {},
) {
  const reads = useContext(WorkspaceReads);
  const pool = share ? reads : null;
  const lastReads = useContext(WorkspaceLastReads);
  const last = share ? lastReads : null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: Callers provide the request identity and explicit reload generation.
  const identity = useMemo(() => ({}), [enabled, pool, share, ...dependencies]);
  const [settled, setSettled] = useState<{ identity: object; result: LoadState<T> }>();
  // biome-ignore lint/correctness/useExhaustiveDependencies: The identity above drives the load, not the inline callback.
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    const pending = share ? (pool?.get(share) as Promise<LoadState<T>> | undefined) : undefined;
    const request = pending ?? load();
    if (!pending && pool && share) {
      pool.set(share, request);
      const release = () => pool.delete(share);
      void request.then(release, release);
    }
    void request.then((result) => {
      if (disposed) return;
      if (last && share) {
        if (result.kind === "ready" || result.kind === "empty")
          last.set(share, { ...result, stale: true });
        else last.delete(share);
      }
      setSettled({ identity, result });
    });
    return () => {
      disposed = true;
    };
  }, [identity]);
  if (!enabled) return loading;
  if (settled?.identity === identity) return settled.result;
  return ((share && last?.get(share)) as LoadState<T> | undefined) ?? loading;
}
export function LoadMessage({ state, retry }: { state: LoadState<unknown>; retry: () => void }) {
  if (state.kind === "loading")
    return (
      <Wait>
        <output className="note">Loading…</output>
      </Wait>
    );
  if (state.kind === "ready" || state.kind === "empty") return null;
  return (
    <div role="alert" className="banner bad">
      <span>Could not load this workspace. {state.error.message}</span>
      <button type="button" className="btn sm" onClick={retry}>
        Try loading again
      </button>
    </div>
  );
}
