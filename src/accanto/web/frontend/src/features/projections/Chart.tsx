import { decimalToCents } from "../../lib/format";
import type { Dollars, Projection } from "../../lib/projections";
import { Chart as Plot, type Series } from "../../ui";

type Row = Projection["timeline"][number];
const cents = (value: string | null) => (value === null ? null : decimalToCents(value));

const SERIES: Series<Row>[] = [
  {
    key: "inv",
    name: "Investments",
    color: "var(--c-invest)",
    pick: (r) => cents(r.investments),
  },
  {
    key: "net",
    name: "Net worth",
    color: "var(--ink2)",
    line: "dashed",
    pick: (r) => cents(r.net_worth),
  },
  {
    key: "tgt",
    name: "FIRE target",
    color: "var(--c-income)",
    line: "dotted",
    pick: (r) => cents(r.fire_target),
  },
];

/** Projected investments, net worth and the FIRE target by year, with dollar and year axes. */
export function Chart({ data, dollars }: { data: Projection; dollars: Dollars }) {
  const rows = data.timeline;
  const last = rows.length - 1;
  const every = last <= 10 ? 2 : 5;
  const unit = dollars === "today" ? "Today's dollars" : "Future dollars";
  const fireAt = data.fire?.months_to_target ?? null;
  return (
    <Plot
      rows={rows}
      series={SERIES}
      title={unit}
      label={`Projection by year, in ${unit.toLowerCase()}`}
      when={(r) => (r.years === 0 ? "Today" : `${r.date.slice(0, 4)}, in ${r.years} yr`)}
      tick={(r, i) =>
        i % every === 0 || i === last ? (r.years === 0 ? "Today" : r.date.slice(0, 4)) : null
      }
      marker={fireAt === null ? null : fireAt / 12}
      hint="Year"
    />
  );
}
