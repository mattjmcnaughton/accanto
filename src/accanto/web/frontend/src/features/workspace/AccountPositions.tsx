import { useState } from "react";
import { type Destination, fundingLabel, id, money, saveBalance, today, validDate } from "./domain";
import { MoneyField, Notice, type ViewProps } from "./ui";
export function AccountPositions({
  state,
  update,
  openEntry,
}: Pick<ViewProps, "state" | "update" | "openEntry">) {
  const [kind, setKind] = useState("debt");
  const [name, setName] = useState("");
  const [date, setDate] = useState(today(state.timeZone));
  const [amount, setAmount] = useState(0);
  const [selected, setSelected] = useState("");
  const [editing, setEditing] = useState("");
  const [error, setError] = useState("");
  const rows = kind === "debt" ? (state.debts ?? []) : state.investments;
  const run = (fn: () => typeof state) => {
    try {
      if (update(fn(), "Account position saved")) setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <section className="surface editor-section">
      <h2>Investment and loan opening positions</h2>
      <p>
        Balances are observations. Contributions and loan payments do not calculate market value or
        principal owed.
      </p>
      {error && <Notice error>{error}</Notice>}
      <label className="field">
        <span>Account type</span>
        <select
          value={kind}
          onChange={(e) => {
            setKind(e.target.value);
            setSelected("");
            setEditing("");
          }}
        >
          <option value="debt">Loan</option>
          <option value="investment">Investment</option>
        </select>
      </label>
      <label className="field">
        <span>Position account</span>
        <select
          value={selected}
          onChange={(e) => {
            setSelected(e.target.value);
            setEditing("");
          }}
        >
          <option value="">New account</option>
          {rows.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
              {a.active ? "" : " (archived)"}
            </option>
          ))}
        </select>
      </label>
      {!selected && (
        <label className="field">
          <span>Position account name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
      )}
      <label className="field">
        <span>Position date</span>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <MoneyField label="Observed amount" value={amount} onChange={(n) => setAmount(n ?? 0)} />
      <button
        type="button"
        className="button primary"
        onClick={() =>
          run(() => {
            if (!validDate(date) || amount < 0) throw new Error("Enter a valid date and amount.");
            const account = rows.find((a) => a.id === selected);
            if (account)
              return saveBalance(state, {
                id: editing || id(),
                name: account.name,
                date,
                amount,
                ...(kind === "debt" ? { debtId: account.id } : { investmentId: account.id }),
              });
            if (!name.trim()) throw new Error("Enter an account name.");
            const created: Destination = {
              id: id(),
              name: name.trim(),
              active: true,
              target: null,
              openingDate: date,
              openingAmount: amount,
            };
            return {
              ...state,
              [kind === "debt" ? "debts" : "investments"]: [...rows, created],
              balances: [
                ...state.balances,
                {
                  id: id(),
                  name: created.name,
                  date,
                  amount,
                  opening: true,
                  ...(kind === "debt" ? { debtId: created.id } : { investmentId: created.id }),
                },
              ],
            };
          })
        }
      >
        {editing
          ? "Save observation correction"
          : selected
            ? "Record observation"
            : "Create account with opening"}
      </button>
      {kind === "debt" &&
        rows.map((a) => {
          const latest = state.balances
            .filter((b) => !b.deleted && b.debtId === a.id)
            .sort((x, y) => y.date.localeCompare(x.date))[0];
          return (
            <div key={a.id}>
              <div className="read-line">
                <span>
                  {a.name} ·{" "}
                  {latest
                    ? `${money(latest.amount)} owed as of ${latest.date}`
                    : "Unknown amount owed"}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    run(() => {
                      if (a.active && latest?.amount !== 0)
                        throw new Error(
                          "Record a zero amount owed before archiving. Payments alone are insufficient.",
                        );
                      return {
                        ...state,
                        debts: state.debts?.map((d) =>
                          d.id === a.id ? { ...d, active: !d.active } : d,
                        ),
                      };
                    })
                  }
                >
                  {a.active ? "Archive loan" : "Reopen loan"}
                </button>
              </div>
              <details>
                <summary>Payment history · {a.name}</summary>
                {state.entries.filter((e) => !e.deleted && e.debtId === a.id).length === 0 && (
                  <p>No payments recorded. Observations do not create payments.</p>
                )}
                {state.entries
                  .filter((e) => !e.deleted && e.debtId === a.id)
                  .map((entry) => (
                    <button
                      type="button"
                      className="read-line"
                      key={entry.id}
                      onClick={() => openEntry(entry)}
                    >
                      <span>
                        {entry.date} · {entry.note || "Loan payment"}
                        <small>{fundingLabel(state, entry)}</small>
                      </span>
                      <strong>{money(entry.amount)}</strong>
                    </button>
                  ))}
              </details>
            </div>
          );
        })}
      {state.balances
        .filter((b) => !b.deleted && b.debtId)
        .map((b) => (
          <div className="read-line" key={b.id}>
            <span>
              {b.name} · {b.date} · {money(b.amount)} {b.opening ? "(opening)" : ""}
            </span>
            {!b.opening && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setSelected(b.debtId ?? "");
                    setDate(b.date);
                    setAmount(b.amount);
                    setKind("debt");
                    setEditing(b.id);
                  }}
                >
                  Edit observation
                </button>
                <button
                  type="button"
                  onClick={() => run(() => saveBalance(state, { ...b, deleted: true }))}
                >
                  Delete observation
                </button>
              </>
            )}
          </div>
        ))}
    </section>
  );
}
