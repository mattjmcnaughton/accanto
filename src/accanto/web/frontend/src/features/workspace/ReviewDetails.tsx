import { type KeyboardEvent, useState } from "react";
import type { Activity, ComparisonGroup, Metric, ReviewResult } from "../../lib/monthly";
import { dollars } from "./shared";
import { useGridKeys } from "./useGridKeys";

type Category = keyof NonNullable<ReviewResult["comparison"]>;
type Entry = Pick<
  Activity,
  "uuid" | "financial_date" | "amount" | "funding_origin" | "is_adjustment" | "note"
> &
  Partial<Pick<Activity, "is_refund" | "fixed_cost_name">>;
type Row = {
  id: string;
  kind: "group" | "item" | "entry";
  name: string;
  planned?: string | null;
  recorded?: string | null;
  difference?: string | null;
  state?: string;
  children: Row[];
};
export type ReviewView = Pick<
  ReviewResult,
  | "version"
  | "actual"
  | "income_difference"
  | "spending_difference"
  | "fixed_cost_difference"
  | "entries"
> &
  Partial<
    Pick<
      ReviewResult,
      "comparison" | "summary" | "metrics" | "expected" | "differences" | "destination_comparisons"
    >
  >;
const labels: Record<Category, string> = {
  income: "Net income",
  fixed_cost: "Fixed costs",
  spending: "Guilt-free spending",
  saving: "New saving",
  investing: "Investing",
  giving: "Giving",
};
const order: Category[] = ["income", "fixed_cost", "spending", "saving", "investing", "giving"];
const columns = ["Category / item", "Planned", "Recorded", "Difference", "State"];

/** The same entry can be listed under several parents (e.g. unplanned and adjustments), so ids are scoped. */
const entryRow =
  (parent: string) =>
  (entry: Entry): Row => ({
    id: `${parent}/e-${entry.uuid}`,
    kind: "entry",
    name: [
      entry.financial_date,
      entry.funding_origin === "savings" ? "Savings-funded" : "Income-funded",
      entry.is_adjustment && "Adjustment",
      entry.is_refund && "Linked refund",
      entry.fixed_cost_name,
      entry.note,
    ]
      .filter(Boolean)
      .join(" · "),
    recorded: entry.amount,
    children: [],
  });
const listRow = (id: string, name: string, entries: Entry[]): Row[] =>
  entries.length
    ? [
        {
          id,
          kind: "item",
          name: `${name} (${entries.length})`,
          children: entries.map(entryRow(id)),
        },
      ]
    : [];

/** One grouped comparison; every identity, contributor and destination line keeps its own row. */
function comparisonRows(review: ReviewView): Row[] {
  const { version, actual, comparison } = review;
  const destinations = review.destination_comparisons;
  const top: Record<Category, [string | null, string | null, string | null, boolean]> = {
    income: [
      version.income,
      actual.income_recorded,
      review.income_difference,
      actual.income_incomplete,
    ],
    fixed_cost: [
      version.fixed_cost_total,
      actual.fixed_cost_recorded,
      review.fixed_cost_difference,
      actual.fixed_cost_incomplete,
    ],
    spending: [
      version.spending,
      actual.spending_recorded,
      review.spending_difference,
      Boolean(comparison?.spending.incomplete),
    ],
    saving: [
      review.expected?.saving ?? null,
      actual.saving_recorded ?? null,
      review.differences?.saving ?? null,
      Boolean(comparison?.saving.incomplete),
    ],
    investing: [
      review.expected?.investing ?? null,
      actual.investing_recorded ?? null,
      review.differences?.investing ?? null,
      Boolean(comparison?.investing.incomplete),
    ],
    giving: [
      review.expected?.giving ?? null,
      actual.giving_recorded ?? null,
      review.differences?.giving ?? null,
      Boolean(comparison?.giving.incomplete),
    ],
  };
  const destinationLines = {
    saving: destinations?.saving_goals.map((l) => ({ ...l, id: l.goal_id, name: l.goal_name })),
    investing: destinations?.investments.map((l) => ({
      ...l,
      id: l.destination_id,
      name: l.destination_name,
    })),
    giving: destinations?.giving.map((l) => ({
      ...l,
      id: l.destination_id,
      name: l.destination_name,
    })),
  };
  return order.map((category) => {
    const [planned, recorded, difference, incomplete] = top[category];
    const group: ComparisonGroup | undefined = comparison?.[category];
    const children: Row[] = [];
    group?.items.forEach((item, index) => {
      children.push({
        id: `i-${category}-${item.id ?? index}`,
        kind: "item",
        name: item.name,
        planned: item.planned,
        recorded: item.recorded,
        difference: item.difference,
        state: item.recorded === null ? "Unknown" : "",
        children: item.entries.map(entryRow(`i-${category}-${item.id ?? index}`)),
      });
    });
    if (!group && category === "income")
      for (const id of actual.missing_sources)
        children.push({
          id: `m-income-${id}`,
          kind: "item",
          name: version.incomes.find((line) => line.source_id === id)?.name || "Historical source",
          recorded: null,
          state: "Unknown",
          children: [],
        });
    if (!group && category === "fixed_cost")
      for (const id of actual.missing_fixed_costs)
        children.push({
          id: `m-fixed-${id}`,
          kind: "item",
          name:
            version.fixed_costs.find((line) => line.fixed_cost_id === id)?.name ||
            "Historical fixed cost",
          recorded: null,
          state: "Unknown",
          children: [],
        });
    if (category === "saving" || category === "investing" || category === "giving")
      for (const line of destinationLines[category] ?? []) {
        const same = group?.items.find(
          (item) =>
            item.id === line.id &&
            item.planned === line.planned &&
            item.recorded === line.recorded &&
            item.difference === line.difference,
        );
        if (!same)
          children.push({
            id: `d-${category}-${line.id}`,
            kind: "item",
            name: group ? `${line.name} · destination allocation` : line.name,
            planned: line.planned,
            recorded: line.recorded,
            difference: line.difference,
            state: line.recorded === null ? "Unknown" : "",
            children: [],
          });
      }
    if (category === "spending")
      children.push(
        ...listRow(
          "c-spending",
          "Contributing entries",
          review.entries.filter((e) => e.category === "spending"),
        ),
      );
    if (group) {
      children.push(...listRow(`u-${category}`, "Unplanned activity", group.unplanned));
      children.push(
        ...listRow(`a-${category}`, "Adjustments, already included", group.adjustments),
      );
    }
    return {
      id: `g-${category}`,
      kind: "group",
      name: labels[category],
      planned,
      recorded,
      difference,
      state: recorded === null ? "Unknown" : incomplete ? "Incomplete" : "",
      children,
    };
  });
}

