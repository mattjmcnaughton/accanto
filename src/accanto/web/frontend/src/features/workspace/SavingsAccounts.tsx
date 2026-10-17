import { useState } from "react";
import {
  type OpeningDesignation,
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
  const [openingDate, setOpeningDate] = useState(today(state.timeZone));
  const [openingAmount, setOpeningAmount] = useState(0);
  const [designations, setDesignations] = useState<(OpeningDesignation & { id: string })[]>([]);
  const [editing, setEditing] = useState<SavingsMovement | null>(null);
  const [date, setDate] = useState(today(state.timeZone));
  const [amount, setAmount] = useState(0);
  const [error, setError] = useState("");
  const [kind, setKind] = useState<SavingsMovement["kind"]>("reassignment");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const run = (f: () => typeof state) => {
    try {
      if (update(f(), "Savings saved")) {
        setError("");
        return true;
      }
    } catch (e) {
      setError((e as Error).message);
    }
    return false;
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
          <input type="date" value={openingDate} onChange={(e) => setOpeningDate(e.target.value)} />
        </label>
        <MoneyField
          label="Opening amount"
          value={openingAmount}
          onChange={(n) => setOpeningAmount(n ?? 0)}
        />
        <p>
          Designate opening money to goals now, or leave it in Unallocated. These starting positions
          create no contributions or movements.
        </p>
        {designations.map((row, index) => {
          const patch = (fields: Partial<OpeningDesignation>) =>
            setDesignations(designations.map((r) => (r.id === row.id ? { ...r, ...fields } : r)));
          return (
            <fieldset className="editor-section" key={row.id}>
              <legend>Opening goal {index + 1}</legend>
              <label className="field">
                <span>Opening goal name {index + 1}</span>
                <input value={row.name} onChange={(e) => patch({ name: e.target.value })} />
              </label>
              <label className="field">
                <span>Opening goal purpose {index + 1}</span>
                <select
                  value={row.purpose}
                  onChange={(e) =>
                    patch({ purpose: e.target.value as OpeningDesignation["purpose"] })
                  }
                >
                  <option value="finite">Finite</option>
                  <option value="ongoing">Ongoing</option>
                </select>
              </label>
              <MoneyField
                label={`Opening designation ${index + 1}`}
                value={row.amount}
                onChange={(n) => patch({ amount: n ?? 0 })}
              />
              <MoneyField
                label={`Opening goal target ${index + 1}`}
                value={row.target}
                onChange={(n) => patch({ target: n ?? 0 })}
              />
              <button
                type="button"
                onClick={() => setDesignations(designations.filter((r) => r.id !== row.id))}
              >
                Remove opening goal {index + 1}
              </button>
            </fieldset>
          );
        })}
        <button
          type="button"
          onClick={() =>
            setDesignations([
              ...designations,
              { id: id(), name: "", amount: 0, target: 0, purpose: "finite" },
            ])
          }
        >
          Designate opening savings to a goal
        </button>
        <p>
          Opening Unallocated savings:{" "}
          {money(openingAmount - designations.reduce((sum, row) => sum + row.amount, 0))}
        </p>
        <button
          type="button"
          className="button primary"
          onClick={() => {
            if (
              run(() => createSavingsAccount(state, name, openingDate, openingAmount, designations))
            ) {
              setName("");
              setOpeningAmount(0);
              setDesignations([]);
            }
          }}
        >
          Open account
        </button>
      </details>
      <details open={editing ? true : undefined}>
        <summary>Transfer, reassign or reconcile savings</summary>
        {editing && (
          <p>Correcting a recorded movement. Its original same-day order is preserved.</p>
        )}
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
                    {state.accounts?.find((a) => a.id === g.accountId)?.name} · {g.name} ·{" "}
                    {money(goalSavings(state, g.id).remaining)}
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
              .filter((g) => g.accountId && (g.active || g.id === editing?.to))
              .map((g) => (
                <option key={g.id} value={g.id}>
                  {state.accounts?.find((a) => a.id === g.accountId)?.name} · {g.name}
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
          onClick={() => {
            if (
              run(() =>
                saveMovement(state, {
                  id: editing?.id ?? id(),
                  date,
                  order: editing?.order ?? nextOrder(state),
                  kind,
                  from: kind === "reconciliation" ? "" : from,
                  to,
                  amount,
                }),
              )
            ) {
              setEditing(null);
              setAmount(0);
            }
          }}
        >
          {editing ? "Save movement correction" : "Record savings movement"}
        </button>
        {editing && (
          <button
            type="button"
            onClick={() => {
              setEditing(null);
              setAmount(0);
              setFrom("");
              setTo("");
            }}
          >
            Cancel movement correction
          </button>
        )}
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
              onClick={() => {
                setEditing(m);
                setKind(m.kind);
                setDate(m.date);
                setAmount(m.amount);
                setFrom(m.from);
                setTo(m.to);
                setError("");
              }}
            >
              Edit movement
            </button>
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
