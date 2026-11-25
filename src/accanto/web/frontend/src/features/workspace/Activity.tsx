import { Fragment, type KeyboardEvent, useEffect, useRef, useState } from "react";
import type { LoadState } from "../../lib/api";
import { balances } from "../../lib/balances";
import { destinations } from "../../lib/destinations";
import {
  daysInMonth,
  fmtDate,
  fmtDay,
  fmtMonth,
  fmtShort,
  formatMoney,
  inputMoney,
  monthName,
  parseMoney,
  plural,
} from "../../lib/format";
import { SIGNED_USD_AMOUNT, USD_AMOUNT } from "../../lib/money";
import {
  type Activity,
  type ActivityInput,
  type KnownTotalInput,
  type RefundInput,
  monthly,
} from "../../lib/monthly";
import { savings } from "../../lib/savings";
import { Dialog, Empty, Field, Head, tint } from "../../ui";
import { type ScreenProps, composing, sourceChoices, useLoad } from "./shared";
import { useGridKeys } from "./useGridKeys";
import "./activity-review.css";

const categoryNames: Record<Activity["category"], string> = {
  income: "Income",
  fixed_cost: "Fixed costs",
  spending: "Guilt-free spending",
  saving: "Saving",
  investing: "Investing",
  giving: "Giving",
};
/** The kit color for each category, so an entry keeps one color on every screen. */
export const categoryKinds: Record<Activity["category"], string> = {
  income: "income",
  fixed_cost: "fixed",
  spending: "free",
  saving: "save",
  investing: "invest",
  giving: "give",
};
const filterNames: Record<Activity["category"], string> = {
  ...categoryNames,
  spending: "Guilt-free",
};
/** The entry, then its amount; the amount is edited in place, everything else in the dialog. */
const columns = 2;
type Draft =
  | { kind: "activity"; entry: Activity | null; form: ActivityInput }
  | {
      kind: "refund";
      target: Activity;
      entry: Activity | null;
      form: RefundInput;
    }
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
const isNewRow = (id: string) => id === "new" || id === "new-refund";
const AMOUNT = "[0-9]{1,9}([.][0-9]{1,2})?";

/** The date a new entry gets: today in the current month, else the month's last or first day. */
export function defaultDate(month: string, today: string) {
  const current = today.slice(0, 7);
  if (!month || month === current) return today;
  return month < current
    ? `${month}-${String(daysInMonth(month)).padStart(2, "0")}`
    : `${month}-01`;
}

/** One alert for the first failed read, with a retry for all of them. */
export function LoadProblem({
  states,
  retry,
}: { states: LoadState<unknown>[]; retry: () => void }) {
  const failed = states.find((state) => "error" in state);
  if (!failed || !("error" in failed)) return null;
  return (
    <div className="ar-banner bad" role="alert">
      <span>Could not load this workspace. {failed.error.message}</span>
      <button type="button" className="btn sm" onClick={retry}>
        Try loading again
      </button>
    </div>
  );
}
export const LoadingCard = ({ label }: { label: string }) => (
  <div className="card pad sk-card" aria-busy="true" aria-label={label}>
    {[60, 84, 72, 78].map((width) => (
      <div key={width} className="sk" style={{ width: `${width}%`, height: 14 }} />
    ))}
  </div>
);

/**
 * month: the shell's month, which the list shows unless All months is chosen.
 * add: a request the shell raises to open the entry dialog, from Add activity or the N key;
 * added tells the shell it was taken, so a later visit does not reopen the dialog.
 */
