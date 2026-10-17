import { useState } from "react";
import { savings, type Goal, type OpeningGoal, type SavingsAccount } from "../../lib/savings";
import { LoadMessage, MoneyInput, type ScreenProps, useLoad } from "../workspace/shared";

const blankGoal = (): OpeningGoal => ({ name: "", kind: "finite", target: "", opening_amount: "0.00" });
const dollars = (amount: string) => `$${amount}`;

export function Savings(p: ScreenProps) {
  const [reload, setReload] = useState(0);
  const state = useLoad(() => savings.list(p.entity.id), [p.entity.id, p.refresh, reload]);
  const [selected, setSelected] = useState<SavingsAccount | null>(null);
  const [mode, setMode] = useState<"create" | "correct" | "new-goal" | "edit-goal" | null>(null);
  const [name, setName] = useState("");
  const [date, setDate] = useState(p.entity.today);
  const [amount, setAmount] = useState("0.00");
  const [goals, setGoals] = useState<OpeningGoal[]>([]);
  const [goal, setGoal] = useState<Goal | null>(null);
  const [kind, setKind] = useState<"finite" | "ongoing">("finite");
  const [target, setTarget] = useState("");
  const [active, setActive] = useState(true);
  const [error, setError] = useState("");
  const rows = state.kind === "ready" ? state.data : [];
  const current = rows.find((row) => row.uuid === selected?.uuid) ?? selected;
  function change() { p.dirty(true); setError(""); }
  function show(account: SavingsAccount, nextMode: typeof mode) {
    if (!p.guard()) return;
    setSelected(account); setMode(nextMode); setName(account.name); setDate(account.opening_date);
    setAmount(account.opening_amount);
    setGoals(account.goals.filter((g) => g.role === "ordinary").map((g) => ({
      name: g.name, kind: g.kind, target: g.target, opening_amount: g.opening_amount,
    })));
    setError(""); p.dirty(false);
  }
  function saved(account: SavingsAccount) {
    setSelected(account); setMode(null); setGoal(null); setError(""); p.dirty(false);
    setReload((value) => value + 1);
  }
  function validateOpening(): boolean {
    const number = Number(amount);
    const sum = goals.reduce((total, g) => total + Number(g.opening_amount), 0);
    if (!Number.isFinite(number) || goals.some((g) => !Number.isFinite(Number(g.opening_amount))) || sum > number) {
      setError("Opening designations must fit within the account opening amount."); return false;
    }
    return true;
  }
  if (p.concealed) return null;
  return <section aria-labelledby="savings-title">
    <div className="section-heading"><div><h2 id="savings-title">Savings accounts and goals</h2>
      <p>Opening money is designated once. Contributions and progress begin with recorded activity.</p></div>
      <button type="button" disabled={p.busy} onClick={() => {
        if (!p.guard()) return; setSelected(null); setMode("create"); setName(""); setDate(p.entity.today);
        setAmount("0.00"); setGoals([]); setError(""); p.dirty(false);
      }}>New savings account</button></div>
    <LoadMessage state={state} retry={() => setReload((value) => value + 1)} />
    {state.kind === "empty" && <p>No savings accounts yet.</p>}
    {rows.map((account) => <article key={account.uuid} className="workspace-card">
      <h3>{account.name}</h3><p>Opening {dollars(account.opening_amount)} on {account.opening_date} · Current saved {dollars(account.balance)}</p>
      <ul>{account.goals.map((item) => <li key={item.uuid}>
        <strong>{item.name}</strong> · {item.role === "unallocated" ? "Unallocated" : item.kind === "finite" ? `Target ${dollars(item.target ?? "0.00")}` : item.target ? `Ongoing target ${dollars(item.target)}` : "Ongoing, no target"}
        <span> · Opening {dollars(item.opening_amount)} · Remaining saved {dollars(item.remaining_saved)} · Contribution progress {dollars(item.contribution_progress)}</span>
        {item.role === "ordinary" && <button type="button" disabled={p.busy} onClick={() => {
          show(account, "edit-goal"); setGoal(item); setName(item.name); setKind(item.kind); setTarget(item.target ?? ""); setActive(item.active);
        }}>Edit {item.name}</button>}
      </li>)}</ul>
      <button type="button" disabled={p.busy} onClick={() => show(account, "correct")}>Correct setup</button>
      <button type="button" disabled={p.busy} onClick={() => { show(account, "new-goal"); setName(""); setKind("finite"); setTarget(""); setActive(true); }}>New goal</button>
    </article>)}
    {mode && <form onSubmit={(event) => {
      event.preventDefault(); if (p.busy) return;
      if (mode === "create") {
        if (!validateOpening()) return;
        p.save(savings.create(p.entity.id, { name, opening_date: date, opening_amount: amount,
          goals: goals.map((g) => ({ ...g, target: g.target || null })) }), saved);
      } else if (mode === "correct" && current) {
        if (!validateOpening()) return;
        const ordinary = current.goals.filter((g) => g.role === "ordinary");
        p.save(savings.edit(p.entity.id, current.uuid, { name, opening_date: date, opening_amount: amount,
          expected_revision: current.revision,
          designations: ordinary.map((g, i) => ({ goal_id: g.uuid, opening_amount: goals[i]?.opening_amount ?? g.opening_amount })) }), saved);
      } else if (mode === "new-goal" && current) {
        p.save(savings.addGoal(p.entity.id, current.uuid, { name, kind, target: target || null,
          expected_account_revision: current.revision }), saved);
      } else if (mode === "edit-goal" && current && goal) {
        p.save(savings.editGoal(p.entity.id, current.uuid, goal.uuid, { name, kind, target: target || null,
          active, expected_revision: goal.revision }), saved);
      }
    }}>
      <h3>{mode === "create" ? "New savings account" : mode === "correct" ? "Correct opening setup" : mode === "new-goal" ? "New saving goal" : "Edit saving goal"}</h3>
      <label>Name<input required maxLength={120} value={name} onChange={(e) => { setName(e.target.value); change(); }} /></label>
      {(mode === "create" || mode === "correct") && <>
        <label>Opening date<input type="date" required value={date} onChange={(e) => { setDate(e.target.value); change(); }} /></label>
        <MoneyInput label="Opening amount" value={amount} onChange={(value) => { setAmount(value); change(); }} />
        <p>Designate opening amounts to goals. The remainder belongs to Unallocated; this is not a contribution.</p>
        {goals.map((item, index) => <fieldset key={index}><legend>{mode === "create" ? `Opening goal ${index + 1}` : item.name}</legend>
          {mode === "create" && <><label>Goal name<input required value={item.name} onChange={(e) => { setGoals(goals.map((g, i) => i === index ? { ...g, name: e.target.value } : g)); change(); }} /></label>
          <label>Goal type<select value={item.kind} onChange={(e) => { setGoals(goals.map((g, i) => i === index ? { ...g, kind: e.target.value as OpeningGoal["kind"] } : g)); change(); }}><option value="finite">Finite</option><option value="ongoing">Ongoing</option></select></label>
          <label>Target {item.kind === "finite" ? "(required)" : "(optional)"}<input required={item.kind === "finite"} inputMode="decimal" pattern="[0-9]+([.][0-9]{1,2})?" value={item.target ?? ""} onChange={(e) => { setGoals(goals.map((g, i) => i === index ? { ...g, target: e.target.value } : g)); change(); }} /></label></>}
          <MoneyInput label="Opening designation" value={item.opening_amount} onChange={(value) => { setGoals(goals.map((g, i) => i === index ? { ...g, opening_amount: value } : g)); change(); }} />
          {mode === "create" && <button type="button" onClick={() => { setGoals(goals.filter((_, i) => i !== index)); change(); }}>Remove goal</button>}
        </fieldset>)}
        {mode === "create" && <button type="button" onClick={() => { setGoals([...goals, blankGoal()]); change(); }}>Add opening goal</button>}
      </>}
      {(mode === "new-goal" || mode === "edit-goal") && <>
        <label>Goal type<select value={kind} onChange={(e) => { setKind(e.target.value as typeof kind); change(); }}><option value="finite">Finite</option><option value="ongoing">Ongoing</option></select></label>
        <label>{kind === "finite" ? "Positive target" : "Optional target"}<input required={kind === "finite"} inputMode="decimal" pattern="[0-9]+([.][0-9]{1,2})?" value={target} onChange={(e) => { setTarget(e.target.value); change(); }} /></label>
        {mode === "edit-goal" && <label><input type="checkbox" checked={active} onChange={(e) => { setActive(e.target.checked); change(); }} />Active for new contributions</label>}
      </>}
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={p.busy}>Save</button>
      <button type="button" onClick={() => { if (p.guard()) { setMode(null); p.dirty(false); } }}>Cancel</button>
    </form>}
  </section>;
}
