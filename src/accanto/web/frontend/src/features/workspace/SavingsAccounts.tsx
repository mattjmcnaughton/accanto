import { useState } from "react";
import {
  type SavingsMovement,
  archiveAccount,
  createSavingsAccount,
  goalSavings,
  id,
  money,
  nextOrder,
  saveMovement,
  today,
} from "./domain";
import { MoneyField, Notice, type ViewProps } from "./ui";
export function SavingsAccounts({ state, update }: Omit<ViewProps, "openEntry">) {
  const [name, setName] = useState("");
  const [date, setDate] = useState(today());
  const [amount, setAmount] = useState(0);
  const [error, setError] = useState("");
  const [kind, setKind] = useState<SavingsMovement["kind"]>("reassignment");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const run = (f: () => typeof state) => {
    try {
      if (update(f(), "Savings saved")) setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <section className="surface editor-section">
      <h2>Savings accounts</h2>
      {error && <Notice error>{error}</Notice>}
      {state.accounts?.map((a) => (
        <div className="read-line" key={a.id}>
          <span>
            {a.name} · opening {money(a.opening)} on {a.date}
            <small>{a.active ? "Active" : "Archived"}</small>
          </span>
          <strong>
            {money(
              state.goals
                .filter((g) => g.accountId === a.id)
                .reduce((s, g) => s + goalSavings(state, g.id).remaining, 0),
            )}
          </strong>
          <button type="button" onClick={() => run(() => archiveAccount(state, a.id))}>
            {a.active ? "Archive account" : "Reopen account"}
          </button>
        </div>
      ))}
      <details>
        <summary>Open a savings account</summary>
        <label className="field">
          <span>Account name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span>Opening date</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <MoneyField label="Opening amount" value={amount} onChange={(n) => setAmount(n ?? 0)} />
        <p>
          Opening money goes to this account’s Unallocated goal. Reassign it explicitly to other
          goals. This is not a contribution.
        </p>
        <button
          type="button"
          className="button primary"
          onClick={() => run(() => createSavingsAccount(state, name, date, amount))}
        >
          Open account
        </button>
      </details>
      <details>
        <summary>Transfer, reassign or reconcile savings</summary>
        <label className="field">
          <span>Operation</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="reassignment">Reassign within account</option>
            <option value="transfer">Transfer between accounts</option>
            <option value="reconciliation">Reconcile one goal</option>
          </select>
        </label>
        {kind !== "reconciliation" && (
          <label className="field">
            <span>From goal</span>
            <select value={from} onChange={(e) => setFrom(e.target.value)}>
              <option value="">Choose goal</option>
              {state.goals
                .filter((g) => g.accountId)
                .map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name} · {money(goalSavings(state, g.id).remaining)}
                  </option>
                ))}
            </select>
          </label>
        )}
        <label className="field">
          <span>{kind === "reconciliation" ? "Reconcile goal" : "To goal"}</span>
          <select value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">Choose goal</option>
            {state.goals
              .filter((g) => g.accountId && g.active)
              .map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
          </select>
        </label>
        <label className="field">
          <span>Movement date</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <MoneyField
          label={kind === "reconciliation" ? "Signed balance correction" : "Movement amount"}
          value={amount}
          signed={kind === "reconciliation"}
          onChange={(n) => setAmount(n ?? 0)}
        />
        <p>
          Reconciliation changes only the selected goal. Transfers and reassignments conserve total
          savings. None create income or new saving.
        </p>
        <button
          type="button"
          className="button primary"
          onClick={() =>
            run(() =>
              saveMovement(state, {
                id: id(),
                date,
                order: nextOrder(state),
                kind,
                from: kind === "reconciliation" ? "" : from,
                to,
                amount,
              }),
            )
          }
        >
          Record savings movement
        </button>
      </details>
      {(state.movements ?? [])
        .filter((m) => !m.deleted)
        .map((m) => (
          <div className="read-line" key={m.id}>
            <span>
              {m.date} · {m.kind} · {state.goals.find((g) => g.id === m.from)?.name} →{" "}
              {state.goals.find((g) => g.id === m.to)?.name}
            </span>
            <strong>{money(m.amount)}</strong>
            <button
              type="button"
              onClick={() => run(() => saveMovement(state, { ...m, deleted: true }))}
            >
              Delete movement
            </button>
          </div>
        ))}
    </section>
  );
}
