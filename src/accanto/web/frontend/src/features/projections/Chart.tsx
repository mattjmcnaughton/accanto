import { type KeyboardEvent, type PointerEvent, useRef, useState } from "react";
import { decimalToCents, formatMoney } from "../../lib/format";
import type { Dollars, Projection } from "../../lib/projections";
import { tint } from "../../ui";

type Row = Projection["timeline"][number];
type Pick = (row: Row) => string | null;

const SERIES: { key: string; name: string; className: string; kind?: string; pick: Pick }[] = [
  {
    key: "inv",
    name: "Investments",
    className: "proj-inv",
    kind: "invest",
    pick: (r) => r.investments,
  },
  { key: "net", name: "Net worth", className: "proj-net", pick: (r) => r.net_worth },
  { key: "tgt", name: "FIRE target", className: "proj-tgt", pick: (r) => r.fire_target },
];
const compact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});
const cents = (value: string | null) => (value === null ? null : decimalToCents(value));

/** A round step giving about four gridlines up to max. */
function niceStep(span: number) {
  const raw = Math.max(span, 1) / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  return ([1, 2, 2.5, 5, 10].find((m) => m * mag >= raw) ?? 10) * mag;
}

/**
 * Projected investments, net worth and the FIRE target by year, with dollar and year axes. Hover,
 * tap or drag across the plot, or focus it and use the arrow keys, to read each series on a date.
 */
export function Chart({ data, dollars }: { data: Projection; dollars: Dollars }) {
  const rows = data.timeline;
  const series = SERIES.filter((s) => rows.some((r) => s.pick(r) !== null));
  const values = rows
    .flatMap((r) => series.map((s) => cents(s.pick(r))))
    .filter((v): v is number => v !== null);
  const step = niceStep(Math.max(...values, 0) - Math.min(0, ...values));
  const top = Math.ceil(Math.max(...values, 1) / step) * step;
  const low = Math.floor(Math.min(0, ...values) / step) * step;
  const ticks = Array.from(
    { length: Math.round((top - low) / step) + 1 },
    (_, i) => low + i * step,
  );
  const last = rows.length - 1;
  const every = last <= 10 ? 2 : 5;
  const x = (i: number) => (i / Math.max(1, last)) * 100;
  const y = (v: number) => 100 - ((v - low) / (top - low)) * 100;
  const line = (pick: Pick) =>
    rows
      .flatMap((r, i) => {
        const v = cents(pick(r));
        return v === null ? [] : [`${x(i)},${y(v)}`];
      })
      .join(" ");

  const [active, setActive] = useState<number | null>(null);
  const plot = useRef<HTMLDivElement>(null);
  const at = (event: PointerEvent) => {
    const box = plot.current?.getBoundingClientRect();
    if (!box) return;
    const f = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    setActive(Math.round(f * last));
  };
  const key = (event: KeyboardEvent) => {
    const move = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[event.key];
    const now = active ?? last;
    if (move) setActive(Math.min(last, Math.max(0, now + move)));
    else if (event.key === "Home") setActive(0);
    else if (event.key === "End") setActive(last);
    else if (event.key === "Escape") setActive(null);
    else return;
    event.preventDefault();
  };
  const row = active === null ? null : rows[active];
  const when = (r: Row) => (r.years === 0 ? "Today" : `${r.date.slice(0, 4)}, in ${r.years} yr`);
  const describe = (r: Row) =>
    `${when(r)}: ${series.map((s) => `${s.name} ${formatMoney(s.pick(r))}`).join(", ")}`;
  const unit = dollars === "today" ? "Today's dollars" : "Future dollars";
  const fireAt = data.fire?.months_to_target ?? null;

  return (
    <figure className="proj-chart">
      <span className="proj-axis-title">{unit}</span>
      <div className="proj-axes">
        <div className="proj-y" aria-hidden="true">
          {ticks.map((t) => (
            <span key={t} style={{ top: `${y(t)}%` }}>
              {compact.format(t / 100)}
            </span>
          ))}
        </div>
        <div
          ref={plot}
          className="proj-plot"
          role="slider"
          tabIndex={0}
          aria-label={`Projection by year, in ${unit.toLowerCase()}`}
          aria-valuemin={0}
          aria-valuemax={rows[last].years}
          aria-valuenow={(row ?? rows[last]).years}
          aria-valuetext={describe(row ?? rows[last])}
          onPointerDown={at}
          onPointerMove={at}
          onPointerLeave={(e) => e.pointerType === "mouse" && setActive(null)}
          onKeyDown={key}
          onBlur={() => setActive(null)}
        >
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {ticks.map((t) => (
              <line
                key={t}
                className={t === 0 ? "proj-zero" : "proj-grid"}
                x1="0"
                x2="100"
                y1={y(t)}
                y2={y(t)}
              />
            ))}
            {fireAt !== null && fireAt <= rows[last].years * 12 && (
              <line
                className="proj-fire-at"
                x1={x(fireAt / 12)}
                x2={x(fireAt / 12)}
                y1="0"
                y2="100"
              />
            )}
            {series.map((s) => (
              <polyline
                key={s.key}
                className={s.className}
                style={s.kind ? tint(s.kind) : undefined}
                points={line(s.pick)}
              />
            ))}
            {active !== null && (
              <line className="proj-cursor" x1={x(active)} x2={x(active)} y1="0" y2="100" />
            )}
          </svg>
          {row &&
            series.map((s) => {
              const v = cents(s.pick(row));
              return v === null ? null : (
                <b
                  key={s.key}
                  className={`proj-dot ${s.key}`}
                  style={{
                    left: `${x(active ?? 0)}%`,
                    top: `${y(v)}%`,
                    ...(s.kind ? tint(s.kind) : {}),
                  }}
                />
              );
            })}
          {row && (
            <div
              className={`proj-tip ${x(active ?? 0) > 55 ? "end" : ""}`}
              style={{ left: `${x(active ?? 0)}%` }}
              aria-hidden="true"
            >
              <b>{when(row)}</b>
              {series.map((s) => (
                <span
                  key={s.key}
                  className={`proj-key ${s.key}`}
                  style={s.kind ? tint(s.kind) : undefined}
                >
                  {s.name} <strong>{formatMoney(s.pick(row))}</strong>
                </span>
              ))}
            </div>
          )}
        </div>
        <span />
        <div className="proj-x" aria-hidden="true">
          {rows.map((r, i) =>
            i % every === 0 || i === last ? (
              <span key={r.years} style={{ left: `${x(i)}%` }}>
                {r.years === 0 ? "Today" : r.date.slice(0, 4)}
              </span>
            ) : null,
          )}
        </div>
      </div>
      <figcaption className="proj-legend">
        {series.map((s) => (
          <span
            key={s.key}
            className={`proj-key ${s.key}`}
            style={s.kind ? tint(s.kind) : undefined}
          >
            {s.name}
          </span>
        ))}
        <span className="muted">Year</span>
      </figcaption>
    </figure>
  );
}
