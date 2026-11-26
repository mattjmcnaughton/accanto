import type React from "react";
import { useEffect, useId, useRef, useState } from "react";
import { decimalToCents, fmtDate, fmtShort, formatMoney, money } from "../../lib/format";
import { type Goal, type SavingsAccount, type SavingsMovement, savings } from "../../lib/savings";
import { Dialog, Empty, Field, Head, Icon, Meter, Skeleton } from "../../ui";
import { type ScreenProps, useLoad } from "../workspace/shared";
import { useGridKeys } from "../workspace/useGridKeys";
import "./savings.css";
import {
  type Draft,
  type MovementEdit,
  type NewGoalEdit,
  accountDraft,
  cents,
  changed,
  draftKey,
  goalDraft,
  hasMoney,
  movementDraft,
  openingRemainder,
  problem,
  writeFor,
} from "./savingsDraft";

type Grid = "goals" | "moves";
type CellField =
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
type Cell = { grid: Grid; id: string; col: number; field: CellField; value: string; error: string };
type GoalRow = { id: string; account: SavingsAccount; goal: Goal | null; isNew?: boolean };
type MoveRow = { id: string; movement: SavingsMovement | null };
type Action = "complete" | "return" | "archive" | "reopen";
type Lifecycle = { action: Action; date: string };

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
  ["Enter / Esc while editing", "Keep a valid edit unsaved; return to the table"],
  ["a / A", "Add a goal to this account, or a savings record"],
  ["dd", "Delete the selected savings record, with confirmation"],
  ["Esc", "Close details"],
  ["Tab / Shift+Tab", "Move between tables and fields"],
  ["Ctrl / ⌘ + S", "Save the unsaved record"],
  ["?", "Open this reference"],
];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const day = (iso: string) => (ISO_DATE.test(iso) ? fmtDate(iso) : iso || "—");
const goalStatus = (account: SavingsAccount, goal: Goal) =>
  goal.completed
    ? "Completed"
    : !account.active
      ? "Archived"
      : !goal.active
        ? "Inactive"
        : (goal.funded_status ?? "");
const hiddenGoal = (goal: Goal) => goal.completed && !hasMoney(goal.remaining_saved);
const isNewRecord = (draft: Draft) =>
  draft.type === "new-account" ||
  draft.type === "new-goal" ||
  (draft.type === "movement" && !draft.movement);
