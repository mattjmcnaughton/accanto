import { useState } from "react";
import { type Loan, type Observation, type ObservationInput, balances } from "../../lib/balances";
import { destinations } from "../../lib/destinations";
import { LoadMessage, MoneyInput, type ScreenProps, dollars, useLoad } from "../workspace/shared";

export function Balances(p: ScreenProps) {
  const [reload, setReload] = useState(0);
  const [kind, setKind] = useState<"debt" | "investment">("debt");
  const loans = useLoad(() => balances.loans(p.entity.id), [p.entity.id, p.refresh, reload]);
  const investments = useLoad(
    () => destinations.list(p.entity.id, "investment"),
    [p.entity.id, p.refresh, reload],
  );
  const rows = useLoad(
    () => balances.list(p.entity.id, kind),
    [p.entity.id, p.refresh, reload, kind],
  );
  const [loanName, setLoanName] = useState("");
  const [loanOpening, setLoanOpening] = useState("");
  const [loanDate, setLoanDate] = useState(p.entity.today);
  const [form, setForm] = useState<ObservationInput | null>(null);
  const [selected, setSelected] = useState<Observation | null>(null);
  const accounts =
    kind === "debt"
      ? loans.kind === "ready"
        ? loans.data
        : []
      : investments.kind === "ready"
        ? investments.data
        : [];
  const name = (id: string | null) =>
    accounts.find((account) => account.uuid === id)?.name ?? "Unassigned";
  const open = (row: Observation | null) => {
    if (!p.guard()) return;
    setSelected(row);
    setForm(
      row
        ? {
            date: row.financial_date,
            amount: row.amount,
            account_id: row.account_id,
            expected_revision: row.revision,
          }
        : {
            date: p.entity.today,
            amount: "",
            account_id: kind === "debt" ? (accounts[0]?.uuid ?? null) : null,
          },
    );
  };
  const saved = () => {
    setForm(null);
    setSelected(null);
    p.dirty(false);
    setReload((value) => value + 1);
  };
  return (
    <section aria-labelledby="balances-title">
      <h2 id="balances-title">Loans and observed balances</h2>
      <p>
        Payments and contributions do not calculate balances. Each balance below is a dated
        observation.
      </p>
      <LoadMessage state={loans} retry={() => setReload((value) => value + 1)} />
      <LoadMessage state={investments} retry={() => setReload((value) => value + 1)} />
      <fieldset className="choice-row">
        <legend>Balance type</legend>
        <button
          type="button"
          aria-pressed={kind === "debt"}
          onClick={() => {
            if (p.guard()) {
              setKind("debt");
              setForm(null);
            }
          }}
        >
          Loans
        </button>
        <button
          type="button"
          aria-pressed={kind === "investment"}
          onClick={() => {
            if (p.guard()) {
              setKind("investment");
              setForm(null);
            }
          }}
        >
          Investments
        </button>
      </fieldset>
      {kind === "debt" && (
        <>
          <h3>Loan accounts</h3>
          {loans.kind === "empty" && <p>No loan accounts yet.</p>}
          {loans.kind === "ready" &&
            loans.data.map((loan: Loan) => (
              <article key={loan.uuid}>
                <h4>
                  {loan.name} {loan.active ? "" : "(archived)"}
                </h4>
                <p>
                  Opened {loan.opening.date} owing {dollars(loan.opening.amount)}. Latest observed
                  amount owed: {dollars(loan.latest.amount)} on {loan.latest.financial_date}.
                </p>
                {!loan.active && loan.draft_fixed_cost_lines.length > 0 && (
                  <p>Review draft fixed-cost allocations for this archived loan.</p>
                )}
                <button
                  type="button"
                  disabled={p.busy || (loan.active && loan.latest.amount !== "0.00")}
                  onClick={() =>
                    p.save(
                      balances.editLoan(p.entity.id, loan.uuid, {
                        name: loan.name,
                        active: !loan.active,
                        expected_revision: loan.revision,
                      }),
                      saved,
                    )
                  }
                >
                  {loan.active ? "Archive loan" : "Reopen loan"}
                </button>
              </article>
            ))}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              p.save(
                balances.createLoan(p.entity.id, {
                  name: loanName,
                  opening: { date: loanDate, amount: loanOpening },
                }),
                () => {
                  setLoanName("");
                  setLoanOpening("");
                  p.dirty(false);
                  setReload((value) => value + 1);
                },
              );
            }}
          >
            <h3>Add loan account</h3>
            <label>
              Name
              <input
                required
                maxLength={120}
                value={loanName}
                onChange={(event) => {
                  setLoanName(event.target.value);
                  p.dirty(true);
                }}
              />
            </label>
            <label>
              Opening date
              <input
                required
                type="date"
                value={loanDate}
                onChange={(event) => {
                  setLoanDate(event.target.value);
                  p.dirty(true);
                }}
              />
            </label>
            <MoneyInput
              label="Opening amount owed"
              value={loanOpening}
              onChange={(value) => {
                setLoanOpening(value);
                p.dirty(true);
              }}
            />
            <button type="submit" disabled={p.busy}>
              Add loan
            </button>
          </form>
        </>
      )}
      <h3>{kind === "debt" ? "Amount owed observations" : "Investment value observations"}</h3>
      <LoadMessage state={rows} retry={() => setReload((value) => value + 1)} />
      {rows.kind === "empty" && <p>No observations yet.</p>}
      {rows.kind === "ready" &&
        rows.data.map((row) => (
          <article key={row.uuid}>
            <p>
              {name(row.account_id)} · {row.financial_date} · {dollars(row.amount)}{" "}
              {row.is_opening ? "(opening)" : ""}
            </p>
            {!row.is_opening && (
              <>
                <button type="button" disabled={p.busy} onClick={() => open(row)}>
                  Correct
                </button>
                <button
                  type="button"
                  disabled={p.busy}
                  onClick={() =>
                    p.save(balances.remove(p.entity.id, kind, row.uuid, row.revision), saved)
                  }
                >
                  Delete
                </button>
              </>
            )}
          </article>
        ))}
      <button type="button" disabled={p.busy} onClick={() => open(null)}>
        Record observation
      </button>
      {form && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const spec = selected
              ? balances.correct(p.entity.id, kind, selected.uuid, form)
              : balances.create(p.entity.id, kind, form);
            p.save(spec, saved);
          }}
        >
          <h4>{selected ? "Correct" : "Record"} observation</h4>
          <label>
            Account
            <select
              required={kind === "debt"}
              value={form.account_id ?? ""}
              onChange={(event) => {
                setForm({ ...form, account_id: event.target.value || null });
                p.dirty(true);
              }}
            >
              {kind === "investment" && <option value="">Unassigned</option>}
              {kind === "debt" && <option value="">Choose loan</option>}
              {accounts.map((account) => (
                <option key={account.uuid} value={account.uuid}>
                  {account.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Observation date
            <input
              required
              type="date"
              value={form.date}
              onChange={(event) => {
                setForm({ ...form, date: event.target.value });
                p.dirty(true);
              }}
            />
          </label>
          <MoneyInput
            label={kind === "debt" ? "Amount owed" : "Observed value"}
            value={form.amount}
            onChange={(value) => {
              setForm({ ...form, amount: value });
              p.dirty(true);
            }}
          />
          <button type="submit" disabled={p.busy}>
            Save observation
          </button>
          <button
            type="button"
            onClick={() => {
              setForm(null);
              p.dirty(false);
            }}
          >
            Cancel
          </button>
        </form>
      )}
    </section>
  );
}
