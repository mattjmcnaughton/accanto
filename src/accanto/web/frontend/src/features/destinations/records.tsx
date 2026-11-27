import { type ReactNode, useEffect, useRef, useState } from "react";
import type { LoadState } from "../../lib/api";
import type { Observation } from "../../lib/balances";
import { decimalToCents, fmtDate, formatMoney } from "../../lib/format";
import { SIGNED_USD_AMOUNT, USD_AMOUNT } from "../../lib/money";
import type { WriteSpec } from "../../lib/monthly";
import { Dialog, Field, Meter } from "../../ui";
import type { ScreenProps } from "../workspace/shared";
import { useGridKeys } from "../workspace/useGridKeys";
import "./records.css";

/** Feature-local pieces shared by the Investments/Giving and Loans screens. */

export const dash = <span className="muted">—</span>;
export const validMoney = (value: string, signed = false) =>
  (signed ? SIGNED_USD_AMOUNT : USD_AMOUNT).test(value.trim());

export const Day = ({ iso }: { iso: string }) => <time dateTime={iso}>{fmtDate(iso)}</time>;

/** Dated observations of one account as chart points, oldest first. */
export function trendPoints(rows: Observation[], account: string) {
  return rows
    .filter((row) => row.account_id === account && !row.deleted)
    .flatMap((row) => {
      const value = decimalToCents(row.amount);
      return value === null ? [] : [{ date: row.financial_date, value }];
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** The last focused grid cell, restored after a save reloads (and briefly unmounts) the grids. */
let lastCell: { label: string; row: number; col: number } | null = null;
let restoreFocus = false;
function armFocusRestore() {
  restoreFocus = true;
  const stop = () => {
    restoreFocus = false;
  };
  for (const type of ["keydown", "pointerdown"])
    document.addEventListener(type, stop, { capture: true, once: true });
}

/** `wide` columns are dropped on a phone so the date, name and amount stay on screen. */
export type Column<T> = {
  header: string;
  numeric?: boolean;
  wide?: boolean;
  cell: (row: T) => ReactNode;
};
const cellClass = (column: { numeric?: boolean; wide?: boolean }) =>
  [column.numeric && "num", column.wide && "wide"].filter(Boolean).join(" ") || undefined;

export function RecordGrid<T>({
  label,
  rows,
  rowId,
  columns,
  empty,
  marked,
  edit,
  add,
  remove,
  help,
}: {
  label: string;
  rows: T[];
  rowId: (row: T) => string;
  columns: Column<T>[];
  empty: string;
  marked?: string | null;
  edit?: (row: T) => void;
  add?: () => void;
  remove?: (row: T) => void;
  help: () => void;
}) {
  const keys = useGridKeys();
  const table = useRef<HTMLTableElement>(null);
  const [position, setPosition] = useState({ row: 0, col: 0 });
  const active = {
    row: Math.min(position.row, Math.max(0, rows.length - 1)),
    col: Math.min(position.col, columns.length - 1),
  };
  const move = (next: { row: number; col: number }) => {
    setPosition(next);
    table.current?.querySelector<HTMLElement>(`[data-cell="${next.row}-${next.col}"]`)?.focus();
  };
  useEffect(() => {
    const focused = document.activeElement;
    if (!restoreFocus || lastCell?.label !== label || (focused && focused !== document.body))
      return;
    move(
      rows.length === 0
        ? { row: 0, col: 0 }
        : {
            row: Math.min(lastCell.row, rows.length - 1),
            col: Math.min(lastCell.col, columns.length - 1),
          },
    );
  });
  return (
    <div className="rec-scroll">
      <table
        ref={table}
        // biome-ignore lint/a11y/useSemanticElements: Interactive record grid with roving cell focus.
        role="grid"
        className="rec-grid"
        aria-label={label}
        aria-describedby="records-status"
      >
        <thead>
          <tr>
            {columns.map((column, col) => (
              <th key={column.header || col} scope="col" className={cellClass(column)}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td
                colSpan={columns.length}
                // biome-ignore lint/a11y/noNoninteractiveTabindex: An empty grid keeps one focusable cell for a and ?.
                tabIndex={0}
                data-cell="0-0"
                className="muted"
                onFocus={() => {
                  lastCell = { label, row: 0, col: 0 };
                }}
                onKeyDown={(event) =>
                  keys(event, {
                    rowId: "empty",
                    position: { row: 0, col: 0 },
                    rows: 0,
                    columns: 0,
                    move,
                    add,
                    help,
                  })
                }
              >
                {empty}
              </td>
            </tr>
          )}
          {rows.map((row, index) => {
            const id = rowId(row);
            return (
              <tr key={id} className={index === active.row ? "selected-row" : undefined}>
                {columns.map((column, col) => {
                  const selected = index === active.row && col === active.col;
                  return (
                    <td
                      key={column.header || col}
                      data-cell={`${index}-${col}`}
                      tabIndex={selected ? 0 : -1}
                      aria-selected={selected}
                      className={cellClass(column)}
                      onClick={() => setPosition({ row: index, col })}
                      onFocus={() => {
                        lastCell = { label, row: index, col };
                      }}
                      onDoubleClick={() => edit?.(row)}
                      onKeyDown={(event) =>
                        keys(event, {
                          rowId: id,
                          position: { row: index, col },
                          rows: rows.length,
                          columns: columns.length,
                          move,
                          edit: edit && (() => edit(row)),
                          add,
                          remove: remove && (() => remove(row)),
                          help,
                        })
                      }
                    >
                      {column.cell(row)}
                      {col === 0 && marked === id && <span className="chip warn">Unsaved</span>}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Focus `ref` once its dialog is open: showModal moves focus itself on the next frame. */
function useFocusWhenOpen<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    ref.current?.focus();
    const frame = requestAnimationFrame(() => ref.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);
  return ref;
}

export type Confirmation = { title: string; message: string; action: string; run: () => void };
export function ConfirmDialog({
  confirmation,
  close,
}: {
  confirmation: Confirmation | null;
  close: () => void;
}) {
  return confirmation && <Confirm confirmation={confirmation} close={close} />;
}
function Confirm({ confirmation, close }: { confirmation: Confirmation; close: () => void }) {
  // Cancel is the safe default in a destructive confirmation.
  const cancel = useFocusWhenOpen<HTMLButtonElement>();
  return (
    <Dialog title={confirmation.title} onClose={close}>
      <div className="dlg-b">
        <p>{confirmation.message}</p>
      </div>
      <div className="dlg-f">
        <button type="button" className="btn" ref={cancel} onClick={close}>
          Cancel
        </button>
        <button
          type="button"
          className="btn danger"
          onClick={() => {
            close();
            confirmation.run();
          }}
        >
          {confirmation.action}
        </button>
      </div>
    </Dialog>
  );
}

const SHORTCUTS = [
  ["h j k l / arrows", "Move between cells"],
  ["0 / $ · Home / End", "First / last cell in row"],
  ["gg / G", "First / last row"],
  ["i / Enter", "Open the selected record"],
  ["a / A", "Add a record to this table"],
  ["dd", "Delete the selected entry or observation, with confirmation"],
  ["Enter / Escape in details", "Keep a valid edit and return to the table"],
  ["Ctrl / ⌘ + S", "Save the record being edited"],
  ["Tab / Shift+Tab", "Leave the table or move through form fields"],
  ["?", "Open this reference"],
];
export function Shortcuts({ open, close }: { open: boolean; close: () => void }) {
  return (
    open && (
      <Dialog title="Keyboard shortcuts" onClose={close}>
        <div className="dlg-b">
          <p className="note">
            Vim-style keys apply while a table has focus. Each record saves on its own.
          </p>
          <dl className="rec-keylist">
            {SHORTCUTS.map(([key, label]) => (
              <div key={key}>
                <dt>
                  <kbd className="kbd">{key}</kbd>
                </dt>
                <dd>{label}</dd>
              </div>
            ))}
          </dl>
        </div>
      </Dialog>
    )
  );
}

export function KeyHint({ help }: { help: () => void }) {
  return (
    <p id="records-status" className="note rec-keys">
      <span>
        In tables: <kbd className="kbd">h j k l</kbd> move <kbd className="kbd">i</kbd> open{" "}
        <kbd className="kbd">a</kbd> add <kbd className="kbd">dd</kbd> delete{" "}
        <kbd className="kbd">Ctrl S</kbd> save <kbd className="kbd">Esc</kbd> back
      </span>
      <button type="button" className="btn sm quiet" onClick={help}>
        Keyboard shortcuts ?
      </button>
    </p>
  );
}

export function Notice({ text, dismiss }: { text: string; dismiss: () => void }) {
  return (
    text && (
      <output className="rec-notice">
        <span>{text}</span>
        <button
          type="button"
          className="btn sm quiet"
          aria-label="Dismiss message"
          onClick={dismiss}
        >
          ×
        </button>
      </output>
    )
  );
}

/** A closed edit that still holds unsaved values. */
export function PendingEdit({
  show,
  busy,
  review,
  save,
  discard,
}: {
  show: boolean;
  busy: boolean;
  review: () => void;
  save: () => void;
  discard: () => void;
}) {
  return (
    show && (
      <output className="rec-pending card">
        <span className="chip warn">Unsaved edit</span>
        <span className="spacer" />
        <button type="button" className="btn sm" onClick={review}>
          Review
        </button>
        <button type="button" className="btn sm pri" disabled={busy} onClick={save}>
          Save
        </button>
        <button type="button" className="btn sm" disabled={busy} onClick={discard}>
          Discard
        </button>
      </output>
    )
  );
}

export function Loading({ what }: { what: string }) {
  return (
    <div className="card pad rec-loading" aria-busy="true" aria-label={`Loading ${what}`}>
      <div className="sk" />
      <div className="sk" />
    </div>
  );
}

export function LoadFailure({ state, retry }: { state: LoadState<unknown>; retry: () => void }) {
  if (state.kind === "loading" || state.kind === "ready" || state.kind === "empty") return null;
  return (
    <div role="alert" className="card pad rec-alert">
      <p>Could not load this workspace. {state.error.message}</p>
      <button type="button" className="btn sm" onClick={retry}>
        Try loading again
      </button>
    </div>
  );
}

export function MoneyField({
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
    <Field label={label}>
      <input
        required={required}
        inputMode="decimal"
        placeholder="0.00"
        pattern={signed ? "-?[0-9]{1,9}([.][0-9]{1,2})?" : "[0-9]{1,9}([.][0-9]{1,2})?"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

/** A destination or loan at a glance: the card body is the caller's, actions sit at the foot. */
export function TrackedCard({
  name,
  chips = [],
  actions,
  children,
}: { name: string; chips?: string[]; actions: ReactNode; children: ReactNode }) {
  return (
    <div className="card pad stack">
      <div className="rec-card-head">
        <b>{name}</b>
        {chips.map((chip) => (
          <span key={chip} className="chip">
            {chip}
          </span>
        ))}
      </div>
      {children}
      <div className="actions rec-card-actions">{actions}</div>
    </div>
  );
}

/** Recorded progress against an optional target. It never mixes in an observed value. */
export function Progress({
  done,
  target,
  kind,
  text,
}: { done: string; target: string | null; kind: string; text: string | null }) {
  return (
    <div>
      {text && <span className="cap">{text}</span>}
      {target && (
        <>
          <div className="rec-meter">
            <Meter
              value={decimalToCents(done) ?? 0}
              max={decimalToCents(target) ?? 0}
              kind={kind}
            />
          </div>
          <span className="cap">
            {formatMoney(done)} of the {formatMoney(target)} target
          </span>
        </>
      )}
    </div>
  );
}

export type Draft<F> = { key: string; form: F; changed: boolean; error: string; open: boolean };

/** One record edited at a time. Escape keeps a valid edit; only Save writes it. */
export function useRecordEditor<F>(p: ScreenProps, reload: () => void) {
  const [draft, setDraft] = useState<Draft<F> | null>(null);
  const origin = useRef<HTMLElement | null>(null);
  const aside = useRef<HTMLDivElement>(null);
  const focusAside = () =>
    requestAnimationFrame(() =>
      aside.current
        ?.querySelector<HTMLElement>("input:enabled,select:enabled,textarea:enabled,button:enabled")
        ?.focus(),
    );
  // A click that does not focus its trigger (WebKit, scripted) leaves origin as body; keep keys in
  // this screen's grids (.records), never another mounted screen's, such as the hidden Plans worksheet.
  const returnFocus = () =>
    requestAnimationFrame(() => {
      const target = origin.current;
      if (target?.isConnected && target !== document.body) target.focus();
      else
        (
          (lastCell &&
            document.querySelector<HTMLElement>(
              `.records [role=grid][aria-label="${lastCell.label}"] [data-cell="${lastCell.row}-${lastCell.col}"]`,
            )) ||
          document.querySelector<HTMLElement>('.records [role=grid] td[tabindex="0"]')
        )?.focus();
    });
  const saved = () => {
    setDraft(null);
    p.dirty(false);
    reload();
    if (lastCell) armFocusRestore();
    else returnFocus();
  };
  return {
    saved,
    draft,
    aside,
    start(key: string, form: F) {
      if (draft?.key === key) {
        setDraft({ ...draft, open: true });
        focusAside();
        return;
      }
      // A pending or failed write keeps its attempted values until it is resolved.
      if (p.busy || !p.guard()) return;
      const active = document.activeElement as HTMLElement | null;
      origin.current = active?.closest("td") ?? active;
      setDraft({ key, form, changed: false, error: "", open: true });
      p.dirty(false);
      focusAside();
    },
    update(change: (form: F) => F) {
      setDraft(
        (current) =>
          current && { ...current, form: change(current.form), changed: true, error: "" },
      );
      p.dirty(true);
    },
    close(problem: string) {
      if (!draft) return;
      // An untouched record holds nothing to retain or validate; only an edit can be invalid.
      if (draft.changed && problem) {
        setDraft({ ...draft, error: problem });
        return;
      }
      setDraft(draft.changed ? { ...draft, open: false } : null);
      returnFocus();
    },
    reset() {
      if (p.busy) return;
      setDraft(null);
      p.dirty(false);
    },
    discard() {
      if (p.busy) return;
      setDraft(null);
      p.dirty(false);
      returnFocus();
    },
    submit(problem: string, spec: WriteSpec<unknown>) {
      if (!draft) return;
      if (problem) {
        setDraft({ ...draft, open: true, error: problem });
        focusAside();
        return;
      }
      p.save(spec, saved);
    },
  };
}
