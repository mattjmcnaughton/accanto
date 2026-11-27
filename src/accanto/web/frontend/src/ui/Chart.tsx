import { type CSSProperties, type KeyboardEvent, type PointerEvent, useRef, useState } from "react";
import { money } from "../lib/format";

/** One plotted series. Values are cents; null is unknown and is never drawn as zero. */
export type Series<T> = {
  key: string;
  name: string;
  /** A CSS color, such as var(--c-fixed). */
  color: string;
  line?: "dashed" | "dotted";
  pick: (row: T) => number | null;
};
const compact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

/** A round step giving about four gridlines up to max. */
function niceStep(span: number) {
  const raw = Math.max(span, 1) / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  return ([1, 2, 2.5, 5, 10].find((m) => m * mag >= raw) ?? 10) * mag;
}

/**
 * Lines, or stacked bars with bars set, over rows with dollar and date axes. Hover, tap or drag
 * across the plot, or focus it and use the arrow keys, to read each series on one row.
 */
export function Chart<T>({
  rows,
  series,
  bars = false,
  title,
  label,
  when,
  tick,
  marker,
  note,
  hint,
}: {
  rows: T[];
  series: Series<T>[];
  bars?: boolean;
  /** The y axis title. */
  title: string;
  /** The plot's accessible name. */
  label: string;
  /** The tooltip heading for a row. */
  when: (row: T) => string;
  /** The x axis label under a row, or null for none. */
  tick: (row: T, i: number) => string | null;
  /** A row index, possibly fractional, to mark with a dashed vertical line. */
  marker?: number | null;
  /** An extra tooltip line for a row. */
  note?: (row: T) => string | null;
  hint?: string;
}) {
  const shown = series.filter((s) => rows.some((r) => s.pick(r) !== null));
  const stack = (r: T, upTo: number) =>
    shown.slice(0, upTo + 1).reduce((sum, s) => sum + (s.pick(r) ?? 0), 0);
  const values = bars
    ? rows.map((r) => stack(r, shown.length - 1))
    : rows.flatMap((r) => shown.map((s) => s.pick(r))).filter((v): v is number => v !== null);
  const step = niceStep(Math.max(...values, 0) - Math.min(0, ...values));
  const top = Math.ceil(Math.max(...values, 1) / step) * step;
  const low = Math.floor(Math.min(0, ...values) / step) * step;
  const ticks = Array.from(
    { length: Math.round((top - low) / step) + 1 },
    (_, i) => low + i * step,
  );
  const last = rows.length - 1;
  const n = rows.length;
  const x = (i: number) => (bars ? ((i + 0.5) / n) * 100 : (i / Math.max(1, last)) * 100);
  const y = (v: number) => 100 - ((v - low) / (top - low)) * 100;
  const width = Math.min(8, (100 / n) * 0.7);
  const line = (s: Series<T>) =>
    rows
      .flatMap((r, i) => {
        const v = s.pick(r);
        return v === null ? [] : [`${x(i)},${y(v)}`];
      })
      .join(" ");

  const [active, setActive] = useState<number | null>(null);
  const plot = useRef<HTMLDivElement>(null);
  const at = (event: PointerEvent) => {
    const box = plot.current?.getBoundingClientRect();
    if (!box) return;
    const f = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    setActive(bars ? Math.min(last, Math.floor(f * n)) : Math.round(f * last));
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
  const amount = (v: number | null) => (v === null ? "Unknown" : money(v));
  const describe = (r: T) =>
    [`${when(r)}: ${shown.map((s) => `${s.name} ${amount(s.pick(r))}`).join(", ")}`, note?.(r)]
      .filter(Boolean)
      .join(", ");
  const color = (s: Series<T>) => ({ "--c": s.color }) as CSSProperties;
  const keyClass = (s: Series<T>) => `chart-key ${bars ? "bar" : (s.line ?? "")}`;
  const lineClass = (s: Series<T>) => `chart-line ${s.line ?? ""}`;
  const tip = row === null ? null : note?.(row);

  return (
    <figure className="chart">
      <span className="chart-title">{title}</span>
      <div className="chart-axes">
        <div className="chart-y" aria-hidden="true">
          {ticks.map((t) => (
            <span key={t} style={{ top: `${y(t)}%` }}>
              {compact.format(t / 100)}
            </span>
          ))}
        </div>
        <div
          ref={plot}
          className="chart-plot"
          role="slider"
          tabIndex={0}
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={last}
          aria-valuenow={active ?? last}
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
                className={t === 0 ? "chart-zero" : "chart-grid"}
                x1="0"
                x2="100"
                y1={y(t)}
                y2={y(t)}
              />
            ))}
            {marker != null && marker <= last && (
              <line className="chart-marker" x1={x(marker)} x2={x(marker)} y1="0" y2="100" />
            )}
            {bars
              ? rows.map((r, i) =>
                  shown.map((s, k) => {
                    const v = s.pick(r) ?? 0;
                    const end = stack(r, k);
                    return v > 0 ? (
                      <rect
                        key={`${i}-${s.key}`}
                        className={`chart-bar${active === null || active === i ? "" : " dim"}`}
                        style={color(s)}
                        x={x(i) - width / 2}
                        width={width}
                        y={y(end)}
                        height={y(end - v) - y(end)}
                      />
                    ) : null;
                  }),
                )
              : shown.map((s) => (
                  <polyline
                    key={s.key}
                    className={lineClass(s)}
                    style={color(s)}
                    points={line(s)}
                  />
                ))}
            {active !== null && !bars && (
              <line className="chart-cursor" x1={x(active)} x2={x(active)} y1="0" y2="100" />
            )}
          </svg>
          {row &&
            !bars &&
            shown.map((s) => {
              const v = s.pick(row);
              return v === null ? null : (
                <b
                  key={s.key}
                  className="chart-dot"
                  style={{ left: `${x(active ?? 0)}%`, top: `${y(v)}%`, ...color(s) }}
                />
              );
            })}
          {row && (
            <div
              className={`chart-tip ${x(active ?? 0) > 55 ? "end" : ""}`}
              style={{ "--x": `${x(active ?? 0)}%` } as CSSProperties}
              aria-hidden="true"
            >
              <b>{when(row)}</b>
              {shown.map((s) => (
                <span key={s.key} className={keyClass(s)} style={color(s)}>
                  {s.name} <strong>{amount(s.pick(row))}</strong>
                </span>
              ))}
              {tip && <span className="muted">{tip}</span>}
            </div>
          )}
        </div>
        <span />
        <div className="chart-x" aria-hidden="true">
          {rows.map((r, i) => {
            const text = tick(r, i);
            return text === null ? null : (
              // biome-ignore lint/suspicious/noArrayIndexKey: one label per row index.
              <span key={i} style={{ left: `${x(i)}%` }} className={bars ? "mid" : undefined}>
                {text}
              </span>
            );
          })}
        </div>
      </div>
      <figcaption className="chart-legend">
        {shown.map((s) => (
          <span key={s.key} className={keyClass(s)} style={color(s)}>
            {s.name}
          </span>
        ))}
        {hint && <span className="muted">{hint}</span>}
      </figcaption>
    </figure>
  );
}
