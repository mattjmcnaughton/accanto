import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import {
  incomeEstimates,
  type EstimateInput,
  type EstimateLine,
  type EstimateResult,
  type Frequency,
} from "../../lib/incomeEstimates";
import { USD_AMOUNT } from "../../lib/money";
import { LoadMessage, type ScreenProps, useLoad } from "../workspace/shared";
import { useGridKeys } from "../workspace/useGridKeys";
import "../workspace/worksheet-ui.css";
import "./estimates.css";

type LineForm = {
  key: string;
  line_id?: string;
  name: string;
  gross: string;
  withholding: string;
  payroll: string;
  frequency: Frequency;
  paid_days: string;
};
type Draft = { id?: string; revision?: number; name: string; lines: LineForm[] };
type Cell = { row: number; col: number };

/** Pays per year the backend assumes; daily lines use entered paid days instead. */
const ASSUMED_PAYS: Record<Exclude<Frequency, "daily">, number> = {
  annual: 1,
  monthly: 12,
  twice_monthly: 24,
  weekly: 52,
};
const FREQUENCIES: [Frequency, string][] = [
  ["annual", "Annual"],
  ["monthly", "Monthly"],
  ["twice_monthly", "Twice monthly"],
  ["weekly", "Weekly"],
  ["daily", "Daily"],
];
const HEADERS = [
  "Income line",
  "Frequency",
  "Pays / yr",
  "Gross / pay",
  "Withholding / pay",
  "Deductions / pay",
  "Monthly net",
];
const INPUT_LABELS = [
  "Income line",
  "Payment frequency",
  "Paid days per year",
  "Gross per payment",
  "Withholding per payment",
  "Payroll deductions per payment",
];
const FIELDS = ["name", "frequency", "paid_days", "gross", "withholding", "payroll"] as const;
const MONEY_COLUMNS = new Set([3, 4, 5]);

const blankLine = (): LineForm => ({
  key: crypto.randomUUID(),
  name: "",
  gross: "",
  withholding: "0.00",
  payroll: "0.00",
  frequency: "monthly",
  paid_days: "",
});
const blank = (): Draft => ({ name: "", lines: [blankLine()] });
const fromSaved = (record: EstimateResult): Draft => ({
  id: record.uuid,
  revision: record.revision,
  name: record.name,
  lines: record.lines.map((line) => ({
    ...line,
    key: line.uuid,
    line_id: line.uuid,
    paid_days: line.paid_days ?? "",
  })),
});
function moneyLabel(value: string): string {
  const [whole, cents] = value.split(".");
  const negative = whole.startsWith("-");
  const digits = negative ? whole.slice(1) : whole;
  return `${negative ? "-" : ""}$${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${cents ?? "00"}`;
}
function cellError(line: LineForm, col: number): string {
  if (col === 0) return line.name.trim() ? "" : "Enter a name.";
  if (col === 2)
    return line.frequency !== "daily" || /^\d+$/.test(line.paid_days.trim())
      ? ""
      : "Enter whole paid days per year.";
  if (MONEY_COLUMNS.has(col))
    return USD_AMOUNT.test(line[FIELDS[col]].trim())
      ? ""
      : "Enter dollars with at most two decimals.";
  return "";
}
/** A saved monthly result applies only while every input it was calculated from is unchanged. */
function savedResult(line: LineForm, saved: EstimateResult | null): EstimateLine | undefined {
  const match = saved?.lines.find((item) => item.uuid === line.line_id);
  if (
    match &&
    match.gross === line.gross &&
    match.withholding === line.withholding &&
    match.payroll === line.payroll &&
    match.frequency === line.frequency &&
    (match.paid_days ?? "") === line.paid_days
  )
    return match;
  return undefined;
}
const signedClass = (value: string) => (value.startsWith("-") ? "negative" : "");

