import "./tokens.css";
import "./ui.css";
import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { fmtDate, fmtShort, inputMoney, money, parseMoney } from "../lib/format";

const PATHS: Record<string, string> = {
  home: "M2.5 7 8 2.5 13.5 7v6.5h-11z M6.5 13.5v-4h3v4",
  activity: "M3 4h10M3 8h10M3 12h6",
  inbox: "M2.5 9.5 4.5 3h7l2 6.5v3.5h-11z M2.5 9.5h3.2l.8 1.5h3l.8-1.5h3.2",
  review: "M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11z M5.5 8l2 2 3-3.5",
  plans:
    "M4.5 2.5h7a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z M2.5 6.5h11M6.5 6.5v7",
  routines:
    "M3 4.5l1.2 1.2L6.5 3.5 M8.5 4.5h5 M3 8.5l1.2 1.2 2.3-2.2 M8.5 8.5h5 M3.5 12.5h2 M8.5 12.5h5",
  projections: "M2.5 13.5h11 M3.5 11 6.5 7.5l2.5 2 4.5-5.5 M10.5 4h3v3",
  savings: "M2.5 6.5 8 3l5.5 3.5 M3.5 6.5v5M6.5 6.5v5M9.5 6.5v5M12.5 6.5v5 M2.5 13h11",
  investments: "M2.5 12.5 6 8.5l2.5 2.5 5-6 M10.5 5h3v3",
  giving: "M8 13.5S2.5 10.2 2.5 6.4A2.9 2.9 0 0 1 8 5a2.9 2.9 0 0 1 5.5 1.4c0 3.8-5.5 7.1-5.5 7.1z",
  loans: "M2.5 4.5h11v7h-11z M2.5 7h11 M5 9.5h2",
  settings:
    "M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M8 2v1.5M8 12.5V14M2 8h1.5M12.5 8H14M3.8 3.8l1 1M11.2 11.2l1 1M3.8 12.2l1-1M11.2 4.8l1-1",
  search: "M7 11.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9z M10.5 10.5l3 3",
  plus: "M8 3v10M3 8h10",
  x: "M4 4l8 8M12 4l-8 8",
  left: "M10 3.5 5.5 8l4.5 4.5",
  right: "M6 3.5 10.5 8 6 12.5",
  down: "M3.5 6 8 10.5 12.5 6",
  more: "M3.5 8h.01M8 8h.01M12.5 8h.01",
  trash: "M3 4.5h10M6.5 4.5v-2h3v2M4.5 4.5l.5 9h6l.5-9",
  copy: "M5.5 5.5h8v8h-8z M2.5 10.5v-8h8",
  chat: "M2.5 3.5h11v7.5H7l-3 2.5V11H2.5z M5 6.5h6M5 8.5h4",
  expand: "M9.5 2.5h4v4M13.5 2.5 9 7M6.5 13.5h-4v-4M2.5 13.5 7 9",
  clip: "M10.5 5 6 9.5a1.4 1.4 0 0 0 2 2L12.6 7a2.8 2.8 0 0 0-4-4L4 7.6a4.2 4.2 0 0 0 6 6L13.5 10",
  send: "M8 13V3M3.5 7.5 8 3l4.5 4.5",
  stop: "M4.5 4.5h7v7h-7z",
  history: "M3.2 6.5A5 5 0 1 1 3 9 M3 3.5v3h3 M8 5.5V8l2 1.5",
  archive: "M2.5 3.5h11v3h-11z M3.5 6.5v6h9v-6 M6.5 9h3",
  shrink: "M13.5 2.5 9.5 6.5M9.5 3v3.5H13M2.5 13.5l4-4M3 9.5h3.5V13",
};
export const Icon = ({ name }: { name: string }) => (
  <svg className="ico" viewBox="0 0 16 16" aria-hidden="true">
    <path d={PATHS[name] ?? ""} />
  </svg>
);
/** Each category keeps one color on every screen. */
export const tint = (kind: string) => ({ "--c": `var(--c-${kind})` }) as CSSProperties;

export type BandPart = {
  key: string;
  kind: string;
  weight: number;
  fill?: number;
  hatch?: number;
  title: string;
};
/**
 * The allocation band. Solid is recorded money, pale is planned and not yet recorded,
 * and hatching is a planned line with no entry: unknown is never drawn as zero.
 */
