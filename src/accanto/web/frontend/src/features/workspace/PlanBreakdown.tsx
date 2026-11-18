import type { Metric } from "../../lib/monthly";
import { money } from "./planWorksheetModel";

// Ratios are display-only, rounded half-even to two percentage decimals.
function percentage(amount: number | null, funding: number | null): number | null {
  if (amount === null || funding === null || funding <= 0) return null;
  const numerator = BigInt(Math.abs(amount)) * 10000n;
  const denominator = BigInt(funding);
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const rounded =
    quotient +
    (remainder * 2n > denominator || (remainder * 2n === denominator && quotient % 2n === 1n)
      ? 1n
      : 0n);
  return (Number(rounded) / 100) * (amount < 0 ? -1 : 1);
}
const label = (value: number | null) => (value === null ? "Unavailable" : `${value.toFixed(2)}%`);

export function PlanBreakdown({
  funding,
  allocated,
  rows,
  state,
  metrics,
}: {
  funding: number | null;
  allocated: number | null;
  rows: { name: string; amount: number | null }[];
  state: string;
  metrics?: Metric[];
}) {
  const shares = rows.map((row) => ({ ...row, share: percentage(row.amount, funding) }));
  const scale = Math.max(100, ...shares.map((row) => row.share ?? 0));
  return (
    <details className="plan-breakdown">
      <summary>
        <strong>Plan breakdown</strong>
        <span>{label(percentage(allocated, funding))} allocated</span>
        <span>{state}</span>
      </summary>
      <div className="breakdown-content">
        <p>Share of monthly funding · {money(funding)}</p>
        <table aria-label="Plan allocation breakdown">
          <thead>
            <tr>
              <th>Allocation</th>
              <th>Monthly amount</th>
              <th>Share of funding</th>
              <th>
                <span className="sr-only">Relative share</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {shares.map((row) => (
              <tr key={row.name}>
                <th scope="row">{row.name}</th>
                <td className="numeric">{money(row.amount)}</td>
                <td className="numeric">{label(row.share)}</td>
                <td className="breakdown-bar-cell">
                  <span
                    className="breakdown-bar"
                    style={{ width: `${(Math.max(0, row.share ?? 0) / scale) * 100}%` }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {funding === 0 && <p>Percentages are unavailable with zero monthly funding.</p>}
        {!!metrics?.length && (
          <details className="breakdown-ratios">
            <summary>Other planned ratios</summary>
            <table aria-label="Stored planned ratios">
              <thead>
                <tr>
                  <th>Ratio</th>
                  <th>Calculation</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {metrics.map((metric) => (
                  <tr key={metric.key}>
                    <th scope="row">{metric.label}</th>
                    <td>
                      {metric.numerator === null ? "Unknown" : `$${metric.numerator}`} ÷{" "}
                      {metric.denominator === null ? "Unknown" : `$${metric.denominator}`}
                    </td>
                    <td title={metric.unavailable_reason ?? undefined}>
                      {metric.percentage === null ? "Unavailable" : `${metric.percentage}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        )}
      </div>
    </details>
  );
}
