import { type KeyboardEvent, useState } from "react";
import { formatMoney, plural } from "../../lib/format";
import {
  type EstimateInput,
  type EstimateLine,
  type EstimateResult,
  type Frequency,
  incomeEstimates,
} from "../../lib/incomeEstimates";
import { USD_AMOUNT } from "../../lib/money";
import { Dialog, Empty, Head, Icon } from "../../ui";
import { type ScreenProps, useLoad } from "../workspace/shared";
import { useGridKeys } from "../workspace/useGridKeys";
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
  ["monthly", "Monthly"],
  ["twice_monthly", "Twice a month"],
  ["weekly", "Weekly"],
  ["annual", "Once a year"],
  ["daily", "Daily"],
];
const HEADERS = [
  "Income",
  "Paid",
  "Payments a year",
  "Gross per payment",
  "Withholding",
  "Other deductions",
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
const SHORTCUTS = [
  ["h j k l / arrows", "Move between cells"],
  ["0 / $ · Home / End", "First / last cell in row"],
  ["gg / G", "First / last line"],
  ["i / Enter", "Edit the selected value"],
  ["Escape / Enter", "Keep a valid edit in the draft"],
  ["a / A", "Add an income line"],
  ["dd", "Remove the line, with confirmation"],
  ["Ctrl / ⌘ + S", "Save estimate"],
];

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
const signedClass = (value: string) => (value.startsWith("-") ? "bad" : "");

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
  const [help, setHelp] = useState(false);
  const lineKeys = useGridKeys();
  const listKeys = useGridKeys();

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
      setNotice("Payments a year follows how often you are paid. Choose Daily to enter paid days.");
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
        <span className={signedClass(result.monthly_net)}>{formatMoney(result.monthly_net)}</span>
      ) : (
        <>
          —<span className="sr-only"> calculated when saved</span>
        </>
      );
    }
    const value = line[FIELDS[col]].trim();
    if (!value) return <span className="muted">—</span>;
    return USD_AMOUNT.test(value) ? formatMoney(value) : value;
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
      className: "input",
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

  return (
    <section
      className="screen est-screen"
      aria-label="Income estimates"
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
          event.preventDefault();
          save();
        }
      }}
    >
      <Head
        title="Income estimates"
        sub="Work out monthly take-home pay from what you enter for each payment. Accanto does not estimate tax, and an estimate is never treated as income received."
      >
        <button type="button" className="btn pri" disabled={p.busy} onClick={startNew}>
          <Icon name="plus" />
          New estimate
        </button>
      </Head>
      {state.kind === "loading" && (
        <output className="card pad sk-card" aria-label="Loading estimates">
          <div className="sk est-sk-title" />
          <div className="sk est-sk-row" />
          <div className="sk est-sk-row" />
        </output>
      )}
      {"error" in state && (
        <div className="banner bad" role="alert">
          <span>Could not load income estimates. {state.error.message}</span>
          <button type="button" className="btn sm" onClick={() => setReload((value) => value + 1)}>
            Try loading again
          </button>
        </div>
      )}
      {state.kind === "empty" && !form && (
        <Empty
          title="No income estimates yet"
          action={
            <button type="button" className="btn pri" disabled={p.busy} onClick={startNew}>
              Create an estimate
            </button>
          }
        >
          Enter gross pay, withholding and deductions for each payment to see a monthly figure you
          can copy into a Plan by hand.
        </Empty>
      )}
      {state.kind === "ready" && (
        <section aria-labelledby="estimates-saved">
          <h2 className="h2" id="estimates-saved">
            Saved estimates
          </h2>
          <div className="card">
            {records.map((record, row) => (
              <button
                key={record.uuid}
                type="button"
                id={`estimate-open-${row}`}
                className="row"
                aria-label={`Open ${record.name}`}
                aria-current={selected?.uuid === record.uuid ? "true" : undefined}
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
                <span className="t">
                  <span className="est-open-name">{record.name}</span>
                  <small>{plural(record.lines.length, "income line")}</small>
                </span>
                <span className={`a ${signedClass(record.monthly_total)}`}>
                  {formatMoney(record.monthly_total)} a month
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
      {!form && state.kind === "ready" && (
        <p className="note">Open a saved estimate to edit it, or start a new one.</p>
      )}
      {form && (
        <div className="card est-editor">
          <fieldset disabled={p.busy} aria-label={form.id ? "Edit estimate" : "New estimate"}>
            <div className="est-bar">
              <input
                id="estimate-name"
                className="input est-name"
                aria-label="Estimate name"
                placeholder="Name this estimate"
                required
                maxLength={120}
                value={form.name}
                aria-invalid={showErrors && !form.name.trim()}
                onChange={(event) => update({ ...form, name: event.target.value })}
              />
              <span className={`chip${changed || !form.id ? " warn" : ""}`}>
                {!form.id
                  ? "New · unsaved"
                  : changed
                    ? "Unsaved draft"
                    : `Saved · rev ${form.revision}`}
              </span>
              <span className="spacer" />
              <button
                type="button"
                className="btn pri"
                aria-keyshortcuts="Control+S Meta+S"
                onClick={save}
              >
                Save estimate
              </button>
            </div>
            <div className="est-scroll">
              <table className="est-grid" aria-label="Income lines">
                <colgroup>
                  <col className="est-col-name" />
                  <col className="est-col-paid" />
                  <col className="est-col-pays" />
                  <col />
                  <col />
                  <col />
                  <col />
                  <col className="est-col-x" />
                </colgroup>
                <thead>
                  <tr>
                    {HEADERS.map((header, col) => (
                      <th key={header} scope="col" className={col >= 2 ? "num" : undefined}>
                        {header}
                      </th>
                    ))}
                    <th scope="col">
                      <span className="sr-only">Remove</span>
                    </th>
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
                            data-label={header}
                            data-col={col}
                            aria-label={`${line.name || `Line ${row + 1}`}, ${header}`}
                            aria-selected={active}
                            tabIndex={active && !editing ? 0 : -1}
                            className={[
                              col >= 2 ? "num" : "",
                              col === 6 ? "est-result" : "",
                              error ? "est-invalid" : "",
                            ].join(" ")}
                            onClick={(event) => {
                              if ((event.target as HTMLElement).closest("input,select")) return;
                              if (!finishEdit()) return;
                              focusCell(row, col);
                              // A touch screen has no double click, so a tap edits the cell.
                              if (window.matchMedia?.("(pointer: coarse)").matches)
                                beginEdit(row, col);
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
                      <td className="est-x">
                        <button
                          type="button"
                          className="icon-btn"
                          aria-label={`Remove ${line.name.trim() || `line ${row + 1}`}`}
                          onClick={() => removeLine(row)}
                        >
                          <Icon name="x" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row" colSpan={6} className="num">
                      Combined monthly net
                    </th>
                    <td className="num est-result" aria-label="Combined monthly net">
                      {totalKnown && selected ? (
                        <span className={signedClass(selected.monthly_total)}>
                          {formatMoney(selected.monthly_total)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className="est-foot">
              <button
                type="button"
                className="btn sm quiet"
                disabled={p.busy || form.lines.length >= 100}
                onClick={addLine}
              >
                <Icon name="plus" />
                Add income line
              </button>
              <span className="spacer" />
              {selected && !changed && (
                <span className="est-duplicate">
                  <input
                    className="input"
                    aria-label="New estimate name"
                    maxLength={120}
                    value={copyName}
                    onChange={(event) => setCopyName(event.target.value)}
                  />
                  <button
                    type="button"
                    className="btn sm"
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
            <div className="est-msgs">
              {editError && (
                <p id="estimate-edit-error" className="err" role="alert">
                  {editError}
                </p>
              )}
              {notice && (
                <output id="estimate-notice" className="note">
                  {notice}
                </output>
              )}
              {!totalKnown && (
                <p className="note">
                  Results are calculated when saved.
                  {selected && ` Last saved combined: ${formatMoney(selected.monthly_total)}.`}
                </p>
              )}
              <p className="note est-hint">Select a cell and press ? for keyboard shortcuts.</p>
            </div>
          </fieldset>
        </div>
      )}
      {help && (
        <Dialog title="Keyboard shortcuts" onClose={() => setHelp(false)}>
          <div className="dlg-b">
            <dl className="est-keys">
              {SHORTCUTS.map(([key, label]) => (
                <div key={key}>
                  <dt>
                    <kbd className="kbd">{key}</kbd>
                  </dt>
                  <dd>{label}</dd>
                </div>
              ))}
            </dl>
            <p className="note">
              Payments a year are assumed from how often you are paid, except daily lines, which use
              the paid days you enter. Withholding and deductions are your own assumptions; no tax
              is calculated.
            </p>
          </div>
        </Dialog>
      )}
    </section>
  );
}
