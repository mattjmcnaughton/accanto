import { useEffect, useState, useSyncExternalStore } from "react";
import type { BrowserSession, LoadState } from "../../lib/api";
import type { PlanGroup, WriteSpec } from "../../lib/monthly";

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

/** Disposed reads cannot populate a new screen, User or month. */
export function useLoad<T>(load: () => Promise<LoadState<T>>, dependencies: unknown[]) {
  const [state, setState] = useState<LoadState<T>>({ kind: "loading" });
  // biome-ignore lint/correctness/useExhaustiveDependencies: Callers provide the request identity and explicit reload generation.
  useEffect(() => {
    let disposed = false;
    setState({ kind: "loading" });
    void load().then((result) => {
      if (!disposed) setState(result);
    });
    return () => {
      disposed = true;
    };
  }, dependencies);
  return state;
}
export function LoadMessage({ state, retry }: { state: LoadState<unknown>; retry: () => void }) {
  if (state.kind === "loading") return <output className="note">Loading…</output>;
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
