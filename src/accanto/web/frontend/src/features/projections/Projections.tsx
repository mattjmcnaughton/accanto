import { useState } from "react";
import { decimalToCents, fmtDate, formatMoney, money } from "../../lib/format";
import { type FireAssumptions, type Projection, projections } from "../../lib/projections";
import { Empty, Field, Head, tint } from "../../ui";
import { LoadFailure, Loading, MoneyField, dash, validMoney } from "../destinations/records";
import { type ScreenProps, useLoad } from "../workspace/shared";
import "./projections.css";

const HORIZONS = [10, 20, 30] as const;
const PER = { monthly: "a month", annual: "a year" } as const;
const WITHDRAWAL = /^\d{1,2}(\.\d{1,2})?$/;

const cents = (value: string | null) => (value === null ? null : decimalToCents(value));
const ago = (months: number) => {
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return [years && `${years} yr`, rest && `${rest} mo`].filter(Boolean).join(" ") || "now";
};

type Row = Projection["timeline"][number];

/** Projected investments and net worth by year, with the FIRE target as a line. */
function Chart({ data }: { data: Projection }) {
  const rows = data.timeline;
  const target = cents(data.fire?.target ?? null);
  const invested = (row: Row) => cents(row.investments);
  const worth = (row: Row) => cents(row.net_worth);
  const known = [...rows.flatMap((row) => [invested(row), worth(row)]), target].filter(
    (v): v is number => v !== null,
  );
  const top = Math.max(...known, 1) * 1.08;
  const low = Math.min(0, ...known);
  const x = (i: number) => (i / Math.max(1, rows.length - 1)) * 100;
  const y = (v: number) => 100 - ((v - low) / (top - low)) * 100;
  const line = (pick: (row: Row) => number | null) =>
    rows
      .flatMap((row, i) => {
        const v = pick(row);
        return v === null ? [] : [`${x(i)},${y(v)}`];
      })
      .join(" ");
  const last = rows[rows.length - 1];
  return (
    <figure className="proj-chart">
      <div
        className="proj-plot"
        role="img"
        aria-label={`Projected investments ${formatMoney(last.investments)} in ${last.years} years${target !== null ? `; FIRE target ${money(target)}` : ""}`}
      >
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {target !== null && (
            <line className="proj-target" x1="0" x2="100" y1={y(target)} y2={y(target)} />
          )}
          <polyline className="proj-net" points={line(worth)} />
          <polyline className="proj-inv" style={tint("invest")} points={line(invested)} />
        </svg>
        {target !== null && (
          <span className="proj-target-label" style={{ top: `${y(target)}%` }}>
            FIRE target {money(target)}
          </span>
        )}
        {data.milestones.map((m) => {
          const i = rows.findIndex((row) => row.years === m.years);
          const v = invested(m);
          return i < 0 || v === null ? null : (
            <b
              key={m.years}
              style={{ left: `${x(i)}%`, top: `${y(v)}%`, ...tint("invest") }}
              title={`In ${m.years} years: ${money(v)}`}
            />
          );
        })}
      </div>
      <figcaption>
        <span>Today</span>
        <span>{Math.round(last.years / 2)} years</span>
        <span>{last.years} years</span>
      </figcaption>
      <div className="proj-legend">
        <span className="proj-key inv" style={tint("invest")}>
          Investments
        </span>
        <span className="proj-key net">Net worth</span>
        {target !== null && <span className="proj-key tgt">FIRE target</span>}
      </div>
    </figure>
  );
}

function FireForm({
  saved,
  busy,
  save,
}: {
  saved: FireAssumptions;
  busy: boolean;
  save: (value: { annual_spending: string | null; withdrawal_percent: string }) => void;
}) {
  const [spending, setSpending] = useState(saved.annual_spending ?? "");
  const [rate, setRate] = useState(saved.withdrawal_percent);
  const [error, setError] = useState("");
  const changed = spending !== (saved.annual_spending ?? "") || rate !== saved.withdrawal_percent;
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
        setError("");
        save({ annual_spending: spending.trim() || null, withdrawal_percent: rate.trim() });
      }}
    >
      <h2 className="h2">FIRE assumptions</h2>
      <p className="note">
        The FIRE target is annual spending ÷ the withdrawal rate. It is compared with projected
        investments, not cash savings.
      </p>
      <div className="two">
        <MoneyField
          label="Annual spending in retirement (USD)"
          value={spending}
          required={false}
          onChange={setSpending}
        />
        <Field label="Withdrawal rate (%, often 4)">
          <input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
        </Field>
      </div>
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
  const [reload, setReload] = useState(0);
  const again = () => setReload((n) => n + 1);
  const deps = [p.entity.id, p.refresh, reload];
  const state = useLoad(() => projections.read(p.entity.id, years), [...deps, years]);
  const assumptions = useLoad(() => projections.assumptions(p.entity.id), deps);
  if (p.concealed) return null;

  const data = state.kind === "ready" ? state.data : null;
  const fire = data?.fire ?? null;
  const missing = data?.investments.filter((i) => i.status === "no_value") ?? [];
  return (
    <section aria-labelledby="projections-title" className="screen proj">
      <Head
        title={<span id="projections-title">Projections</span>}
        sub="Illustrative figures from each investment's expected return and contribution. They are not recorded activity or observed values, and they ignore inflation, taxes, fees, and market risk."
      >
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
          <div className="grid3 proj-figs">
            {data.milestones.map((m) => (
              <div key={m.years} className="card pad">
                <span className="cap">
                  Net worth in {m.years} years, {fmtDate(m.date)}
                </span>
                <div className="fig">{formatMoney(m.net_worth)}</div>
                <span className="cap">{formatMoney(m.investments)} invested</span>
              </div>
            ))}
          </div>
          <div className="card pad stack">
            <div className="proj-fire-head">
              <div>
                <span className="cap">FIRE</span>
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
                    ? `Target ${formatMoney(fire.target)}: ${formatMoney(fire.annual_spending)} a year at ${fire.withdrawal_percent}%${fire.months_to_target !== null ? `, in ${ago(fire.months_to_target)}` : ""}`
                    : "Enter annual spending below to see a FIRE target and date."}
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
              <Chart data={data} />
            )}
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
        </>
      )}
      {assumptions.kind === "ready" && (
        <FireForm
          key={assumptions.data.revision}
          saved={assumptions.data}
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
    </section>
  );
}
