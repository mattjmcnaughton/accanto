import type React from "react";
import { useEffect, useId, useRef, useState } from "react";
import { type Goal, type SavingsAccount, type SavingsMovement, savings } from "../../lib/savings";
import { LoadMessage, type ScreenProps, useLoad } from "../workspace/shared";
import { useGridKeys } from "../workspace/useGridKeys";
import "../workspace/worksheet-ui.css";
import "./savings.css";
import {
  type Draft,
  type MovementEdit,
  type NewGoalEdit,
  accountDraft,
  cents,
  changed,
  dollars,
  draftKey,
  formatCents,
  goalDraft,
  hasMoney,
  movementDraft,
  openingRemainder,
  problem,
  writeFor,
} from "./savingsDraft";

type Grid = "goals" | "moves";
type Field =
  | "name"
  | "kind"
  | "target"
  | "date"
  | "amount"
  | "designation"
  | "action"
  | "from"
  | "to"
  | "note";
type Cell = { grid: Grid; id: string; col: number; field: Field; value: string; error: string };
type GoalRow = { id: string; account: SavingsAccount; goal: Goal | null; isNew?: boolean };
type MoveRow = { id: string; movement: SavingsMovement | null };
type Lifecycle = { action: "complete" | "return" | "archive" | "reopen"; date: string };

const GOAL_COLUMNS = [
  "Goal",
  "Type",
  "Target",
  "Opening",
  "Remaining saved",
  "Contributions",
  "Status",
];
const MOVE_COLUMNS = ["Date", "Action", "From / goal", "To", "Amount", "Note", "Actions"];
const ACTIONS: Record<SavingsMovement["kind"], string> = {
  reassignment: "Reassign",
  transfer: "Transfer",
  reconciliation: "Reconcile",
};
const KIND = { finite: "Finite", ongoing: "Ongoing" };
const SHORTCUTS = [
  ["h j k l / arrows", "Move between cells"],
  ["0 / $ · Home / End", "First / last cell in row"],
  ["gg / G", "First / last row"],
  ["i / Enter", "Edit a value, or open details"],
  ["Enter / Esc while editing", "Keep a valid edit unsaved; return to normal"],
  ["a / A", "Add a goal to this account, or a savings record"],
  ["dd", "Delete the selected savings record, with confirmation"],
  ["Esc", "Close details"],
  ["Tab / Shift+Tab", "Move between tables and fields"],
  ["Ctrl / ⌘ + S", "Save the unsaved record"],
  ["?", "Open this reference"],
];

const goalStatus = (account: SavingsAccount, goal: Goal) =>
  goal.completed
    ? "Completed"
    : !account.active
      ? "Archived"
      : !goal.active
        ? "Inactive"
        : (goal.funded_status ?? "");
const hiddenGoal = (goal: Goal) => goal.completed && !hasMoney(goal.remaining_saved);