export function Band({
  parts,
  label,
  limit,
}: { parts: BandPart[]; label: string; limit?: number }) {
  const shown = parts.filter((p) => p.weight > 0);
  if (!shown.length) return null;
  return (
    <div className="band-wrap">
      <div className="band" role="img" aria-label={label}>
        {shown.map((p) => (
          <div
            key={p.key}
            className={`seg ${p.kind === "none" ? "none" : ""}`}
            style={{ ...tint(p.kind), flexGrow: p.weight }}
            title={p.title}
          >
            <i style={{ width: `${Math.min(1, p.fill ?? 1) * 100}%` }} />
            {p.hatch ? (
              <u
                style={{
                  left: `${Math.min(1, p.fill ?? 0) * 100}%`,
                  width: `${Math.min(1, p.hatch) * 100}%`,
                }}
              />
            ) : null}
          </div>
        ))}
      </div>
      {limit !== undefined && limit < 1 && (
        <div className="limit" style={{ left: `${limit * 100}%` }}>
          <span>Funding ends here</span>
        </div>
      )}
    </div>
  );
}
export const Meter = ({
  value,
  max,
  kind,
  faint,
}: { value: number; max: number; kind: string; faint?: boolean }) => (
  <div className={`meter${faint ? " faint" : ""}`} style={tint(kind)}>
    <i style={{ width: `${max > 0 ? Math.max(0, Math.min(1, value / max)) * 100 : 0}%` }} />
  </div>
);
const scale = (values: number[], height: number, pad: number) => {
  const low = Math.min(...values);
  const span = Math.max(...values) - low || 1;
  return (v: number) => height - pad - ((v - low) / span) * (height - pad * 2);
};
export function Spark({ values, kind }: { values: number[]; kind: string }) {
  if (values.length < 2) return null;
  const y = scale(values, 34, 5);
  const points = values.map((v, i) => `${4 + (i * 192) / (values.length - 1)},${y(v)}`).join(" ");
  return (
    <svg
      className="spark"
      viewBox="0 0 200 34"
      preserveAspectRatio="none"
      aria-hidden="true"
      style={tint(kind)}
    >
      <polyline points={points} />
    </svg>
  );
}
/** A small labeled trend of dated observations. */
export function Trend({
  points,
  kind,
  label,
}: { points: { date: string; value: number }[]; kind: string; label: string }) {
  if (points.length < 2) return null;
  const values = points.map((p) => p.value);
  const y = scale(values, 84, 14);
  const x = (i: number) => 3 + (i * 94) / (points.length - 1);
  const first = points[0];
  const last = points[points.length - 1];
  return (
    <figure className="trend" style={tint(kind)}>
      <div
        className="trend-plot"
        role="img"
        aria-label={`${label}: ${money(first.value)} on ${fmtDate(first.date)}, ${money(last.value)} on ${fmtDate(last.date)}`}
      >
        <svg viewBox="0 0 100 84" preserveAspectRatio="none" aria-hidden="true">
          <polyline points={points.map((p, i) => `${x(i)},${y(p.value)}`).join(" ")} />
        </svg>
        {points.map((p, i) => (
          <b
            key={p.date}
            style={{ left: `${x(i)}%`, top: `${(y(p.value) / 84) * 100}%` }}
            title={`${fmtDate(p.date)}: ${money(p.value)}`}
          />
        ))}
      </div>
      <figcaption>
        <span>
          {fmtShort(first.date)}, {money(first.value)}
        </span>
        <span>
          {fmtShort(last.date)}, {money(last.value)}
        </span>
      </figcaption>
    </figure>
  );
}

// Open dialogs, innermost last. A modal dialog makes the rest of the page inert, so a message
// that must stay reachable while one is open renders into the innermost dialog's slot.
const slots: HTMLElement[] = [];
const slotListeners = new Set<() => void>();
const slotsChanged = () => {
  for (const notify of slotListeners) notify();
};
/** The slot at the top of the innermost open Dialog, or null when no Dialog is open. */
export function useDialogSlot(): HTMLElement | null {
  return useSyncExternalStore(
    (notify) => {
      slotListeners.add(notify);
      return () => slotListeners.delete(notify);
    },
    () => slots[slots.length - 1] ?? null,
  );
}

