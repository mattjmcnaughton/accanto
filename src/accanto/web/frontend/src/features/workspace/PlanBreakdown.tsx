import { useState } from "react";
import { formatMoney } from "../../lib/format";
import type { Metric } from "../../lib/monthly";
import { tint } from "../../ui";
import { money } from "./planWorksheetModel";

/** Share of funding, rounded half-even to two decimals; null when funding is unknown or zero. */
export function share(amount: number | null, funding: number | null): number | null {
  return percentage(amount, funding);
}
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
  rows: { name: string; amount: number | null; kind?: string }[];
  state: string;
  metrics?: Metric[];
}) {
  const shares = rows.map((row) => ({ ...row, share: percentage(row.amount, funding) }));
  const scale = Math.max(100, ...shares.map((row) => row.share ?? 0));
  // Open beside the worksheet on desktop; collapsed below it on narrow screens.
  const [open, setOpen] = useState(() => !!window.matchMedia?.("(min-width: 961px)").matches);
  return (
    <details
      className="plan-breakdown card"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>
        <strong>Plan breakdown</strong>
        <span className="muted">{label(percentage(allocated, funding))} allocated</span>
        <span className="chip">{state}</span>
      </summary>
      <div className="breakdown-content">
        <p className="note">Share of monthly funding, {money(funding)}</p>
        <table className="plan-table" aria-label="Plan allocation breakdown">
          <thead>
            <tr>
              <th>Allocation</th>
              <th className="num">Monthly</th>
              <th className="num">Share</th>
              <th className="breakdown-bar-cell">
                <span className="sr-only">Relative share</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {shares.map((row) => (
              <tr key={row.name} style={tint(row.kind ?? "none")}>
                <th scope="row">
                  <span className="dot" /> {row.name}
                </th>
                <td className="num">{money(row.amount)}</td>
                <td className="num">{label(row.share)}</td>
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
        {funding === 0 && (
          <p className="note">Percentages are unavailable with zero monthly funding.</p>
        )}
        {!!metrics?.length && (
          <details className="breakdown-ratios">
            <summary>Other planned ratios</summary>
            <table className="plan-table" aria-label="Stored planned ratios">
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
                      {formatMoney(metric.numerator)} ÷ {formatMoney(metric.denominator)}
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