export function IncomeEstimates(p: ScreenProps) {
  const [reload, setReload] = useState(0);
  const state = useLoad(() => incomeEstimates.list(p.entity.id), [p.entity.id, p.refresh, reload]);
  const [form, setForm] = useState<Draft | null>(null);
  const [selected, setSelected] = useState<EstimateResult | null>(null);
  const [changed, setChanged] = useState(false);
  const [copyName, setCopyName] = useState("");
  const [cell, setCell] = useState<Cell>({ row: 0, col: 0 });
  const [listRow, setListRow] = useState(0);
  const [edit, setEdit] = useState<Cell | null>(null);
  const [editError, setEditError] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  const [notice, setNotice] = useState("");
  const [inTable, setInTable] = useState(false);
  const [help, setHelp] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const priorFocus = useRef<HTMLElement | null>(null);
  const lineKeys = useGridKeys();
  const listKeys = useGridKeys();

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (help) {
      priorFocus.current = document.activeElement as HTMLElement;
      if (typeof element.showModal === "function") element.showModal();
      else element.setAttribute("open", "");
    } else if (element.open) {
      element.close();
      priorFocus.current?.focus();
    }
  }, [help]);

  if (p.concealed) return null;

  function focusId(id: string) {
    requestAnimationFrame(() => document.getElementById(id)?.focus());
  }
  /** Focuses at once so rapid keys land on the new cell; deferred when rows re-render. */
  function focusCell(row: number, col: number, defer = false) {
    setCell({ row, col });
    const id = `estimate-cell-${row}-${col}`;
    if (defer) focusId(id);
    else document.getElementById(id)?.focus();
  }
  function update(value: Draft) {
    setForm(value);
    setChanged(true);
    setNotice("");
    p.dirty(true);
  }
  function confirmed(record: EstimateResult) {
    setForm(fromSaved(record));
    setSelected(record);
    setChanged(false);
    setEdit(null);
    setEditError("");
    setShowErrors(false);
    setNotice("");
    setCopyName(`${record.name} copy`);
    p.dirty(false);
  }
  function open(record: EstimateResult) {
    if (p.busy || !p.guard()) return;
    confirmed(record);
    focusCell(0, 0, true);
  }
  function startNew() {
    if (p.busy || !p.guard()) return;
    setForm(blank());
    setSelected(null);
    setChanged(true);
    setEdit(null);
    setShowErrors(false);
    setNotice("");
    setCell({ row: 0, col: 0 });
    p.dirty(true);
    focusId("estimate-name");
  }
  function updateLine(row: number, patch: Partial<LineForm>) {
    if (!form) return;
    update({
      ...form,
      lines: form.lines.map((line, index) => (index === row ? { ...line, ...patch } : line)),
    });
    setEditError("");
  }
  function beginEdit(row: number, col: number) {
    if (!form || p.busy || col > 5) return;
    if (col === 2 && form.lines[row].frequency !== "daily") {
      setNotice("Pays per year follows the frequency. Choose Daily to enter paid days.");
      return;
    }
    setNotice("");
    setEditError("");
    setCell({ row, col });
    setEdit({ row, col });
  }
  /** Keeps a valid value in the draft; invalid input stays in the cell with its error. */
  function finishEdit(): boolean {
    if (!edit || !form) return true;
    const line = form.lines[edit.row];
    const error = line ? cellError(line, edit.col) : "";
    if (error) {
      setEditError(error);
      return false;
    }
    setEdit(null);
    setEditError("");
    return true;
  }
  function addLine() {
    if (!form || p.busy || form.lines.length >= 100) return;
    if (!finishEdit()) return;
    const row = form.lines.length;
    update({ ...form, lines: [...form.lines, blankLine()] });
    setCell({ row, col: 0 });
    setEdit({ row, col: 0 });
  }
  function removeLine(row: number) {
    if (!form || p.busy) return;
    if (form.lines.length === 1) {
      setNotice("Keep at least one income line.");
      return;
    }
    const name = form.lines[row].name.trim() || `line ${row + 1}`;
    if (
      !confirm(`Remove “${name}” from this draft? The saved estimate changes only when you save.`)
    )
      return;
    update({ ...form, lines: form.lines.filter((_, index) => index !== row) });
    focusCell(Math.min(row, form.lines.length - 2), cell.col, true);
  }
  function save() {
    if (!form || p.busy) return;
    if (!finishEdit()) {
      setNotice("Correct the highlighted value before saving.");
      return;
    }
    if (!changed) {
      setNotice("No unsaved changes.");
      return;
    }
    const invalid =
      !form.name.trim() ||
      form.lines.some((line) => HEADERS.slice(0, 6).some((_, col) => cellError(line, col)));
    if (invalid) {
      setShowErrors(true);
      setNotice("Correct the highlighted inputs before saving.");
      return;
    }
    const body: EstimateInput = {
      name: form.name,
      lines: form.lines.map((line) => ({
        ...(line.line_id ? { line_id: line.line_id } : {}),
        name: line.name,
        gross: line.gross,
        withholding: line.withholding,
        payroll: line.payroll,
        frequency: line.frequency,
        ...(line.frequency === "daily" ? { paid_days: line.paid_days.trim() } : {}),
      })),
      ...(form.id ? { expected_revision: form.revision } : {}),
    };
    p.save(
      form.id
        ? incomeEstimates.edit(p.entity.id, form.id, body)
        : incomeEstimates.create(p.entity.id, body),
      confirmed,
    );
  }

  function display(line: LineForm, col: number) {
    if (col === 0) return line.name || <span className="muted">—</span>;
    if (col === 1) return FREQUENCIES.find(([value]) => value === line.frequency)?.[1];
    if (col === 2)
      return line.frequency === "daily" ? (
        <>
          {line.paid_days || "—"} <small className="muted">entered</small>
        </>
      ) : (
        <>
          {ASSUMED_PAYS[line.frequency]} <small className="muted">assumed</small>
        </>
      );
    if (col === 6) {
      const result = savedResult(line, selected);
      return result ? (
        <span className={signedClass(result.monthly_net)}>{moneyLabel(result.monthly_net)}</span>
      ) : (
        <>
          —<span className="sr-only"> calculated when saved</span>
        </>
      );
    }
    const value = line[FIELDS[col]].trim();
    if (!value) return <span className="muted">—</span>;
    if (!USD_AMOUNT.test(value)) return value;
    const [whole, cents = ""] = value.split(".");
    return moneyLabel(`${whole.replace(/^0+(?=\d)/, "")}.${cents.padEnd(2, "0")}`);
  }
  function editor(line: LineForm, row: number, col: number) {
    const label = `${INPUT_LABELS[col]} ${row + 1}`;
    const keys = (event: KeyboardEvent) => {
      if (event.key === "Enter" || event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (finishEdit()) focusCell(row, col);
      }
    };
    const common = {
      autoFocus: true,
      "aria-label": label,
      "aria-invalid": !!editError,
      "aria-describedby": editError ? "estimate-edit-error" : undefined,
      onKeyDown: keys,
      onBlur: () => finishEdit(),
    };
    if (col === 1)
      return (
        <select
          {...common}
          value={line.frequency}
          onChange={(event) =>
            updateLine(row, { frequency: event.target.value as Frequency, paid_days: "" })
          }
        >
          {FREQUENCIES.map(([value, name]) => (
            <option key={value} value={value}>
              {name}
            </option>
          ))}
        </select>
      );
    return (
      <input
        {...common}
        maxLength={col === 0 ? 120 : undefined}
        inputMode={col === 0 ? "text" : col === 2 ? "numeric" : "decimal"}
        value={line[FIELDS[col]]}
        onFocus={(event) => event.target.select()}
        onChange={(event) => updateLine(row, { [FIELDS[col]]: event.target.value })}
      />
    );
  }

  const records = state.kind === "ready" ? state.data : [];
  const totalKnown =
    !!form &&
    !!selected &&
    form.lines.length === selected.lines.length &&
    form.lines.every((line) => savedResult(line, selected));
  const mode = edit ? "INSERT" : inTable ? "NORMAL" : "READY";

  return (
    <section
      className="data-workspace estimates-workspace"
      aria-labelledby="estimates-title"
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
          event.preventDefault();
          save();
        }
      }}
    >
      <div className="data-toolbar">
        <h2 id="estimates-title">Income estimates</h2>
        <p className="muted estimates-note">
          Monthly net from entered assumptions. Not receipts, Plan income or calculated tax; copy a
          result into a Plan manually.
        </p>
        <button type="button" disabled={p.busy} onClick={startNew}>
          New estimate
        </button>
      </div>
      <LoadMessage state={state} retry={() => setReload((value) => value + 1)} />
      <div className="estimates-layout">
        <div className="estimates-index">
          {state.kind === "empty" && (
            <p className="muted estimates-empty">
              No estimates yet. Create one to explore assumptions.
            </p>
          )}
          {state.kind === "ready" && (
            <table className="data-grid" aria-label="Saved income estimates">
              <colgroup>
                <col />
                <col className="estimates-count-col" />
                <col className="estimates-money-col" />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">Estimate</th>
                  <th scope="col" className="numeric">
                    Lines
                  </th>
                  <th scope="col" className="numeric">
                    Monthly net
                  </th>
                </tr>
              </thead>
              <tbody>
                {records.map((record, row) => (
                  <tr
                    key={record.uuid}
                    aria-current={selected?.uuid === record.uuid ? "true" : undefined}
                    className={selected?.uuid === record.uuid ? "estimates-open-row" : undefined}
                  >
                    <td>
                      <button
                        type="button"
                        id={`estimate-open-${row}`}
                        className="estimates-open"
                        aria-label={`Open ${record.name}`}
                        title={record.name}
                        tabIndex={row === Math.min(listRow, records.length - 1) ? 0 : -1}
                        disabled={p.busy}
                        onFocus={() => setListRow(row)}
                        onClick={() => open(record)}
                        onKeyDown={(event) =>
                          listKeys(event, {
                            rowId: record.uuid,
                            position: { row, col: 0 },
                            rows: records.length,
                            columns: 1,
                            move: ({ row: next }) => {
                              setListRow(next);
                              focusId(`estimate-open-${next}`);
                            },
                            edit: () => open(record),
                            help: () => setHelp(true),
                          })
                        }
                      >
                        {record.name}
                      </button>
                    </td>
                    <td className="numeric">{record.lines.length}</td>
                    <td className={`numeric ${signedClass(record.monthly_total)}`}>
                      {moneyLabel(record.monthly_total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="estimates-editor">
          {form ? (
            <fieldset disabled={p.busy} aria-label={form.id ? "Edit estimate" : "New estimate"}>
              <div className="estimates-editor-bar">
                <input
                  id="estimate-name"
                  className="estimates-name"
                  aria-label="Estimate name"
                  required
                  maxLength={120}
                  value={form.name}
                  aria-invalid={showErrors && !form.name.trim()}
                  onChange={(event) => update({ ...form, name: event.target.value })}
                />
                <span className="badge">
                  {!form.id
                    ? "New · unsaved"
                    : changed
                      ? "Unsaved draft"
                      : `Saved · rev ${form.revision}`}
                </span>
                <button type="button" className="primary" onClick={save}>
                  Save estimate
                </button>
                {selected && !changed && (
                  <span className="estimates-duplicate">
                    <input
                      aria-label="New estimate name"
                      maxLength={120}
                      value={copyName}
                      onChange={(event) => setCopyName(event.target.value)}
                    />
                    <button
                      type="button"
                      disabled={!copyName.trim()}
                      onClick={() =>
                        p.save(
                          incomeEstimates.duplicate(p.entity.id, selected.uuid, {
                            name: copyName,
                            expected_revision: selected.revision,
                          }),
                          confirmed,
                        )
                      }
                    >
                      Duplicate estimate
                    </button>
                  </span>
                )}
              </div>
              <div className="data-table-scroll">
                <table
                  className="data-grid estimates-lines"
                  aria-label="Income lines"
                  onFocus={() => setInTable(true)}
                  onBlur={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget)) setInTable(false);
                  }}
                >
                  <colgroup>
                    <col className="estimates-name-col" />
                    <col className="estimates-frequency-col" />
                    <col className="estimates-pays-col" />
                    <col />
                    <col />
                    <col />
                    <col />
                  </colgroup>
                  <thead>
                    <tr>
                      {HEADERS.map((header, col) => (
                        <th key={header} scope="col" className={col >= 2 ? "numeric" : undefined}>
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {form.lines.map((line, row) => (
                      <tr key={line.key}>
                        {HEADERS.map((header, col) => {
                          const active = cell.row === row && cell.col === col;
                          const editing = edit?.row === row && edit.col === col;
                          const error = showErrors && !editing ? cellError(line, col) : "";
                          return (
                            <td
                              key={header}
                              id={`estimate-cell-${row}-${col}`}
                              aria-label={`${line.name || `Line ${row + 1}`}, ${header}`}
                              aria-selected={active}
                              tabIndex={active && !editing ? 0 : -1}
                              className={[
                                col >= 2 ? "numeric" : "",
                                col === 6 ? "estimates-result" : "",
                                error ? "estimates-invalid" : "",
                              ].join(" ")}
                              onClick={(event) => {
                                if ((event.target as HTMLElement).closest("input,select")) return;
                                if (finishEdit()) focusCell(row, col);
                              }}
                              onDoubleClick={() => beginEdit(row, col)}
                              onKeyDown={(event) =>
                                lineKeys(event, {
                                  rowId: line.key,
                                  position: { row, col },
                                  rows: form.lines.length,
                                  columns: HEADERS.length,
                                  move: (next) => focusCell(next.row, next.col),
                                  edit: () => beginEdit(row, col),
                                  add: addLine,
                                  remove: () => removeLine(row),
                                  help: () => setHelp(true),
                                })
                              }
                            >
                              {editing ? editor(line, row, col) : display(line, col)}
                              {error && <span className="sr-only">. {error}</span>}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th scope="row" colSpan={6}>
                        Combined monthly net
                      </th>
                      <td className="numeric estimates-result" aria-label="Combined monthly net">
                        {totalKnown && selected ? (
                          <span className={signedClass(selected.monthly_total)}>
                            {moneyLabel(selected.monthly_total)}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <div className="estimates-messages">
                {editError && (
                  <p id="estimate-edit-error" className="field-error" role="alert">
                    {editError}
                  </p>
                )}
                {notice && <output id="estimate-notice">{notice}</output>}
                {!totalKnown && (
                  <p className="muted">
                    Results are calculated when saved.
                    {selected && ` Last saved combined: ${moneyLabel(selected.monthly_total)}.`}
                  </p>
                )}
              </div>
            </fieldset>
          ) : (
            <p className="muted estimates-empty">Open or create an estimate.</p>
          )}
        </div>
      </div>
      <footer className="data-status">
        <span className="badge">{mode}</span>
        <span>
          <kbd>h j k l</kbd> Move <kbd>i</kbd> Edit <kbd>Esc</kbd> Keep <kbd>a</kbd> Add{" "}
          <kbd>dd</kbd> Remove <kbd>Ctrl/⌘ S</kbd> Save <kbd>?</kbd> Help
        </span>
        <button
          type="button"
          className="estimates-add"
          disabled={!form || p.busy || form.lines.length >= 100}
          onClick={addLine}
        >
          Add income line
        </button>
      </footer>
      <dialog ref={dialog} aria-labelledby="estimates-help-title" onCancel={() => setHelp(false)}>
        <h2 id="estimates-help-title">Keyboard shortcuts</h2>
        <dl className="estimates-shortcuts">
          {[
            ["h j k l / arrows", "Move between cells"],
            ["0 / $ · Home / End", "First / last cell in row"],
            ["gg / G", "First / last line"],
            ["i / Enter", "Edit the selected value"],
            ["Escape / Enter", "Keep a valid edit in the draft"],
            ["a / A", "Add an income line"],
            ["dd", "Remove the line, with confirmation"],
            ["Ctrl / ⌘ + S", "Save estimate"],
          ].map(([key, label]) => (
            <div key={key}>
              <dt>
                <kbd>{key}</kbd>
              </dt>
              <dd>{label}</dd>
            </div>
          ))}
        </dl>
        <p>
          Pays per year are assumed from the frequency, except daily lines, which use entered paid
          days. Withholding and deductions are entered assumptions; no tax is calculated.
        </p>
        <button type="button" onClick={() => setHelp(false)}>
          Close
        </button>
      </dialog>
    </section>
  );
}
