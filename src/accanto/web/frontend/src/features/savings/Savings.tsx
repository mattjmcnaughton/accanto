import { useState } from "react";
import {
  type Goal,
  type MovementBody,
  type OpeningGoal,
  type SavingsAccount,
  type SavingsMovement,
  savings,
} from "../../lib/savings";
import { LoadMessage, MoneyInput, type ScreenProps, useLoad } from "../workspace/shared";

type FormGoal = OpeningGoal & { key: string };
const blankGoal = (): FormGoal => ({
  key: crypto.randomUUID(),
  name: "",
  kind: "finite",
  target: "",
  opening_amount: "0.00",
});
const dollars = (amount: string) => `$${amount}`;

export function Savings(p: ScreenProps) {
  const [reload, setReload] = useState(0);
  const state = useLoad(() => savings.list(p.entity.id), [p.entity.id, p.refresh, reload]);
  const [selected, setSelected] = useState<SavingsAccount | null>(null);
  const [mode, setMode] = useState<"create" | "correct" | "new-goal" | "edit-goal" | null>(null);
  const [name, setName] = useState("");
  const [date, setDate] = useState(p.entity.today);
  const [amount, setAmount] = useState("0.00");
  const [goals, setGoals] = useState<FormGoal[]>([]);
  const [goal, setGoal] = useState<Goal | null>(null);
  const [kind, setKind] = useState<"finite" | "ongoing">("finite");
  const [target, setTarget] = useState("");
  const [active, setActive] = useState(true);
  const [error, setError] = useState("");
  const rows = state.kind === "ready" ? state.data : [];
  const current = rows.find((row) => row.uuid === selected?.uuid) ?? selected;
  function change() {
    p.dirty(true);
    setError("");
  }
  function show(account: SavingsAccount, nextMode: typeof mode) {
    if (!p.guard()) return;
    setSelected(account);
    setMode(nextMode);
    setName(account.name);
    setDate(account.opening_date);
    setAmount(account.opening_amount);
    setGoals(
      account.goals
        .filter((g) => g.role === "ordinary")
        .map((g) => ({
          key: g.uuid,
          name: g.name,
          kind: g.kind,
          target: g.target,
          opening_amount: g.opening_amount,
        })),
    );
    setError("");
    p.dirty(false);
  }
  function saved(account: SavingsAccount) {
    setSelected(account);
    setMode(null);
    setGoal(null);
    setError("");
    p.dirty(false);
    setReload((value) => value + 1);
  }
  function validateOpening(): boolean {
    const number = Number(amount);
    const sum = goals.reduce((total, g) => total + Number(g.opening_amount), 0);
    if (
      !Number.isFinite(number) ||
      goals.some((g) => !Number.isFinite(Number(g.opening_amount))) ||
      sum > number
    ) {
      setError("Opening designations must fit within the account opening amount.");
      return false;
    }
    return true;
  }
  if (p.concealed) return null;
  return (
    <section aria-labelledby="savings-title">
      <div className="section-heading">
        <div>
          <h2 id="savings-title">Savings accounts and goals</h2>
          <p>
            Opening money is designated once. Contributions and progress begin with recorded
            activity.
          </p>
        </div>
        <button
          type="button"
          disabled={p.busy}
          onClick={() => {
            if (!p.guard()) return;
            setSelected(null);
            setMode("create");
            setName("");
            setDate(p.entity.today);
            setAmount("0.00");
            setGoals([]);
            setError("");
            p.dirty(false);
          }}
        >
          New savings account
        </button>
      </div>
      <LoadMessage state={state} retry={() => setReload((value) => value + 1)} />
      {state.kind === "empty" && <p>No savings accounts yet.</p>}
      {rows.map((account) => (
        <article key={account.uuid} className="workspace-card">
          <h3>{account.name}</h3>
          <p>
            Opening {dollars(account.opening_amount)} on {account.opening_date} · Current saved{" "}
            {dollars(account.balance)}
          </p>
          <ul>
            {account.goals.map((item) => (
              <li key={item.uuid}>
                <strong>{item.name}</strong> ·{" "}
                {item.role === "unallocated"
                  ? "Unallocated"
                  : item.kind === "finite"
                    ? `Target ${dollars(item.target ?? "0.00")}`
                    : item.target
                      ? `Ongoing target ${dollars(item.target)}`
                      : "Ongoing, no target"}
                <span>
                  {" "}
                  · Opening {dollars(item.opening_amount)} · Remaining saved{" "}
                  {dollars(item.remaining_saved)} · Contribution progress{" "}
                  {dollars(item.contribution_progress)}
                  {item.funded_status && ` · ${item.funded_status}`}
                </span>
                {item.role === "ordinary" && (
                  <button
                    type="button"
                    disabled={p.busy}
                    onClick={() => {
                      show(account, "edit-goal");
                      setGoal(item);
                      setName(item.name);
                      setKind(item.kind);
                      setTarget(item.target ?? "");
                      setActive(item.active);
                    }}
                  >
                    Edit {item.name}
                  </button>
                )}
              </li>
            ))}
          </ul>
          <button type="button" disabled={p.busy} onClick={() => show(account, "correct")}>
            Correct setup
          </button>
          <button
            type="button"
            disabled={p.busy}
            onClick={() => {
              show(account, "new-goal");
              setName("");
              setKind("finite");
              setTarget("");
              setActive(true);
            }}
          >
            New goal
          </button>
        </article>
      ))}
      <SavingsMovements {...p} accounts={rows} onSaved={() => setReload((value) => value + 1)} />
      {mode && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (p.busy) return;
            if (mode === "create") {
              if (!validateOpening()) return;
              p.save(
                savings.create(p.entity.id, {
                  name,
                  opening_date: date,
                  opening_amount: amount,
                  goals: goals.map((g) => ({
                    name: g.name,
                    kind: g.kind,
                    target: g.target || null,
                    opening_amount: g.opening_amount,
                  })),
                }),
                saved,
              );
            } else if (mode === "correct" && current) {
              if (!validateOpening()) return;
              const ordinary = current.goals.filter((g) => g.role === "ordinary");
              p.save(
                savings.edit(p.entity.id, current.uuid, {
                  name,
                  opening_date: date,
                  opening_amount: amount,
                  expected_revision: current.revision,
                  designations: ordinary.map((g, i) => ({
                    goal_id: g.uuid,
                    opening_amount: goals[i]?.opening_amount ?? g.opening_amount,
                  })),
                }),
                saved,
              );
            } else if (mode === "new-goal" && current) {
              p.save(
                savings.addGoal(p.entity.id, current.uuid, {
                  name,
                  kind,
                  target: target || null,
                  expected_account_revision: current.revision,
                }),
                saved,
              );
            } else if (mode === "edit-goal" && current && goal) {
              p.save(
                savings.editGoal(p.entity.id, current.uuid, goal.uuid, {
                  name,
                  kind,
                  target: target || null,
                  active,
                  expected_revision: goal.revision,
                }),
                saved,
              );
            }
          }}
        >
          <h3>
            {mode === "create"
              ? "New savings account"
              : mode === "correct"
                ? "Correct opening setup"
                : mode === "new-goal"
                  ? "New saving goal"
                  : "Edit saving goal"}
          </h3>
          <label>
            Name
            <input
              required
              maxLength={120}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                change();
              }}
            />
          </label>
          {(mode === "create" || mode === "correct") && (
            <>
              <label>
                Opening date
                <input
                  type="date"
                  required
                  value={date}
                  onChange={(e) => {
                    setDate(e.target.value);
                    change();
                  }}
                />
              </label>
              <MoneyInput
                label="Opening amount"
                value={amount}
                onChange={(value) => {
                  setAmount(value);
                  change();
                }}
              />
              <p>
                Designate opening amounts to goals. The remainder belongs to Unallocated; this is
                not a contribution.
              </p>
              {goals.map((item, index) => (
                <fieldset key={item.key}>
                  <legend>{mode === "create" ? `Opening goal ${index + 1}` : item.name}</legend>
                  {mode === "create" && (
                    <>
                      <label>
                        Goal name
                        <input
                          required
                          value={item.name}
                          onChange={(e) => {
                            setGoals(
                              goals.map((g, i) =>
                                i === index ? { ...g, name: e.target.value } : g,
                              ),
                            );
                            change();
                          }}
                        />
                      </label>
                      <label>
                        Goal type
                        <select
                          value={item.kind}
                          onChange={(e) => {
                            setGoals(
                              goals.map((g, i) =>
                                i === index
                                  ? { ...g, kind: e.target.value as OpeningGoal["kind"] }
                                  : g,
                              ),
                            );
                            change();
                          }}
                        >
                          <option value="finite">Finite</option>
                          <option value="ongoing">Ongoing</option>
                        </select>
                      </label>
                      <label>
                        Target {item.kind === "finite" ? "(required)" : "(optional)"}
                        <input
                          required={item.kind === "finite"}
                          inputMode="decimal"
                          pattern="[0-9]+([.][0-9]{1,2})?"
                          value={item.target ?? ""}
                          onChange={(e) => {
                            setGoals(
                              goals.map((g, i) =>
                                i === index ? { ...g, target: e.target.value } : g,
                              ),
                            );
                            change();
                          }}
                        />
                      </label>
                    </>
                  )}
                  <MoneyInput
                    label="Opening designation"
                    value={item.opening_amount}
                    onChange={(value) => {
                      setGoals(
                        goals.map((g, i) => (i === index ? { ...g, opening_amount: value } : g)),
                      );
                      change();
                    }}
                  />
                  {mode === "create" && (
                    <button
                      type="button"
                      onClick={() => {
                        setGoals(goals.filter((_, i) => i !== index));
                        change();
                      }}
                    >
                      Remove goal
                    </button>
                  )}
                </fieldset>
              ))}
              {mode === "create" && (
                <button
                  type="button"
                  onClick={() => {
                    setGoals([...goals, blankGoal()]);
                    change();
                  }}
                >
                  Add opening goal
                </button>
              )}
            </>
          )}
          {(mode === "new-goal" || mode === "edit-goal") && (
            <>
              <label>
                Goal type
                <select
                  value={kind}
                  onChange={(e) => {
                    setKind(e.target.value as typeof kind);
                    change();
                  }}
                >
                  <option value="finite">Finite</option>
                  <option value="ongoing">Ongoing</option>
                </select>
              </label>
              <label>
                {kind === "finite" ? "Positive target" : "Optional target"}
                <input
                  required={kind === "finite"}
                  inputMode="decimal"
                  pattern="[0-9]+([.][0-9]{1,2})?"
                  value={target}
                  onChange={(e) => {
                    setTarget(e.target.value);
                    change();
                  }}
                />
              </label>
              {mode === "edit-goal" && (
                <label>
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={(e) => {
                      setActive(e.target.checked);
                      change();
                    }}
                  />
                  Active for new contributions
                </label>
              )}
            </>
          )}
          {error && <p role="alert">{error}</p>}
          <button type="submit" disabled={p.busy}>
            Save
          </button>
          <button
            type="button"
            onClick={() => {
              if (p.guard()) {
                setMode(null);
                p.dirty(false);
              }
            }}
          >
            Cancel
          </button>
        </form>
      )}
    </section>
  );
}

