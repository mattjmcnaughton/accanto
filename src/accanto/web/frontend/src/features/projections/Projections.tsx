import { useState } from "react";
import { fmtDate, formatMoney, monthName } from "../../lib/format";
import {
  type Dollars,
  type FireAssumptions,
  type PlannedFixedCosts,
  projections,
  saveDollars,
  savedDollars,
} from "../../lib/projections";
import { Empty, Field, Head } from "../../ui";
import { Chart } from "./Chart";
import { FixedInDollars } from "./FixedInDollars";
import { LoadFailure, Loading, MoneyField, dash, validMoney } from "../destinations/records";
import { type ScreenProps, useLoad } from "../workspace/shared";
import "./projections.css";

const HORIZONS = [10, 20, 30] as const;
const PER = { monthly: "a month", annual: "a year" } as const;
const WITHDRAWAL = /^\d{1,2}(\.\d{1,2})?$/;

const ago = (months: number) => {
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return [years && `${years} yr`, rest && `${rest} mo`].filter(Boolean).join(" ") || "now";
};

function FireForm({
  saved,
  planned,
  busy,
  save,
}: {
  saved: FireAssumptions;
  planned: PlannedFixedCosts | null;
  busy: boolean;
  save: (value: {
    annual_spending: string | null;
    withdrawal_percent: string;
    inflation_percent: string;
    fixed_costs_not_rising_with_inflation?: string[];
  }) => void;
}) {
  const steadyNow = (planned?.lines ?? [])
    .filter((l) => !l.rises_with_inflation)
    .map((l) => l.fixed_cost_id);
  const [steady, setSteady] = useState(steadyNow);
  const [spending, setSpending] = useState(saved.annual_spending ?? "");
  const [rate, setRate] = useState(saved.withdrawal_percent);
  const [inflation, setInflation] = useState(saved.inflation_percent);
  const [error, setError] = useState("");
  const changed =
    spending !== (saved.annual_spending ?? "") ||
    rate !== saved.withdrawal_percent ||
    inflation !== saved.inflation_percent ||
    [...steady].sort().join() !== [...steadyNow].sort().join();
  return (
    <form
      className="card pad stack proj-fire"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (spending.trim() && !validMoney(spending))
          return setError("Enter annual spending as USD with up to two decimals.");
        if (!WITHDRAWAL.test(rate.trim()) || Number(rate) <= 0 || Number(rate) > 10)
          return setError("Enter a withdrawal rate above 0 and up to 10 percent.");
        if (!WITHDRAWAL.test(inflation.trim()) || Number(inflation) > 15)
          return setError("Enter average inflation from 0 to 15 percent.");
        setError("");
        save({
          annual_spending: spending.trim() || null,
          withdrawal_percent: rate.trim(),
          inflation_percent: inflation.trim(),
          // Without a saved Plan version there is no list to replace: keep every flag.
          ...(planned ? { fixed_costs_not_rising_with_inflation: steady } : {}),
        });
      }}
    >
      <h2 className="h2">FIRE assumptions</h2>
      <p className="note">
        The FIRE target is annual spending ÷ the withdrawal rate, compared with projected
        investments, not cash savings. Spending is in today&apos;s dollars and rises with inflation,
        except planned fixed costs marked fixed in dollars.
      </p>
      <div className="proj-fire-fields">
        <Field label="Withdrawal rate (%, often 4)">
          <input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
        </Field>
        <MoneyField
          label="Annual spending in retirement (USD, today's dollars)"
          value={spending}
          required={false}
          onChange={setSpending}
        />
        <Field label="Average annual inflation (%)">
          <input
            inputMode="decimal"
            value={inflation}
            onChange={(e) => setInflation(e.target.value)}
          />
        </Field>
      </div>
      {planned ? (
        <FixedInDollars planned={planned} selected={steady} onChange={setSteady} />
      ) : (
        <p className="note">
          Save a Plan version to choose fixed costs that do not rise with inflation.
        </p>
      )}
      {planned && (
        <p className="note proj-planned-ref">
          For reference: {monthName(planned.month)}&apos;s planned fixed costs are{" "}
          <b>{formatMoney(planned.annual_total)} a year</b> ({formatMoney(planned.monthly_total)} a
          month, {planned.plan_name} version {planned.version_number}).
        </p>
      )}
      {error && (
        <p className="err" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        <button type="submit" className="btn pri sm" disabled={busy || !changed}>
          Save assumptions
        </button>
      </div>
    </form>
  );
}

