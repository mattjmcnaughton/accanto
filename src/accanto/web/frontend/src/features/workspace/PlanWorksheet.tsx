import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PlanRevision } from "../../lib/monthly";
import type { SavingsAccount } from "../../lib/savings";
import type { SpendingSubcategory } from "../../lib/spendingSubcategories";
import { Band, Combobox, Dialog, Icon, cleanName, tint } from "../../ui";
import { NewGoal } from "../create/CreateForms";
import { type CreatableKind, type CreateRequest, NOUNS } from "../create/create";
import { PlanBreakdown, share } from "./PlanBreakdown";
import {
  type Catalog,
  type Choice,
  type Estimates,
  type Group,
  type Line,
  type WorksheetDraft,
  allocationBand,
  allocations,
  FREQUENCIES,
  balance,
  cents,
  even,
  kinds,
  lineGroups,
  money,
  monthlyAmount as monthly,
  revisionEstimates,
  revisionLines,
  savedLabel,
  storedCents,
  storedGroups,
  storedTotals,
  titles,
  totals,
} from "./planWorksheetModel";
import { composing } from "./shared";

type DisplayRow = { id: string; group: Group } & (
  | { heading: true }
  | { heading: false; line: Line }
  // A Spending subcategory under guilt-free spending, with an optional estimate.
  | { heading: "subcategory"; subcategory: SpendingSubcategory }
  // Guilt-free spending not covered by estimates; shown once any estimate is set.
  | { heading: "unestimated" }
);
const ESTIMATE = "subcategory-";
/** The subcategory id of an estimate cell edit, or null for any other edit. */
const estimateOf = (id?: string) => (id?.startsWith(ESTIMATE) ? id.slice(ESTIMATE.length) : null);
const groups: Group[] = ["income", "funding", "fixed", "spending", "saving", "investing", "giving"];
/** What a Destination picker can create; savings accounts and other groups are made elsewhere. */
const creatable = (group: Group): CreatableKind | null =>
  group === "saving"
    ? "saving_goal"
    : group === "investing"
      ? "investment"
      : group === "giving"
        ? "giving_recipient"
        : null;

/**
 * Entered amount (1) and monthly amount (3) both edit a line's amount. The monthly cell edits in
 * place only when the two are equal; other frequencies edit the entered amount, which converts.
 */
const amountCol = (col: number) => col === 1 || col === 3;

/** Section captions shown above the first group of each half of the worksheet. */
const sections: Partial<Record<Group, [string, string?]>> = {
  income: ["Where the money comes from"],
  fixed: ["Where it goes"],
};

