import { useEffect, useId, useRef, useState } from "react";
import { balances } from "../../lib/balances";
import { destinations } from "../../lib/destinations";
import { SIGNED_USD_AMOUNT, USD_AMOUNT } from "../../lib/money";
import {
  type Activity,
  type ActivityInput,
  type KnownTotalInput,
  type RefundInput,
  monthly,
} from "../../lib/monthly";
import { savings } from "../../lib/savings";
import {
  LoadMessage,
  MoneyInput,
  type ScreenProps,
  dollars,
  sourceChoices,
  useLoad,
} from "./shared";
import { useGridKeys } from "./useGridKeys";
import "./worksheet-ui.css";
import "./activity-review.css";

const categoryNames: Record<Activity["category"], string> = {
  income: "Income",
  spending: "Guilt-free spending",
  fixed_cost: "Fixed cost payment",
  saving: "Saving",
  investing: "Investment contribution",
  giving: "Giving",
};
const columns = ["Date", "Category", "Item", "Funding", "Amount", "Flags", "Note", "Actions"];
/** Columns edited in place; other fields belong to the details panel. */
const fields: Record<number, "date" | "amount" | "note"> = { 0: "date", 4: "amount", 6: "note" };
type Draft =
  | { kind: "activity"; entry: Activity | null; form: ActivityInput }
  | { kind: "refund"; target: Activity; entry: Activity | null; form: RefundInput }
  | { kind: "known"; form: KnownTotalInput };
type Row = { id: string; view: Activity };
const readOnly = (entry: Activity) =>
  !entry.refund_of && (entry.category === "investing" || entry.category === "giving");
const draftRow = (draft: Draft | null) =>
  draft?.kind === "activity"
    ? (draft.entry?.uuid ?? "new")
    : draft?.kind === "refund"
      ? (draft.entry?.uuid ?? "new-refund")
      : null;

