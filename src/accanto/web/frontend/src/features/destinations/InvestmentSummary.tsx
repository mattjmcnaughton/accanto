import { useState } from "react";
import type { Destination } from "../../lib/destinations";
import { decimalToCents, money, pct, plural } from "../../lib/format";
import { Band, tint } from "../../ui";

type Split = { label: string; parts: { key: string; name: string; kind: string; cents: number }[] };

/**
 * Observed value split by liquidity and tax treatment. Each investment counts at its latest
 * observed value; one without a value yet is left out and counted, never drawn as zero.
 */
export function investmentSplits(rows: Destination[]) {
  const valued = rows.flatMap((row) => {
    const cents = row.latest ? decimalToCents(row.latest.amount) : null;
    return cents === null ? [] : [{ row, cents }];
  });
  const total = valued.reduce((sum, v) => sum + v.cents, 0);
  const by = (test: (row: Destination) => boolean) =>
    valued.reduce((sum, v) => sum + (test(v.row) ? v.cents : 0), 0);
  const liquid = by((row) => (row.liquidity ?? "liquid") === "liquid");
  const taxable = by((row) => (row.tax_treatment ?? "taxable") === "taxable");
  const splits: Split[] = [
    {
      label: "Liquidity",
      parts: [
        { key: "liquid", name: "Liquid", kind: "save", cents: liquid },
        { key: "illiquid", name: "Illiquid", kind: "fixed", cents: total - liquid },
      ],
    },
    {
      label: "Tax treatment",
      parts: [
        { key: "taxable", name: "Taxable", kind: "free", cents: taxable },
        { key: "advantaged", name: "Tax-advantaged", kind: "invest", cents: total - taxable },
      ],
    },
  ];
  return { total, unvalued: rows.length - valued.length, splits };
}

export function InvestmentSummary({ rows }: { rows: Destination[] }) {
  const { total, unvalued, splits } = investmentSplits(rows);
  // The segment under the pointer (or last tapped), read back beside its bar's label.
  const [pointed, setPointed] = useState<Record<string, string>>({});
  const point = (split: string, target: EventTarget | null) =>
    setPointed((now) => ({
      ...now,
      [split]: (target as HTMLElement | null)?.closest<HTMLElement>(".seg")?.title ?? "",
    }));
  return (
    <section className="card pad inv-summary" aria-labelledby="inv-total">
      <div>
        <span className="cap" id="inv-total">
          Total observed value
        </span>
        <div className="fig inv-total">{money(total)}</div>
        {unvalued > 0 && (
          <span className="cap">
            Leaves out {plural(unvalued, "investment", "investments")} with no value yet
          </span>
        )}
      </div>
      {total > 0 &&
        splits.map((split) => {
          const text = (p: Split["parts"][number]) =>
            `${p.name}: ${money(p.cents)} (${pct(p.cents, total, 0)})`;
          return (
            <div key={split.label} className="inv-split">
              <span className="cap" aria-live="polite">
                {split.label}
                {pointed[split.label] && <b className="inv-pointed">{pointed[split.label]}</b>}
              </span>
              <div
                onPointerOver={(event) => point(split.label, event.target)}
                onPointerDown={(event) => point(split.label, event.target)}
                onPointerLeave={(event) =>
                  event.pointerType === "mouse" && point(split.label, null)
                }
              >
                <Band
                  label={`${split.label}: ${split.parts.map(text).join(", ")}`}
                  parts={split.parts.map((p) => ({
                    key: p.key,
                    kind: p.kind,
                    weight: p.cents,
                    title: text(p),
                  }))}
                />
              </div>
              <ul className="inv-legend">
                {split.parts.map((p) => (
                  <li key={p.key} style={tint(p.kind)} title={text(p)}>
                    <span className="dot" />
                    {p.name} <b>{money(p.cents)}</b>
                    <span className="muted">{pct(p.cents, total, 0)}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
    </section>
  );
}