export function Projections(p: ScreenProps & { openInvestments?: () => void }) {
  const [years, setYears] = useState<(typeof HORIZONS)[number]>(20);
  const [dollars, setDollars] = useState<Dollars>(savedDollars);
  const choose = (value: Dollars) => {
    setDollars(value);
    saveDollars(value);
  };
  const [reload, setReload] = useState(0);
  const again = () => setReload((n) => n + 1);
  const deps = [p.entity.id, p.refresh, reload];
  const state = useLoad(
    () => projections.read(p.entity.id, years, dollars),
    [...deps, years, dollars],
  );
  const assumptions = useLoad(() => projections.assumptions(p.entity.id), deps);
  if (p.concealed) return null;

  const data = state.kind === "ready" ? state.data : null;
  const fire = data?.fire ?? null;
  const missing = data?.investments.filter((i) => i.status === "no_value") ?? [];
  return (
    <section aria-labelledby="projections-title" className="screen proj">
      <Head
        title={<span id="projections-title">Projections</span>}
        sub="Illustrative figures from each investment's expected return and contribution, with loans paid down at their fixed rate and monthly payment. They are not recorded activity or observed values, and they ignore taxes, fees, and market risk."
      >
        {/* biome-ignore lint/a11y/useSemanticElements: The kit\'s segmented control is a button group. */}
        <div className="seg-control" role="group" aria-label="Dollars">
          {(["today", "future"] as const).map((d) => (
            <button key={d} type="button" aria-pressed={dollars === d} onClick={() => choose(d)}>
              {d === "today" ? "Today's dollars" : "Future dollars"}
            </button>
          ))}
        </div>
        {/* biome-ignore lint/a11y/useSemanticElements: The kit\'s segmented control is a button group. */}
        <div className="seg-control" role="group" aria-label="Horizon">
          {HORIZONS.map((h) => (
            <button key={h} type="button" aria-pressed={years === h} onClick={() => setYears(h)}>
              {h} yr
            </button>
          ))}
        </div>
      </Head>
      <LoadFailure state={state} retry={again} />
      {state.kind === "loading" && <Loading what="projections" />}
      {state.kind === "empty" && (
        <Empty
          title="Nothing to project yet"
          action={
            p.openInvestments && (
              <button type="button" className="btn pri sm" onClick={p.openInvestments}>
                Go to Investments
              </button>
            )
          }
        >
          Add an investment with an observed value, then set its expected annual return and
          contribution.
        </Empty>
      )}
      {data && (
        <>
          <div className="card pad stack">
            <div className="proj-fire-head">
              <div>
                <span className="cap">
                  FIRE date{" "}
                  <span className="muted">
                    {dollars === "today" ? "today's dollars" : "future dollars"},{" "}
                    {data.inflation_percent}% inflation
                  </span>
                </span>
                <div className="fig">
                  {fire
                    ? fire.reached_on
                      ? fmtDate(fire.reached_on)
                      : data.today.net_worth === null
                        ? "Unknown"
                        : "Not within 100 years"
                    : "Set annual spending"}
                </div>
                <span className="cap">
                  {fire
                    ? `Target ${formatMoney(fire.target ?? fire.target_today)}${fire.target && dollars === "future" ? " then" : ""}: ${formatMoney(fire.annual_spending)} a year at ${fire.withdrawal_percent}%${fire.months_to_target !== null ? `, in ${ago(fire.months_to_target)}` : ""}`
                    : "Enter annual spending to see a FIRE target and date."}
                </span>
              </div>
              <div className="proj-today">
                <span className="cap">Net worth today</span>
                <div className="fig">{formatMoney(data.today.net_worth)}</div>
                <span className="cap">
                  {formatMoney(data.today.investments)} invested + {formatMoney(data.today.savings)}{" "}
                  saved − {formatMoney(data.today.loans)} owed
                </span>
              </div>
            </div>
            {missing.length > 0 ? (
              <p className="proj-warn" role="note">
                {missing.map((m) => m.name).join(", ")} {missing.length === 1 ? "has" : "have"} no
                observed value, so net worth and FIRE are unknown. Record a value in Investments to
                project them.
              </p>
            ) : (
              <Chart data={data} dollars={dollars} />
            )}
          </div>
          <div className="proj-assume">
            {assumptions.kind === "ready" && (
              <FireForm
                key={assumptions.data.revision}
                saved={assumptions.data}
                planned={data?.planned_fixed_costs ?? null}
                busy={p.busy}
                save={(value) =>
                  p.save(
                    projections.saveAssumptions(p.entity.id, {
                      ...value,
                      expected_revision: assumptions.data.revision,
                    }),
                    again,
                  )
                }
              />
            )}
          </div>
          <div className="grid3 proj-figs">
            {data.milestones.map((m) => (
              <div key={m.years} className="card pad">
                <span className="cap">
                  Net worth in {m.years} years, {fmtDate(m.date)}
                </span>
                <div className="fig">{formatMoney(m.net_worth)}</div>
                <span className="cap">
                  {formatMoney(m.investments)} invested, {formatMoney(m.loans)} owed
                </span>
              </div>
            ))}
          </div>
          <div className="card pad stack">
            <h2 className="h2">By investment</h2>
            <table className="proj-table">
              <thead>
                <tr>
                  <th>Investment</th>
                  <th>Latest value</th>
                  <th>Expected return</th>
                  <th>Contribution</th>
                  {data.milestones.map((m) => (
                    <th key={m.years}>In {m.years} yr</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.investments.map((row) => (
                  <tr key={row.investment_id}>
                    <td>
                      <div className="proj-name">
                        <b>{row.name}</b>
                        {row.status === "no_value" && (
                          <span className="chip warn">No observed value</span>
                        )}
                      </div>
                    </td>
                    <td data-label="Latest value">
                      {row.latest ? formatMoney(row.latest.amount) : "Unknown"}
                    </td>
                    <td data-label="Expected return">
                      <span>
                        {row.return_percent}%
                        {row.return_source === "default" && <span className="muted"> default</span>}
                      </span>
                    </td>
                    <td data-label="Contribution">
                      {row.expected_contribution
                        ? `${formatMoney(row.expected_contribution)} ${PER[row.expected_contribution_frequency]}`
                        : dash}
                    </td>
                    {row.milestones.map((m) => (
                      <td key={m.years} data-label={`In ${m.years} yr`}>
                        {formatMoney(m.amount)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {p.openInvestments && (
              <div className="actions">
                <button type="button" className="btn sm" onClick={p.openInvestments}>
                  Edit assumptions in Investments
                </button>
              </div>
            )}
          </div>
          {data.loans.length > 0 && (
            <div className="card pad stack">
              <h2 className="h2">By loan</h2>
              <p className="note">
                A loan with a fixed rate and a monthly payment that covers its interest is paid down
                from today, starting at its latest amount owed; other loans stay at that amount. A
                loan last observed months ago pays off later here than in its Loans schedule, which
                starts at the observation; record a new amount owed to align them. Payments are not
                taken from investment contributions, and a repaid loan&apos;s payment is not
                invested.
              </p>
              <table className="proj-table">
                <thead>
                  <tr>
                    <th>Loan</th>
                    <th>Owed now</th>
                    <th>Terms</th>
                    <th>Paid off</th>
                    {data.milestones.map((m) => (
                      <th key={m.years}>In {m.years} yr</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.loans.map((row) => (
                    <tr key={row.debt_id}>
                      <td>
                        <div className="proj-name">
                          <b>{row.name}</b>
                          {row.status === "interest_not_covered" && (
                            <span className="chip warn">Payment under interest</span>
                          )}
                        </div>
                      </td>
                      <td data-label="Owed now">{formatMoney(row.latest.amount)}</td>
                      <td data-label="Terms">
                        {row.interest_rate_percent && row.monthly_payment
                          ? `${row.interest_rate_percent}%, ${formatMoney(row.monthly_payment)} a month`
                          : "No terms, held flat"}
                      </td>
                      <td data-label="Paid off">
                        {row.payoff_date
                          ? fmtDate(row.payoff_date)
                          : row.status === "paid_off"
                            ? "Paid off"
                            : dash}
                      </td>
                      {row.milestones.map((m) => (
                        <td key={m.years} data-label={`In ${m.years} yr`}>
                          {formatMoney(m.amount)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