export function ActivityScreen(p: ScreenProps) {
  const [reload, setReload] = useState(0);
  const entries = useLoad(() => monthly.activity(p.entity.id), [p.entity.id, p.refresh, reload]);
  const plans = useLoad(() => monthly.plans(p.entity.id), [p.entity.id, p.refresh, reload]);
  const accounts = useLoad(() => savings.list(p.entity.id), [p.entity.id, p.refresh, reload]);
  const investments = useLoad(
    () => destinations.list(p.entity.id, "investment"),
    [p.entity.id, p.refresh, reload],
  );
  const loans = useLoad(() => balances.loans(p.entity.id), [p.entity.id, p.refresh, reload]);
  const recipients = useLoad(
    () => destinations.list(p.entity.id, "giving"),
    [p.entity.id, p.refresh, reload],
  );
  const [draft, setDraft] = useState<Draft | null>(null);
  const [changed, setChanged] = useState(false);
  const [info, setInfo] = useState<Activity | null>(null);
  const [edit, setEdit] = useState<{ id: string; col: number; value: string } | null>(null);
  const [cellError, setCellError] = useState("");
  const [selection, setSelection] = useState({ id: "", col: 0 });
  const [area, setArea] = useState<"page" | "table" | "details">("page");
  const [month, setMonth] = useState(p.entity.today.slice(0, 7));
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const [help, setHelp] = useState(false);
  const [submitRequest, setSubmitRequest] = useState(0);
  const form = useRef<HTMLFormElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const priorFocus = useRef<HTMLElement | null>(null);
  const gridKeys = useGridKeys();
  const helpTitle = useId();
  // Ctrl/⌘+S submits after a committed cell edit has rendered into the record form.
  useEffect(() => {
    if (submitRequest) form.current?.requestSubmit();
  }, [submitRequest]);
  useEffect(() => {
    if (help) {
      priorFocus.current = document.activeElement as HTMLElement | null;
      dialog.current?.showModal?.();
    } else if (dialog.current?.open) {
      dialog.current.close();
      priorFocus.current?.focus();
    }
  }, [help]);
  const data = entries.kind === "ready" ? entries.data : [];
  const sources = plans.kind === "ready" ? sourceChoices(plans.data) : [];
  const fixedCosts =
    plans.kind === "ready"
      ? [
          ...new Map(
            plans.data.flatMap((plan) =>
              plan.revisions.flatMap((revision) =>
                revision.fixed_costs.map((cost) => [cost.fixed_cost_id, cost] as const),
              ),
            ),
          ).values(),
        ]
      : [];
  const savingGoals =
    accounts.kind === "ready"
      ? accounts.data.flatMap((account) =>
          account.goals.map((goal) => ({
            account,
            goal,
            label: `${account.name} · ${goal.name}`,
          })),
        )
      : [];
  const goalLabel = (id: string | null) =>
    savingGoals.find(({ goal }) => goal.uuid === id)?.label ?? "Historical saving goal";
  const loanName = (id: string) =>
    (loans.kind === "ready" ? loans.data.find((loan) => loan.uuid === id)?.name : null) ??
    "Historical loan";
  const destinationLabel = (entry: Activity) => {
    const state = entry.category === "investing" ? investments : recipients;
    const fallback =
      entry.category === "investing" ? "Historical investment" : "Historical recipient";
    return state.kind === "ready"
      ? (state.data.find((row) => row.uuid === entry.destination_id)?.name ?? fallback)
      : fallback;
  };
  const itemLabel = (entry: Activity) => {
    const item =
      entry.category === "spending"
        ? ""
        : entry.category === "fixed_cost"
          ? (entry.fixed_cost_name ?? "Unassigned fixed cost")
          : entry.category === "saving" && entry.saving_goal_id
            ? goalLabel(entry.saving_goal_id)
            : entry.destination_id &&
                (entry.category === "investing" || entry.category === "giving")
              ? destinationLabel(entry)
              : entry.source_id
                ? sources.find((s) => s.id === entry.source_id)?.label || "Historical Income source"
                : "Unassigned";
    return entry.category === "fixed_cost" && entry.debt_account_id
      ? `${item} · Loan: ${loanName(entry.debt_account_id)}`
      : item;
  };
  const fundingLabel = (entry: Activity) =>
    entry.category === "income" || entry.category === "saving"
      ? ""
      : entry.funding_origin === "savings" && entry.saving_goal_id
        ? goalLabel(entry.saving_goal_id)
        : "Current income";
  const refundedDate = (entry: Activity) =>
    data.find((row) => row.uuid === entry.refund_of)?.financial_date ?? "an earlier date";

  /** The visible row merges a pending draft over its stored entry. */
  function draftView(): Row | null {
    if (draft?.kind === "activity") {
      const base: Activity = draft.entry ?? {
        uuid: "new",
        financial_date: "",
        category: "spending",
        amount: "",
        source_id: null,
        fixed_cost_id: null,
        fixed_cost_name: null,
        debt_account_id: null,
        note: "",
        revision: 0,
        is_adjustment: false,
        funding_origin: "income",
        saving_goal_id: null,
      };
      const f = draft.form;
      return {
        id: base.uuid,
        view: {
          ...base,
          financial_date: f.date,
          category: f.category,
          amount: f.amount,
          source_id: f.source_id ?? null,
          fixed_cost_id: f.fixed_cost_id ?? null,
          fixed_cost_name:
            fixedCosts.find((cost) => cost.fixed_cost_id === f.fixed_cost_id)?.canonical_name ??
            (f.fixed_cost_id === base.fixed_cost_id ? base.fixed_cost_name : null),
          debt_account_id: f.debt_account_id ?? null,
          note: f.note ?? "",
          is_adjustment: Boolean(f.is_adjustment),
          funding_origin: f.funding_origin ?? "income",
          saving_goal_id: f.saving_goal_id ?? null,
        },
      };
    }
    if (draft?.kind === "refund") {
      const base = draft.entry ?? {
        ...draft.target,
        uuid: "new-refund",
        is_refund: true,
        refund_of: draft.target.uuid,
        remaining_refundable: null,
      };
      return {
        id: base.uuid,
        view: {
          ...base,
          financial_date: draft.form.date,
          amount: draft.form.amount ? `-${draft.form.amount}` : "",
          note: draft.form.note ?? "",
        },
      };
    }
    return null;
  }
  const pendingRow = draftView();
  const query = search.trim().toLowerCase();
  const rows: Row[] = [
    ...(pendingRow && (pendingRow.id === "new" || pendingRow.id === "new-refund")
      ? [pendingRow]
      : []),
    ...[...data]
      .sort((a, b) => b.financial_date.localeCompare(a.financial_date))
      .map((entry) =>
        pendingRow?.id === entry.uuid ? pendingRow : { id: entry.uuid, view: entry },
      )
      .filter(
        ({ id, view }) =>
          id === pendingRow?.id ||
          ((!month || view.financial_date.startsWith(month)) &&
            (!category || view.category === category) &&
            (!query ||
              [view.financial_date, categoryNames[view.category], itemLabel(view), view.note]
                .join(" ")
                .toLowerCase()
                .includes(query))),
      ),
  ];
  const months = [
    ...new Set([p.entity.today.slice(0, 7), ...data.map((e) => e.financial_date.slice(0, 7))]),
  ].sort((a, b) => b.localeCompare(a));
  const rowIndex = Math.max(
    0,
    rows.findIndex((row) => row.id === selection.id),
  );
  const activeRow = rows[rowIndex];

  function fingerprint(
    month: string,
    category: "income" | "spending" | "saving" | "fixed_cost",
    selectionId: string | null,
  ) {
    return data
      .filter(
        (entry) =>
          entry.financial_date.slice(0, 7) === month.slice(0, 7) &&
          entry.category === category &&
          (category === "spending" ||
            category === "fixed_cost" ||
            (category === "income"
              ? entry.source_id === selectionId
              : entry.saving_goal_id === selectionId)),
      )
      .map(({ uuid, revision }) => ({ uuid, revision }));
  }
  function focusCell(id: string, col: number) {
    setSelection({ id, col });
    requestAnimationFrame(() => document.getElementById(`activity-${id}-${col}`)?.focus());
  }
  function focusDetails() {
    requestAnimationFrame(() =>
      document
        .getElementById("activity-details")
        ?.querySelector<HTMLElement>("input,select,textarea,button")
        ?.focus(),
    );
  }
  function start(next: Draft, isNew: boolean) {
    setDraft(next);
    setInfo(null);
    setEdit(null);
    setCellError("");
    setChanged(isNew);
    p.dirty(isNew);
  }
  function change(next: Draft) {
    setDraft(next);
    setChanged(true);
    p.dirty(true);
  }
  function done() {
    setDraft(null);
    setInfo(null);
    setEdit(null);
    setCellError("");
    setChanged(false);
    p.dirty(false);
  }
  /** Select a row's record for editing; unsaved work on another record needs confirmation. */
  function claim(row: Row): boolean {
    // Reopening the retained record is allowed while a write is pending; replacing it is not.
    if (draftRow(draft) === row.id) return true;
    if (p.busy) return false;
    if (readOnly(row.view)) {
      if (draft && changed && !p.guard()) return false;
      done();
      setInfo(row.view);
      return false;
    }
    if (!p.guard()) return false;
    const entry = row.view;
    if (entry.refund_of) {
      const target = data.find((r) => r.uuid === entry.refund_of);
      if (!target) return false;
      start(
        {
          kind: "refund",
          target,
          entry,
          form: {
            date: entry.financial_date,
            amount: entry.amount.replace(/^-/, ""),
            note: entry.note,
            expected_revision: entry.revision,
          },
        },
        false,
      );
    } else
      start(
        {
          kind: "activity",
          entry,
          form: {
            date: entry.financial_date,
            category: entry.category as ActivityInput["category"],
            amount: entry.amount,
            source_id: entry.source_id,
            fixed_cost_id: entry.fixed_cost_id,
            debt_account_id: entry.debt_account_id,
            note: entry.note,
            expected_revision: entry.revision,
            is_adjustment: entry.is_adjustment,
            funding_origin: entry.funding_origin,
            saving_goal_id: entry.saving_goal_id,
          },
        },
        false,
      );
    return true;
  }
  function openDetails(row: Row) {
    setSelection({ id: row.id, col: selection.col });
    claim(row);
    focusDetails();
  }
  function begin(row: Row, col: number) {
    const field = fields[col];
    if (!field || readOnly(row.view) || p.busy) {
      openDetails(row);
      return;
    }
    if (!claim(row)) return;
    const value =
      field === "amount" && row.view.refund_of
        ? row.view.amount.replace(/^-/, "")
        : (row.view[field === "date" ? "financial_date" : field] ?? "");
    setCellError("");
    setEdit({ id: row.id, col, value });
  }
  function openNew() {
    if (p.busy || !p.guard()) return;
    start(
      {
        kind: "activity",
        entry: null,
        form: {
          date: p.entity.today,
          category: "spending",
          amount: "",
          source_id: null,
          fixed_cost_id: null,
          debt_account_id: null,
          note: "",
          funding_origin: "income",
          saving_goal_id: null,
        },
      },
      true,
    );
    setSelection({ id: "new", col: 0 });
    focusDetails();
  }
  function openRefund(original: Activity) {
    if (p.busy || (draftRow(draft) !== original.uuid && !p.guard())) return;
    start(
      {
        kind: "refund",
        target: original,
        entry: null,
        form: {
          date: p.entity.today < original.financial_date ? original.financial_date : p.entity.today,
          amount: "",
          note: "",
        },
      },
      true,
    );
    setSelection({ id: "new-refund", col: 4 });
    focusDetails();
  }
  function openKnown() {
    if ((entries.kind !== "ready" && entries.kind !== "empty") || p.busy || !p.guard()) return;
    const knownMonth = `${p.entity.today.slice(0, 7)}-01`;
    start(
      {
        kind: "known",
        form: {
          date: p.entity.today,
          month: knownMonth,
          category: "spending",
          desired_total: "",
          source_id: null,
          saving_goal_id: null,
          note: "",
          contributing_entries: fingerprint(knownMonth, "spending", null),
        },
      },
      true,
    );
    focusDetails();
  }
  function cellProblem(col: number, value: string) {
    if (col === 0)
      return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value))
        ? ""
        : "Enter a date as YYYY-MM-DD.";
    if (col === 4) {
      const signed = draft?.kind === "activity" && draft.form.is_adjustment;
      return (signed ? SIGNED_USD_AMOUNT : USD_AMOUNT).test(value)
        ? ""
        : `Enter a ${signed ? "signed " : ""}USD amount with at most two decimal places.`;
    }
    return value.length <= 2000 ? "" : "Notes are limited to 2000 characters.";
  }
  /** Keeps a valid cell edit in the local record; invalid input stays in insert mode. */
  function commit(): Draft | null | false {
    if (!edit || !draft || draft.kind === "known") return draft;
    const problem = cellProblem(edit.col, edit.value);
    if (problem) {
      setCellError(problem);
      return false;
    }
    const field = fields[edit.col];
    setEdit(null);
    setCellError("");
    if ((draft.form as unknown as Record<string, unknown>)[field] === edit.value) return draft;
    const next = { ...draft, form: { ...draft.form, [field]: edit.value } } as Draft;
    change(next);
    return next;
  }
  function remove(row: Row) {
    const entry = row.view;
    if (p.busy || readOnly(entry) || row.id === "new" || row.id === "new-refund") return;
    if (draftRow(draft) !== row.id && draft && changed && !p.guard()) return;
    const message = entry.refund_of
      ? "Delete this linked refund? Its history will be retained."
      : "Delete this mistaken entry? It will stop contributing to totals; its history is retained.";
    if (!window.confirm(message)) return;
    p.save(
      entry.refund_of
        ? monthly.deleteRefund(p.entity.id, entry.uuid, { expected_revision: entry.revision })
        : monthly.deleteActivity(p.entity.id, entry.uuid, { expected_revision: entry.revision }),
      done,
    );
  }
  function submit(next: Draft) {
    if (next.kind === "activity")
      p.save(
        next.entry
          ? monthly.editActivity(p.entity.id, next.entry.uuid, next.form)
          : monthly.createActivity(p.entity.id, next.form),
        done,
      );
    else if (next.kind === "refund")
      p.save(
        next.entry
          ? monthly.editRefund(p.entity.id, next.entry.uuid, next.form)
          : monthly.createRefund(p.entity.id, next.target.uuid, next.form),
        done,
      );
    else if (entries.kind === "ready" || entries.kind === "empty")
      p.save(monthly.recordKnownTotal(p.entity.id, next.form), done);
  }
  function closeDetails() {
    const id = selection.id || rows[0]?.id;
    if (!p.busy && (!draft || !changed)) {
      setDraft(null);
      setInfo(null);
      p.dirty(false);
    }
    if (id) focusCell(id, selection.col);
  }
  function onCellKey(e: React.KeyboardEvent, row: Row, index: number, col: number) {
    if (edit?.id === row.id && edit.col === col) {
      if (e.key === "Enter" || e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (commit() !== false) focusCell(row.id, col);
      }
      return;
    }
    if (e.key === "Escape" && (draft || info)) {
      e.preventDefault();
      closeDetails();
      return;
    }
    gridKeys(e, {
      rowId: row.id,
      position: { row: index, col },
      rows: rows.length,
      columns: columns.length,
      move: (next) => focusCell(rows[next.row].id, next.col),
      edit: () => begin(row, col),
      add: openNew,
      remove: () => remove(row),
      help: () => setHelp(true),
    });
  }
  function cellText(row: Row, col: number) {
    const v = row.view;
    switch (col) {
      case 0:
        return v.financial_date;
      case 1:
        return categoryNames[v.category];
      case 2:
        return v.category === "fixed_cost" && v.debt_account_id ? (
          <>
            <span>{v.fixed_cost_name ?? "Unassigned fixed cost"}</span>
            {" · "}
            <span className="muted">Loan: {loanName(v.debt_account_id)}</span>
          </>
        ) : (
          itemLabel(v)
        );
      case 3:
        return fundingLabel(v);
      case 4:
        return v.amount ? dollars(v.amount) : "—";
      case 6:
        return v.note;
      default:
        return "";
    }
  }
  function flags(row: Row) {
    const v = row.view;
    return (
      <>
        {v.is_adjustment && <span className="badge">Adjustment</span>}
        {v.refund_of && <span className="badge">Refund of {refundedDate(v)}</span>}
        {!v.refund_of &&
          v.remaining_refundable != null &&
          v.remaining_refundable !==
            (data.find((e) => e.uuid === row.id) ?? v).amount.replace(/^-/, "") && (
            <span className="badge">Refundable {dollars(v.remaining_refundable)}</span>
          )}
        {readOnly(v) && <span className="badge muted">Read only</span>}
        {draftRow(draft) === row.id && changed && <span className="badge pending">Unsaved</span>}
      </>
    );
  }
  if (p.concealed) return null;
  const record = draft && draft.kind !== "known" ? pendingRow?.view : null;
  const mode =
    area === "table"
      ? edit
        ? "INSERT"
        : activeRow && readOnly(activeRow.view)
          ? "READ ONLY"
          : "NORMAL"
      : area === "details"
        ? "DETAILS"
        : "READY";
  return (
    <section
      className="data-workspace activity-screen"
      aria-labelledby="activity-title"
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
          e.preventDefault();
          if (p.busy) return;
          const next = commit();
          // Only a changed record is saved; leaving or saving an untouched row sends nothing.
          if (next && (changed || next !== draft)) {
            setDraft(next);
            setSubmitRequest((x) => x + 1);
          }
        }
      }}
    >
      <div className="data-toolbar">
        <h2 id="activity-title">Activity</h2>
        <label>
          <span className="sr-only">Month</span>
          <select aria-label="Month" value={month} onChange={(e) => setMonth(e.target.value)}>
            <option value="">All months</option>
            {months.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <select
          aria-label="Category filter"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="">All categories</option>
          {Object.entries(categoryNames).map(([value, name]) => (
            <option key={value} value={value}>
              {name}
            </option>
          ))}
        </select>
        <input
          type="search"
          aria-label="Search activity"
          placeholder="Search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="muted">
          {rows.length} {rows.length === 1 ? "entry" : "entries"}
        </span>
        <span className="toolbar-actions">
          <button type="button" disabled={p.busy} onClick={openNew}>
            Record activity
          </button>
          <button
            type="button"
            disabled={p.busy || (entries.kind !== "ready" && entries.kind !== "empty")}
            onClick={openKnown}
          >
            Enter known total
          </button>
        </span>
      </div>
      <LoadMessage state={entries} retry={() => setReload((x) => x + 1)} />
      <LoadMessage state={plans} retry={() => setReload((x) => x + 1)} />
      <LoadMessage state={accounts} retry={() => setReload((x) => x + 1)} />
      <LoadMessage state={investments} retry={() => setReload((x) => x + 1)} />
      <LoadMessage state={loans} retry={() => setReload((x) => x + 1)} />
      <LoadMessage state={recipients} retry={() => setReload((x) => x + 1)} />
      <div className={`data-layout${draft || info ? " with-sidebar" : ""}`}>
        <div className="data-table-scroll">
          {/* biome-ignore lint/a11y/useSemanticElements: Interactive grid with roving cell focus. */}
          <table
            role="grid"
            className="data-grid activity-grid"
            aria-label="Activity entries"
            aria-describedby="activity-status"
            onFocus={() => setArea("table")}
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget)) setArea("page");
            }}
          >
            <thead>
              <tr>
                {columns.map((name, col) => (
                  <th key={name} scope="col" className={col === 4 ? "numeric" : undefined}>
                    {col === 7 ? <span className="sr-only">{name}</span> : name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr
                  key={row.id}
                  className={`${row.id === activeRow?.id ? "selected-row" : ""} ${draftRow(draft) === row.id ? "draft-row" : ""}`}
                >
                  {columns.map((name, col) => {
                    const active = row.id === activeRow?.id && col === selection.col;
                    const editing = edit?.id === row.id && edit.col === col;
                    return (
                      <td
                        key={name}
                        id={`activity-${row.id}-${col}`}
                        aria-selected={active}
                        tabIndex={active ? 0 : -1}
                        className={`${col === 4 ? "numeric" : ""} ${col === 4 && row.view.amount.startsWith("-") ? "negative" : ""} ${col === 6 ? "note-cell" : ""}`}
                        onKeyDown={(e) => onCellKey(e, row, index, col)}
                        onClick={(e) => {
                          if ((e.target as HTMLElement).closest("button,input")) return;
                          if (commit() === false) return;
                          focusCell(row.id, col);
                        }}
                        onDoubleClick={() => begin(row, col)}
                      >
                        {editing ? (
                          <input
                            // biome-ignore lint/a11y/noAutofocus: Insert mode moves focus into the edited cell.
                            autoFocus
                            aria-label={`${row.view.refund_of && col === 4 ? "Refund amount" : name} for ${categoryNames[row.view.category]} on ${row.view.financial_date || "new entry"}`}
                            aria-invalid={Boolean(cellError)}
                            aria-describedby={cellError ? "activity-cell-error" : undefined}
                            inputMode={col === 4 ? "decimal" : "text"}
                            maxLength={col === 6 ? 2000 : undefined}
                            value={edit.value}
                            onChange={(e) => {
                              setEdit({ ...edit, value: e.target.value });
                              setCellError("");
                            }}
                            onBlur={() => commit()}
                          />
                        ) : col === 5 ? (
                          flags(row)
                        ) : col === 7 ? (
                          <button
                            type="button"
                            tabIndex={-1}
                            className="icon-button"
                            aria-label={`Details for ${categoryNames[row.view.category]} on ${row.view.financial_date || "new entry"}`}
                            onClick={() => openDetails(row)}
                          >
                            ⋯
                          </button>
                        ) : (
                          cellText(row, col)
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {cellError && (
            <p id="activity-cell-error" role="alert" className="field-error">
              {cellError}
            </p>
          )}
          {entries.kind === "empty" && !pendingRow && (
            <p className="empty-state">No activity recorded yet.</p>
          )}
          {entries.kind === "ready" && rows.length === 0 && (
            <p className="empty-state">No activity matches these filters.</p>
          )}
        </div>
        {(draft || info) && (
          <aside
            id="activity-details"
            className="data-sidebar"
            aria-label="Activity details"
            onFocus={() => setArea("details")}
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget)) setArea("page");
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape" && !(e.target instanceof HTMLSelectElement)) {
                e.preventDefault();
                closeDetails();
              }
            }}
          >
            {info && (
              <>
                <h3>{categoryNames[info.category]}</h3>
                <dl className="detail-list">
                  <dt>Date</dt>
                  <dd>{info.financial_date}</dd>
                  <dt>Item</dt>
                  <dd>{itemLabel(info)}</dd>
                  <dt>Funding</dt>
                  <dd>{fundingLabel(info)}</dd>
                  <dt>Amount</dt>
                  <dd>{dollars(info.amount)}</dd>
                  {info.note && (
                    <>
                      <dt>Note</dt>
                      <dd>{info.note}</dd>
                    </>
                  )}
                </dl>
                <p>Correct this entry in Investments and giving.</p>
                {info.remaining_refundable != null && Number(info.remaining_refundable) > 0 && (
                  <button type="button" disabled={p.busy} onClick={() => openRefund(info)}>
                    Record refund from this purchase
                  </button>
                )}
                <button type="button" onClick={closeDetails}>
                  Close
                </button>
              </>
            )}
            {draft && (
              <form
                ref={form}
                id="activity-record"
                onSubmit={(e) => {
                  e.preventDefault();
                  const next = commit();
                  if (next) submit(next);
                }}
              >
                <fieldset disabled={p.busy}>
                  {draft.kind === "activity" && (
                    <ActivityFields
                      draft={draft}
                      change={change}
                      fixedCosts={fixedCosts}
                      loans={loans.kind === "ready" ? loans.data : []}
                      sources={sources}
                      savingGoals={savingGoals}
                    />
                  )}
                  {draft.kind === "refund" && (
                    <>
                      <legend>{draft.entry ? "Correct linked refund" : "Record refund"}</legend>
                      <p className="muted">
                        Original {draft.target.category} payment {dollars(draft.target.amount)} on{" "}
                        {draft.target.financial_date} · Remaining refundable{" "}
                        {dollars(draft.target.remaining_refundable ?? "0.00")}
                      </p>
                      <label>
                        Refund date
                        <input
                          type="date"
                          required
                          min={draft.target.financial_date}
                          value={draft.form.date}
                          onChange={(e) =>
                            change({ ...draft, form: { ...draft.form, date: e.target.value } })
                          }
                        />
                      </label>
                      <MoneyInput
                        label="Refund amount (USD)"
                        value={draft.form.amount}
                        onChange={(amount) => change({ ...draft, form: { ...draft.form, amount } })}
                      />
                      <label>
                        Note
                        <textarea
                          maxLength={2000}
                          value={draft.form.note ?? ""}
                          onChange={(e) =>
                            change({ ...draft, form: { ...draft.form, note: e.target.value } })
                          }
                        />
                      </label>
                    </>
                  )}
                  {draft.kind === "known" && (
                    <KnownFields
                      draft={draft}
                      change={change}
                      fingerprint={fingerprint}
                      sources={sources}
                      savingGoals={savingGoals}
                    />
                  )}
                  {draft.kind === "activity" && draft.entry?.remaining_refundable != null && (
                    <p className="muted">
                      Remaining refundable: {dollars(draft.entry.remaining_refundable)}
                    </p>
                  )}
                  <div className="sidebar-actions">
                    <button className="primary" type="submit">
                      {draft.kind === "known"
                        ? "Save adjustment"
                        : draft.kind === "refund"
                          ? "Save refund"
                          : "Save activity"}
                    </button>
                    {draft.kind === "activity" &&
                      draft.entry &&
                      !changed &&
                      draft.entry.remaining_refundable != null &&
                      Number(draft.entry.remaining_refundable) > 0 && (
                        <button type="button" onClick={() => openRefund(draft.entry as Activity)}>
                          Record refund from this purchase
                        </button>
                      )}
                    {draft.kind !== "known" && draft.entry && (
                      <button
                        type="button"
                        className="danger"
                        onClick={() => record && remove({ id: record.uuid, view: record })}
                      >
                        {draft.kind === "refund" ? "Delete refund" : "Delete activity"}
                      </button>
                    )}
                    <button type="button" onClick={done}>
                      {changed ? "Discard changes" : "Close"}
                    </button>
                  </div>
                </fieldset>
              </form>
            )}
          </aside>
        )}
      </div>
      <footer id="activity-status" className="data-status">
        <span className="mode">{mode}</span>
        <span>
          <kbd>h j k l</kbd> Move <kbd>i</kbd>/<kbd>Enter</kbd> Edit or details <kbd>a</kbd> Record{" "}
          <kbd>dd</kbd> Delete <kbd>Ctrl/⌘ S</kbd> Save <kbd>?</kbd> Keys
        </span>
        {changed && <span className="pending">Unsaved record</span>}
      </footer>
      <dialog ref={dialog} aria-labelledby={helpTitle} onClose={() => setHelp(false)}>
        <h2 id={helpTitle}>Keyboard shortcuts</h2>
        <dl className="shortcut-list">
          {[
            ["h j k l / arrows", "Move between cells"],
            ["0 / $ · gg / G", "First or last cell, row"],
            ["i / Enter", "Edit date, amount or note; other cells open details"],
            ["Enter / Escape", "Keep a valid edit in the unsaved record"],
            ["a", "Record activity"],
            ["dd", "Delete the selected entry, with confirmation"],
            ["Ctrl / ⌘ + S", "Save the record being edited"],
            ["Escape", "Leave details; unsaved changes stay"],
          ].map(([key, label]) => (
            <div key={key}>
              <dt>
                <kbd>{key}</kbd>
              </dt>
              <dd>{label}</dd>
            </div>
          ))}
        </dl>
        <button type="button" onClick={() => setHelp(false)}>
          Close
        </button>
      </dialog>
    </section>
  );
}

type GoalChoice = {
  account: { active: boolean; opening_date: string };
  goal: { uuid: string; active: boolean };
  label: string;
};
function ActivityFields({
  draft,
  change,
  fixedCosts,
  loans,
  sources,
  savingGoals,
}: {
  draft: Extract<Draft, { kind: "activity" }>;
  change: (next: Draft) => void;
  fixedCosts: Array<{ fixed_cost_id: string; canonical_name: string }>;
  loans: Array<{ uuid: string; name: string; active: boolean }>;
  sources: Array<{ id: string; label: string }>;
  savingGoals: GoalChoice[];
}) {
  const form = draft.form;
  const selected = draft.entry;
  const update = (value: ActivityInput) => change({ ...draft, form: value });
  return (
    <>
      <legend>{selected ? "Correct activity" : "Record activity"}</legend>
      <label>
        Financial date
        <input
          type="date"
          required
          value={form.date}
          onChange={(e) => update({ ...form, date: e.target.value })}
        />
      </label>
      <label>
        Category
        <select
          value={form.category}
          onChange={(e) =>
            update({
              ...form,
              category: e.target.value as ActivityInput["category"],
              source_id: null,
              fixed_cost_id: null,
              debt_account_id: null,
              funding_origin: "income",
              saving_goal_id: null,
            })
          }
        >
          <option value="income">Income</option>
          <option value="spending">Guilt-free spending</option>
          <option value="fixed_cost">Fixed cost payment</option>
          <option value="saving">Saving contribution</option>
        </select>
      </label>
      {form.category === "fixed_cost" && (
        <>
          <label>
            Fixed cost
            <select
              name="fixed-cost"
              value={form.fixed_cost_id || ""}
              onChange={(e) => update({ ...form, fixed_cost_id: e.target.value || null })}
            >
              <option value="">Unassigned fixed cost</option>
              {fixedCosts.map((cost) => (
                <option key={cost.fixed_cost_id} value={cost.fixed_cost_id}>
                  {cost.canonical_name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Loan account (optional)
            <select
              name="loan-account"
              value={form.debt_account_id || ""}
              onChange={(e) => update({ ...form, debt_account_id: e.target.value || null })}
            >
              <option value="">Ordinary fixed cost</option>
              {loans
                .filter((loan) => loan.active || loan.uuid === selected?.debt_account_id)
                .map((loan) => (
                  <option key={loan.uuid} value={loan.uuid}>
                    {loan.name}
                  </option>
                ))}
            </select>
          </label>
        </>
      )}
      <MoneyInput
        label="Amount (USD)"
        value={form.amount}
        onChange={(amount) => update({ ...form, amount })}
        signed={form.is_adjustment}
      />
      <label className="check">
        <input
          type="checkbox"
          checked={Boolean(form.is_adjustment)}
          onChange={(e) => update({ ...form, is_adjustment: e.target.checked })}
        />
        Adjustment to recorded total
      </label>
      {form.category === "income" && (
        <label>
          Income source
          <select
            value={form.source_id || ""}
            onChange={(e) => update({ ...form, source_id: e.target.value || null })}
          >
            <option value="">Unassigned income</option>
            {sources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {(form.category === "spending" || form.category === "fixed_cost") && (
        <label>
          Funding origin
          <select
            name="funding-origin"
            value={form.funding_origin ?? "income"}
            onChange={(e) =>
              update({
                ...form,
                funding_origin: e.target.value as "income" | "savings",
                saving_goal_id: null,
              })
            }
          >
            <option value="income">Current income</option>
            <option value="savings">Previously saved money</option>
          </select>
        </label>
      )}
      {(form.category === "saving" || form.funding_origin === "savings") && (
        <label>
          Saving goal
          <select
            name="saving-goal"
            required
            value={form.saving_goal_id ?? ""}
            onChange={(e) => update({ ...form, saving_goal_id: e.target.value || null })}
          >
            <option value="">Choose a goal</option>
            {savingGoals
              .filter(
                ({ account, goal }) =>
                  account.active &&
                  account.opening_date <= form.date &&
                  (form.category !== "saving" ||
                    goal.active ||
                    goal.uuid === selected?.saving_goal_id),
              )
              .map(({ goal, label }) => (
                <option key={goal.uuid} value={goal.uuid}>
                  {label}
                </option>
              ))}
          </select>
        </label>
      )}
      <label>
        Note
        <textarea
          maxLength={2000}
          value={form.note || ""}
          onChange={(e) => update({ ...form, note: e.target.value })}
        />
      </label>
    </>
  );
}

function KnownFields({
  draft,
  change,
  fingerprint,
  sources,
  savingGoals,
}: {
  draft: Extract<Draft, { kind: "known" }>;
  change: (next: Draft) => void;
  fingerprint: (
    month: string,
    category: KnownTotalInput["category"],
    selectionId: string | null,
  ) => KnownTotalInput["contributing_entries"];
  sources: Array<{ id: string; label: string }>;
  savingGoals: GoalChoice[];
}) {
  const known = draft.form;
  const update = (form: KnownTotalInput) => change({ ...draft, form });
  return (
    <>
      <legend>Enter known total</legend>
      <p className="muted">
        A dated adjustment records the difference. Later detail adds to this total.
      </p>
      <p className="muted">
        {known.contributing_entries.length} contributing entries were captured for this total.
      </p>
      <label>
        Financial date
        <input
          type="date"
          required
          value={known.date}
          onChange={(e) => {
            const date = e.target.value;
            const month = `${date.slice(0, 7)}-01`;
            update({
              ...known,
              date,
              month,
              contributing_entries: fingerprint(
                month,
                known.category,
                known.category === "saving"
                  ? known.saving_goal_id || null
                  : known.source_id || null,
              ),
            });
          }}
        />
      </label>
      <label>
        Category
        <select
          value={known.category}
          onChange={(e) => {
            const category = e.target.value as KnownTotalInput["category"];
            update({
              ...known,
              category,
              source_id: null,
              saving_goal_id: null,
              contributing_entries: fingerprint(known.month, category, null),
            });
          }}
        >
          <option value="spending">Guilt-free spending</option>
          <option value="fixed_cost">Fixed costs</option>
          <option value="income">Income</option>
          <option value="saving">Saving</option>
        </select>
      </label>
      {known.category === "income" && (
        <label>
          Income source
          <select
            value={known.source_id || ""}
            onChange={(e) => {
              const source_id = e.target.value || null;
              update({
                ...known,
                source_id,
                contributing_entries: fingerprint(known.month, "income", source_id),
              });
            }}
          >
            <option value="">Unassigned income</option>
            {sources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {known.category === "saving" && (
        <label>
          Saving goal
          <select
            name="known-saving-goal"
            required
            value={known.saving_goal_id || ""}
            onChange={(e) => {
              const saving_goal_id = e.target.value || null;
              update({
                ...known,
                saving_goal_id,
                contributing_entries: fingerprint(known.month, "saving", saving_goal_id),
              });
            }}
          >
            <option value="">Choose a goal</option>
            {savingGoals
              .filter(
                ({ account, goal }) =>
                  account.active && account.opening_date <= known.date && goal.active,
              )
              .map(({ goal, label }) => (
                <option key={goal.uuid} value={goal.uuid}>
                  {label}
                </option>
              ))}
          </select>
        </label>
      )}
      <MoneyInput
        label="Known total (USD)"
        value={known.desired_total}
        onChange={(desired_total) => update({ ...known, desired_total })}
      />
      <label>
        Note
        <textarea
          maxLength={2000}
          value={known.note || ""}
          onChange={(e) => update({ ...known, note: e.target.value })}
        />
      </label>
    </>
  );
}
