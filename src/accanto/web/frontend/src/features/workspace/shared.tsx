import { useEffect, useState } from "react";
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
export const dollars = (value: string | null) => (value === null ? "Unknown" : `$${value}`);

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
  if (state.kind === "loading") return <output>Loading…</output>;
  if (state.kind === "ready" || state.kind === "empty") return null;
  return (
    <div role="alert">
      <p>Could not load this workspace. {state.error.message}</p>
      <button type="button" onClick={retry}>
        Try loading again
      </button>
    </div>
  );
}
export function MoneyInput({
  label,
  value,
  onChange,
  signed = false,
  required = true,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  signed?: boolean;
  required?: boolean;
}) {
  return (
    <label>
      {label}
      <input
        required={required}
        inputMode="decimal"
        pattern={signed ? "-?[0-9]{1,9}([.][0-9]{1,2})?" : "[0-9]{1,9}([.][0-9]{1,2})?"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