export function Savings(p: ScreenProps) {
  const [reload, setReload] = useState(0);
  const accountsState = useLoad(() => savings.list(p.entity.id), [p.entity.id, p.refresh, reload]);
  const movesState = useLoad(
    () => savings.movements(p.entity.id),
    [p.entity.id, p.refresh, reload],
  );
  // Keep the last loaded rows during a reload so the focused cell and selection survive a save.
  const loaded = useRef<{ accounts: SavingsAccount[]; movements: SavingsMovement[] }>({
    accounts: [],
    movements: [],
  });
  if (accountsState.kind !== "loading")
    loaded.current.accounts = accountsState.kind === "ready" ? accountsState.data : [];
  if (movesState.kind !== "loading")
    loaded.current.movements = movesState.kind === "ready" ? movesState.data : [];
  const { accounts, movements } = loaded.current;
  const reloading = (state: { kind: string }, rows: unknown[]) =>
    state.kind === "loading" && rows.length > 0;
  const [pending, setPending] = useState<Draft | null>(null);
  const [cell, setCell] = useState<Cell | null>(null);
  const [selection, setSelection] = useState<Record<Grid, { id: string; col: number }>>({
    goals: { id: "", col: 0 },
    moves: { id: "", col: 0 },
  });
  const [sidebar, setSidebar] = useState<string | null>(null);
  const [lifecycle, setLifecycle] = useState<Lifecycle | null>(null);
  const [notice, setNotice] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [area, setArea] = useState<Grid | "details" | "page">("page");
  const [help, setHelp] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const uid = useId();
  const ids = {
    title: `${uid}-title`,
    records: `${uid}-records`,
    details: `${uid}-details`,
    status: `${uid}-status`,
    cellError: `${uid}-cell-error`,
    keys: `${uid}-keys`,
  };
  const goalKeys = useGridKeys();
  const moveKeys = useGridKeys();
  useEffect(() => {
    if (help) dialog.current?.showModal?.();
    else dialog.current?.close?.();
  }, [help]);

  const goalIndex = new Map(
    accounts.flatMap((account) => account.goals.map((goal) => [goal.uuid, { account, goal }])),
  );
  const goalAccount = (id: string) => goalIndex.get(id)?.account.uuid;
  const goalLabel = (id: string) => {
    const found = goalIndex.get(id);
    return found ? `${found.account.name} / ${found.goal.name}` : "—";
  };
  const pendingFor = (key: string) => (pending && draftKey(pending) === key ? pending : null);
  const hiddenCount =
    accounts.filter((a) => !a.active).length +
    accounts.filter((a) => a.active).flatMap((a) => a.goals.filter(hiddenGoal)).length;

  const goalRows: GoalRow[] = accounts
    .filter((account) => showArchived || account.active)
    .flatMap((account) => {
      const visible = account.goals.filter((g) => showArchived || !hiddenGoal(g));
      const newGoal = pendingFor(`new-goal:${account.uuid}`);
      return [
        { id: `a:${account.uuid}`, account, goal: null },
        ...visible
          .filter((g) => g.role === "ordinary")
          .map((goal) => ({ id: `g:${goal.uuid}`, account, goal })),
        ...(newGoal ? [{ id: "new-goal", account, goal: null, isNew: true }] : []),
        ...visible
          .filter((g) => g.role === "unallocated")
          .map((goal) => ({ id: `g:${goal.uuid}`, account, goal })),
      ];
    });
  const newMove = pendingFor("new-move");
  const moveRows: MoveRow[] = [
    ...(newMove ? [{ id: "new-move", movement: null }] : []),
    ...movements.map((movement) => ({ id: `m:${movement.uuid}`, movement })),
  ];

  // ---- One pending record ------------------------------------------------
  // A busy workspace may hold a failed or unconfirmed write of the attempted values: never replace them.
  function switchTo(key: string): boolean {
    if (p.busy) return false;
    if (!pending || draftKey(pending) === key) return true;
    if (!p.guard()) return false;
    setPending(null);
    setCell(null);
    p.dirty(false);
    return true;
  }
  function update(next: Draft) {
    if (changed(next)) {
      setPending(next);
      p.dirty(true);
    } else {
      setPending(null);
      p.dirty(false);
    }
    setNotice("");
  }
  function edit(key: string, base: () => Draft, patch: (draft: Draft) => Draft) {
    if (!switchTo(key)) return;
    update(patch(pendingFor(key) ?? base()));
  }
  function discard() {
    if (!pending || p.busy) return;
    if (changed(pending) && !window.confirm("Discard the unsaved Savings record?")) return;
    const wasNewAccount = pending.type === "new-account";
    setPending(null);
    setCell(null);
    setNotice("");
    p.dirty(false);
    if (wasNewAccount) setSidebar(null);
  }
  function save() {
    if (p.busy) return;
    if (cell) {
      setNotice("Finish the active cell edit before saving.");
      return;
    }
    if (!pending || !changed(pending)) {
      setNotice("Nothing to save.");
      return;
    }
    const issue = problem(pending, goalAccount);
    if (issue) {
      setNotice(issue);
      return;
    }
    const saving = pending;
    p.save(writeFor(p.entity.id, saving), (data) => {
      setPending(null);
      setNotice("");
      p.dirty(false);
      if (saving.type === "new-account") setSidebar(`a:${(data as SavingsAccount).uuid}`);
      setReload((n) => n + 1);
    });
  }

  // ---- Cells -------------------------------------------------------------
  function focusCell(grid: Grid, id: string, col: number) {
    setSelection((s) => ({ ...s, [grid]: { id, col } }));
    // Focus at once so fast key sequences reach the new cell; wait for render only for new rows.
    const target = () => document.getElementById(`${grid}-${id}-${col}`);
    const cellElement = target();
    if (cellElement) cellElement.focus();
    else requestAnimationFrame(() => target()?.focus());
  }
  function goalField(row: GoalRow, col: number): Field | null {
    if (!row.account.active) return null;
    if (!row.goal && !row.isNew) return (["name", "date", null, "amount"] as const)[col] ?? null;
    if (row.goal?.role === "unallocated") return null;
    if (col === 3) return row.isNew ? null : "designation";
    if (row.goal?.completed) return null;
    return (["name", "kind", "target"] as const)[col] ?? null;
  }
  function moveField(draft: Draft & { type: "movement" }, col: number): Field | null {
    if (col === 1) return draft.movement ? null : "action";
    if (col === 3 && draft.action === "reconciliation") return null;
    return (["date", null, "from", "to", "amount", "note"] as const)[col] ?? null;
  }
  function goalRecord(row: GoalRow, field: Field): Draft {
    if (!row.goal && !row.isNew)
      return pendingFor(`a:${row.account.uuid}`) ?? accountDraft(row.account);
    if (field === "designation")
      return pendingFor(`a:${row.account.uuid}`) ?? accountDraft(row.account);
    if (row.isNew) return pendingFor(`new-goal:${row.account.uuid}`) as Draft;
    return pendingFor(`g:${row.goal?.uuid}`) ?? goalDraft(row.account, row.goal as Goal);
  }
  function moveRecord(row: MoveRow): Draft & { type: "movement" } {
    return (pendingFor(row.movement ? `m:${row.movement.uuid}` : "new-move") ??
      movementDraft(row.movement as SavingsMovement)) as Draft & { type: "movement" };
  }
  function read(draft: Draft, field: Field, goalId?: string): string {
    if (field === "kind") return "goalKind" in draft ? draft.goalKind : "";
    if (field === "designation" && draft.type === "account")
      return draft.designations[goalId ?? ""] ?? "";
    if (field === "from" && draft.type === "movement" && draft.action === "reconciliation")
      return draft.goal;
    return String((draft as unknown as Record<string, unknown>)[field] ?? "");
  }
  function apply(draft: Draft, field: Field, value: string, goalId?: string): Draft {
    if (field === "kind") return { ...draft, goalKind: value } as Draft;
    if (field === "designation" && draft.type === "account")
      return { ...draft, designations: { ...draft.designations, [goalId ?? ""]: value } };
    if (field === "from" && draft.type === "movement" && draft.action === "reconciliation")
      return { ...draft, goal: value };
    return { ...draft, [field]: value } as Draft;
  }
  function begin(grid: Grid, id: string, col: number, field: Field, draft: Draft, goalId?: string) {
    if (!switchTo(draftKey(draft))) return;
    if (!pendingFor(draftKey(draft))) setPending(draft);
    setCell({ grid, id, col, field, value: read(draft, field, goalId), error: "" });
    setSelection((s) => ({ ...s, [grid]: { id, col } }));
    setNotice("");
  }
  function commitCell(): boolean {
    if (!cell || !pending) return true;
    const value = cell.field === "name" ? cell.value.trim() : cell.value;
    const error =
      cell.field === "name" && (!value || value.length > 120)
        ? "Enter a name up to 120 characters."
        : (cell.field === "amount" || cell.field === "designation") && cents(value) === null
          ? "Enter a USD amount with up to two decimal places."
          : cell.field === "target" && value !== "" && !hasMoney(value)
            ? "Enter a positive target, or leave it blank."
            : cell.field === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(value)
              ? "Enter a date."
              : cell.field === "note" && value.length > 2000
                ? "Keep the note within 2000 characters."
                : "";
    if (error) {
      setCell({ ...cell, error });
      return false;
    }
    const goalId = cell.id.startsWith("g:") ? cell.id.slice(2) : undefined;
    update(apply(pending, cell.field, value, goalId));
    setCell(null);
    return true;
  }
  function editGoalCell(row: GoalRow, col: number) {
    const field = goalField(row, col);
    if (!field) {
      if (row.goal?.role === "unallocated" && col !== 6) setNotice("Unallocated is protected.");
      if (!row.isNew) openDetails(row.id);
      return;
    }
    begin("goals", row.id, col, field, goalRecord(row, field), row.goal?.uuid);
  }
  function editMoveCell(row: MoveRow, col: number) {
    if (col === 6) {
      if (row.movement) remove(row.movement);
      return;
    }
    const draft = moveRecord(row);
    const field = moveField(draft, col);
    if (!field) {
      setNotice(col === 1 ? "A recorded action cannot change; delete and record again." : "");
      return;
    }
    begin("moves", row.id, col, field, draft);
  }
  function addGoal(row: GoalRow | undefined) {
    if (!row || p.busy) return;
    if (!row.account.active) {
      setNotice("Reopen the account to add goals.");
      return;
    }
    const key = `new-goal:${row.account.uuid}`;
    if (!switchTo(key)) return;
    const draft = (pendingFor(key) as NewGoalEdit | null) ?? {
      type: "new-goal" as const,
      account: row.account,
      name: "",
      goalKind: "finite",
      target: "",
    };
    setPending(draft);
    p.dirty(true);
    setCell({ grid: "goals", id: "new-goal", col: 0, field: "name", value: draft.name, error: "" });
    setSelection((s) => ({ ...s, goals: { id: "new-goal", col: 0 } }));
  }
  function addMove() {
    if (!switchTo("new-move")) return;
    const draft: MovementEdit = (pendingFor("new-move") as MovementEdit | null) ?? {
      type: "movement",
      movement: null,
      action: "reassignment",
      date: p.entity.today,
      from: "",
      to: "",
      goal: "",
      amount: "",
      note: "",
    };
    setPending(draft);
    p.dirty(true);
    setCell({
      grid: "moves",
      id: "new-move",
      col: 1,
      field: "action",
      value: draft.action,
      error: "",
    });
    setSelection((s) => ({ ...s, moves: { id: "new-move", col: 1 } }));
  }
  function remove(movement: SavingsMovement) {
    if (p.busy) return;
    if (pending && !p.guard()) return;
    const label = `${ACTIONS[movement.kind]} ${dollars(movement.amount)} on ${movement.date}`;
    if (!window.confirm(`Delete “${label}”? It leaves current totals; its history is kept.`))
      return;
    setPending(null);
    setCell(null);
    p.dirty(false);
    p.save(savings.deleteMovement(p.entity.id, movement), () => setReload((n) => n + 1));
  }
  function openDetails(id: string) {
    setSidebar(id);
    setLifecycle(null);
    requestAnimationFrame(() => document.getElementById(ids.details)?.focus());
  }
  function closeDetails() {
    if (pending?.type === "new-account") {
      setNotice("Save or discard the new account first.");
      return;
    }
    setSidebar(null);
    setLifecycle(null);
    const { id, col } = selection.goals;
    if (id) focusCell("goals", id, col);
  }
  function newAccount() {
    if (!switchTo("new-account")) return;
    setPending(
      pendingFor("new-account") ?? {
        type: "new-account",
        name: "",
        date: p.entity.today,
        amount: "0.00",
        goals: [],
      },
    );
    openDetails("new-account");
  }

  // ---- Rendering ---------------------------------------------------------
  function editor(field: Field, label: string) {
    if (!cell) return null;
    const current = cell;
    const goalChoices = (selected: string) =>
      [...goalIndex.values()]
        .filter(({ account, goal }) => (account.active && goal.active) || goal.uuid === selected)
        .map(({ account, goal }) => (
          <option key={goal.uuid} value={goal.uuid}>
            {account.name} / {goal.name} ({dollars(goal.remaining_saved)} saved)
          </option>
        ));
    const props = {
      autoFocus: true,
      "aria-label": label,
      "aria-invalid": !!current.error,
      "aria-describedby": current.error ? ids.cellError : undefined,
      value: current.value,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        setCell({ ...current, value: e.target.value, error: "" });
        p.dirty(true);
      },
      onBlur: () => {
        commitCell();
      },
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key !== "Enter" && e.key !== "Escape") return;
        e.preventDefault();
        e.stopPropagation();
        if (commitCell()) focusCell(current.grid, current.id, current.col);
      },
    };
    if (field === "kind")
      return (
        <select {...props}>
          <option value="finite">Finite</option>
          <option value="ongoing">Ongoing</option>
        </select>
      );
    if (field === "action")
      return (
        <select {...props}>
          <option value="reassignment">Reassign within account</option>
          <option value="transfer">Transfer between accounts</option>
          <option value="reconciliation">Reconcile one goal</option>
        </select>
      );
    if (field === "from" || field === "to")
      return (
        <select {...props}>
          <option value="">Choose goal</option>
          {goalChoices(current.value)}
        </select>
      );
    return (
      <input
        {...props}
        type={field === "date" ? "date" : "text"}
        inputMode={["amount", "designation", "target"].includes(field) ? "decimal" : "text"}
        maxLength={field === "name" ? 120 : undefined}
      />
    );
  }
  function gridCell(
    grid: Grid,
    rows: { id: string }[],
    rowIndex: number,
    col: number,
    columns: string[],
    rowName: string,
    content: React.ReactNode,
    onEdit: () => void,
    onAdd: () => void,
    onRemove: () => void,
    className = "",
  ) {
    const row = rows[rowIndex];
    const selected = selection[grid];
    const selectedIndex = Math.max(
      0,
      rows.findIndex((r) => r.id === selected.id),
    );
    const active = selectedIndex === rowIndex && selected.col === col;
    const editing = cell?.grid === grid && cell.id === row.id && cell.col === col;
    const keys = grid === "goals" ? goalKeys : moveKeys;
    return (
      <td
        key={col}
        id={`${grid}-${row.id}-${col}`}
        aria-label={`${rowName}, ${columns[col]}`}
        aria-selected={active}
        tabIndex={active && !editing ? 0 : -1}
        className={`${className} ${active ? "selected-cell" : ""}`}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === "Escape") {
            if (sidebar) {
              e.preventDefault();
              closeDetails();
            }
            return;
          }
          keys(e, {
            rowId: row.id,
            position: { row: rowIndex, col },
            rows: rows.length,
            columns: columns.length,
            move: ({ row: r, col: c }) => {
              if (cell && !commitCell()) return;
              focusCell(grid, rows[r].id, c);
            },
            edit: onEdit,
            add: onAdd,
            remove: onRemove,
            help: () => setHelp(true),
          });
        }}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("button,input,select")) return;
          if (
            cell &&
            !(cell.grid === grid && cell.id === row.id && cell.col === col) &&
            !commitCell()
          )
            return;
          if (!editing) focusCell(grid, row.id, col);
        }}
        onDoubleClick={() => {
          if (!editing) onEdit();
        }}
      >
        {editing ? (
          <>
            {editor(cell.field, `${columns[col]} for ${rowName}`)}
            {cell.error && (
              <span id={ids.cellError} role="alert" className="field-error">
                {cell.error}
              </span>
            )}
          </>
        ) : (
          content
        )}
      </td>
    );
  }

  function goalRowView(row: GoalRow, index: number) {
    const account = (pendingFor(`a:${row.account.uuid}`) as Draft & { type: "account" }) ?? null;
    const pendingKey = pending ? draftKey(pending) : "";
    if (!row.goal && !row.isNew) {
      const a = row.account;
      const name = account?.name ?? a.name;
      const cells = [
        <strong key="n">{name}</strong>,
        <span key="d" className="muted">
          Opened {account?.date ?? a.opening_date}
        </span>,
        "",
        dollars(account?.amount ?? a.opening_amount),
        dollars(a.balance),
        "",
        <span key="s" className="status-cell">
          <span className="badge">{a.active ? "Active" : "Archived"}</span>
          <DetailsButton name={name} onClick={() => openDetails(row.id)} />
        </span>,
      ];
      return (
        <tr
          key={row.id}
          className={`group-row ${pendingKey === `a:${a.uuid}` ? "pending-row" : ""} ${a.active ? "" : "archived-row"}`}
        >
          {cells.map((content, col) =>
            gridCell(
              "goals",
              goalRows,
              index,
              col,
              GOAL_COLUMNS,
              name,
              content,
              () => editGoalCell(row, col),
              () => addGoal(row),
              () => setNotice("Accounts and goals are archived from Details, not deleted."),
              col >= 3 && col <= 5 ? "numeric" : "",
            ),
          )}
        </tr>
      );
    }
    const goal = row.goal;
    const draft = row.isNew
      ? (pendingFor(`new-goal:${row.account.uuid}`) as Draft & { type: "new-goal" })
      : ((pendingFor(`g:${goal?.uuid}`) as (Draft & { type: "goal" }) | null) ?? null);
    const name = draft?.name ?? goal?.name ?? "";
    const kind = draft?.goalKind ?? goal?.kind ?? "finite";
    const target = draft ? draft.target : (goal?.target ?? "");
    const unallocated = goal?.role === "unallocated";
    const opening = row.isNew
      ? "—"
      : unallocated && account
        ? (() => {
            const remainder = openingRemainder(account.amount, Object.values(account.designations));
            return remainder === null ? "—" : dollars(formatCents(remainder));
          })()
        : dollars(account?.designations[goal?.uuid ?? ""] ?? goal?.opening_amount ?? "0.00");
    const label = name || "New goal";
    const cells = [
      <span key="n" className="goal-name">
        {label}
        {(pendingKey === `g:${goal?.uuid}` || row.isNew) && (
          <span className="badge pending-badge">unsaved</span>
        )}
      </span>,
      unallocated ? "Unallocated" : KIND[kind],
      target ? (
        dollars(target)
      ) : (
        <span key="t" className="muted">
          —
        </span>
      ),
      <span key="o" className={opening.startsWith("$-") ? "negative" : ""}>
        {opening}
      </span>,
      row.isNew ? "—" : dollars(goal?.remaining_saved ?? "0.00"),
      row.isNew ? "—" : dollars(goal?.contribution_progress ?? "0.00"),
      row.isNew ? (
        <span key="s" className="badge pending-badge">
          new
        </span>
      ) : (
        <span key="s" className="status-cell">
          {goal && goalStatus(row.account, goal) && (
            <span className="badge">{goalStatus(row.account, goal)}</span>
          )}
          <DetailsButton name={label} onClick={() => openDetails(row.id)} />
        </span>
      ),
    ];
    return (
      <tr
        key={row.id}
        className={`${row.isNew || pendingKey === `g:${goal?.uuid}` ? "pending-row" : ""} ${unallocated ? "unallocated-row" : ""}`}
      >
        {cells.map((content, col) =>
          gridCell(
            "goals",
            goalRows,
            index,
            col,
            GOAL_COLUMNS,
            label,
            content,
            () => editGoalCell(row, col),
            () => addGoal(row),
            () => setNotice("Accounts and goals are archived from Details, not deleted."),
            col >= 2 && col <= 5 ? "numeric" : "",
          ),
        )}
      </tr>
    );
  }

  function moveRowView(row: MoveRow, index: number) {
    const draft = row.movement
      ? (pendingFor(`m:${row.movement.uuid}`) as MovementEdit | null)
      : (newMove as MovementEdit);
    const m = draft ?? movementDraft(row.movement as SavingsMovement);
    const reconcile = m.action === "reconciliation";
    const name = row.movement
      ? `${ACTIONS[row.movement.kind]} on ${row.movement.date}`
      : "New savings record";
    const amount = draft
      ? m.amount
        ? `${reconcile ? "Known " : ""}${dollars(m.amount)}`
        : "—"
      : dollars(row.movement?.amount ?? "");
    const cells = [
      m.date,
      <span key="a">
        {ACTIONS[m.action]}
        {draft && <span className="badge pending-badge">unsaved</span>}
      </span>,
      goalLabel(reconcile ? m.goal : m.from),
      reconcile ? (
        <span key="t" className="muted">
          —
        </span>
      ) : (
        goalLabel(m.to)
      ),
      amount,
      <span key="n" className="muted">
        {m.note}
      </span>,
      row.movement ? (
        <button
          key="x"
          type="button"
          tabIndex={-1}
          className="text-button"
          aria-label={`Delete ${name}`}
          disabled={p.busy}
          onClick={() => row.movement && remove(row.movement)}
        >
          Delete
        </button>
      ) : (
        ""
      ),
    ];
    return (
      <tr key={row.id} className={draft ? "pending-row" : ""}>
        {cells.map((content, col) =>
          gridCell(
            "moves",
            moveRows,
            index,
            col,
            MOVE_COLUMNS,
            name,
            content,
            () => editMoveCell(row, col),
            addMove,
            () => {
              if (row.movement) remove(row.movement);
              else setNotice("Discard drops the unsaved record.");
            },
            col === 4 ? "numeric" : col === 5 ? "note-cell" : "",
          ),
        )}
      </tr>
    );
  }

  function details() {
    if (!sidebar) return null;
    if (sidebar === "new-account" && pending?.type === "new-account")
      return <NewAccount titleId={ids.details} draft={pending} onChange={update} />;
    const accountRow = accounts.find((a) => `a:${a.uuid}` === sidebar);
    const goalEntry = sidebar.startsWith("g:") ? goalIndex.get(sidebar.slice(2)) : undefined;
    if (accountRow)
      return (
        <AccountDetails
          titleId={ids.details}
          account={accountRow}
          draft={pendingFor(`a:${accountRow.uuid}`) as (Draft & { type: "account" }) | null}
          onEdit={(patch) => edit(`a:${accountRow.uuid}`, () => accountDraft(accountRow), patch)}
          onAddGoal={() => addGoal(goalRows.find((r) => r.id === sidebar))}
          lifecycleControl={lifecycleControl(accountRow)}
        />
      );
    if (goalEntry)
      return (
        <GoalDetails
          titleId={ids.details}
          account={goalEntry.account}
          goal={goalEntry.goal}
          draft={pendingFor(`g:${goalEntry.goal.uuid}`) as (Draft & { type: "goal" }) | null}
          onEdit={(patch) =>
            edit(
              `g:${goalEntry.goal.uuid}`,
              () => goalDraft(goalEntry.account, goalEntry.goal),
              patch,
            )
          }
          lifecycleControl={lifecycleControl(goalEntry.account, goalEntry.goal)}
        />
      );
    return null;
  }

  function lifecycleControl(account: SavingsAccount, goal?: Goal) {
    const choices: Lifecycle["action"][] = goal
      ? account.active && goal.completed && hasMoney(goal.remaining_saved)
        ? ["return"]
        : account.active &&
            goal.role === "ordinary" &&
            goal.kind === "finite" &&
            goal.active &&
            !goal.completed
          ? ["complete"]
          : []
      : [account.active ? "archive" : "reopen"];
    if (choices.length === 0) return null;
    const label = {
      complete: `Complete ${goal?.name}`,
      return: `Return ${goal?.name} to Unallocated`,
      archive: `Archive ${account.name}`,
      reopen: `Reopen ${account.name}`,
    };
    const facts = {
      complete: `Returns ${dollars(goal?.remaining_saved ?? "0.00")} to Unallocated · account total unchanged · no new contributions`,
      return: `Returns ${dollars(goal?.remaining_saved ?? "0.00")} to Unallocated · goal stays completed`,
      archive: `Requires $0.00 saved (now ${dollars(account.balance)}) · moves no money · archives its goals`,
      reopen: "Restores goals archived with it · completed and inactive goals keep their status",
    };
    const blocked = !!pending;
    function confirmLifecycle() {
      if (!lifecycle || p.busy || pending) return;
      const done = () => {
        setLifecycle(null);
        setReload((n) => n + 1);
      };
      if (lifecycle.action === "complete" && goal)
        p.save(
          savings.complete(p.entity.id, account.uuid, goal.uuid, {
            date: lifecycle.date,
            expected_revision: goal.revision,
            expected_return: goal.remaining_saved,
          }),
          done,
        );
      else if (lifecycle.action === "return" && goal) {
        const unallocated = account.goals.find((g) => g.role === "unallocated");
        if (unallocated)
          p.save(
            savings.move(p.entity.id, {
              kind: "reassignment",
              date: lifecycle.date,
              from_goal_id: goal.uuid,
              to_goal_id: unallocated.uuid,
              amount: goal.remaining_saved,
              note: "Returned completed-goal refund",
            }),
            done,
          );
      } else if (lifecycle.action === "archive" || lifecycle.action === "reopen")
        p.save(
          savings.lifecycle(p.entity.id, account.uuid, lifecycle.action, account.revision),
          done,
        );
    }
    return (
      <div className="lifecycle">
        {choices.map((action) =>
          lifecycle?.action === action ? (
            <fieldset key={action} className="lifecycle-confirm">
              <legend>{label[action]}</legend>
              <p>{facts[action]}</p>
              {(action === "complete" || action === "return") && (
                <label>
                  Financial date
                  <input
                    type="date"
                    required
                    value={lifecycle.date}
                    onChange={(e) => setLifecycle({ ...lifecycle, date: e.target.value })}
                  />
                </label>
              )}
              {blocked && <p className="field-error">Save or discard the unsaved record first.</p>}
              <div className="button-row">
                <button
                  type="button"
                  className="primary"
                  disabled={p.busy || blocked || !lifecycle.date}
                  onClick={confirmLifecycle}
                >
                  Confirm {action}
                </button>
                <button type="button" onClick={() => setLifecycle(null)}>
                  Cancel
                </button>
              </div>
            </fieldset>
          ) : (
            <button
              key={action}
              type="button"
              disabled={p.busy}
              onClick={() => {
                setLifecycle({ action, date: p.entity.today });
                requestAnimationFrame(() =>
                  document
                    .querySelector<HTMLElement>(
                      ".lifecycle-confirm input, .lifecycle-confirm .primary",
                    )
                    ?.focus(),
                );
              }}
            >
              {label[action]}…
            </button>
          ),
        )}
      </div>
    );
  }

  if (p.concealed) return null;
  const pendingLabel = pending
    ? {
        goal: () => `goal ${pending.type === "goal" ? pending.goal.name : ""}`,
        "new-goal": () => "new goal",
        account: () => `account ${pending.type === "account" ? pending.account.name : ""}`,
        "new-account": () => "new account",
        movement: () => "savings record",
      }[pending.type]()
    : "";
  const dirtyPending = !!pending && changed(pending);
  return (
    <section
      className="data-workspace savings-workspace"
      aria-labelledby={ids.title}
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
          e.preventDefault();
          save();
        }
      }}
    >
      <div className="data-toolbar">
        <h2 id={ids.title}>Savings</h2>
        <button type="button" className="primary" disabled={p.busy} onClick={newAccount}>
          New savings account
        </button>
        {hiddenCount > 0 && (
          <button type="button" onClick={() => setShowArchived((v) => !v)}>
            {showArchived ? "Hide archived" : `Show archived (${hiddenCount})`}
          </button>
        )}
        <button type="button" aria-label="Keyboard shortcuts" onClick={() => setHelp(true)}>
          ?
        </button>
      </div>
      <div className={`data-layout ${sidebar ? "with-sidebar" : ""}`}>
        <div className="savings-tables">
          {!reloading(accountsState, accounts) && (
            <LoadMessage state={accountsState} retry={() => setReload((n) => n + 1)} />
          )}
          {accountsState.kind === "empty" && <p className="empty">No savings accounts yet.</p>}
          {goalRows.length > 0 && (
            <div className="data-table-scroll">
              {/* biome-ignore lint/a11y/useSemanticElements: Spreadsheet grid with roving cell focus. */}
              <table
                role="grid"
                className="data-grid"
                aria-label="Savings accounts and goals"
                aria-describedby={ids.status}
                onFocus={() => setArea("goals")}
                onBlur={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget)) setArea("page");
                }}
              >
                <thead>
                  <tr>
                    {GOAL_COLUMNS.map((c, i) => (
                      <th key={c} scope="col" className={i >= 2 && i <= 5 ? "numeric" : ""}>
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>{goalRows.map(goalRowView)}</tbody>
              </table>
            </div>
          )}
          <div className="table-title">
            <h3 id={ids.records}>Savings records</h3>
            {accounts.length > 0 && (
              <button type="button" disabled={p.busy} onClick={addMove}>
                Add savings record
              </button>
            )}
          </div>
          {!reloading(movesState, movements) && (
            <LoadMessage state={movesState} retry={() => setReload((n) => n + 1)} />
          )}
          {accounts.length > 0 && (
            <div className="data-table-scroll">
              {/* biome-ignore lint/a11y/useSemanticElements: Spreadsheet grid with roving cell focus. */}
              <table
                role="grid"
                className="data-grid"
                aria-labelledby={ids.records}
                aria-describedby={ids.status}
                onFocus={() => setArea("moves")}
                onBlur={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget)) setArea("page");
                }}
              >
                <thead>
                  <tr>
                    {MOVE_COLUMNS.map((c, i) => (
                      <th key={c} scope="col" className={i === 4 ? "numeric" : ""}>
                        {i === 6 ? <span className="sr-only">{c}</span> : c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {moveRows.map(moveRowView)}
                  {moveRows.length === 0 && (
                    <tr>
                      <td colSpan={7} className="muted">
                        No savings movements yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
        {sidebar && (
          <aside
            className="data-sidebar savings-details"
            aria-labelledby={ids.details}
            onFocus={() => setArea("details")}
            onKeyDown={(e) => {
              if (e.key === "Escape" && !(e.target instanceof HTMLSelectElement)) {
                e.stopPropagation();
                closeDetails();
              }
            }}
          >
            <button
              type="button"
              className="close-details"
              aria-label="Close details"
              onClick={closeDetails}
            >
              ×
            </button>
            <fieldset className="details-body" disabled={p.busy}>
              {details()}
            </fieldset>
          </aside>
        )}
      </div>
      <footer id={ids.status} className="data-status savings-status">
        <span className="mode">
          {cell ? "INSERT" : area === "details" ? "DETAILS" : area === "page" ? "READY" : "NORMAL"}
        </span>
        {dirtyPending ? (
          <span className="pending-actions">
            Unsaved {pendingLabel}
            <button type="button" className="primary" disabled={p.busy} onClick={save}>
              Save
            </button>
            <button type="button" disabled={p.busy} onClick={discard}>
              Discard
            </button>
          </span>
        ) : null}
        {notice && (
          <span role="alert" className="field-error">
            {notice}
          </span>
        )}
        <span className="key-hints">
          <kbd>h j k l</kbd> Move <kbd>i</kbd> Edit <kbd>a</kbd> Add <kbd>Ctrl S</kbd> Save{" "}
          <kbd>?</kbd> Keys
        </span>
      </footer>
      <dialog ref={dialog} aria-labelledby={ids.keys} onClose={() => setHelp(false)}>
        <h2 id={ids.keys}>Keyboard shortcuts</h2>
        <dl className="savings-shortcuts">
          {SHORTCUTS.map(([key, label]) => (
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

function DetailsButton({ name, onClick }: { name: string; onClick: () => void }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      className="details-button"
      aria-label={`Details for ${name}`}
      onClick={onClick}
    >
      ›
    </button>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function AccountDetails({
  titleId,
  account,
  draft,
  onEdit,
  onAddGoal,
  lifecycleControl,
}: {
  titleId: string;
  account: SavingsAccount;
  draft: (Draft & { type: "account" }) | null;
  onEdit: (patch: (d: Draft) => Draft) => void;
  onAddGoal: () => void;
  lifecycleControl: React.ReactNode;
}) {
  const d = draft ?? (accountDraft(account) as Draft & { type: "account" });
  const ordinary = account.goals.filter((g) => g.role === "ordinary");
  const remainder = openingRemainder(d.amount, Object.values(d.designations));
  const set = (patch: Partial<Draft & { type: "account" }>) =>
    onEdit((current) => ({ ...current, ...patch }) as Draft);
  return (
    <>
      <h3 id={titleId} tabIndex={-1}>
        {account.name}
      </h3>
      <dl className="facts">
        <Fact label="Remaining saved" value={dollars(account.balance)} />
        <Fact label="Status" value={account.active ? "Active" : "Archived"} />
      </dl>
      {account.active && (
        <fieldset>
          <legend>Opening setup</legend>
          <label>
            Name
            <input
              required
              maxLength={120}
              value={d.name}
              onChange={(e) => set({ name: e.target.value })}
            />
          </label>
          <label>
            Opening date
            <input
              type="date"
              required
              value={d.date}
              onChange={(e) => set({ date: e.target.value })}
            />
          </label>
          <label>
            Opening amount
            <input
              inputMode="decimal"
              value={d.amount}
              onChange={(e) => set({ amount: e.target.value })}
            />
          </label>
          {ordinary.map((goal) => (
            <label key={goal.uuid}>
              {goal.name} opening
              <input
                inputMode="decimal"
                value={d.designations[goal.uuid] ?? ""}
                onChange={(e) =>
                  onEdit((current) =>
                    current.type === "account"
                      ? {
                          ...current,
                          designations: { ...current.designations, [goal.uuid]: e.target.value },
                        }
                      : current,
                  )
                }
              />
            </label>
          ))}
          <Remainder value={remainder} />
        </fieldset>
      )}
      {account.active && (
        <button type="button" onClick={onAddGoal}>
          Add goal
        </button>
      )}
      {lifecycleControl}
    </>
  );
}

function Remainder({ value }: { value: number | null }) {
  return (
    <output className={value !== null && value < 0 ? "remainder negative" : "remainder"}>
      Unallocated opening {value === null ? "—" : dollars(formatCents(value))}
    </output>
  );
}

function GoalDetails({
  titleId,
  account,
  goal,
  draft,
  onEdit,
  lifecycleControl,
}: {
  titleId: string;
  account: SavingsAccount;
  goal: Goal;
  draft: (Draft & { type: "goal" }) | null;
  onEdit: (patch: (d: Draft) => Draft) => void;
  lifecycleControl: React.ReactNode;
}) {
  const d = draft ?? (goalDraft(account, goal) as Draft & { type: "goal" });
  const editable = account.active && goal.role === "ordinary" && !goal.completed;
  const set = (patch: Partial<Draft & { type: "goal" }>) =>
    onEdit((current) => ({ ...current, ...patch }) as Draft);
  return (
    <>
      <h3 id={titleId} tabIndex={-1}>
        {goal.name}
      </h3>
      <dl className="facts">
        <Fact label="Account" value={account.name} />
        <Fact label="Type" value={goal.role === "unallocated" ? "Unallocated" : KIND[goal.kind]} />
        <Fact label="Target" value={goal.target ? dollars(goal.target) : "—"} />
        <Fact label="Opening" value={dollars(goal.opening_amount)} />
        <Fact label="Remaining saved" value={dollars(goal.remaining_saved)} />
        <Fact label="Contributions" value={dollars(goal.contribution_progress)} />
        <Fact label="Status" value={goalStatus(account, goal) || "Active"} />
      </dl>
      {goal.role === "unallocated" && <p className="muted">Protected goal.</p>}
      {editable && (
        <fieldset>
          <legend>Goal</legend>
          <label>
            Name
            <input
              required
              maxLength={120}
              value={d.name}
              onChange={(e) => set({ name: e.target.value })}
            />
          </label>
          <label>
            Goal type
            <select
              value={d.goalKind}
              onChange={(e) => set({ goalKind: e.target.value as Goal["kind"] })}
            >
              <option value="finite">Finite</option>
              <option value="ongoing">Ongoing</option>
            </select>
          </label>
          <label>
            {d.goalKind === "finite" ? "Target (required)" : "Target (optional)"}
            <input
              inputMode="decimal"
              value={d.target}
              onChange={(e) => set({ target: e.target.value })}
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={d.active}
              onChange={(e) => set({ active: e.target.checked })}
            />
            Active for new contributions
          </label>
        </fieldset>
      )}
      {lifecycleControl}
    </>
  );
}

function NewAccount({
  titleId,
  draft,
  onChange,
}: {
  titleId: string;
  draft: Draft & { type: "new-account" };
  onChange: (draft: Draft) => void;
}) {
  const set = (patch: Partial<Draft & { type: "new-account" }>) => onChange({ ...draft, ...patch });
  const setGoal = (index: number, patch: Partial<(typeof draft.goals)[number]>) =>
    set({ goals: draft.goals.map((g, i) => (i === index ? { ...g, ...patch } : g)) });
  const remainder = openingRemainder(
    draft.amount,
    draft.goals.map((g) => g.amount),
  );
  return (
    <>
      <h3 id={titleId} tabIndex={-1}>
        New savings account
      </h3>
      <label>
        Name
        <input
          required
          maxLength={120}
          value={draft.name}
          onChange={(e) => set({ name: e.target.value })}
        />
      </label>
      <label>
        Opening date
        <input
          type="date"
          required
          value={draft.date}
          onChange={(e) => set({ date: e.target.value })}
        />
      </label>
      <label>
        Opening amount
        <input
          inputMode="decimal"
          value={draft.amount}
          onChange={(e) => set({ amount: e.target.value })}
        />
      </label>
      {draft.goals.map((goal, index) => (
        <fieldset key={goal.key}>
          <legend>Opening goal {index + 1}</legend>
          <label>
            Goal name
            <input
              required
              maxLength={120}
              value={goal.name}
              onChange={(e) => setGoal(index, { name: e.target.value })}
            />
          </label>
          <label>
            Goal type
            <select
              value={goal.goalKind}
              onChange={(e) => setGoal(index, { goalKind: e.target.value as Goal["kind"] })}
            >
              <option value="finite">Finite</option>
              <option value="ongoing">Ongoing</option>
            </select>
          </label>
          <label>
            {goal.goalKind === "finite" ? "Target (required)" : "Target (optional)"}
            <input
              inputMode="decimal"
              value={goal.target}
              onChange={(e) => setGoal(index, { target: e.target.value })}
            />
          </label>
          <label>
            Opening designation
            <input
              inputMode="decimal"
              value={goal.amount}
              onChange={(e) => setGoal(index, { amount: e.target.value })}
            />
          </label>
          <button
            type="button"
            onClick={() => set({ goals: draft.goals.filter((_, i) => i !== index) })}
          >
            Remove goal
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        onClick={() =>
          set({
            goals: [
              ...draft.goals,
              {
                key: crypto.randomUUID(),
                name: "",
                goalKind: "finite",
                target: "",
                amount: "0.00",
              },
            ],
          })
        }
      >
        Add opening goal
      </button>
      <Remainder value={remainder} />
    </>
  );
}
