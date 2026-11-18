import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PlanRevision } from "../../lib/monthly";
import { PlanBreakdown } from "./PlanBreakdown";
import { composing } from "./shared";
import {
  type Group,
  type Line,
  type Catalog,
  type Choice,
  type WorksheetDraft,
  cents,
  even,
  monthlyAmount as monthly,
  money,
  sum,
  totals,
  storedTotals,
  storedCents,
  revisionLines,
  versionLabel,
} from "./planWorksheetModel";

type DisplayRow = { id: string; group: Group } & (
  | { heading: true }
  | { heading: false; line: Line }
);
const groups: Group[] = ["income", "funding", "fixed", "spending", "saving", "investing", "giving"];
const titles: Record<Group, string> = {
  income: "Net income",
  funding: "Planned use of savings",
  fixed: "Fixed costs",
  spending: "Guilt-free spending",
  saving: "Saving",
  investing: "Investing",
  giving: "Giving",
};

export function PlanWorksheet({
  revision,
  retained,
  versions,
  catalog,
  unavailable = [],
  loans,
  busy,
  timeZone,
  onChange,
  onSave,
  onVersion,
  onBack,
}: {
  revision: PlanRevision;
  retained?: WorksheetDraft;
  versions: PlanRevision[];
  catalog: Catalog;
  /** Reference data still loading or failed: unknown, not empty or inactive. */
  unavailable?: ReadonlyArray<Group | "loans">;
  loans: Choice[];
  busy: boolean;
  timeZone: string;
  onChange: (draft: WorksheetDraft) => void;
  onSave: (name: string, lines: Line[]) => void;
  onVersion: () => void;
  onBack: () => void;
}) {
  const initialLines = useMemo(() => revisionLines(revision), [revision]);
  const [draftLines, setLines] = useState<Line[]>(retained?.lines ?? initialLines);
  const [draftName, setDraftName] = useState(retained?.name ?? revision.name);
  const [editingName, setEditingName] = useState(retained?.name.trim() === "");
  const saved = JSON.stringify({ name: revision.name, lines: initialLines });
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
  const [versionIndex, setVersionIndex] = useState<number | null>(null);
  const [focusArea, setFocusArea] = useState("page");
  const dialog = useRef<HTMLDialogElement>(null);
  const priorFocus = useRef<HTMLElement | null>(null);
  const gTime = useRef(0);
  const pendingDelete = useRef<{ id: string; time: number } | null>(null);
  const readOnly = versionIndex !== null;
  const snapshot = readOnly ? versions[versionIndex] : null;
  const lines = useMemo(
    () => (snapshot ? revisionLines(snapshot) : draftLines),
    [snapshot, draftLines],
  );
  const planName = snapshot ? snapshot.name : draftName;
  const validName = draftName.trim().length > 0 && draftName.trim().length <= 120;
  const dirty = JSON.stringify({ name: draftName, lines: draftLines }) !== saved;
  const stats = snapshot
    ? storedTotals(snapshot)
    : edit
      ? { funding: null, allocated: null, unassigned: null }
      : dirty
        ? totals(lines)
        : storedTotals(revision);
  const selectedLine = lines.find((l) => l.id === sidebar);
  const valid = validName && lines.every((l) => cents(l.amount) !== null && l.name.trim());
  const income = sum(lines.filter((line) => line.group === "income"));
  const stored = snapshot ?? (!dirty && !edit ? revision : null);
  const groupTotal = (group: Group) =>
    stored
      ? storedCents(
          {
            income: stored.income,
            funding: stored.savings_funding_total,
            fixed: stored.fixed_cost_total,
            spending: stored.spending,
            saving: stored.saving_total,
            investing: stored.investing_total,
            giving: stored.giving_total,
          }[group],
        )
      : sum(lines.filter((line) => line.group === group));
  const needsRevision = (line: Line) =>
    !readOnly &&
    ((catalog[line.group] &&
      !unavailable.includes(line.group) &&
      !catalog[line.group]?.some((choice) => choice.id === line.reference && choice.active)) ||
      (line.link &&
        !unavailable.includes("loans") &&
        !loans.some((loan) => loan.id === line.link && loan.active)));
  const display = useMemo(
    () =>
      groups.flatMap<DisplayRow>((group) =>
        group === "spending"
          ? lines
              .filter((line) => line.group === "spending")
              .map((line) => ({ id: line.id, group, heading: false as const, line }))
          : [
              { id: `group-${group}`, group, heading: true },
              ...(collapsed.includes(group)
                ? []
                : lines
                    .filter((l) => l.group === group)
                    .map((line) => ({ id: line.id, group, heading: false, line }))),
            ],
      ),
    [lines, collapsed],
  );
  const notify = useRef(onChange);
  notify.current = onChange;
  useEffect(() => {
    notify.current({ name: draftName, lines: draftLines, editing: !!edit, cellEdit: edit });
  }, [draftName, draftLines, edit]);
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
    if (modal) {
      priorFocus.current = document.activeElement as HTMLElement;
      dialog.current?.showModal();
    } else if (dialog.current?.open) {
      dialog.current.close();
      priorFocus.current?.focus();
    }
  }, [modal]);
  useEffect(() => {
    if (editingName) document.getElementById("plan-name")?.focus();
  }, [editingName]);
  const toggle = (group: Group) =>
    setCollapsed((cs) => (cs.includes(group) ? cs.filter((g) => g !== group) : [...cs, group]));
  function begin(row: DisplayRow, col: number) {
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
    if (
      col === 3 ||
      (col === 2 && row.group !== "fixed") ||
      (col === 0 && row.group === "spending")
    )
      return;
    setError("");
    setEdit({
      id: row.id,
      col,
      value:
        col === 0
          ? catalog[row.group]
            ? (row.line.reference ?? "")
            : row.line.name
          : col === 1
            ? row.line.amount
            : row.line.frequency,
    });
  }
  function commit(): boolean {
    if (!edit) return true;
    if (edit.col === 1 && cents(edit.value) === null) {
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
        : edit.col === 1
          ? { amount: edit.value.trim() }
          : { frequency: edit.value as Line["frequency"] },
    );
    setEdit(null);
    setError("");
    return true;
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
      setNotice("Spending is one monthly amount. Press i on its amount to edit it.");
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
    if (options?.length === 0) {
      setNotice(
        "No available destinations. Add or reopen a destination in the workspace, or edit an existing line.",
      );
      return;
    }
    const id = `new-${crypto.randomUUID()}`;
    const line: Line = {
      id,
      group,
      name: options?.[0]?.name || (group === "income" ? "New income source" : "New fixed cost"),
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
    onSave(draftName.trim(), lines);
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
        if (commit()) focusCell(row.id, col);
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
    if (!edit || row.heading) return null;
    const currentEdit = edit;
    const options =
      edit?.col === 2
        ? ["Monthly", "Annual"].map((name) => ({ id: name, name, active: true }))
        : catalog[row.group];
    const props = {
      autoFocus: true,
      value: edit?.value,
      "aria-label": `${edit?.col === 0 ? "Name" : edit?.col === 1 ? "Amount" : "Frequency"} for ${row.line?.name}`,
      "aria-invalid": !!error,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        setEdit({ ...currentEdit, value: e.target.value });
        setError("");
      },
      onBlur: () => {
        commit();
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
        inputMode={edit?.col === 1 ? "decimal" : "text"}
        onFocus={(e) => e.target.select()}
      />
    );
  }
  return (
    <div
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
          e.preventDefault();
          saveDraft();
        }
      }}
    >
      <button type="button" className="text-button" onClick={onBack}>
        ‹ All Plans
      </button>
      <fieldset disabled={busy}>
        <div id="plan-toolbar" className="flex items-center flex-wrap gap-3">
          <div id="plan-name-control">
            {editingName && !readOnly ? (
              <>
                <label className="sr-only" htmlFor="plan-name">
                  Plan name
                </label>
                <input
                  id="plan-name"
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
                  <p id="plan-name-error" className="field-error" role="alert">
                    Enter a Plan name (1–120 characters).
                  </p>
                )}
              </>
            ) : (
              <h1>
                {readOnly ? (
                  planName
                ) : (
                  <button
                    type="button"
                    id="rename-plan"
                    aria-label={`Rename Plan: ${planName}`}
                    title="Rename Plan"
                    onClick={() => {
                      if (commit()) setEditingName(true);
                    }}
                  >
                    {planName}
                    <span aria-hidden="true">✎</span>
                  </button>
                )}
              </h1>
            )}
          </div>
          <span className="badge">{readOnly ? "Read only" : "Draft"}</span>
          <span id="save-state">
            {readOnly
              ? dirty || edit
                ? "Unsaved draft retained"
                : "Saved snapshot"
              : dirty || edit
                ? "Unsaved changes"
                : "Draft saved"}
          </span>
          <div className="toolbar-actions">
            <select
              id="plan-version"
              aria-label="Viewing Plan version"
              value={versionIndex ?? "draft"}
              onChange={(e) => switchVersion(e.target.value)}
            >
              <option value="draft">Current draft</option>
              {versions.map((v, i) => (
                <option value={i} key={v.uuid}>
                  {versionLabel(v, versions, timeZone)}
                </option>
              ))}
            </select>
            {readOnly ? (
              <button type="button" id="return-draft" onClick={() => switchVersion("draft")}>
                Return to draft
              </button>
            ) : (
              <>
                <button
                  type="button"
                  id="save-draft"
                  title="Save editable work without creating an immutable version"
                  onClick={saveDraft}
                >
                  Save draft
                </button>
                <button
                  type="button"
                  id="save-version"
                  className="primary"
                  disabled={dirty || !!edit || !valid}
                  onClick={saveVersion}
                >
                  Save version
                </button>
              </>
            )}
          </div>
        </div>
        <div id="plan-totals">
          <div>
            Monthly funding <strong>{money(stats.funding)}</strong>
          </div>
          <div>
            Allocated <strong>{money(stats.allocated)}</strong>
          </div>
          <div className={stats.unassigned !== null && stats.unassigned < 0 ? "negative" : ""}>
            {stats.unassigned !== null && stats.unassigned < 0 ? "Overallocated" : "Unassigned"}{" "}
            <strong>{money(stats.unassigned)}</strong>
          </div>
          <button type="button" className="text-button shortcuts" onClick={() => setModal("help")}>
            Keyboard shortcuts <kbd>?</kbd>
          </button>
        </div>
        {(notice || error) && (
          <div id="feedback" role={error ? "alert" : "status"}>
            {error || notice}
            <button
              type="button"
              aria-label="Dismiss message"
              onClick={() => {
                if (!error) setNotice("");
              }}
            >
              ×
            </button>
          </div>
        )}
        <div id="editor-layout" className={sidebar ? "with-sidebar" : ""}>
          <section id="worksheet" aria-label="Plan worksheet">
            <div className="table-scroll">
              {/* biome-ignore lint/a11y/useSemanticElements: This is an interactive spreadsheet grid with roving cell focus. */}
              <table
                role="grid"
                aria-readonly={readOnly}
                aria-label="Monthly Plan worksheet"
                aria-describedby="keyboard-status"
                onFocus={() => setFocusArea("table")}
                onBlur={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget)) setFocusArea("page");
                }}
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
                    <th scope="col">Item / destination</th>
                    <th scope="col" className="numeric">
                      Entered amount
                    </th>
                    <th scope="col">Frequency</th>
                    <th scope="col" className="numeric">
                      Monthly amount
                    </th>
                    <th scope="col">
                      <span className="sr-only">Row actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {display.map((row) => (
                    <tr
                      id={`row-${row.id}`}
                      key={row.id}
                      className={`${row.heading ? "group-row" : ""} ${selection.id === row.id ? "selected-row" : ""} ${row.group === "spending" ? "spending-row" : ""}`}
                    >
                      {[0, 1, 2, 3, 4].map((col) => {
                        const active = selection.id === row.id && selection.col === col;
                        const editing = edit?.id === row.id && edit.col === col;
                        return (
                          <td
                            id={`cell-${row.id}-${col}`}
                            key={col}
                            aria-label={`${row.heading ? titles[row.group] : row.line?.name}, ${["Item", "Entered amount", "Frequency", "Monthly amount", "Actions"][col]}`}
                            aria-selected={active}
                            tabIndex={active ? 0 : -1}
                            className={`${col === 1 || col === 3 ? "numeric" : ""} ${col === 4 ? "action-cell" : ""} ${active ? "selected-cell" : ""}`}
                            onKeyDown={(e) => onGridKey(e, row, col)}
                            onClick={(e) => {
                              if ((e.target as HTMLElement).closest("button,input,select")) return;
                              if (!commit()) return;
                              focusCell(row.id, col);
                            }}
                            onDoubleClick={() => begin(row, col)}
                          >
                            {editing ? (
                              editor(row)
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
                                  <span>{collapsed.includes(row.group) ? "›" : "⌄"}</span>
                                  {titles[row.group]}
                                  <small>{lines.filter((l) => l.group === row.group).length}</small>
                                </button>
                              ) : col === 3 ? (
                                money(groupTotal(row.group))
                              ) : col === 4 && !readOnly ? (
                                <button
                                  type="button"
                                  tabIndex={-1}
                                  aria-label={`Add ${titles[row.group]} line`}
                                  className="icon-button add"
                                  onClick={() => add(row.group)}
                                >
                                  +
                                </button>
                              ) : null
                            ) : col === 0 ? (
                              <span className="line-name">
                                {row.line?.name}
                                {row.line?.link && <span className="link-label">Loan</span>}
                                {needsRevision(row.line) && (
                                  <span className="link-label">Review reference</span>
                                )}
                              </span>
                            ) : col === 1 ? (
                              cents(row.line.amount) === null ? (
                                <span className="field-error">
                                  {row.line.amount || "Enter amount"}
                                </span>
                              ) : (
                                money(cents(row.line.amount))
                              )
                            ) : col === 2 ? (
                              row.group === "fixed" ? (
                                <span className="frequency">
                                  {row.line?.frequency}
                                  {!readOnly && <span>⌄</span>}
                                </span>
                              ) : (
                                <span className="dash">—</span>
                              )
                            ) : col === 3 ? (
                              money(monthly(row.line))
                            ) : (
                              <button
                                type="button"
                                tabIndex={-1}
                                aria-label={`Details for ${row.line?.name}`}
                                className="icon-button details"
                                onClick={() => {
                                  setSelection({ id: row.id, col: 4 });
                                  openDetails(row.id);
                                }}
                              >
                                ↗
                              </button>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div id="worksheet-footnote">
              <span>Monthly Plan · USD</span>
              <span>
                Tithe target{" "}
                <b>
                  {money(
                    stored
                      ? storedCents(stored.tithe_target)
                      : income === null
                        ? null
                        : even(income, 10),
                  )}
                </b>
                <span className="muted"> · 10% of net income</span>
              </span>
            </div>
          </section>
          {selectedLine && (
            <aside
              id="row-details"
              aria-label="Row details"
              onFocus={() => setFocusArea("details")}
              onKeyDown={(e) => {
                if (e.key === "Escape" && !(e.target instanceof HTMLSelectElement)) {
                  e.stopPropagation();
                  closeDetails();
                }
              }}
            >
              <div className="detail-heading">
                <span>{titles[selectedLine.group]}</span>
                <button
                  type="button"
                  id="close-details"
                  className="icon-button"
                  aria-label="Close row details"
                  onClick={closeDetails}
                >
                  ×
                </button>
              </div>
              <h2>{selectedLine.name}</h2>
              {needsRevision(selectedLine) && (
                <p className="field-error">
                  This reference is inactive or unavailable. Review this draft allocation
                  explicitly.
                </p>
              )}
              <fieldset disabled={readOnly || busy}>
                <label htmlFor="detail-name">
                  {catalog[selectedLine.group] ? "Destination" : "Name"}
                </label>
                {catalog[selectedLine.group] ? (
                  <select
                    id="detail-name"
                    value={selectedLine.reference ?? ""}
                    onChange={(e) =>
                      change(selectedLine.id, {
                        reference: e.target.value,
                        name: catalog[selectedLine.group]?.find(
                          (choice) => choice.id === e.target.value,
                        )?.name,
                      })
                    }
                  >
                    <option value={selectedLine.reference}>{selectedLine.name}</option>
                    {catalog[selectedLine.group]
                      ?.filter(
                        (n) =>
                          n.active &&
                          !lines.some(
                            (l) => l.group === selectedLine.group && l.reference === n.id,
                          ),
                      )
                      .map((n) => (
                        <option key={n.id} value={n.id}>
                          {n.name}
                        </option>
                      ))}
                  </select>
                ) : (
                  <input
                    id="detail-name"
                    value={selectedLine.name}
                    readOnly={selectedLine.group === "spending"}
                    aria-invalid={!selectedLine.name.trim()}
                    onChange={(e) => change(selectedLine.id, { name: e.target.value })}
                  />
                )}
                {!selectedLine.name.trim() && <p className="field-error">Enter a name.</p>}
                <label htmlFor="detail-amount">
                  {selectedLine.group === "fixed" ? "Entered amount" : "Monthly amount"}
                </label>
                <div className="currency-field">
                  <span>$</span>
                  <input
                    id="detail-amount"
                    inputMode="decimal"
                    aria-invalid={cents(selectedLine.amount) === null}
                    value={selectedLine.amount}
                    onChange={(e) => change(selectedLine.id, { amount: e.target.value })}
                  />
                </div>
                {cents(selectedLine.amount) === null && (
                  <p className="field-error" role="alert">
                    Enter a nonnegative USD amount, up to two decimals.
                  </p>
                )}
                {selectedLine.group === "fixed" && (
                  <>
                    <label htmlFor="detail-frequency">Frequency</label>
                    <select
                      id="detail-frequency"
                      value={selectedLine.frequency}
                      onChange={(e) =>
                        change(selectedLine.id, { frequency: e.target.value as Line["frequency"] })
                      }
                    >
                      <option>Monthly</option>
                      <option>Annual</option>
                    </select>
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
                    <div className="detail-result">
                      <span>Monthly amount</span>
                      <strong>{money(monthly(selectedLine))}</strong>
                    </div>
                  </>
                )}
              </fieldset>
              {!readOnly && selectedLine.group !== "spending" && (
                <button type="button" className="danger" id="remove-line" onClick={() => remove()}>
                  Remove line
                </button>
              )}
              <div className="detail-hint">
                {readOnly ? "Read-only snapshot" : "Editing draft"}{" "}
                <span>
                  <kbd>Esc</kbd> Close
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
          ...groups
            .filter((group) => group !== "income" && group !== "funding")
            .map((group) => ({
              name: titles[group],
              amount: edit && !snapshot ? null : groupTotal(group),
            })),
          { name: "Unassigned", amount: stats.unassigned },
        ]}
        metrics={stored?.planned_metrics}
      />
      <footer id="keyboard-status">
        <span className="mode">
          {readOnly
            ? "READ ONLY"
            : focusArea === "table"
              ? edit
                ? "INSERT"
                : "NORMAL"
              : focusArea === "details"
                ? "DETAILS"
                : "READY"}
        </span>
        <span className="key-hints">
          <kbd>h j k l</kbd> Move{" "}
          {!readOnly && (
            <>
              <kbd>i</kbd> Edit
            </>
          )}{" "}
          <kbd>Enter</kbd> Open <kbd>Esc</kbd> Normal
        </span>
      </footer>
      <dialog ref={dialog} id="plan-help-dialog" onCancel={() => setModal(null)}>
        <div className="dialog-heading">
          <h2>Keyboard shortcuts</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="Close dialog"
            onClick={() => setModal(null)}
          >
            ×
          </button>
        </div>
        <p>Vim-style navigation applies while the table has focus. Saved versions are read-only.</p>
        <dl className="shortcut-list">
          {[
            ["h j k l / arrows", "Move between cells"],
            ["0 / $ · Home / End", "First / last cell in row"],
            ["gg / G", "First / last visible row"],
            ["i / Enter", "Edit a draft value or activate a control"],
            ["a / A", "Add a line in the current category"],
            ["dd", "Remove selected line, with confirmation"],
            ["Escape / Enter", "Keep a valid cell edit; return to normal"],
            ["↑ / ↓ in a selector", "Choose an option in insert mode"],
            ["Tab / Shift+Tab", "Leave the table or move through form fields"],
            ["Ctrl / ⌘ + S", "Save draft"],
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
        <p>Invalid input stays visible. Save version is always an explicit action.</p>
      </dialog>
    </div>
  );
}