function ComparisonGrid({ review, onHelp }: { review: ReviewView; onHelp?: () => void }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [selection, setSelection] = useState({ id: "g-income", col: 0 });
  const gridKeys = useGridKeys();
  const isOpen = (row: Row) => open[row.id] ?? row.kind === "group";
  const rows: Array<Row & { depth: number }> = [];
  const walk = (list: Row[], depth: number) => {
    for (const row of list) {
      rows.push({ ...row, depth });
      if (isOpen(row)) walk(row.children, depth + 1);
    }
  };
  walk(comparisonRows(review), 0);
  const index = Math.max(
    0,
    rows.findIndex((row) => row.id === selection.id),
  );
  const focus = (id: string, col: number) => {
    setSelection({ id, col });
    requestAnimationFrame(() => document.getElementById(`review-${id}-${col}`)?.focus());
  };
  const toggle = (row: Row) => {
    if (row.children.length) setOpen({ ...open, [row.id]: !isOpen(row) });
  };
  function onKey(e: KeyboardEvent, row: Row, rowIndex: number, col: number) {
    if (e.key === " ") {
      e.preventDefault();
      toggle(row);
      return;
    }
    gridKeys(e, {
      rowId: row.id,
      position: { row: rowIndex, col },
      rows: rows.length,
      columns: columns.length,
      move: (next) => focus(rows[next.row].id, next.col),
      edit: () => toggle(row),
      help: onHelp,
    });
  }
  return (
    <div className="data-table-scroll">
      <table
        className="data-grid review-grid"
        role="treegrid"
        aria-readonly="true"
        aria-label="Comparison by category and saved identity"
        aria-describedby="review-status"
      >
        <caption className="sr-only">USD · recorded minus planned · Unknown is not zero</caption>
        <thead>
          <tr>
            {columns.map((name, col) => (
              <th key={name} scope="col" className={col && col < 4 ? "numeric" : undefined}>
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr
              key={row.id}
              className={`${row.kind}-row ${row.depth ? "child-row" : ""}`}
              aria-level={row.depth + 1}
              aria-expanded={row.children.length ? isOpen(row) : undefined}
            >
              {columns.map((name, col) => {
                const active = rowIndex === index && col === selection.col;
                const value = [row.name, row.planned, row.recorded, row.difference, row.state][col];
                return (
                  <td
                    key={name}
                    id={`review-${row.id}-${col}`}
                    aria-selected={active}
                    tabIndex={active ? 0 : -1}
                    style={col === 0 ? { paddingLeft: 14 + row.depth * 20 } : undefined}
                    className={`${col && col < 4 ? "numeric" : ""} ${(col === 2 || col === 4) && row.state === "Unknown" ? "unknown" : ""} ${col === 3 && value?.startsWith("-") ? "negative" : ""}`}
                    onKeyDown={(e) => onKey(e, row, rowIndex, col)}
                    onClick={() => focus(row.id, col)}
                  >
                    {col === 0 ? (
                      <>
                        {row.children.length ? (
                          <button
                            type="button"
                            tabIndex={-1}
                            className="icon-button toggle"
                            aria-label={`${isOpen(row) ? "Collapse" : "Expand"} ${row.name}`}
                            onClick={() => toggle(row)}
                          >
                            {isOpen(row) ? "▾" : "▸"}
                          </button>
                        ) : (
                          <span className="toggle" />
                        )}
                        {row.name}
                      </>
                    ) : col === 4 ? (
                      (value ?? "")
                    ) : value === undefined ? (
                      ""
                    ) : (
                      dollars(value)
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Metrics({ metrics, title }: { metrics: Metric[]; title: string }) {
  return (
    <section aria-label={title}>
      <h3 className="table-title">{title}</h3>
      <div className="data-table-scroll">
        <table className="data-grid metrics">
          <thead>
            <tr>
              <th scope="col">Metric</th>
              <th scope="col">Basis</th>
              <th scope="col">Result</th>
            </tr>
          </thead>
          <tbody>
            {metrics.map((metric) => (
              <tr key={`${metric.basis}-${metric.key}`}>
                <th scope="row">{metric.label}</th>
                <td>{metric.basis === "planned" ? "Planned" : "Actual"}</td>
                <td>
                  <details>
                    <summary>
                      {metric.percentage === null ? "Unavailable" : `${metric.percentage}%`}
                    </summary>
                    <p>
                      {metric.numerator_label} ÷ {metric.denominator_label} × 100
                    </p>
                    <p>
                      {dollars(metric.numerator)} ÷ {dollars(metric.denominator)} × 100
                    </p>
                    {metric.unavailable_reason && <p>Unavailable: {metric.unavailable_reason}</p>}
                    <ul>
                      {metric.components.map((component, index) => (
                        <li key={`${component.name}-${index}`}>
                          {component.name}: {dollars(component.amount)}
                        </li>
                      ))}
                    </ul>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Strip({ label, items }: { label: string; items: Array<[string, string]> }) {
  return (
    <dl className="summary-strip" aria-label={label}>
      {items.map(([name, value]) => (
        <div key={name}>
          <dt>{name}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ReviewDetails({ review, onHelp }: { review: ReviewView; onHelp?: () => void }) {
  const { actual, summary, expected } = review;
  const missing = actual.missing_sources.length + actual.missing_fixed_costs.length;
  return (
    <>
      {missing > 0 && (
        <p className="attention">
          Unknown:{" "}
          {[
            [actual.missing_sources.length, "income source"],
            [actual.missing_fixed_costs.length, "fixed cost"],
          ]
            .filter(([count]) => count)
            .map(([count, name]) => `${count} ${name}${count === 1 ? "" : "s"}`)
            .join(", ")}
          . Record an entry for each, including an explicit zero when appropriate.
        </p>
      )}
      <ComparisonGrid review={review} onHelp={onHelp} />
      {!review.destination_comparisons && (
        <p className="attention">Destination comparison for this older version: Unknown</p>
      )}
      {!review.comparison && review.entries.length > 0 && (
        <section aria-label="Activity in this month">
          <h3 className="table-title">Activity in this month</h3>
          <table className="data-grid">
            <tbody>
              {review.entries.map((entry) => (
                <tr key={entry.uuid}>
                  <td>{entry.financial_date}</td>
                  <td>
                    {entry.category}
                    {entry.is_adjustment && " adjustment"}
                  </td>
                  <td className="numeric">{dollars(entry.amount)}</td>
                  <td>{[entry.fixed_cost_name, entry.note].filter(Boolean).join(" · ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {expected && (
        <Strip
          label="Planned funding"
          items={[
            ["Planned use of savings", dollars(expected.savings_funding)],
            ["Total planned funding", dollars(expected.funding)],
            ["Total planned allocation", dollars(expected.allocation)],
          ]}
        />
      )}
      {(summary || "savings_used" in actual) && (
        <Strip
          label="Same-month saving and funding"
          items={[
            ...("savings_used" in actual
              ? [
                  ["Outflows funded from savings", dollars(actual.savings_used ?? null)] as [
                    string,
                    string,
                  ],
                ]
              : []),
            ...(summary
              ? ([
                  ["New saving", dollars(summary.new_saving)],
                  [
                    "Savings used",
                    `${dollars(summary.savings_used)}${summary.savings_used_incomplete ? " (incomplete)" : ""}`,
                  ],
                  ["Net saving", dollars(summary.net_saving)],
                  ["Investment contributions", dollars(summary.total_investing)],
                  ["Income-funded investing", dollars(summary.income_funded_investing)],
                  ["Income-funded fixed costs", dollars(summary.income_funded_fixed_cost)],
                ] as Array<[string, string]>)
              : []),
          ]}
        />
      )}
      {review.metrics && <Metrics title="Planned and actual metrics" metrics={review.metrics} />}
    </>
  );
}