function lifecycleChoices(account: SavingsAccount, goal?: Goal): Action[] {
  if (!goal) return [account.active ? "archive" : "reopen"];
  if (account.active && goal.completed && hasMoney(goal.remaining_saved)) return ["return"];
  if (
    account.active &&
    goal.role === "ordinary" &&
    goal.kind === "finite" &&
    goal.active &&
    !goal.completed
  )
    return ["complete"];
  return [];
}

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
  const settled = useRef(false);
  if (accountsState.kind !== "loading") {
    settled.current = true;
    loaded.current.accounts = accountsState.kind === "ready" ? accountsState.data : [];
  }
  if (movesState.kind !== "loading")
    loaded.current.movements = movesState.kind === "ready" ? movesState.data : [];
  const { accounts, movements } = loaded.current;
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
  const [help, setHelp] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const uid = useId();
  const ids = { status: `${uid}-status`, cellError: `${uid}-cell-error`, keys: `${uid}-keys` };
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

  const pendingLabel = pending
    ? {
        goal: () => `goal ${pending.type === "goal" ? pending.goal.name : ""}`,
        "new-goal": () => "new goal",
        account: () => `account ${pending.type === "account" ? pending.account.name : ""}`,
        "new-account": () => "new account",
        movement: () => "savings record",
      }[pending.type]()
    : "";

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
    const key = draftKey(pending);
    const wasNew = isNewRecord(pending);
    setPending(null);
    setCell(null);
    setNotice("");
    p.dirty(false);
    if (wasNew && sidebar === key) setSidebar(null);
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
    const key = draftKey(saving);
    p.save(writeFor(p.entity.id, saving), (data) => {
      setPending(null);
      setNotice("");
      p.dirty(false);
      if (saving.type === "new-account") setSidebar(`a:${(data as SavingsAccount).uuid}`);
      else if (isNewRecord(saving)) setSidebar((open) => (open === key ? null : open));
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
  function goalField(row: GoalRow, col: number): CellField | null {
    if (!row.account.active) return null;
    if (!row.goal && !row.isNew) return (["name", "date", null, "amount"] as const)[col] ?? null;
    if (row.goal?.role === "unallocated") return null;
    if (col === 3) return row.isNew ? null : "designation";
    if (row.goal?.completed) return null;
    return (["name", "kind", "target"] as const)[col] ?? null;
  }
  function moveField(draft: Draft & { type: "movement" }, col: number): CellField | null {
    if (col === 1) return draft.movement ? null : "action";
    if (col === 3 && draft.action === "reconciliation") return null;
    return (["date", null, "from", "to", "amount", "note"] as const)[col] ?? null;
  }
  function goalRecord(row: GoalRow, field: CellField): Draft {
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
  function read(draft: Draft, field: CellField, goalId?: string): string {
    if (field === "kind") return "goalKind" in draft ? draft.goalKind : "";
    if (field === "designation" && draft.type === "account")
      return draft.designations[goalId ?? ""] ?? "";
    if (field === "from" && draft.type === "movement" && draft.action === "reconciliation")
      return draft.goal;
    return String((draft as unknown as Record<string, unknown>)[field] ?? "");
  }
  function apply(draft: Draft, field: CellField, value: string, goalId?: string): Draft {
    if (field === "kind") return { ...draft, goalKind: value } as Draft;
    if (field === "designation" && draft.type === "account")
      return { ...draft, designations: { ...draft.designations, [goalId ?? ""]: value } };
    if (field === "from" && draft.type === "movement" && draft.action === "reconciliation")
      return { ...draft, goal: value };
    return { ...draft, [field]: value } as Draft;
  }
  function begin(
    grid: Grid,
    id: string,
    col: number,
    field: CellField,
    draft: Draft,
    goalId?: string,
  ) {
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
            : cell.field === "date" && !ISO_DATE.test(value)
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
  /** Starts (or resumes) a new goal for this account; returns its draft, or null when blocked. */
  function startGoal(account: SavingsAccount): NewGoalEdit | null {
    if (p.busy) return null;
    if (!account.active) {
      setNotice("Reopen the account to add goals.");
      return null;
    }
    if (cell && !commitCell()) return null;
    const key = `new-goal:${account.uuid}`;
    if (!switchTo(key)) return null;
    const draft = (pendingFor(key) as NewGoalEdit | null) ?? {
      type: "new-goal" as const,
      account,
      name: "",
      goalKind: "finite",
      target: "",
    };
    setPending(draft);
    p.dirty(true);
    return draft;
  }
  function addGoal(row: GoalRow | undefined) {
    const draft = row && startGoal(row.account);
    if (!draft) return;
    setCell({ grid: "goals", id: "new-goal", col: 0, field: "name", value: draft.name, error: "" });
    setSelection((s) => ({ ...s, goals: { id: "new-goal", col: 0 } }));
  }
  function startMove(from = ""): MovementEdit | null {
    if (cell && !commitCell()) return null;
    if (!switchTo("new-move")) return null;
    const draft: MovementEdit = (pendingFor("new-move") as MovementEdit | null) ?? {
      type: "movement",
      movement: null,
      action: "reassignment",
      date: p.entity.today,
      from,
      to: "",
      goal: "",
      amount: "",
      note: "",
    };
    setPending(draft);
    p.dirty(true);
    return draft;
  }
  function addMove() {
    const draft = startMove();
    if (!draft) return;
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
    const label = `${ACTIONS[movement.kind]} ${formatMoney(movement.amount)} on ${day(movement.date)}`;
    if (!window.confirm(`Delete “${label}”? It leaves current totals; its history is kept.`))
      return;
    setPending(null);
    setCell(null);
    p.dirty(false);
    p.save(savings.deleteMovement(p.entity.id, movement), () => setReload((n) => n + 1));
  }
  function openDetails(id: string, action?: Action) {
    if (!sidebar && document.activeElement instanceof HTMLElement)
      opener.current = document.activeElement;
    setSidebar(id);
    setLifecycle(action ? { action, date: p.entity.today } : null);
    if (action) focusConfirm();
    // A new record's form starts at its first field rather than the close button.
    else if (id.startsWith("new"))
      requestAnimationFrame(() =>
        document.querySelector<HTMLElement>(".sv-form :is(input, select)")?.focus(),
      );
  }
  function focusConfirm() {
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>(".sv-confirm input, .sv-confirm .pri")?.focus(),
    );
  }
  function closeDetails() {
    // A new record stays open until it is saved or discarded; a failed save's notice shows in it.
    if (pending && sidebar === draftKey(pending) && isNewRecord(pending)) {
      setNotice(`Save or discard the ${pendingLabel} first.`);
      return;
    }
    setSidebar(null);
    setLifecycle(null);
    const back = opener.current;
    opener.current = null;
    requestAnimationFrame(() => back?.isConnected && back.focus());
  }
  function newAccount() {
    if (cell && !commitCell()) return;
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

  // ---- Grid rendering ----------------------------------------------------
  function goalChoices(selected: string) {
    return [...goalIndex.values()]
      .filter(({ account, goal }) => (account.active && goal.active) || goal.uuid === selected)
      .map(({ account, goal }) => (
        <option key={goal.uuid} value={goal.uuid}>
          {account.name} / {goal.name} ({formatMoney(goal.remaining_saved)} saved)
        </option>
      ));
  }
  function editor(field: CellField, label: string) {
    if (!cell) return null;
    const current = cell;
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
        className={`${className} ${editing ? "sv-editing" : ""}`}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
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
              <span id={ids.cellError} role="alert" className="err">
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

  const unsavedChip = (
    <span key="u" className="chip warn sv-unsaved">
      unsaved
    </span>
  );
  function goalRowView(row: GoalRow, index: number) {
    const account = (pendingFor(`a:${row.account.uuid}`) as Draft & { type: "account" }) ?? null;
    const pendingKey = pending ? draftKey(pending) : "";
    if (!row.goal && !row.isNew) {
      const a = row.account;
      const name = account?.name ?? a.name;
      const cells = [
        <strong key="n">
          {name}
          {pendingKey === `a:${a.uuid}` && unsavedChip}
        </strong>,
        <span key="d" className="muted">
          Opened {day(account?.date ?? a.opening_date)}
        </span>,
        "",
        formatMoney(account?.amount ?? a.opening_amount),
        formatMoney(a.balance),
        "",
        <span key="s" className="sv-status">
          <span className="chip">{a.active ? "Active" : "Archived"}</span>
          <DetailsButton name={name} onClick={() => openDetails(row.id)} />
        </span>,
      ];
      return (
        <tr
          key={row.id}
          className={`sv-account-row ${pendingKey === `a:${a.uuid}` ? "sv-pending-row" : ""} ${a.active ? "" : "sv-quiet-row"}`}
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
              col >= 3 && col <= 5 ? "num" : "",
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
    let opening = "—";
    let negative = false;
    if (!row.isNew && unallocated && account) {
      const remainder = openingRemainder(account.amount, Object.values(account.designations));
      if (remainder !== null) opening = money(remainder);
      negative = remainder !== null && remainder < 0;
    } else if (!row.isNew)
      opening = formatMoney(
        account?.designations[goal?.uuid ?? ""] ?? goal?.opening_amount ?? "0.00",
      );
    const label = name || "New goal";
    const cells = [
      <span key="n" className="sv-goal-name">
        {label}
        {(pendingKey === `g:${goal?.uuid}` || row.isNew) && unsavedChip}
      </span>,
      unallocated ? "Unallocated" : KIND[kind],
      target ? (
        formatMoney(target)
      ) : (
        <span key="t" className="muted">
          —
        </span>
      ),
      <span key="o" className={negative ? "bad" : ""}>
        {opening}
      </span>,
      row.isNew ? "—" : formatMoney(goal?.remaining_saved ?? "0.00"),
      row.isNew ? "—" : formatMoney(goal?.contribution_progress ?? "0.00"),
      row.isNew ? (
        <span key="s" className="chip warn">
          new
        </span>
      ) : (
        <span key="s" className="sv-status">
          {goal && goalStatus(row.account, goal) && (
            <span className="chip">{goalStatus(row.account, goal)}</span>
          )}
          <DetailsButton name={label} onClick={() => openDetails(row.id)} />
        </span>
      ),
    ];
    return (
      <tr
        key={row.id}
        className={`${row.isNew || pendingKey === `g:${goal?.uuid}` ? "sv-pending-row" : ""} ${unallocated || !row.account.active ? "sv-quiet-row" : ""}`}
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
            col >= 2 && col <= 5 ? "num" : "",
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
      ? `${ACTIONS[row.movement.kind]} on ${day(row.movement.date)}`
      : "New savings record";
    const amount = draft
      ? m.amount
        ? `${reconcile ? "Known " : ""}${formatMoney(m.amount)}`
        : "—"
      : formatMoney(row.movement?.amount ?? "");
    const cells = [
      day(m.date),
      <span key="a">
        {ACTIONS[m.action]}
        {draft && unsavedChip}
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
          className="btn sm quiet danger"
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
      <tr key={row.id} className={draft ? "sv-pending-row" : ""}>
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
            col === 4
              ? "num"
              : col === 5
                ? "sv-note-cell"
                : col === 2 || col === 3
                  ? "sv-wrap"
                  : "",
          ),
        )}
      </tr>
    );
  }

  // ---- Progress cards ----------------------------------------------------
  function goalCard(account: SavingsAccount, goal: Goal) {
    const saved = decimalToCents(goal.remaining_saved) ?? 0;
    const target = goal.target ? decimalToCents(goal.target) : null;
    const status = goalStatus(account, goal);
    const action = lifecycleChoices(account, goal)[0];
    return (
      <div className="card pad sv-goal" key={goal.uuid}>
        <div className="sv-goal-top">
          <b>{goal.name}</b>
          <span className="sv-chips">
            {status && <span className={status === "Funded" ? "chip good" : "chip"}>{status}</span>}
            <span className="chip">
              {goal.kind === "finite" ? "Goal with a target" : "Ongoing"}
            </span>
          </span>
        </div>
        <div className="fig sv-fig">
          {formatMoney(goal.remaining_saved)}{" "}
          <small>{goal.target ? `of ${formatMoney(goal.target)}` : "with no target"}</small>
        </div>
        <div className="sv-meter">
          {target ? (
            <Meter value={saved} max={target} kind="save" />
          ) : (
            <Meter value={1} max={1} kind="save" faint />
          )}
        </div>
        <span className="cap">
          {formatMoney(goal.contribution_progress)} contributed since{" "}
          {fmtShort(account.opening_date)}.
        </span>
        <div className="actions">
          {account.active && !goal.completed && (
            <button
              type="button"
              className="btn sm"
              disabled={p.busy}
              aria-label={`Move money from ${goal.name}`}
              onClick={() => startMove(goal.uuid) && openDetails("new-move")}
            >
              Move
            </button>
          )}
          <button
            type="button"
            className="btn sm"
            aria-label={`Edit ${goal.name}`}
            onClick={() => openDetails(`g:${goal.uuid}`)}
          >
            Edit
          </button>
          {action && (
            <button
              type="button"
              className="btn sm quiet"
              disabled={p.busy}
              onClick={() => openDetails(`g:${goal.uuid}`, action)}
            >
              {action === "complete" ? "Complete goal" : "Return to Unallocated"}
            </button>
          )}
        </div>
      </div>
    );
  }
  function accountSection(account: SavingsAccount) {
    const goals = account.goals.filter((g) => g.role === "ordinary" && !hiddenGoal(g));
    const done = account.goals.filter(hiddenGoal);
    const unallocated = account.goals.find((g) => g.role === "unallocated");
    return (
      <section key={account.uuid} aria-label={account.name}>
        <div className="h2 sv-account-head">
          <h2>{account.name}</h2>
          <span>
            {formatMoney(account.balance)} saved, opened {day(account.opening_date)}
          </span>
          {!account.active && <span className="chip">Archived</span>}
          <div className="sv-actions">
            {account.active && (
              <button
                type="button"
                className="btn sm"
                disabled={p.busy}
                onClick={() => startGoal(account) && openDetails(`new-goal:${account.uuid}`)}
              >
                Add goal
              </button>
            )}
            <button
              type="button"
              className="btn sm quiet"
              aria-label={`Edit ${account.name}`}
              onClick={() => openDetails(`a:${account.uuid}`)}
            >
              Edit
            </button>
            <button
              type="button"
              className="btn sm quiet"
              disabled={p.busy}
              aria-label={`${account.active ? "Archive" : "Reopen"} ${account.name}`}
              onClick={() =>
                openDetails(`a:${account.uuid}`, account.active ? "archive" : "reopen")
              }
            >
              {account.active ? "Archive" : "Reopen"}
            </button>
          </div>
        </div>
        {goals.length > 0 && (
          <div className="grid2 sv-cards">{goals.map((goal) => goalCard(account, goal))}</div>
        )}
        {unallocated && (
          <div className="card">
            <div className="row">
              <span className="t">
                Unallocated
                <small>Not assigned to a goal</small>
              </span>
              <span className="a">{formatMoney(unallocated.remaining_saved)}</span>
              {account.active && (
                <button
                  type="button"
                  className="btn sm"
                  disabled={p.busy}
                  onClick={() => startMove(unallocated.uuid) && openDetails("new-move")}
                >
                  Move to a goal
                </button>
              )}
            </div>
          </div>
        )}
        {done.length > 0 && (
          <p className="note sv-done">
            Completed: {done.map((g) => g.name).join(", ")}. What was left went back to unallocated
            money.
          </p>
        )}
      </section>
    );
  }

  // ---- Details and forms -------------------------------------------------
  function details() {
    if (!sidebar) return null;
    if (sidebar === "new-account" && pending?.type === "new-account")
      return <NewAccount draft={pending} onChange={update} />;
    if (sidebar.startsWith("new-goal:") && pending?.type === "new-goal")
      return <NewGoal draft={pending} onChange={update} />;
    if (sidebar === "new-move" && pending?.type === "movement" && !pending.movement)
      return moveForm(pending);
    const accountRow = accounts.find((a) => `a:${a.uuid}` === sidebar);
    const goalEntry = sidebar.startsWith("g:") ? goalIndex.get(sidebar.slice(2)) : undefined;
    if (accountRow)
      return (
        <AccountDetails
          account={accountRow}
          draft={pendingFor(`a:${accountRow.uuid}`) as (Draft & { type: "account" }) | null}
          onEdit={(patch) => edit(`a:${accountRow.uuid}`, () => accountDraft(accountRow), patch)}
          onAddGoal={() => startGoal(accountRow) && openDetails(`new-goal:${accountRow.uuid}`)}
          lifecycleControl={lifecycleControl(accountRow)}
        />
      );
    if (goalEntry)
      return (
        <GoalDetails
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
  function detailsTitle() {
    if (!sidebar) return "";
    if (sidebar === "new-account") return "New savings account";
    if (sidebar === "new-move") return "Move saved money";
    if (sidebar.startsWith("new-goal:")) {
      const account = accounts.find((a) => `new-goal:${a.uuid}` === sidebar);
      return `New goal in ${account?.name ?? "this account"}`;
    }
    if (sidebar.startsWith("g:")) return goalIndex.get(sidebar.slice(2))?.goal.name ?? "Goal";
    return accounts.find((a) => `a:${a.uuid}` === sidebar)?.name ?? "Savings account";
  }
  function moveForm(draft: MovementEdit) {
    const reconcile = draft.action === "reconciliation";
    const set = (patch: Partial<MovementEdit>) => {
      const next = { ...draft, ...patch };
      // Choosing goals picks the matching kind of move; the API still checks both ends.
      if (!reconcile && ("from" in patch || "to" in patch) && next.from && next.to)
        next.action = goalAccount(next.from) === goalAccount(next.to) ? "reassignment" : "transfer";
      update(next);
    };
    return (
      <>
        <Field label="Kind of record">
          <select
            value={draft.action}
            onChange={(e) => set({ action: e.target.value as MovementEdit["action"] })}
          >
            <option value="reassignment">Reassign within account</option>
            <option value="transfer">Transfer between accounts</option>
            <option value="reconciliation">Reconcile one goal</option>
          </select>
        </Field>
        {reconcile ? (
          <Field label="Goal">
            <select value={draft.goal} onChange={(e) => set({ goal: e.target.value })}>
              <option value="">Choose goal</option>
              {goalChoices(draft.goal)}
            </select>
          </Field>
        ) : (
          <>
            <Field label="From">
              <select value={draft.from} onChange={(e) => set({ from: e.target.value })}>
                <option value="">Choose goal</option>
                {goalChoices(draft.from)}
              </select>
            </Field>
            <Field label="To">
              <select value={draft.to} onChange={(e) => set({ to: e.target.value })}>
                <option value="">Choose goal</option>
                {goalChoices(draft.to)}
              </select>
            </Field>
          </>
        )}
        <div className="two">
          <Field label={reconcile ? "Known saved amount (USD)" : "Amount (USD)"}>
            <input
              inputMode="decimal"
              placeholder="0.00"
              value={draft.amount}
              onChange={(e) => set({ amount: e.target.value })}
            />
          </Field>
          <Field label="Date">
            <input
              type="date"
              required
              value={draft.date}
              onChange={(e) => set({ date: e.target.value })}
            />
          </Field>
        </div>
        <Field
          label="Note (optional)"
          hint="Moving saved money is not income, spending or new saving."
        >
          <input
            maxLength={2000}
            value={draft.note}
            onChange={(e) => set({ note: e.target.value })}
          />
        </Field>
      </>
    );
  }

  function lifecycleControl(account: SavingsAccount, goal?: Goal) {
    const choices = lifecycleChoices(account, goal);
    if (choices.length === 0) return null;
    const label = {
      complete: `Complete ${goal?.name}`,
      return: `Return ${goal?.name} to Unallocated`,
      archive: `Archive ${account.name}`,
      reopen: `Reopen ${account.name}`,
    };
    const facts = {
      complete: `Returns ${formatMoney(goal?.remaining_saved ?? "0.00")} to Unallocated · account total unchanged · no new contributions`,
      return: `Returns ${formatMoney(goal?.remaining_saved ?? "0.00")} to Unallocated · goal stays completed`,
      archive: `Requires $0.00 saved (now ${formatMoney(account.balance)}) · moves no money · archives its goals`,
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
      <div className="sv-lifecycle">
        {choices.map((action) =>
          lifecycle?.action === action ? (
            <fieldset key={action} className="sv-confirm">
              <legend>{label[action]}</legend>
              <p className="note">{facts[action]}</p>
              {(action === "complete" || action === "return") && (
                <Field label="Financial date">
                  <input
                    type="date"
                    required
                    value={lifecycle.date}
                    onChange={(e) => setLifecycle({ ...lifecycle, date: e.target.value })}
                  />
                </Field>
              )}
              {blocked && <p className="err">Save or discard the unsaved record first.</p>}
              <div className="sv-buttons">
                <button
                  type="button"
                  className="btn pri"
                  disabled={p.busy || blocked || !lifecycle.date}
                  onClick={confirmLifecycle}
                >
                  Confirm {action}
                </button>
                <button type="button" className="btn" onClick={() => setLifecycle(null)}>
                  Cancel
                </button>
              </div>
            </fieldset>
          ) : (
            <button
              key={action}
              type="button"
              className={action === "archive" ? "btn quiet" : "btn"}
              disabled={p.busy}
              onClick={() => {
                setLifecycle({ action, date: p.entity.today });
                focusConfirm();
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
  if (!settled.current) return <Skeleton />;
  const dirtyPending = !!pending && changed(pending);
  const pendingActions = (
    <>
      {notice && (
        <span role="alert" className="err sv-notice">
          {notice}
        </span>
      )}
      {dirtyPending && (
        <>
          <span className="sv-pending">Unsaved {pendingLabel}</span>
          <span className="spacer" />
          <button type="button" className="btn" disabled={p.busy} onClick={discard}>
            Discard
          </button>
          <button type="button" className="btn pri" disabled={p.busy} onClick={save}>
            Save
          </button>
        </>
      )}
    </>
  );
  const active = accounts.filter((a) => a.active);
  const archived = accounts.filter((a) => !a.active);
  const loadError = (state: { kind: string; error?: { message: string } }, what: string) =>
    state.kind !== "loading" && state.kind !== "ready" && state.kind !== "empty" ? (
      <div className="card pad sv-error" role="alert">
        <p>
          Could not load {what}. {state.error?.message}
        </p>
        <button type="button" className="btn sm" onClick={() => setReload((n) => n + 1)}>
          Try loading again
        </button>
      </div>
    ) : null;
  const movesError = loadError(movesState, "savings records");
  return (
    <section
      className="screen sv"
      aria-label="Savings"
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
          e.preventDefault();
          save();
        }
      }}
    >
      <Head
        title="Savings"
        sub={
          active.length
            ? "Every saved dollar sits in a goal or in its account's unallocated money."
            : "Track what you have set aside, and what each dollar is for."
        }
      >
        {accounts.length > 0 && (
          <button
            type="button"
            className="btn"
            disabled={p.busy}
            onClick={() => startMove() && openDetails("new-move")}
          >
            Move saved money
          </button>
        )}
        <button type="button" className="btn pri" disabled={p.busy} onClick={newAccount}>
          <Icon name="plus" />
          New account
        </button>
        <button
          type="button"
          className="btn sv-keys-btn"
          aria-label="Keyboard shortcuts"
          onClick={() => setHelp(true)}
        >
          ?
        </button>
      </Head>
      {loadError(accountsState, "your savings accounts")}
      {accountsState.kind === "empty" && (
        <Empty
          title="No savings accounts yet"
          action={
            <button type="button" className="btn pri" disabled={p.busy} onClick={newAccount}>
              Add a savings account
            </button>
          }
        >
          Add an account with what it holds today, then split it into goals such as an emergency
          fund or a trip.
        </Empty>
      )}
      {active.map(accountSection)}
      {hiddenCount > 0 && (
        <div>
          <button
            type="button"
            className="sv-disclose"
            aria-expanded={showArchived}
            onClick={() => setShowArchived((v) => !v)}
          >
            {showArchived ? "Hide archived" : `Show archived (${hiddenCount})`}
          </button>
        </div>
      )}
      {showArchived && archived.map(accountSection)}
      {goalRows.length > 0 && (
        <section aria-label="Table view">
          <h2 className="h2">
            Table view{" "}
            <span>Edit in place: arrow keys or h j k l move, Enter edits, ? lists every key.</span>
          </h2>
          <div className="card sv-table">
            {/* biome-ignore lint/a11y/useSemanticElements: Spreadsheet grid with roving cell focus. */}
            <table
              role="grid"
              className="sv-grid sv-goals"
              aria-label="Savings accounts and goals"
              aria-describedby={ids.status}
            >
              <thead>
                <tr>
                  {GOAL_COLUMNS.map((c, i) => (
                    <th key={c} scope="col" className={i >= 2 && i <= 5 ? "num" : ""}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>{goalRows.map(goalRowView)}</tbody>
            </table>
          </div>
        </section>
      )}
      {(accounts.length > 0 || movesError) && (
        <section aria-label="Moves and corrections">
          <h2 className="h2">
            Moves and corrections <span>Not new saving, income or spending</span>
          </h2>
          {movesError}
          {accounts.length > 0 && (
            <div className="card sv-table">
              {/* biome-ignore lint/a11y/useSemanticElements: Spreadsheet grid with roving cell focus. */}
              <table
                role="grid"
                className="sv-grid sv-moves"
                aria-label="Savings records"
                aria-describedby={ids.status}
              >
                <thead>
                  <tr>
                    {MOVE_COLUMNS.map((c, i) => (
                      <th key={c} scope="col" className={i === 4 ? "num" : ""}>
                        {i === 6 ? <span className="sv-sr-only">{c}</span> : c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {moveRows.map(moveRowView)}
                  {moveRows.length === 0 && (
                    <tr>
                      <td colSpan={7} className="muted">
                        No moves yet. Use Move saved money to reassign or transfer savings.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      <div id={ids.status} className="card sv-bar" aria-live="polite">
        {!sidebar && (notice || dirtyPending) ? pendingActions : null}
      </div>
      {sidebar && (
        <Dialog title={detailsTitle()} onClose={closeDetails} className="sv-dlg">
          <fieldset className="dlg-b sv-form" disabled={p.busy}>
            {details()}
          </fieldset>
          <div className="dlg-f">
            {pendingActions}
            {!dirtyPending && (
              <button type="button" className="btn" onClick={closeDetails}>
                Done
              </button>
            )}
          </div>
        </Dialog>
      )}
      <dialog
        ref={dialog}
        className="dlg"
        aria-labelledby={ids.keys}
        onClose={() => setHelp(false)}
      >
        <div className="dlg-h">
          <h2 id={ids.keys}>Keyboard shortcuts</h2>
          <button
            type="button"
            className="icon-btn"
            aria-label="Close"
            onClick={() => setHelp(false)}
          >
            <Icon name="x" />
          </button>
        </div>
        <dl className="dlg-b sv-keys">
          {SHORTCUTS.map(([key, label]) => (
            <div key={key}>
              <dt>
                <kbd className="kbd">{key}</kbd>
              </dt>
              <dd>{label}</dd>
            </div>
          ))}
        </dl>
      </dialog>
    </section>
  );
}

function DetailsButton({ name, onClick }: { name: string; onClick: () => void }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      className="icon-btn sv-details-btn"
      aria-label={`Details for ${name}`}
      onClick={onClick}
    >
      <Icon name="right" />
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
  account,
  draft,
  onEdit,
  onAddGoal,
  lifecycleControl,
}: {
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
      <dl className="sv-facts">
        <Fact label="Remaining saved" value={formatMoney(account.balance)} />
        <Fact label="Status" value={account.active ? "Active" : "Archived"} />
      </dl>
      {account.active && (
        <fieldset>
          <legend>Opening setup</legend>
          <Field label="Account name">
            <input
              required
              maxLength={120}
              value={d.name}
              onChange={(e) => set({ name: e.target.value })}
            />
          </Field>
          <div className="two">
            <Field label="Opening amount (USD)">
              <input
                inputMode="decimal"
                value={d.amount}
                onChange={(e) => set({ amount: e.target.value })}
              />
            </Field>
            <Field label="Opening date">
              <input
                type="date"
                required
                value={d.date}
                onChange={(e) => set({ date: e.target.value })}
              />
            </Field>
          </div>
          {ordinary.map((goal) => (
            <Field key={goal.uuid} label={`${goal.name} opening`}>
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
            </Field>
          ))}
          <Remainder value={remainder} />
        </fieldset>
      )}
      {account.active && (
        <button type="button" className="btn sv-start" onClick={onAddGoal}>
          <Icon name="plus" />
          Add goal
        </button>
      )}
      {lifecycleControl}
    </>
  );
}

function Remainder({ value }: { value: number | null }) {
  return (
    <output className={value !== null && value < 0 ? "sv-remainder bad" : "sv-remainder"}>
      Unallocated opening {value === null ? "—" : money(value)}
    </output>
  );
}

function KindAndTarget({
  kind,
  target,
  onKind,
  onTarget,
}: {
  kind: Goal["kind"];
  target: string;
  onKind: (kind: Goal["kind"]) => void;
  onTarget: (target: string) => void;
}) {
  return (
    <div className="two">
      <Field label="Goal type">
        <select value={kind} onChange={(e) => onKind(e.target.value as Goal["kind"])}>
          <option value="finite">Finite, with a target</option>
          <option value="ongoing">Ongoing</option>
        </select>
      </Field>
      <Field label={kind === "finite" ? "Target (required)" : "Target (optional)"}>
        <input
          inputMode="decimal"
          placeholder="0.00"
          value={target}
          onChange={(e) => onTarget(e.target.value)}
        />
      </Field>
    </div>
  );
}

function GoalDetails({
  account,
  goal,
  draft,
  onEdit,
  lifecycleControl,
}: {
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
      <dl className="sv-facts">
        <Fact label="Account" value={account.name} />
        <Fact label="Type" value={goal.role === "unallocated" ? "Unallocated" : KIND[goal.kind]} />
        <Fact label="Target" value={goal.target ? formatMoney(goal.target) : "—"} />
        <Fact label="Opening" value={formatMoney(goal.opening_amount)} />
        <Fact label="Remaining saved" value={formatMoney(goal.remaining_saved)} />
        <Fact label="Contributions" value={formatMoney(goal.contribution_progress)} />
        <Fact label="Status" value={goalStatus(account, goal) || "Active"} />
      </dl>
      {goal.role === "unallocated" && <p className="note">Protected goal.</p>}
      {editable && (
        <fieldset>
          <legend>Goal</legend>
          <Field label="Goal name">
            <input
              required
              maxLength={120}
              value={d.name}
              onChange={(e) => set({ name: e.target.value })}
            />
          </Field>
          <KindAndTarget
            kind={d.goalKind}
            target={d.target}
            onKind={(goalKind) => set({ goalKind })}
            onTarget={(target) => set({ target })}
          />
          <label className="sv-check">
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

function NewGoal({ draft, onChange }: { draft: NewGoalEdit; onChange: (draft: Draft) => void }) {
  const set = (patch: Partial<NewGoalEdit>) => onChange({ ...draft, ...patch });
  return (
    <>
      <Field label="Goal name">
        <input
          required
          maxLength={120}
          placeholder="New laptop"
          value={draft.name}
          onChange={(e) => set({ name: e.target.value })}
        />
      </Field>
      <KindAndTarget
        kind={draft.goalKind}
        target={draft.target}
        onKind={(goalKind) => set({ goalKind })}
        onTarget={(target) => set({ target })}
      />
      <p className="note">
        A new goal starts at $0.00. Move money into it from Unallocated once it is saved.
      </p>
    </>
  );
}

function NewAccount({
  draft,
  onChange,
}: {
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
      <Field label="Account name">
        <input
          required
          maxLength={120}
          placeholder="Rainy day savings"
          value={draft.name}
          onChange={(e) => set({ name: e.target.value })}
        />
      </Field>
      <div className="two">
        <Field label="Holds today (USD)">
          <input
            inputMode="decimal"
            value={draft.amount}
            onChange={(e) => set({ amount: e.target.value })}
          />
        </Field>
        <Field label="As of">
          <input
            type="date"
            required
            value={draft.date}
            onChange={(e) => set({ date: e.target.value })}
          />
        </Field>
      </div>
      <p className="note">
        An opening amount is not new saving. What no goal holds starts as unallocated money.
      </p>
      {draft.goals.map((goal, index) => (
        <fieldset key={goal.key}>
          <legend>Opening goal {index + 1}</legend>
          <Field label="Goal name">
            <input
              required
              maxLength={120}
              value={goal.name}
              onChange={(e) => setGoal(index, { name: e.target.value })}
            />
          </Field>
          <KindAndTarget
            kind={goal.goalKind}
            target={goal.target}
            onKind={(goalKind) => setGoal(index, { goalKind })}
            onTarget={(target) => setGoal(index, { target })}
          />
          <Field label="Opening designation">
            <input
              inputMode="decimal"
              value={goal.amount}
              onChange={(e) => setGoal(index, { amount: e.target.value })}
            />
          </Field>
          <button
            type="button"
            className="btn sm quiet danger sv-start"
            onClick={() => set({ goals: draft.goals.filter((_, i) => i !== index) })}
          >
            Remove goal
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        className="btn sv-start"
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
        <Icon name="plus" />
        Add opening goal
      </button>
      <Remainder value={remainder} />
    </>
  );
}