export function Dialog({
  title,
  onClose,
  children,
  className = "",
}: { title: string; onClose: () => void; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const slot = useRef<HTMLDivElement>(null);
  // Read on the first render, before an autofocused field inside takes focus.
  const opener = useRef(document.activeElement);
  useEffect(() => {
    const dialog = ref.current;
    const own = slot.current;
    if (!dialog || !own) return;
    slots.push(own);
    slotsChanged();
    // jsdom has no showModal or close, so tests fall back to the open attribute.
    if (!dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }
    return () => {
      slots.splice(slots.indexOf(own), 1);
      slotsChanged();
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
      // The dialog is already out of the page here, so the browser cannot return focus itself.
      // Without this, keys after Esc start from the page instead of where they left off.
      const lost = !document.activeElement || document.activeElement === document.body;
      const back = opener.current;
      if (lost && back instanceof HTMLElement && back.isConnected)
        back.focus({ preventScroll: true });
    };
  }, []);
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape closes the dialog through onCancel; the click only handles the backdrop.
    <dialog
      ref={ref}
      className={`dlg ${className}`}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div ref={slot} className="dlg-slot" />
      {className.includes("pal") ? (
        children
      ) : (
        <>
          <div className="dlg-h">
            <h2>{title}</h2>
            <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
              <Icon name="x" />
            </button>
          </div>
          {children}
        </>
      )}
    </dialog>
  );
}
export const Field = ({
  label,
  hint,
  children,
}: { label: string; hint?: string; children: ReactNode }) => (
  // biome-ignore lint/a11y/noLabelWithoutControl: The control is passed as children.
  <label className="field">
    <span>{label}</span>
    {children}
    {hint && <small>{hint}</small>}
  </label>
);
export const Empty = ({
  title,
  children,
  action,
}: { title: string; children: ReactNode; action?: ReactNode }) => (
  <div className="empty card">
    <h2>{title}</h2>
    <p>{children}</p>
    {action}
  </div>
);
export const Head = ({
  title,
  sub,
  children,
}: { title: ReactNode; sub?: ReactNode; children?: ReactNode }) => (
  <div className="head">
    <div>
      <h1 className="h1">{title}</h1>
      {sub && <p className="sub">{sub}</p>}
    </div>
    {children && <div className="head-actions">{children}</div>}
  </div>
);

/** Arrow keys and Enter move between amounts, as in a spreadsheet column. */
function gridKeys(e: KeyboardEvent<HTMLInputElement>) {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Enter") return;
  const cells = [
    ...(e.currentTarget
      .closest("[data-grid]")
      ?.querySelectorAll<HTMLInputElement>("input.amt:not(:disabled)") ?? []),
  ];
  const next = cells[cells.indexOf(e.currentTarget) + (e.key === "ArrowUp" ? -1 : 1)];
  if (next) {
    e.preventDefault();
    next.focus();
  }
}
/** An amount cell. Totals follow each valid keystroke; an invalid amount reverts when you leave the cell. */
export function AmountInput({
  cents,
  onCommit,
  label,
  disabled,
}: { cents: number; onCommit: (cents: number) => void; label: string; disabled?: boolean }) {
  const [text, setText] = useState<string | null>(null);
  const invalid = text !== null && parseMoney(text) === null;
  return (
    <input
      className="amt"
      inputMode="decimal"
      aria-label={label}
      aria-invalid={invalid}
      disabled={disabled}
      value={text ?? inputMoney(cents)}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => {
        setText(e.target.value);
        const parsed = parseMoney(e.target.value);
        if (parsed !== null) onCommit(parsed);
      }}
      onBlur={() => setText(null)}
      onKeyDown={gridKeys}
    />
  );
}
export const Skeleton = () => (
  <div className="screen" aria-busy="true" aria-label="Loading">
    <div className="sk" style={{ width: "42%", height: 30 }} />
    <div className="card pad sk-card">
      <div className="sk" style={{ width: "60%", height: 22 }} />
      <div className="sk" style={{ height: 30 }} />
      {[72, 64, 80, 58].map((w) => (
        <div key={w} className="sk" style={{ width: `${w}%`, height: 14 }} />
      ))}
    </div>
    <div className="grid3">
      {[1, 2, 3].map((n) => (
        <div key={n} className="card pad sk-card">
          <div className="sk" style={{ width: "50%", height: 12 }} />
          <div className="sk" style={{ width: "70%", height: 22 }} />
        </div>
      ))}
    </div>
  </div>
);