export function PlanWorksheet({
  revision,
  retained,
  versions,
  catalog,
  unavailable = [],
  loans,
  subcategories = [],
  onSubcategories,
  busy,
  timeZone,
  onChange,
  onSave,
  onVersion,
  onBack,
  onCopy,
  onCreate,
  accounts = [],
}: {
  revision: PlanRevision;
  retained?: WorksheetDraft;
  versions: PlanRevision[];
  catalog: Catalog;
  /** Reference data still loading or failed: unknown, not empty or inactive. */
  unavailable?: ReadonlyArray<Group | "loans">;
  loans: Choice[];
  /** Active Spending subcategories, listed under guilt-free spending with optional estimates. */
  subcategories?: SpendingSubcategory[];
  /** Opens the Spending subcategories manager (add, rename, archive). */
  onSubcategories?: () => void;
  busy: boolean;
  timeZone: string;
  onChange: (draft: WorksheetDraft) => void;
  onSave: (name: string, lines: Line[], estimates: Estimates) => void;
  onVersion: () => void;
  onBack: () => void;
  /** Copy this Plan; omitted while copying is unavailable. */
  onCopy?: () => void;
  /**
   * Create a saving goal, investment or giving recipient from a typed name; `chosen` gets the
   * new record once its create command succeeds. Omitted, the Destination picker only chooses.
   */
  onCreate?: (request: CreateRequest, chosen: (id: string) => void) => void;
  /** Savings accounts a new saving goal can belong to. */
  accounts?: SavingsAccount[];
}) {
  const initialLines = useMemo(() => revisionLines(revision), [revision]);
  const [draftLines, setLines] = useState<Line[]>(retained?.lines ?? initialLines);
  const initialEstimates = useMemo(() => revisionEstimates(revision), [revision]);
  const [draftEstimates, setEstimates] = useState<Estimates>(
    retained?.estimates ?? initialEstimates,
  );
  const [draftName, setDraftName] = useState(retained?.name ?? revision.name);
  const [editingName, setEditingName] = useState(retained?.name.trim() === "");
  const saved = JSON.stringify({
    name: revision.name,
    lines: initialLines,
    estimates: initialEstimates,
  });
  const [collapsed, setCollapsed] = useState<Group[]>([]);
  const [selection, setSelection] = useState({
    id: retained?.cellEdit?.id ?? "group-income",
    col: retained?.cellEdit?.col ?? 0,
  });
  const [sidebar, setSidebar] = useState<string | null>(null);
  const [edit, setEdit] = useState<WorksheetDraft["cellEdit"]>(retained?.cellEdit ?? null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [modal, setModal] = useState<"help" | null>(null);
  /** A new saving goal's name, waiting for its savings account. */
  const [newGoal, setNewGoal] = useState<string | null>(null);
  const [versionIndex, setVersionIndex] = useState<number | null>(null);
  const gTime = useRef(0);
  const pendingDelete = useRef<{ id: string; time: number } | null>(null);
  /** The closing editor's blur must not write the value Escape discarded. */
  const discarded = useRef(false);
  const readOnly = versionIndex !== null;
  const snapshot = readOnly ? versions[versionIndex] : null;
  const lines = useMemo(
    () => (snapshot ? revisionLines(snapshot) : draftLines),
    [snapshot, draftLines],
  );
  const planName = snapshot ? snapshot.name : draftName;
  const validName = draftName.trim().length > 0 && draftName.trim().length <= 120;
  const dirty =
    JSON.stringify({ name: draftName, lines: draftLines, estimates: draftEstimates }) !== saved;
  const estimates = useMemo(
    () => (snapshot ? revisionEstimates(snapshot) : draftEstimates),
    [snapshot, draftEstimates],
  );
  // An open amount or frequency edit previews in the totals and band; an invalid amount is unknown.
  const preview = useMemo(() => {
    if (!edit || readOnly || estimateOf(edit.id) !== null) return lines;
    if (amountCol(edit.col) && cents(edit.value) === null) return null;
    return lines.map((line) =>
      line.id !== edit.id
        ? line
        : amountCol(edit.col)
          ? { ...line, amount: edit.value.trim() }
          : edit.col === 2
            ? { ...line, frequency: edit.value as Line["frequency"] }
            : line,
    );
  }, [edit, lines, readOnly]);
  const stats = snapshot
    ? storedTotals(snapshot)
    : preview === null
      ? { funding: null, allocated: null, unassigned: null }
      : dirty || edit
        ? totals(preview)
        : storedTotals(revision);
  const selectedLine = lines.find((l) => l.id === sidebar);
  const valid = validName && lines.every((l) => cents(l.amount) !== null && l.name.trim());
  const stored = snapshot ?? (!dirty && !edit ? revision : null);
  const amounts = stored ? storedGroups(stored) : lineGroups(preview);
  const groupTotal = (group: Group) => amounts[group];
  const band = allocationBand(amounts, stats.unassigned);
  // Estimates are informational: they need not add up to guilt-free spending.
  const shownEstimates = { ...estimates };
  const editing = estimateOf(edit?.id);
  if (editing !== null && edit && !readOnly) {
    if (edit.value.trim()) shownEstimates[editing] = edit.value.trim();
    else delete shownEstimates[editing];
  }
  const estimateValues = Object.values(shownEstimates).map(cents);
  const estimated = estimateValues.some((value) => value === null)
    ? null
    : estimateValues.reduce<number>((total, value) => total + (value ?? 0), 0);
  const unestimated =
    estimated === null || amounts.spending === null ? null : amounts.spending - estimated;
  // Archived subcategories keep the estimates a draft or version already has.
  const estimateRows = useMemo<SpendingSubcategory[]>(() => {
    const names = new Map(
      (snapshot ?? revision).spending_estimates?.map((line) => [
        line.spending_subcategory_id,
        line.spending_subcategory_name,
      ]) ?? [],
    );
    return [
      ...subcategories,
      ...Object.keys(estimates)
        .filter((id) => !subcategories.some((sub) => sub.uuid === id))
        .map((id) => ({
          uuid: id,
          name: names.get(id) ?? "Archived subcategory",
          active: false,
          revision: 0,
          entries: 0,
        })),
    ];
  }, [subcategories, estimates, snapshot, revision]);
  const hasEstimates = estimateValues.length > 0;
  const state = balance(stats);
  const needsRevision = (line: Line) =>
    !readOnly &&
    ((catalog[line.group] &&
      line.reference &&
      !unavailable.includes(line.group) &&
      !catalog[line.group]?.some((choice) => choice.id === line.reference && choice.active)) ||
      (line.link &&
        !unavailable.includes("loans") &&
        !loans.some((loan) => loan.id === line.link && loan.active)));
  const display = useMemo(
    () =>
      groups.flatMap<DisplayRow>((group) =>
        group === "spending"
          ? [
              ...lines
                .filter((line) => line.group === "spending")
                .map((line) => ({ id: line.id, group, heading: false as const, line })),
              ...estimateRows.map((subcategory) => ({
                id: `${ESTIMATE}${subcategory.uuid}`,
                group,
                heading: "subcategory" as const,
                subcategory,
              })),
              ...(hasEstimates
                ? [{ id: "unestimated", group, heading: "unestimated" as const }]
                : []),
            ]
          : [
              { id: `group-${group}`, group, heading: true },
              ...(collapsed.includes(group)
                ? []
                : lines
                    .filter((l) => l.group === group)
                    .map((line) => ({ id: line.id, group, heading: false, line }))),
            ],
      ),
    [lines, collapsed, estimateRows, hasEstimates],
  );
  const notify = useRef(onChange);
  notify.current = onChange;
  useEffect(() => {
    notify.current({
      name: draftName,
      lines: draftLines,
      estimates: draftEstimates,
      editing: !!edit,
      cellEdit: edit,
    });
  }, [draftName, draftLines, draftEstimates, edit]);
  const focusCell = (id: string, col: number) => {
    setSelection({ id, col });
    requestAnimationFrame(() => document.getElementById(`cell-${id}-${col}`)?.focus());
  };
  const change = (id: string, patch: Partial<Line>) => {
    if (readOnly || busy) return;
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
    setNotice("");
  };
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => {
      if (dirty || edit) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty, edit]);
  useEffect(() => {
    if (editingName) document.getElementById("plan-name")?.focus();
  }, [editingName]);
  const toggle = (group: Group) =>
    setCollapsed((cs) => (cs.includes(group) ? cs.filter((g) => g !== group) : [...cs, group]));
  function begin(row: DisplayRow, col: number) {
    if (row.heading === "unestimated") return;
    if (row.heading === "subcategory") {
      if (col === 4) add(row.group);
      else if (amountCol(col) && !readOnly && !busy) {
        setError("");
        discarded.current = false;
        setSelection({ id: row.id, col: 1 });
        setEdit({ id: row.id, col: 1, value: estimates[row.subcategory.uuid] ?? "" });
      }
      return;
    }
    if (row.heading) {
      if (col === 0) toggle(row.group);
      if (col === 4) add(row.group);
      return;
    }
    if (col === 4) {
      openDetails(row.line.id);
      return;
    }
    if (readOnly || busy) return;
    if ((col === 2 && row.group !== "fixed") || (col === 0 && row.group === "spending")) return;
    const at = col === 3 && row.line.frequency !== "Monthly" ? 1 : col;
    setError("");
    discarded.current = false;
    setSelection({ id: row.id, col: at });
    setEdit({
      id: row.id,
      col: at,
      value:
        col === 0
          ? catalog[row.group]
            ? (row.line.reference ?? "")
            : row.line.name
          : amountCol(col)
            ? row.line.amount
            : row.line.frequency,
    });
  }
  function commit(): boolean {
    if (!edit) return true;
    const estimate = estimateOf(edit.id);
    if (estimate !== null) {
      const value = edit.value.trim();
      const amount = cents(value);
      if (value && amount === null) {
        setError("Enter an amount, or leave it blank.");
        return false;
      }
      setEstimates((all) => {
        const next = { ...all };
        if (amount === null) delete next[estimate];
        else next[estimate] = (amount / 100).toFixed(2);
        return next;
      });
      setEdit(null);
      setError("");
      setNotice("");
      return true;
    }
    if (amountCol(edit.col) && cents(edit.value) === null) {
      setError("Enter a nonnegative USD amount with up to two decimal places.");
      return false;
    }
    if (edit.col === 0 && !edit.value.trim()) {
      setError("Enter a name.");
      return false;
    }
    const line = lines.find((line) => line.id === edit.id);
    if (!line) return false;
    const choice = catalog[line.group]?.find((choice) => choice.id === edit.value);
    change(
      edit.id,
      edit.col === 0
        ? catalog[line.group]
          ? { reference: edit.value, name: choice?.name ?? line.name }
          : { name: edit.value.trim() }
        : amountCol(edit.col)
          ? { amount: edit.value.trim() }
          : { frequency: edit.value as Line["frequency"] },
    );
    setEdit(null);
    setError("");
    return true;
  }
  function discard() {
    discarded.current = true;
    setEdit(null);
    setError("");
  }
  function openDetails(id: string) {
    if (!commit()) return;
    setSidebar(id);
    requestAnimationFrame(() =>
      document.getElementById(readOnly ? "close-details" : "detail-name")?.focus(),
    );
  }
  function closeDetails() {
    if (selectedLine && (cents(selectedLine.amount) === null || !selectedLine.name.trim())) return;
    setSidebar(null);
    focusCell(selection.id, selection.col);
  }
  function add(group: Group) {
    if (readOnly || busy) return;
    if (group === "spending") {
      // Subcategories are Entity records: adding one leaves the draft unchanged.
      if (commit()) onSubcategories?.();
      return;
    }
    if (!commit()) return;
    if (lines.filter((line) => line.group === group).length >= 100) {
      setNotice("A category supports at most 100 lines.");
      return;
    }
    if (unavailable.includes(group)) {
      setNotice("Destinations are not loaded. Retry loading them, then add the line.");
      return;
    }
    const options = catalog[group]?.filter(
      (choice) =>
        choice.active && !lines.some((l) => l.group === group && l.reference === choice.id),
    );
    if (options?.length === 0 && !onCreate) {
      setNotice(
        "No available destinations. Add or reopen a destination in the workspace, or edit an existing line.",
      );
      return;
    }
    const id = `new-${crypto.randomUUID()}`;
    const line: Line = {
      id,
      group,
      // With nothing to choose, the line waits for a destination to be created in its details.
      name:
        options?.[0]?.name ??
        (options ? "" : group === "income" ? "New income source" : "New fixed cost"),
      reference: options?.[0]?.id,
      amount: "0.00",
      frequency: "Monthly",
    };
    setLines((ls) => [...ls, line]);
    setCollapsed((cs) => cs.filter((g) => g !== group));
    setSidebar(id);
    setSelection({ id, col: 0 });
    requestAnimationFrame(() => document.getElementById("detail-name")?.focus());
  }
  function remove(id: string | null = sidebar) {
    const target = lines.find((l) => l.id === id);
    if (readOnly || busy || !target || target.group === "spending") return;
    if (target.group === "income" && lines.filter((l) => l.group === "income").length === 1) {
      setNotice("Keep at least one income source.");
      return;
    }
    if (!confirm(`Remove “${target.name}” from this draft? Saved versions will not change.`))
      return;
    const group = target.group;
    setLines((ls) => ls.filter((l) => l.id !== target.id));
    setSidebar(null);
    focusCell(`group-${group}`, 0);
  }
  function finishName() {
    if (!validName) return false;
    setDraftName(draftName.trim());
    setEditingName(false);
    return true;
  }
  function saveDraft() {
    if (readOnly || busy) return;
    if (edit) {
      setNotice("Finish the active cell edit before saving.");
      return;
    }
    if (!valid) {
      setNotice("Correct the highlighted inputs before saving.");
      return;
    }
    onSave(draftName.trim(), lines, draftEstimates);
  }
  function saveVersion() {
    if (readOnly || busy) return;
    if (edit || dirty || !valid) {
      setNotice("Save a valid draft before creating a version.");
      return;
    }
    onVersion();
  }
  function switchVersion(value: string) {
    if (editingName && !finishName()) return;
    if (!commit()) return;
    setVersionIndex(value === "draft" ? null : Number(value));
    setSidebar(null);
    setError("");
    setNotice("");
    setSelection({ id: "group-income", col: 0 });
  }
  function onGridKey(e: React.KeyboardEvent, row: DisplayRow, col: number) {
    if (edit) {
      if (composing(e)) return;
      if (e.key === "Escape" || e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        if (e.key === "Escape") discard();
        if (e.key === "Escape" || commit()) focusCell(row.id, edit.col);
      }
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    let index = display.findIndex((r) => r.id === row.id);
    let nextCol = col;
    const key = e.key;
    if (key !== "d") pendingDelete.current = null;
    if (key !== "g") gTime.current = 0;
    if (key === "a" || key === "A") {
      e.preventDefault();
      add(row.group);
      return;
    }
    if (key === "d") {
      e.preventDefault();
      if (e.repeat || readOnly || row.heading || row.group === "spending") return;
      const previous = pendingDelete.current;
      if (previous?.id === row.id && Date.now() - previous.time < 700) {
        pendingDelete.current = null;
        remove(row.id);
      } else pendingDelete.current = { id: row.id, time: Date.now() };
      return;
    }
    if (key === "?") {
      e.preventDefault();
      setModal("help");
      return;
    }
    if (key === "i" || key === "Enter") {
      e.preventDefault();
      begin(row, col);
      return;
    }
    if (key === "Escape" && sidebar) {
      e.preventDefault();
      closeDetails();
      return;
    }
    if (key === "h" || key === "ArrowLeft") nextCol = Math.max(0, col - 1);
    else if (key === "l" || key === "ArrowRight") nextCol = Math.min(4, col + 1);
    else if (key === "j" || key === "ArrowDown") index = Math.min(display.length - 1, index + 1);
    else if (key === "k" || key === "ArrowUp") index = Math.max(0, index - 1);
    else if (key === "0" || key === "Home") nextCol = 0;
    else if (key === "$" || key === "End") nextCol = 4;
    else if (key === "G") index = display.length - 1;
    else if (key === "g") {
      e.preventDefault();
      if (Date.now() - gTime.current < 600) {
        focusCell(display[0].id, col);
        gTime.current = 0;
      } else gTime.current = Date.now();
      return;
    } else return;
    e.preventDefault();
    focusCell(display[index].id, nextCol);
  }
  function editor(row: DisplayRow) {
    if (!edit) return null;
    if (row.heading === "subcategory") {
      const currentEdit = edit;
      return (
        <input
          // biome-ignore lint/a11y/noAutofocus: Editing a cell focuses its input.
          autoFocus
          value={edit.value}
          inputMode="decimal"
          placeholder="Optional"
          aria-label={`Estimate for ${row.subcategory.name}`}
          aria-invalid={!!error}
          onFocus={(e) => e.target.select()}
          onChange={(e) => {
            setEdit({ ...currentEdit, value: e.target.value });
            setError("");
          }}
          onBlur={() => {
            if (discarded.current) discarded.current = false;
            else commit();
          }}
        />
      );
    }
    if (row.heading) return null;
    const currentEdit = edit;
    const options =
      edit?.col === 2
        ? Object.keys(FREQUENCIES).map((name) => ({ id: name, name, active: true }))
        : catalog[row.group];
    const props = {
      autoFocus: true,
      value: edit?.value,
      "aria-label": `${["Name", "Amount", "Frequency", "Monthly amount"][edit.col]} for ${row.line?.name}`,
      "aria-invalid": !!error,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        setEdit({ ...currentEdit, value: e.target.value });
        setError("");
      },
      onBlur: () => {
        if (discarded.current) discarded.current = false;
        else commit();
      },
    };
    return edit?.col === 2 || (edit?.col === 0 && options) ? (
      <select {...props}>
        {currentEdit.col === 0 && <option value={row.line.reference}>{row.line.name}</option>}
        {options
          ?.filter(
            (o) =>
              o.id === row.line?.reference ||
              edit?.col === 2 ||
              (o.active && !lines.some((l) => l.group === row.group && l.reference === o.id)),
          )
          .map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
              {o.active ? "" : " (inactive)"}
            </option>
          ))}
      </select>
    ) : (
      <input
        {...props}
        inputMode={amountCol(edit.col) ? "decimal" : "text"}
        onFocus={(e) => e.target.select()}
      />
    );
  }
  // A line's monthly amount follows an open edit, as the totals do.
  const previewMonthly = (line: Line) => {
    if (preview === null) return edit?.id === line.id ? null : monthly(line);
    const shown = preview.find((item) => item.id === line.id);
    return shown ? monthly(shown) : null;
  };
  const loanName = (id?: string) => loans.find((loan) => loan.id === id)?.name;
  const savedState = readOnly
    ? dirty || edit
      ? "Unsaved draft retained"
      : "Saved snapshot"
    : dirty || edit
      ? "Unsaved changes"
      : "Draft saved";
  const overallocated = stats.unassigned !== null && stats.unassigned < 0;
  return (
    <div
      className="plan-sheet screen"
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
          e.preventDefault();
          saveDraft();
        }
      }}
    >
      <div>
        <button type="button" className="btn sm quiet plan-back" onClick={onBack}>
          <Icon name="left" />
          All Plans
        </button>
      </div>
      <fieldset disabled={busy} className="plan-fieldset">
        <div className="stack">
          <div className="head">
            <div className="plan-title">
              {editingName && !readOnly ? (
                <>
                  <label className="sr-only" htmlFor="plan-name">
                    Plan name
                  </label>
                  <input
                    id="plan-name"
                    className="title-in"
                    maxLength={120}
                    value={draftName}
                    aria-invalid={!validName}
                    aria-describedby={!validName ? "plan-name-error" : undefined}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => {
                      setDraftName(e.target.value);
                      setNotice("");
                    }}
                    onBlur={() => finishName()}
                    onKeyDown={(e) => {
                      if (!composing(e) && (e.key === "Enter" || e.key === "Escape")) {
                        e.preventDefault();
                        if (finishName())
                          requestAnimationFrame(() =>
                            document.getElementById("rename-plan")?.focus(),
                          );
                      }
                    }}
                  />
                  {!validName && (
                    <p id="plan-name-error" className="err" role="alert">
                      Enter a Plan name (1–120 characters).
                    </p>
                  )}
                </>
              ) : (
                <h1 className="h1">
                  {readOnly ? (
                    planName
                  ) : (
                    <button
                      type="button"
                      id="rename-plan"
                      className="title-btn"
                      aria-label={`Rename Plan: ${planName}`}
                      title="Rename Plan"
                      onClick={() => {
                        if (commit()) setEditingName(true);
                      }}
                    >
                      {planName}
                    </button>
                  )}
                </h1>
              )}
              <span className={`chip ${state.tone}`}>{state.text}</span>
            </div>
            <div className="head-actions">
              <select
                id="plan-version"
                className="input plan-version"
                aria-label="Viewing Plan version"
                value={versionIndex ?? "draft"}
                onChange={(e) => switchVersion(e.target.value)}
              >
                <option value="draft">Current draft</option>
                {versions.map((v, i) => (
                  <option value={i} key={v.uuid}>
                    {savedLabel(v, timeZone)}
                  </option>
                ))}
              </select>
              {onCopy && (
                <button type="button" className="btn" onClick={onCopy}>
                  <Icon name="copy" />
                  Copy
                </button>
              )}
              {readOnly ? (
                <button
                  type="button"
                  id="return-draft"
                  className="btn"
                  onClick={() => switchVersion("draft")}
                >
                  Return to draft
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    id="save-draft"
                    className="btn"
                    title="Save editable work without creating an immutable version"
                    onClick={saveDraft}
                  >
                    Save draft
                  </button>
                  <button
                    type="button"
                    id="save-version"
                    className="btn pri"
                    disabled={dirty || !!edit || !valid}
                    title={
                      dirty || edit ? "Save the draft first; a version is a copy of it" : undefined
                    }
                    onClick={saveVersion}
                  >
                    Save version
                  </button>
                </>
              )}
            </div>
          </div>
          {snapshot ? (
            <p className="banner">
              <span>
                Viewing {savedLabel(snapshot, timeZone).replace("Version", "version")}, read-only.
                {dirty || edit ? " Your unsaved draft is kept." : ""}
              </span>
            </p>
          ) : (
            <p className="note" id="save-state">
              <span className={dirty || edit ? "warn" : ""}>{savedState}.</span>{" "}
              {dirty || edit
                ? "Ctrl+S saves the draft."
                : versions.length
                  ? `${versions.length === 1 ? "One saved version" : `${versions.length} saved versions`}.`
                  : "No saved versions yet."}
            </p>
          )}
          <div className="tot">
            {(
              [
                ["Monthly funding", stats.funding],
                ["Net income", groupTotal("income")],
                ["From savings", groupTotal("funding")],
                ["Allocated", stats.allocated],
                [overallocated ? "Overallocated" : "Unassigned", stats.unassigned],
              ] as const
            ).map(([name, value]) => (
              <div key={name} className={name === "Overallocated" ? "bad" : ""}>
                <small>{name}</small>
                <b>{money(value)}</b>
              </div>
            ))}
          </div>
          {band ? (
            <div className={overallocated ? "plan-band over" : "plan-band"}>
              <Band
                parts={band}
                label={`Allocation of ${money(stats.funding)} monthly funding`}
                limit={
                  overallocated && stats.allocated && stats.funding !== null
                    ? stats.funding / stats.allocated
                    : undefined
                }
              />
            </div>
          ) : null}
          {overallocated && (
            <p className="err">Allocations exceed funding by {money(-(stats.unassigned ?? 0))}.</p>
          )}
        </div>
        {(notice || error) && (
          <div
            id="feedback"
            className={error ? "banner bad" : "banner"}
            role={error ? "alert" : "status"}
          >
            <span>{error || notice}</span>
            <button
              type="button"
              className="icon-btn"
              aria-label="Dismiss message"
              onClick={() => {
                if (!error) setNotice("");
              }}
            >
              <Icon name="x" />
            </button>
          </div>
        )}
        <div className={sidebar ? "plan-layout with-sidebar" : "plan-layout"}>
          <section className="card plan-grid-card" aria-label="Plan worksheet">
            {/* biome-ignore lint/a11y/useSemanticElements: This is an interactive spreadsheet grid with roving cell focus. */}
            <table
              role="grid"
              className="plan-grid"
              aria-readonly={readOnly}
              aria-label="Monthly Plan worksheet"
            >
              <colgroup>
                <col className="name-col" />
                <col className="amount-col" />
                <col className="freq-col" />
                <col className="month-col" />
                <col className="action-col" />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">Item</th>
                  <th scope="col" className="num">
                    Entered amount
                  </th>
                  <th scope="col">Frequency</th>
                  <th scope="col" className="num">
                    Monthly amount
                  </th>
                  <th scope="col">
                    <span className="sr-only">Row actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {display.flatMap((row) => {
                  const sub = row.heading === "subcategory" ? row.subcategory : null;
                  const rest = row.heading === "unestimated";
                  // The estimate follows an open edit, as line amounts do.
                  const estimate = sub ? cents(shownEstimates[sub.uuid] ?? "") : null;
                  const caption =
                    row.heading === true || (row.heading === false && row.group === "spending")
                      ? sections[row.group]
                      : undefined;
                  const total = groupTotal(row.group);
                  const ratio =
                    allocations.some((group) => group === row.group) && total !== null
                      ? share(total, stats.funding)
                      : null;
                  const cells = (
                    <tr
                      id={`row-${row.id}`}
                      key={row.id}
                      style={tint(kinds[row.group])}
                      data-group={row.group}
                      className={`${row.heading === true || (row.heading === false && row.group === "spending") ? "group-row" : "line-row"} ${selection.id === row.id ? "selected-row" : ""}`}
                    >
                      {[0, 1, 2, 3, 4].map((col) => {
                        const active = selection.id === row.id && selection.col === col;
                        const editing = edit?.id === row.id && edit.col === col;
                        return (
                          <td
                            id={`cell-${row.id}-${col}`}
                            key={col}
                            aria-label={`${sub ? sub.name : rest ? "Unestimated" : row.heading ? titles[row.group] : row.line?.name}, ${["Item", sub ? "Estimate" : "Entered amount", "Frequency", sub ? "Estimate" : "Monthly amount", "Actions"][col]}`}
                            aria-selected={active}
                            tabIndex={active ? 0 : -1}
                            className={`c${col} ${col === 1 || col === 3 ? "num" : ""} ${active ? "selected-cell" : ""} ${editing ? "editing" : ""} ${amountCol(col) && (row.heading === false || row.heading === "subcategory") && !readOnly ? "amount-edit" : ""}`}
                            onKeyDown={(e) => onGridKey(e, row, col)}
                            onClick={(e) => {
                              if ((e.target as HTMLElement).closest("button,input,select")) return;
                              if (!commit()) return;
                              // A click on an amount opens it; other cells select, then edit on a
                              // double click or Enter.
                              if (
                                amountCol(col) &&
                                (row.heading === false || row.heading === "subcategory") &&
                                !readOnly
                              )
                                begin(row, col);
                              else focusCell(row.id, col);
                            }}
                            onDoubleClick={() => begin(row, col)}
                          >
                            {editing ? (
                              editor(row)
                            ) : rest ? (
                              col === 0 ? (
                                <span
                                  className="line-name"
                                  title={
                                    unestimated !== null && unestimated < 0
                                      ? "Estimates exceed guilt-free spending"
                                      : "Guilt-free spending without an estimate"
                                  }
                                >
                                  <span className="nm muted">
                                    {unestimated !== null && unestimated < 0
                                      ? "Estimates over"
                                      : "Unestimated"}
                                  </span>
                                </span>
                              ) : col === 3 ? (
                                <span className="muted">
                                  {money(unestimated === null ? null : Math.abs(unestimated))}
                                </span>
                              ) : null
                            ) : sub ? (
                              col === 0 ? (
                                <span className="line-name">
                                  <span className="nm">{sub.name}</span>
                                </span>
                              ) : col === 4 ? (
                                !readOnly && (
                                  <button
                                    type="button"
                                    tabIndex={-1}
                                    aria-label={`Rename or archive ${sub.name}`}
                                    title="Rename or archive"
                                    className="icon-btn"
                                    onClick={() => {
                                      setSelection({ id: row.id, col: 4 });
                                      add(row.group);
                                    }}
                                  >
                                    <Icon name="more" />
                                  </button>
                                )
                              ) : col === 1 || col === 3 ? (
                                estimate === null ? (
                                  <span className="muted" title="Estimate (optional)">
                                    —
                                  </span>
                                ) : (
                                  <span className="ink2" title="Estimate">
                                    {money(estimate)}
                                  </span>
                                )
                              ) : null
                            ) : row.heading ? (
                              col === 0 ? (
                                <button
                                  type="button"
                                  tabIndex={-1}
                                  className="group-toggle"
                                  aria-expanded={!collapsed.includes(row.group)}
                                  onClick={() => {
                                    if (!commit()) return;
                                    focusCell(row.id, 0);
                                    toggle(row.group);
                                  }}
                                >
                                  <span className="dot" />
                                  {titles[row.group]}
                                  <small className="muted">
                                    {lines.filter((l) => l.group === row.group).length}
                                  </small>
                                  {collapsed.includes(row.group) && <Icon name="right" />}
                                  {ratio !== null && (
                                    <span className="share">{ratio.toFixed(2)}% of funding</span>
                                  )}
                                </button>
                              ) : col === 3 ? (
                                <b>{money(total)}</b>
                              ) : col === 4 && !readOnly ? (
                                <button
                                  type="button"
                                  tabIndex={-1}
                                  aria-label={`Add ${titles[row.group]} line`}
                                  title={`Add ${titles[row.group]} line`}
                                  className="icon-btn"
                                  onClick={() => add(row.group)}
                                >
                                  <Icon name="plus" />
                                </button>
                              ) : null
                            ) : col === 0 ? (
                              row.group === "spending" ? (
                                <span className="group-name">
                                  <span className="dot" />
                                  {row.line.name}
                                  {subcategories.length > 0 && (
                                    <small className="muted">{subcategories.length}</small>
                                  )}
                                  {ratio !== null && (
                                    <span className="share">{ratio.toFixed(2)}% of funding</span>
                                  )}
                                </span>
                              ) : (
                                <span className="line-name">
                                  <span className="nm">{row.line?.name}</span>
                                  {row.line?.link && (
                                    <span className="chip">
                                      Pays {loanName(row.line.link) ?? "a loan"}
                                    </span>
                                  )}
                                  {needsRevision(row.line) && (
                                    <span className="chip warn">Review reference</span>
                                  )}
                                </span>
                              )
                            ) : col === 1 ? (
                              cents(row.line.amount) === null ? (
                                <span className="err">{row.line.amount || "Enter amount"}</span>
                              ) : (
                                money(cents(row.line.amount))
                              )
                            ) : col === 2 ? (
                              row.group === "fixed" ? (
                                <span className="frequency">
                                  {row.line?.frequency}
                                  {!readOnly && <Icon name="down" />}
                                </span>
                              ) : (
                                <span className="muted">—</span>
                              )
                            ) : col === 3 ? (
                              row.group === "spending" ? (
                                <b>{money(previewMonthly(row.line))}</b>
                              ) : (
                                <span className="ink2">{money(previewMonthly(row.line))}</span>
                              )
                            ) : (
                              <span className="row-actions">
                                {row.group === "spending" && !readOnly && (
                                  <button
                                    type="button"
                                    tabIndex={-1}
                                    aria-label="Add Guilt-free spending subcategory"
                                    title="Add Guilt-free spending subcategory"
                                    className="icon-btn"
                                    onClick={() => {
                                      setSelection({ id: row.id, col: 4 });
                                      add(row.group);
                                    }}
                                  >
                                    <Icon name="plus" />
                                  </button>
                                )}
                                <button
                                  type="button"
                                  tabIndex={-1}
                                  aria-label={`Details for ${row.line?.name}`}
                                  title="Details"
                                  className="icon-btn"
                                  onClick={() => {
                                    setSelection({ id: row.id, col: 4 });
                                    openDetails(row.id);
                                  }}
                                >
                                  <Icon name="more" />
                                </button>
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                  return caption
                    ? [
                        <tr key={`section-${row.group}`} className="section-row">
                          <td colSpan={5}>
                            <span className="h2">
                              {caption[0]} {caption[1] && !readOnly && <span>{caption[1]}</span>}
                            </span>
                          </td>
                        </tr>,
                        cells,
                      ]
                    : [cells];
                })}
              </tbody>
            </table>
            <div className="plan-foot">
              <span>
                Tithe target{" "}
                <b>
                  {money(
                    stored
                      ? storedCents(stored.tithe_target)
                      : amounts.income === null
                        ? null
                        : even(amounts.income, 10),
                  )}
                </b>{" "}
                <span className="muted">10% of net income</span>
              </span>
              <button type="button" className="btn sm quiet" onClick={() => setModal("help")}>
                Keyboard shortcuts <span className="kbd">?</span>
              </button>
            </div>
          </section>
          {selectedLine && (
            <aside
              className="card pad plan-details"
              aria-label="Row details"
              style={tint(kinds[selectedLine.group])}
              onKeyDown={(e) => {
                if (e.key === "Escape" && !(e.target instanceof HTMLSelectElement)) {
                  e.stopPropagation();
                  closeDetails();
                }
              }}
            >
              <div className="detail-heading">
                <span className="cap">
                  <span className="dot" /> {titles[selectedLine.group]}
                </span>
                <button
                  type="button"
                  id="close-details"
                  className="icon-btn"
                  aria-label="Close row details"
                  onClick={closeDetails}
                >
                  <Icon name="x" />
                </button>
              </div>
              <h2 className="h2">{selectedLine.name}</h2>
              {needsRevision(selectedLine) && (
                <p className="banner">Inactive or unavailable reference. Review this line.</p>
              )}
              <fieldset disabled={readOnly || busy} className="detail-fields">
                <div className="field">
                  <label htmlFor="detail-name">
                    {catalog[selectedLine.group] ? "Destination" : "Name"}
                  </label>
                  {catalog[selectedLine.group] ? (
                    <Combobox
                      id="detail-name"
                      placeholder="Choose or type a new name"
                      options={[
                        ...(selectedLine.reference
                          ? [{ id: selectedLine.reference, name: selectedLine.name }]
                          : []),
                        ...(catalog[selectedLine.group] ?? [])
                          .filter(
                            (n) =>
                              n.active &&
                              !lines.some(
                                (l) => l.group === selectedLine.group && l.reference === n.id,
                              ),
                          )
                          .map((n) => ({ id: n.id, name: n.name })),
                      ]}
                      value={selectedLine.reference ?? ""}
                      onChange={(id) =>
                        change(selectedLine.id, {
                          reference: id,
                          name: catalog[selectedLine.group]?.find((choice) => choice.id === id)
                            ?.name,
                        })
                      }
                      create={
                        onCreate && creatable(selectedLine.group)
                          ? {
                              noun: NOUNS[creatable(selectedLine.group) as CreatableKind],
                              // Goal names repeat across accounts; the catalog reads "Account · Goal".
                              taken:
                                selectedLine.group === "saving"
                                  ? []
                                  : (catalog[selectedLine.group] ?? []).map((n) => n.name),
                              onCreate: (name) => {
                                const line = selectedLine.id;
                                if (selectedLine.group === "saving") return setNewGoal(name);
                                const kind = creatable(selectedLine.group) as
                                  | "investment"
                                  | "giving_recipient";
                                onCreate({ kind, name }, (id) =>
                                  change(line, { reference: id, name: cleanName(name) }),
                                );
                              },
                            }
                          : undefined
                      }
                    />
                  ) : (
                    <input
                      id="detail-name"
                      value={selectedLine.name}
                      readOnly={selectedLine.group === "spending"}
                      aria-invalid={!selectedLine.name.trim()}
                      onChange={(e) => change(selectedLine.id, { name: e.target.value })}
                    />
                  )}
                  {!selectedLine.name.trim() && (
                    <p className="err">
                      {catalog[selectedLine.group]
                        ? "Choose a destination, or type a new name to create one."
                        : "Enter a name."}
                    </p>
                  )}
                  {newGoal !== null && selectedLine.group === "saving" && onCreate && (
                    <NewGoal
                      name={newGoal}
                      accounts={accounts}
                      busy={busy}
                      onCancel={() => setNewGoal(null)}
                      onCreate={(request) => {
                        const line = selectedLine.id;
                        const account = request.kind === "saving_goal" ? request.account : null;
                        setNewGoal(null);
                        onCreate(request, (id) =>
                          change(line, {
                            reference: id,
                            name: `${account?.name} · ${cleanName(request.name)}`,
                          }),
                        );
                      }}
                    />
                  )}
                </div>
                <div className="field">
                  <label htmlFor="detail-amount">
                    {selectedLine.group === "fixed" ? "Entered amount" : "Monthly amount"}
                  </label>
                  <input
                    id="detail-amount"
                    inputMode="decimal"
                    aria-invalid={cents(selectedLine.amount) === null}
                    value={selectedLine.amount}
                    onChange={(e) => change(selectedLine.id, { amount: e.target.value })}
                  />
                  {cents(selectedLine.amount) === null && (
                    <p className="err" role="alert">
                      Enter a nonnegative USD amount, up to two decimals.
                    </p>
                  )}
                </div>
                {selectedLine.group === "fixed" && (
                  <>
                    <div className="field">
                      <label htmlFor="detail-frequency">Frequency</label>
                      <select
                        id="detail-frequency"
                        value={selectedLine.frequency}
                        onChange={(e) =>
                          change(selectedLine.id, {
                            frequency: e.target.value as Line["frequency"],
                          })
                        }
                      >
                        {Object.keys(FREQUENCIES).map((name) => (
                          <option key={name}>{name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor="detail-loan">Linked loan</label>
                      <select
                        id="detail-loan"
                        value={selectedLine.link || ""}
                        onChange={(e) =>
                          change(selectedLine.id, { link: e.target.value || undefined })
                        }
                      >
                        <option value="">None</option>
                        {selectedLine.link &&
                          (readOnly || !loans.some((loan) => loan.id === selectedLine.link)) && (
                            <option value={selectedLine.link}>
                              {snapshot?.fixed_costs.find(
                                (line) => line.fixed_cost_id === selectedLine.reference,
                              )?.debt_account_name ?? "Unavailable loan"}
                            </option>
                          )}
                        {loans
                          .filter(
                            (loan) => !readOnly && (loan.active || loan.id === selectedLine.link),
                          )
                          .map((loan) => (
                            <option key={loan.id} value={loan.id}>
                              {loan.name}
                              {loan.active ? "" : " (inactive)"}
                            </option>
                          ))}
                      </select>
                    </div>
                    <div className="detail-result">
                      <span className="muted">Monthly amount</span>
                      <b>{money(monthly(selectedLine))}</b>
                    </div>
                  </>
                )}
              </fieldset>
              <div className="actions">
                {!readOnly && selectedLine.group !== "spending" && (
                  <button
                    type="button"
                    className="btn sm danger"
                    id="remove-line"
                    onClick={() => remove()}
                  >
                    <Icon name="trash" />
                    Remove line
                  </button>
                )}
                <span className="note">
                  {readOnly ? "Read-only snapshot" : "Editing draft"}.{" "}
                  <span className="kbd">Esc</span> closes.
                </span>
              </div>
            </aside>
          )}
        </div>
      </fieldset>
      <PlanBreakdown
        funding={stats.funding}
        allocated={stats.allocated}
        state={snapshot ? "Saved version" : dirty || edit ? "Unsaved preview" : "Saved draft"}
        rows={[
          ...allocations.map((group) => ({
            name: titles[group],
            amount: groupTotal(group),
            kind: kinds[group],
          })),
          { name: "Unassigned", amount: stats.unassigned },
        ]}
        metrics={stored?.planned_metrics}
      />
      {modal === "help" && (
        <Dialog title="Keyboard shortcuts" onClose={() => setModal(null)}>
          <div className="dlg-b">
            <dl className="shortcut-list">
              {[
                ["h j k l / arrows", "Move between cells"],
                ["0 / $ · Home / End", "First / last cell in row"],
                ["gg / G", "First / last visible row"],
                ["i / Enter", "Edit a draft value or activate a control"],
                [
                  "a / A",
                  "Add a line in the current category, or a guilt-free spending subcategory",
                ],
                ["Click or Enter on a subcategory", "Set its estimate (optional; blank clears)"],
                ["dd", "Remove selected line, with confirmation"],
                ["Enter", "Keep a valid cell edit; return to normal"],
                ["Escape", "Discard a cell edit; return to normal"],
                ["↑ / ↓ in a selector", "Choose an option while editing"],
                ["Tab / Shift+Tab", "Leave the table or move through form fields"],
                ["Ctrl / ⌘ + S", "Save draft"],
                ["?", "Open this reference"],
              ].map(([key, label]) => (
                <div key={key}>
                  <dt>
                    <span className="kbd">{key}</span>
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
