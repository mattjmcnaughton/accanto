import { type FocusEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { SIGNED_USD_AMOUNT, USD_AMOUNT } from "../../lib/money";
import type { WriteSpec } from "../../lib/monthly";
import { useGridKeys } from "../workspace/useGridKeys";
import type { ScreenProps } from "../workspace/shared";
import "../workspace/worksheet-ui.css";
import "./records.css";

/** Feature-local pieces shared by the Investments/Giving and Loans screens. */

export const dash = <span className="muted">—</span>;
export const validMoney = (value: string, signed = false) =>
  (signed ? SIGNED_USD_AMOUNT : USD_AMOUNT).test(value.trim());
export const amountClass = (value: string) => `numeric${value.startsWith("-") ? " negative" : ""}`;

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

export type Column<T> = { header: string; numeric?: boolean; cell: (row: T) => ReactNode };

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
    <div className="data-table-scroll">
      <table
        ref={table}
        // biome-ignore lint/a11y/useSemanticElements: Interactive record grid with roving cell focus.
        role="grid"
        className="data-grid"
        aria-label={label}
        aria-describedby="records-status"
      >
        <thead>
          <tr>
            {columns.map((column, col) => (
              <th
                key={column.header || col}
                scope="col"
                className={column.numeric ? "numeric" : ""}
              >
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
                      className={column.numeric ? "numeric" : undefined}
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
                      {col === 0 && marked === id && <span className="badge unsaved">Unsaved</span>}
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

/** Native modal dialog; returns focus to where it opened. */
export function Modal({
  title,
  open,
  close,
  children,
}: {
  title: string;
  open: boolean;
  close: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const prior = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      prior.current = document.activeElement as HTMLElement | null;
      if (typeof element.showModal === "function") element.showModal();
      else element.setAttribute("open", "");
      element.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    } else if (!open && element.open) {
      if (typeof element.close === "function") element.close();
      else element.removeAttribute("open");
      prior.current?.focus();
    }
  }, [open]);
  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <h2 id={titleId}>{title}</h2>
      {children}
    </dialog>
  );
}

export type Confirmation = { title: string; message: string; action: string; run: () => void };
export function ConfirmDialog({
  confirmation,
  close,
}: {
  confirmation: Confirmation | null;
  close: () => void;
}) {
  return (
    <Modal title={confirmation?.title ?? ""} open={!!confirmation} close={close}>
      <p>{confirmation?.message}</p>
      <div className="record-actions">
        <button
          type="button"
          className="danger"
          onClick={() => {
            close();
            confirmation?.run();
          }}
        >
          {confirmation?.action}
        </button>
        {/* Cancel is the safe default in a destructive confirmation. */}
        <button type="button" data-autofocus onClick={close}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

export function Shortcuts({ open, close }: { open: boolean; close: () => void }) {
  return (
    <Modal title="Keyboard shortcuts" open={open} close={close}>
      <p>Vim-style keys apply while a table has focus. Each record saves on its own.</p>
      <dl className="shortcut-list">
        {[
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
        ].map(([key, label]) => (
          <div key={key}>
            <dt>
              <kbd>{key}</kbd>
            </dt>
            <dd>{label}</dd>
          </div>
        ))}
      </dl>
      <button type="button" onClick={close}>
        Close
      </button>
    </Modal>
  );
}

export function StatusBar({ mode, help }: { mode: string; help: () => void }) {
  return (
    <footer id="records-status" className="data-status">
      <span className="mode">{mode}</span>
      <span>
        <kbd>h j k l</kbd> Move <kbd>i</kbd> Open <kbd>a</kbd> Add <kbd>dd</kbd> Delete{" "}
        <kbd>Ctrl S</kbd> Save <kbd>Esc</kbd> Back
      </span>
      <button type="button" className="link" onClick={help}>
        Keyboard shortcuts ?
      </button>
    </footer>
  );
}

export const modeFor = (event: FocusEvent) => {
  const target = event.target as HTMLElement;
  return target.closest("[role=grid]") ? "NORMAL" : target.closest("aside") ? "DETAILS" : "READY";
};

export type Draft<F> = { key: string; form: F; changed: boolean; error: string; open: boolean };

/** One record edited at a time. Escape keeps a valid edit; only Save writes it. */
export function useRecordEditor<F>(p: ScreenProps, reload: () => void) {
  const [draft, setDraft] = useState<Draft<F> | null>(null);
  const origin = useRef<HTMLElement | null>(null);
  const aside = useRef<HTMLElement>(null);
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