function SavingsMovements(p: ScreenProps & { accounts: SavingsAccount[]; onSaved: () => void }) {
  const [reload, setReload] = useState(0);
  const state = useLoad(() => savings.movements(p.entity.id), [p.entity.id, p.refresh, reload]);
  const rows = state.kind === "ready" ? state.data : [];
  const [editing, setEditing] = useState<SavingsMovement | null>(null);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<MovementBody["kind"]>("reassignment");
  const [date, setDate] = useState(p.entity.today);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [goal, setGoal] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const choices = p.accounts.flatMap((account) =>
    account.goals.map((item) => ({
      id: item.uuid,
      label: `${account.name} / ${item.name} (${dollars(item.remaining_saved)} saved)`,
      account: account.uuid,
      active: item.active && account.active,
    })),
  );
  const names = new Map(choices.map((choice) => [choice.id, choice.label]));
  const changed = () => {
    p.dirty(true);
    setError("");
  };
  const close = () => {
    setOpen(false);
    setEditing(null);
    setError("");
    p.dirty(false);
  };
  const done = () => {
    close();
    setReload((n) => n + 1);
    p.onSaved();
  };
  const begin = (row: SavingsMovement | null) => {
    if (!p.guard()) return;
    setEditing(row);
    setKind(row?.kind ?? "reassignment");
    setDate(row?.date ?? p.entity.today);
    setFrom(row?.from_goal_id ?? "");
    setTo(row?.to_goal_id ?? "");
    setGoal(row?.goal_id ?? "");
    setAmount(row?.kind === "reconciliation" ? "" : (row?.amount ?? ""));
    setNote(row?.note ?? "");
    setError("");
    setOpen(true);
    p.dirty(false);
  };
  return (
    <section aria-labelledby="savings-movements-title">
      <h3 id="savings-movements-title">Savings movements and reconciliation</h3>
      <p>Move existing savings between goals, or correct the recorded amount of one goal.</p>
      <button type="button" disabled={p.busy} onClick={() => begin(null)}>
        Record movement or reconciliation
      </button>
      <LoadMessage state={state} retry={() => setReload((n) => n + 1)} />
      {state.kind === "empty" && <p>No savings movements yet.</p>}
      {rows.length > 0 && (
        <ul>
          {rows.map((row) => (
            <li key={row.uuid}>
              {row.date} ·{" "}
              {row.kind === "reconciliation"
                ? `Reconcile ${names.get(row.goal_id ?? "") ?? "goal"} by ${dollars(row.amount)}`
                : `${row.kind === "transfer" ? "Transfer" : "Reassign"} ${dollars(row.amount)} from ${names.get(row.from_goal_id ?? "") ?? "goal"} to ${names.get(row.to_goal_id ?? "") ?? "goal"}`}
              {row.note && ` · ${row.note}`}
              <button type="button" disabled={p.busy} onClick={() => begin(row)}>
                Correct
              </button>
              <button
                type="button"
                disabled={p.busy}
                onClick={() => {
                  if (!p.guard()) return;
                  p.save(savings.deleteMovement(p.entity.id, row), done);
                }}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (p.busy) return;
            if (kind === "reconciliation" ? !goal : !from || !to || from === to) {
              setError("Choose valid, distinct savings goals.");
              return;
            }
            if (kind !== "reconciliation") {
              const source = choices.find((choice) => choice.id === from);
              const destination = choices.find((choice) => choice.id === to);
              if (
                !source ||
                !destination ||
                (kind === "transfer") !== (source.account !== destination.account)
              ) {
                setError(
                  kind === "transfer"
                    ? "Choose goals in different accounts."
                    : "Choose goals in one account.",
                );
                return;
              }
            }
            const body: MovementBody =
              kind === "reconciliation"
                ? { kind, date, goal_id: goal, known_amount: amount, note }
                : { kind, date, from_goal_id: from, to_goal_id: to, amount, note };
            if (editing)
              p.save(
                savings.correctMovement(p.entity.id, editing.uuid, {
                  ...body,
                  expected_revision: editing.revision,
                }),
                done,
              );
            else p.save(savings.move(p.entity.id, body), done);
          }}
        >
          <h4>{editing ? "Correct savings record" : "New savings record"}</h4>
          <label>
            Action
            <select
              value={kind}
              disabled={!!editing}
              onChange={(event) => {
                setKind(event.target.value as MovementBody["kind"]);
                changed();
              }}
            >
              <option value="reassignment">Reassign within account</option>
              <option value="transfer">Transfer between accounts</option>
              <option value="reconciliation">Reconcile one goal</option>
            </select>
          </label>
          <label>
            Financial date
            <input
              type="date"
              required
              value={date}
              onChange={(event) => {
                setDate(event.target.value);
                changed();
              }}
            />
          </label>
          {kind === "reconciliation" ? (
            <label>
              Goal
              <select
                required
                value={goal}
                onChange={(event) => {
                  setGoal(event.target.value);
                  changed();
                }}
              >
                <option value="">Choose goal</option>
                {choices
                  .filter((choice) => choice.active || choice.id === goal)
                  .map((choice) => (
                    <option key={choice.id} value={choice.id}>
                      {choice.label}
                    </option>
                  ))}
              </select>
            </label>
          ) : (
            <>
              <label>
                From goal
                <select
                  required
                  value={from}
                  onChange={(event) => {
                    setFrom(event.target.value);
                    changed();
                  }}
                >
                  <option value="">Choose source</option>
                  {choices
                    .filter((choice) => choice.active || choice.id === from)
                    .map((choice) => (
                      <option key={choice.id} value={choice.id}>
                        {choice.label}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                To goal
                <select
                  required
                  value={to}
                  onChange={(event) => {
                    setTo(event.target.value);
                    changed();
                  }}
                >
                  <option value="">Choose destination</option>
                  {choices
                    .filter((choice) => choice.active || choice.id === to)
                    .map((choice) => (
                      <option key={choice.id} value={choice.id}>
                        {choice.label}
                      </option>
                    ))}
                </select>
              </label>
            </>
          )}
          <MoneyInput
            label={kind === "reconciliation" ? "Known saved amount on this date" : "Amount to move"}
            value={amount}
            onChange={(value) => {
              setAmount(value);
              changed();
            }}
          />
          <label>
            Note
            <input
              maxLength={2000}
              value={note}
              onChange={(event) => {
                setNote(event.target.value);
                changed();
              }}
            />
          </label>
          {error && <p role="alert">{error}</p>}
          <button type="submit" disabled={p.busy}>
            Save
          </button>
          <button
            type="button"
            onClick={() => {
              if (p.guard()) close();
            }}
          >
            Cancel
          </button>
        </form>
      )}
    </section>
  );
}