export function ActivityScreen(
  p: ScreenProps & { month?: string; add?: number; added?: () => void },
) {
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
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<{ id: string; value: string } | null>(null);
  const [cellError, setCellError] = useState("");
  const [selection, setSelection] = useState({ id: "", col: 0 });
  const [allMonths, setAllMonths] = useState(false);
  const shown = p.month ?? p.entity.today.slice(0, 7);
  const month = allMonths ? "" : shown;
  const [category, setCategory] = useState<Activity["category"] | "">("");
  const [search, setSearch] = useState("");
  const [quick, setQuick] = useState("");
  const [quickError, setQuickError] = useState("");
  const [help, setHelp] = useState(false);
  const [submitRequest, setSubmitRequest] = useState(0);
  const form = useRef<HTMLFormElement>(null);
  const gridKeys = useGridKeys();
  // biome-ignore lint/correctness/useExhaustiveDependencies: Only a new request opens the dialog.
  useEffect(() => {
    if (!p.add) return;
    p.added?.();
    openNew();
  }, [p.add]);
  // Ctrl/⌘+S submits after a committed amount edit has rendered into the record form.
  useEffect(() => {
    if (submitRequest) form.current?.requestSubmit();
  }, [submitRequest]);
  const data = entries.kind === "ready" ? entries.data : [];
  const today = p.entity.today;
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
      ? (state.data.find(
          (row) =>
            row.uuid ===
            (entry.category === "investing" ? entry.investment_id : entry.giving_recipient_id),
        )?.name ?? fallback)
      : fallback;
  };
  /** What an entry was: the note for guilt-free spending, otherwise the line it belongs to. */
  const title = (entry: Activity): string => {
    if (entry.refund_of) {
      const purchase = data.find((row) => row.uuid === entry.refund_of);
      return `Refund: ${purchase ? title(purchase) : "an earlier purchase"}`;
    }
    return entry.category === "spending"
      ? entry.note || "Guilt-free spending"
      : entry.category === "fixed_cost"
        ? (entry.fixed_cost_name ?? "Unassigned fixed cost")
        : entry.category === "saving" && entry.saving_goal_id
          ? goalLabel(entry.saving_goal_id)
          : (entry.category === "investing" && entry.investment_id) ||
              (entry.category === "giving" && entry.giving_recipient_id)
            ? destinationLabel(entry)
            : entry.source_id
              ? sources.find((s) => s.id === entry.source_id)?.label || "Historical Income source"
              : "Unassigned";
  };
  const refundedDate = (entry: Activity) => {
    const date = data.find((row) => row.uuid === entry.refund_of)?.financial_date;
    return date ? fmtDate(date) : "an earlier date";
  };
  const describe = (entry: Activity) =>
    [
      categoryNames[entry.category],
      entry.category === "fixed_cost" && entry.debt_account_id
        ? `Loan: ${loanName(entry.debt_account_id)}`
        : "",
      entry.category !== "income" &&
      entry.category !== "saving" &&
      entry.funding_origin === "savings"
        ? `from ${entry.funding_goal_id ? goalLabel(entry.funding_goal_id) : "saved money"}`
        : "",
      entry.refund_of ? `refund of the purchase on ${refundedDate(entry)}` : "",
      entry.category === "spending" ? "" : entry.note,
    ].filter(Boolean);
  const amountText = (entry: Activity) =>
    entry.amount === ""
      ? "No amount yet"
      : `${entry.category === "income" && !entry.amount.startsWith("-") && Number(entry.amount) ? "+" : ""}${formatMoney(entry.amount)}`;

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
        funding_goal_id: null,
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
          funding_origin: f.funding_goal_id ? "savings" : "income",
          saving_goal_id: f.saving_goal_id ?? null,
          funding_goal_id: f.funding_goal_id ?? null,
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
  const inMonth = data.filter((entry) => !month || entry.financial_date.startsWith(month));
  const rows: Row[] = [
    ...(pendingRow && isNewRow(pendingRow.id) ? [pendingRow] : []),
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
              [
                view.financial_date,
                fmtDate(view.financial_date),
                categoryNames[view.category],
                title(view),
                ...describe(view),
              ]
                .join(" ")
                .toLowerCase()
                .includes(query))),
      ),
  ];
  const groups: Array<{ key: string; label: string; rows: Row[] }> = [];
  for (const row of rows) {
    const key = isNewRow(row.id) ? "new" : row.view.financial_date;
    const last = groups[groups.length - 1];
    if (last?.key === key) last.rows.push(row);
    else
      groups.push({
        key,
        label:
          key === "new" ? "Not saved yet" : key === today ? `Today, ${fmtDay(key)}` : fmtDay(key),
        rows: [row],
      });
  }
  const rowIndex = Math.max(
    0,
    rows.findIndex((row) => row.id === selection.id),
  );
  const activeRow = rows[rowIndex];
  const captureDate = defaultDate(month, today);
  const loaded = entries.kind === "ready" || entries.kind === "empty";

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
    setOpen(false);
    setEdit(null);
    setCellError("");
    setChanged(false);
    p.dirty(false);
  }
  /** Select a row's record; unsaved work on another record needs confirmation. */
  function claim(row: Row): boolean {
    // Reopening the retained record is allowed while a write is pending; replacing it is not.
    if (draftRow(draft) === row.id) return true;
    if (p.busy) return false;
    if (readOnly(row.view)) {
      if (draft && changed && !p.guard()) return false;
      done();
      setInfo(row.view);
      return true;
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
            saving_goal_id: entry.saving_goal_id,
            funding_goal_id: entry.funding_goal_id,
          },
        },
        false,
      );
    return true;
  }
  function openDetails(row: Row) {
    setSelection({ id: row.id, col: selection.col });
    if (claim(row)) setOpen(true);
  }
  function begin(row: Row, col: number) {
    if (col !== 1 || readOnly(row.view) || p.busy) {
      openDetails(row);
      return;
    }
    if (!claim(row)) return;
    setCellError("");
    setEdit({ id: row.id, value: row.view.amount.replace(/^-/, "") });
  }
  function openNew(prefill?: { amount: string; note: string }) {
    if (p.busy || !p.guard()) return;
    start(
      {
        kind: "activity",
        entry: null,
        form: {
          date: captureDate,
          category: "spending",
          amount: prefill?.amount ?? "",
          source_id: null,
          fixed_cost_id: null,
          debt_account_id: null,
          note: prefill?.note ?? "",
          saving_goal_id: null,
          funding_goal_id: null,
        },
      },
      true,
    );
    setSelection({ id: "new", col: 0 });
    setOpen(true);
  }
  function openRefund(original: Activity) {
    if (p.busy || (draftRow(draft) !== original.uuid && changed && !p.guard())) return;
    start(
      {
        kind: "refund",
        target: original,
        entry: null,
        form: {
          date: today < original.financial_date ? original.financial_date : today,
          amount: "",
          note: "",
        },
      },
      true,
    );
    setSelection({ id: "new-refund", col: 1 });
    setOpen(true);
  }
  function openKnown() {
    if (!loaded || p.busy || !p.guard()) return;
    const knownMonth = `${captureDate.slice(0, 7)}-01`;
    start(
      {
        kind: "known",
        form: {
          date: captureDate,
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
    setOpen(true);
  }
  /** Keeps a valid amount edit in the local record; invalid input stays in the cell. */
  function commit(): Draft | null | false {
    if (!edit || !draft || draft.kind === "known") return draft;
    const signed = draft.kind === "activity" && draft.form.is_adjustment;
    if (!(signed ? SIGNED_USD_AMOUNT : USD_AMOUNT).test(edit.value)) {
      setCellError(`Enter a ${signed ? "signed " : ""}USD amount with at most two decimal places.`);
      return false;
    }
    setEdit(null);
    setCellError("");
    if (draft.form.amount === edit.value) return draft;
    const next = {
      ...draft,
      form: { ...draft.form, amount: edit.value },
    } as Draft;
    change(next);
    return next;
  }
  function remove(row: Row) {
    const entry = row.view;
    if (p.busy || readOnly(entry) || isNewRow(row.id)) return;
    if (draftRow(draft) !== row.id && draft && changed && !p.guard()) return;
    const message = entry.refund_of
      ? "Delete this linked refund? Its history will be retained."
      : "Delete this mistaken entry? It will stop contributing to totals; its history is retained.";
    if (!window.confirm(message)) return;
    setOpen(false);
    p.save(
      entry.refund_of
        ? monthly.deleteRefund(p.entity.id, entry.uuid, {
            expected_revision: entry.revision,
          })
        : monthly.deleteActivity(p.entity.id, entry.uuid, {
            expected_revision: entry.revision,
          }),
      done,
    );
  }
  /** The dialog stays open while the write is pending, so a save failure is answered there. */
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
    else if (loaded) p.save(monthly.recordKnownTotal(p.entity.id, next.form), done);
  }
  /** One line records guilt-free spending: an amount, then what it was. */
  function capture() {
    const match = /^\s*\$?([\d,]+(?:\.\d+)?)\s+(\S.*)$/.exec(quick);
    const cents = match ? parseMoney(match[1]) : null;
    if (!match || cents === null) {
      setQuickError('Start with an amount, then what it was. For example: "42.50 groceries".');
      return;
    }
    if (p.busy || !loaded) return;
    if (draft && changed && !p.guard()) return;
    done();
    setQuickError("");
    const note = match[2].trim().replace(/^./, (c) => c.toUpperCase());
    p.save(
      monthly.createActivity(p.entity.id, {
        date: captureDate,
        category: "spending",
        amount: inputMoney(cents),
        source_id: null,
        fixed_cost_id: null,
        debt_account_id: null,
        note: note.slice(0, 2000),
        saving_goal_id: null,
        funding_goal_id: null,
      }),
      () => setQuick(""),
    );
  }
  /** Escape or the backdrop leaves the dialog; unsaved changes stay on their row. */
  function closeDialog() {
    if (!draft || (!changed && !p.busy)) done();
    else setOpen(false);
    const id = selection.id || rows[0]?.id;
    if (id) focusCell(id, selection.col);
  }
  function onCellKey(e: KeyboardEvent, row: Row, index: number, col: number) {
    if (edit?.id === row.id && col === 1) {
      if ((e.key === "Enter" || e.key === "Escape") && !composing(e)) {
        e.preventDefault();
        e.stopPropagation();
        if (commit() !== false) focusCell(row.id, col);
      }
      return;
    }
    gridKeys(e, {
      rowId: row.id,
      position: { row: index, col },
      rows: rows.length,
      columns,
      move: (next) => focusCell(rows[next.row].id, next.col),
      edit: () => begin(row, col),
      add: () => openNew(),
      remove: () => remove(row),
      help: () => setHelp(true),
    });
  }
  if (p.concealed) return null;
  const record = draft && draft.kind !== "known" ? pendingRow?.view : null;
  const dialogTitle = info
    ? categoryNames[info.category]
    : draft?.kind === "known"
      ? "Enter a known total"
      : draft?.kind === "refund"
        ? draft.entry
          ? "Edit linked refund"
          : "Record a refund"
        : draft?.entry
          ? "Edit activity"
          : "Record activity";
  return (
    <div
      className="screen ar activity-screen"
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
          e.preventDefault();
          if (p.busy) return;
          const next = commit();
          // Only a changed record is saved; leaving or saving an untouched row sends nothing.
          if (next && (changed || next !== draft)) {
            setDraft(next);
            if (open) setSubmitRequest((x) => x + 1);
            else submit(next);
          }
        }
      }}
    >
      <Head
        title="Activity"
        sub={
          !loaded
            ? undefined
            : month
              ? `${fmtMonth(month)}, ${plural(inMonth.length, "entry", "entries")}`
              : `All months, ${plural(data.length, "entry", "entries")}`
        }
      >
        <select
          className="input ar-month"
          aria-label="Months shown"
          value={month}
          onChange={(e) => setAllMonths(!e.target.value)}
        >
          <option value={shown}>{fmtMonth(shown)}</option>
          <option value="">All months</option>
        </select>
        <button type="button" className="btn" disabled={p.busy || !loaded} onClick={openKnown}>
          Enter known total
        </button>
        <button type="button" className="btn pri" disabled={p.busy} onClick={() => openNew()}>
          Record activity
        </button>
      </Head>
      <div>
        <form
          className="card quick"
          onSubmit={(e) => {
            e.preventDefault();
            capture();
          }}
        >
          <input
            value={quick}
            onChange={(e) => {
              setQuick(e.target.value);
              setQuickError("");
            }}
            placeholder="42.50 groceries"
            aria-label="Record guilt-free spending: amount, then what it was"
            aria-invalid={Boolean(quickError)}
            aria-describedby="activity-quick-help"
            autoComplete="off"
            maxLength={2020}
          />
          <span className="chip">
            Guilt-free, {captureDate === today ? "today" : fmtShort(captureDate)}
          </span>
          <button type="submit" className="btn pri" disabled={p.busy || !loaded}>
            Record
          </button>
        </form>
        {quickError ? (
          <p id="activity-quick-help" className="err ar-under" role="alert">
            {quickError}
          </p>
        ) : (
          <p id="activity-quick-help" className="note ar-under">
            Type an amount and what it was, then press Enter. For another category, date or funding
            origin,{" "}
            <button
              type="button"
              className="disclose"
              disabled={p.busy}
              onClick={() => {
                const match = /^\s*\$?([\d,]+(?:\.\d+)?)\s+(\S.*)$/.exec(quick);
                const cents = match ? parseMoney(match[1]) : null;
                openNew(
                  match && cents !== null
                    ? { amount: inputMoney(cents), note: match[2].trim() }
                    : undefined,
                );
              }}
            >
              open the full form
            </button>
            .
          </p>
        )}
      </div>
      <LoadProblem
        states={[entries, plans, accounts, investments, loans, recipients]}
        retry={() => setReload((x) => x + 1)}
      />
      {entries.kind === "loading" ? (
        <LoadingCard label="Loading activity" />
      ) : !loaded ? null : inMonth.length === 0 && !pendingRow ? (
        <Empty title={`Nothing is recorded in ${month ? monthName(month) : "any month"} yet`}>
          Record spending in the line above, or use Record activity for income, fixed costs and
          saving. Investing and giving are recorded in Investments and Giving.
        </Empty>
      ) : (
        <section aria-label="Entries">
          <div className="filters">
            {/* biome-ignore lint/a11y/useSemanticElements: The kit's segmented control is a button group. */}
            <div role="group" className="seg-control" aria-label="Show category">
              {(["", ...Object.keys(categoryNames)] as Array<Activity["category"] | "">).map(
                (kind) => (
                  <button
                    type="button"
                    key={kind || "all"}
                    aria-pressed={category === kind}
                    onClick={() => setCategory(kind)}
                  >
                    {kind ? filterNames[kind] : "All"}
                  </button>
                ),
              )}
            </div>
            <input
              className="input"
              type="search"
              placeholder="Find an entry"
              aria-label="Find an entry"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <output className="note">{plural(rows.length, "entry", "entries")}</output>
          </div>
          {rows.length === 0 && (
            <p className="note ar-under">
              No entries match. Clear the filter or the search to see all {inMonth.length}.
            </p>
          )}
          {groups.map((group) => (
            <div key={group.key}>
              <div className="dayh">
                <span>{group.label}</span>
                <span>{plural(group.rows.length, "entry", "entries")}</span>
              </div>
              {/* biome-ignore lint/a11y/useSemanticElements: A list of entries with roving cell focus. */}
              <div
                role="grid"
                className="card"
                aria-label={`Entries: ${group.label}`}
                aria-describedby="activity-keys"
              >
                {group.rows.map((row) => {
                  const index = rows.indexOf(row);
                  const v = row.view;
                  const editing = edit?.id === row.id;
                  const pending = draftRow(draft) === row.id;
                  const cell = (col: number) => ({
                    id: `activity-${row.id}-${col}`,
                    role: "gridcell",
                    "aria-selected": row.id === activeRow?.id && col === selection.col,
                    tabIndex: row.id === activeRow?.id && col === selection.col ? 0 : -1,
                    onKeyDown: (e: KeyboardEvent) => onCellKey(e, row, index, col),
                  });
                  return (
                    // biome-ignore lint/a11y/useSemanticElements lint/a11y/useFocusableInteractive: Grid rows hold the focusable cells.
                    <div
                      role="row"
                      key={row.id}
                      className={`row entry ar-row${row.id === activeRow?.id ? " sel" : ""}${pending && changed ? " draft" : ""}`}
                      style={tint(categoryKinds[v.category])}
                    >
                      <div
                        {...cell(0)}
                        className="ar-what"
                        onClick={() => {
                          if (commit() === false) return;
                          openDetails(row);
                        }}
                      >
                        <span className="dot" />
                        <span className="t">
                          <span className="ar-title">
                            {title(v)}
                            {v.is_adjustment && <span className="chip">Adjustment</span>}
                            {!v.refund_of &&
                              v.remaining_refundable != null &&
                              v.remaining_refundable !==
                                (data.find((e) => e.uuid === row.id) ?? v).amount.replace(
                                  /^-/,
                                  "",
                                ) && (
                                <span className="chip">
                                  Refundable {formatMoney(v.remaining_refundable)}
                                </span>
                              )}
                            {readOnly(v) && <span className="chip">Read only</span>}
                            {pending && changed && <span className="chip warn">Unsaved</span>}
                          </span>
                          <small>
                            {describe(v).map((part, i) => (
                              <Fragment key={part}>
                                {i ? ", " : ""}
                                <span>{part}</span>
                              </Fragment>
                            ))}
                          </small>
                        </span>
                      </div>
                      <div
                        {...cell(1)}
                        className={`a${v.category === "income" ? " good" : ""}`}
                        onClick={(e) => {
                          if ((e.target as HTMLElement).closest("input")) return;
                          if (commit() === false) return;
                          openDetails(row);
                        }}
                        onDoubleClick={() => begin(row, 1)}
                      >
                        {editing ? (
                          <input
                            // biome-ignore lint/a11y/noAutofocus: Editing moves focus into the amount.
                            autoFocus
                            className="amt"
                            aria-label={`${v.refund_of ? "Refund amount" : "Amount"} for ${title(v)} on ${v.financial_date ? fmtDate(v.financial_date) : "new entry"}`}
                            aria-invalid={Boolean(cellError)}
                            aria-describedby={cellError ? "activity-cell-error" : undefined}
                            inputMode="decimal"
                            value={edit.value}
                            onChange={(e) => {
                              setEdit({ ...edit, value: e.target.value });
                              setCellError("");
                            }}
                            onBlur={() => commit()}
                          />
                        ) : (
                          amountText(v)
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          {cellError && (
            <p id="activity-cell-error" role="alert" className="err ar-under">
              {cellError}
            </p>
          )}
          <p id="activity-keys" className="note ar-keys">
            <kbd className="kbd">j</kbd> <kbd className="kbd">k</kbd> move,{" "}
            <kbd className="kbd">Enter</kbd> opens an entry, <kbd className="kbd">i</kbd> on an
            amount edits it, <kbd className="kbd">a</kbd> adds, <kbd className="kbd">dd</kbd>{" "}
            deletes, <kbd className="kbd">?</kbd> all keys
            {changed && draft && !open && (
              <>
                {" "}
                · <span className="warn">Unsaved entry: Ctrl/⌘ S saves it</span>
              </>
            )}
          </p>
        </section>
      )}
      {open && (info || draft) && (
        <Dialog title={dialogTitle} onClose={closeDialog} className="ar">
          {info && (
            <>
              <div className="dlg-b">
                <dl className="ar-facts">
                  <dt>What</dt>
                  <dd>{title(info)}</dd>
                  <dt>Date</dt>
                  <dd>{fmtDate(info.financial_date)}</dd>
                  <dt>Amount</dt>
                  <dd>{formatMoney(info.amount)}</dd>
                  <dt>Paid from</dt>
                  <dd>
                    {info.funding_goal_id ? goalLabel(info.funding_goal_id) : "Current income"}
                  </dd>
                  {info.note && (
                    <>
                      <dt>Note</dt>
                      <dd>{info.note}</dd>
                    </>
                  )}
                </dl>
                <p className="note">
                  Correct this entry in {info.category === "investing" ? "Investments" : "Giving"}.
                </p>
              </div>
              <div className="dlg-f">
                {info.remaining_refundable != null && Number(info.remaining_refundable) > 0 && (
                  <button
                    type="button"
                    className="btn"
                    disabled={p.busy}
                    onClick={() => openRefund(info)}
                  >
                    Record a refund
                  </button>
                )}
                <span className="spacer" />
                <button type="button" className="btn" onClick={closeDialog}>
                  Close
                </button>
              </div>
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
              <fieldset disabled={p.busy} className="ar-fs">
                <div className="dlg-b">
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
                      <p className="note">
                        Original {categoryNames[draft.target.category].toLowerCase()} payment of{" "}
                        {formatMoney(draft.target.amount)} on {fmtDate(draft.target.financial_date)}
                        . Remaining refundable:{" "}
                        {formatMoney(draft.target.remaining_refundable ?? "0.00")}.
                      </p>
                      <div className="two">
                        <Field label="Refund date">
                          <input
                            type="date"
                            required
                            min={draft.target.financial_date}
                            value={draft.form.date}
                            onChange={(e) =>
                              change({
                                ...draft,
                                form: { ...draft.form, date: e.target.value },
                              })
                            }
                          />
                        </Field>
                        <Field label="Refund amount (USD)">
                          <input
                            required
                            inputMode="decimal"
                            pattern={AMOUNT}
                            placeholder="0.00"
                            value={draft.form.amount}
                            onChange={(e) =>
                              change({
                                ...draft,
                                form: { ...draft.form, amount: e.target.value },
                              })
                            }
                          />
                        </Field>
                      </div>
                      <Field label="Note (optional)">
                        <input
                          maxLength={2000}
                          value={draft.form.note ?? ""}
                          onChange={(e) =>
                            change({
                              ...draft,
                              form: { ...draft.form, note: e.target.value },
                            })
                          }
                        />
                      </Field>
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
                    <p className="note">
                      Remaining refundable: {formatMoney(draft.entry.remaining_refundable)}
                    </p>
                  )}
                </div>
                <div className="dlg-f">
                  {draft.kind !== "known" && draft.entry && (
                    <button
                      type="button"
                      className="btn quiet danger"
                      onClick={() => record && remove({ id: record.uuid, view: record })}
                    >
                      Delete
                    </button>
                  )}
                  {draft.kind === "activity" &&
                    draft.entry &&
                    !changed &&
                    draft.entry.remaining_refundable != null &&
                    Number(draft.entry.remaining_refundable) > 0 && (
                      <button
                        type="button"
                        className="btn quiet"
                        onClick={() => openRefund(draft.entry as Activity)}
                      >
                        Record a refund
                      </button>
                    )}
                  <span className="spacer" />
                  <button type="button" className="btn" onClick={done}>
                    {changed ? "Discard changes" : "Cancel"}
                  </button>
                  <button className="btn pri" type="submit">
                    {draft.kind === "known"
                      ? "Save adjustment"
                      : draft.kind === "refund"
                        ? "Save refund"
                        : draft.entry
                          ? "Save changes"
                          : "Record"}
                  </button>
                </div>
              </fieldset>
            </form>
          )}
        </Dialog>
      )}
      {help && (
        <Dialog title="Keyboard shortcuts" onClose={() => setHelp(false)} className="ar">
          <div className="dlg-b">
            <dl className="ar-keylist">
              {[
                ["j k / arrows", "Move between entries"],
                ["h l / arrows", "Move between an entry and its amount"],
                ["gg / G", "First or last entry"],
                ["Enter / i", "Open the entry; on an amount, edit it in place"],
                ["Enter / Escape", "Keep a valid amount in the unsaved entry"],
                ["a", "Record activity"],
                ["dd", "Delete the selected entry, with confirmation"],
                ["Ctrl / ⌘ + S", "Save the entry being edited"],
                ["Escape", "Close the dialog; unsaved changes stay"],
              ].map(([key, label]) => (
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
      )}
    </div>
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
  const fundable = form.category === "spending" || form.category === "fixed_cost";
  const openGoals = savingGoals.filter(
    ({ account, goal }) =>
      account.active &&
      account.opening_date <= form.date &&
      (form.category !== "saving" || goal.active || goal.uuid === selected?.saving_goal_id),
  );
  return (
    <>
      <div className="two">
        <Field label="Category">
          <select
            value={form.category}
            onChange={(e) =>
              update({
                ...form,
                category: e.target.value as ActivityInput["category"],
                source_id: null,
                fixed_cost_id: null,
                debt_account_id: null,
                saving_goal_id: null,
                funding_goal_id: null,
              })
            }
          >
            <option value="income">Income</option>
            <option value="fixed_cost">Fixed costs</option>
            <option value="spending">Guilt-free spending</option>
            <option value="saving">Saving</option>
          </select>
        </Field>
        <Field label="Financial date">
          <input
            type="date"
            required
            value={form.date}
            onChange={(e) => update({ ...form, date: e.target.value })}
          />
        </Field>
      </div>
      {form.category === "spending" && (
        <Field label="What was it?">
          <input
            maxLength={2000}
            placeholder="Groceries"
            value={form.note || ""}
            onChange={(e) => update({ ...form, note: e.target.value })}
          />
        </Field>
      )}
      {form.category === "income" && (
        <Field label="Income source">
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
        </Field>
      )}
      {form.category === "fixed_cost" && (
        <div className="two">
          <Field label="Fixed cost">
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
          </Field>
          <Field label="Loan account (optional)">
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
          </Field>
        </div>
      )}
      {form.category === "saving" && (
        <Field label="Goal">
          <select
            name="saving-goal"
            required
            value={form.saving_goal_id ?? ""}
            onChange={(e) => update({ ...form, saving_goal_id: e.target.value || null })}
          >
            <option value="">Choose a goal</option>
            {openGoals.map(({ goal, label }) => (
              <option key={goal.uuid} value={goal.uuid}>
                {label}
              </option>
            ))}
          </select>
        </Field>
      )}
      <div>
        <Field label="Amount (USD)">
          <input
            required
            inputMode="decimal"
            placeholder="0.00"
            pattern={form.is_adjustment ? `-?${AMOUNT}` : AMOUNT}
            value={form.amount}
            onChange={(e) => update({ ...form, amount: e.target.value })}
          />
        </Field>
        <p className="note ar-under">
          {form.is_adjustment
            ? "An adjustment may be negative; it changes the recorded total by this amount."
            : "Zero is a real entry: it records that nothing happened."}
        </p>
      </div>
      {fundable && (
        <Field label="Paid from">
          <select
            name="funding-origin"
            required
            value={form.funding_goal_id ?? "income"}
            onChange={(e) =>
              update({
                ...form,
                funding_goal_id: e.target.value === "income" ? null : e.target.value || null,
              })
            }
          >
            <option value="income">Current income</option>
            {openGoals.map(({ goal, label }) => (
              <option key={goal.uuid} value={goal.uuid}>
                Saved money: {label}
              </option>
            ))}
          </select>
        </Field>
      )}
      {form.category !== "spending" && (
        <Field label="Note (optional)">
          <input
            maxLength={2000}
            value={form.note || ""}
            onChange={(e) => update({ ...form, note: e.target.value })}
          />
        </Field>
      )}
      <label className="ar-check">
        <input
          type="checkbox"
          checked={Boolean(form.is_adjustment)}
          onChange={(e) => update({ ...form, is_adjustment: e.target.checked })}
        />
        Adjustment to the recorded total
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
  const count = known.contributing_entries.length;
  return (
    <>
      <p className="note">
        When you know a month's total but not every entry, a dated adjustment records the
        difference. Later entries add to this total. {count}{" "}
        {count === 1 ? "contributing entry was" : "contributing entries were"} captured for this
        total.
      </p>
      <div className="two">
        <Field label="Category">
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
        </Field>
        <Field label="Financial date">
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
        </Field>
      </div>
      {known.category === "income" && (
        <Field label="Income source">
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
        </Field>
      )}
      {known.category === "saving" && (
        <Field label="Goal">
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
        </Field>
      )}
      <Field label="Known total (USD)">
        <input
          required
          inputMode="decimal"
          placeholder="0.00"
          pattern={AMOUNT}
          value={known.desired_total}
          onChange={(e) => update({ ...known, desired_total: e.target.value })}
        />
      </Field>
      <Field label="Note (optional)">
        <input
          maxLength={2000}
          value={known.note || ""}
          onChange={(e) => update({ ...known, note: e.target.value })}
        />
      </Field>
    </>
  );
}
