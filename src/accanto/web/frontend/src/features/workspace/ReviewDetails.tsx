import { type KeyboardEvent, type ReactNode, useState } from "react";
import {
  decimalToCents,
  fmtDate,
  fmtShort,
  formatMoney,
  inputMoney,
  money,
  parseMoney,
  plural,
} from "../../lib/format";
import type { Activity, Metric, ReviewResult } from "../../lib/monthly";
import { Meter } from "../../ui";
import { useGridKeys } from "./useGridKeys";

type Category = keyof NonNullable<ReviewResult["comparison"]>;
type Entry = Pick<
  Activity,
  "uuid" | "financial_date" | "amount" | "funding_origin" | "is_adjustment" | "note"
> &
  Partial<Pick<Activity, "is_refund" | "fixed_cost_name" | "spending_subcategory_name">>;
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
type Amount = string | null | undefined;
/** One saved identity in a section; `id` is the identity an entry for it would carry. */
export type ReviewLine = {
  key: string;
  id: string | null;
  name: string;
  planned: Amount;
  recorded: Amount;
  difference: Amount;
  entries: Entry[];
};
export type ReviewSection = {
  category: Category;
  name: string;
  planned: Amount;
  recorded: Amount;
  difference: Amount;
  incomplete: boolean;
  lines: ReviewLine[];
  /** Lines with no entry. Unknown is never zero. */
  unknown: ReviewLine[];
  lists: Array<{ key: string; name: string; entries: Entry[] }>;
};
/** A question the Review asks about one unknown line, answered by recording an entry. */
export type Resolution = { category: Category; id: string | null; name: string; amount: string };

const names: Record<Category, string> = {
  income: "Net income",
  fixed_cost: "Fixed costs",
  spending: "Guilt-free spending",
  saving: "Saving",
  investing: "Investing",
  giving: "Giving",
};
const kinds: Record<Category, string> = {
  income: "income",
  fixed_cost: "fixed",
  spending: "free",
  saving: "save",
  investing: "invest",
  giving: "give",
};
const order: Category[] = ["income", "fixed_cost", "spending", "saving", "investing", "giving"];
const cents = (value: Amount) => (value == null ? null : decimalToCents(value));

/** The API's comparison grouped into the six sections a Review walks through. */
export function reviewSections(review: ReviewView): ReviewSection[] {
  const { version, actual, comparison } = review;
  const destinations = review.destination_comparisons;
  const top: Record<Category, [Amount, Amount, Amount, boolean]> = {
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
    const group = comparison?.[category];
    const lines: ReviewLine[] = (group?.items ?? []).map((item, index) => ({
      key: `i-${category}-${item.id ?? index}`,
      id: item.id,
      name: item.name,
      planned: item.planned,
      recorded: item.recorded,
      difference: item.difference,
      entries: item.entries,
    }));
    const missing = (
      ids: string[],
      line: (id: string) => { name: string; amount: string } | undefined,
      fallback: string,
    ) =>
      ids.map((id) => ({
        key: `m-${category}-${id}`,
        id,
        name: line(id)?.name || fallback,
        planned: line(id)?.amount,
        recorded: null,
        difference: null,
        entries: [],
      }));
    if (!group && category === "income")
      lines.push(
        ...missing(
          actual.missing_sources,
          (id) => version.incomes.find((line) => line.source_id === id),
          "Historical source",
        ),
      );
    if (!group && category === "fixed_cost")
      lines.push(
        ...missing(
          actual.missing_fixed_costs,
          (id) => {
            const line = version.fixed_costs.find((cost) => cost.fixed_cost_id === id);
            return line && { name: line.name, amount: line.monthly_amount };
          },
          "Historical fixed cost",
        ),
      );
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
          lines.push({
            key: `d-${category}-${line.id}`,
            id: line.id,
            name: group ? `${line.name} (destination allocation)` : line.name,
            planned: line.planned,
            recorded: line.recorded,
            difference: line.difference,
            entries: [],
          });
      }
    // Guilt-free spending by subcategory: recorded only, no planned amounts, and the
    // groups add up to the section's recorded total (TDD 07).
    if (category === "spending" && group?.breakdown)
      for (const part of group.breakdown)
        lines.push({
          key: `b-spending-${part.id ?? "unassigned"}`,
          id: part.id,
          name: part.name ?? "Unassigned",
          planned: undefined,
          recorded: part.recorded,
          difference: undefined,
          entries: part.entries,
        });
    const lists: ReviewSection["lists"] = [];
    const spendingEntries = review.entries.filter((e) => e.category === "spending");
    if (category === "spending" && !group?.breakdown && spendingEntries.length)
      lists.push({ key: "c-spending", name: "Contributing entries", entries: spendingEntries });
    if (group?.unplanned.length && !(category === "spending" && group.breakdown))
      lists.push({ key: `u-${category}`, name: "Unplanned activity", entries: group.unplanned });
    if (group?.adjustments.length)
      lists.push({
        key: `a-${category}`,
        name: "Adjustments, already included",
        entries: group.adjustments,
      });
    const unknown = lines.filter((line) => line.recorded === null);
    if (category === "spending" && recorded === null)
      unknown.push({
        key: "s-spending",
        id: null,
        name: names.spending,
        planned,
        recorded: null,
        difference: null,
        entries: [],
      });
    return {
      category,
      name: names[category],
      planned,
      recorded,
      difference,
      incomplete,
      lines,
      unknown,
      lists,
    };
  });
}
export const complete = (s: ReviewSection) =>
  s.recorded != null && !s.incomplete && s.unknown.length === 0;

/** How the recorded amount compares with the plan, in the section's own words. */
function standing(s: ReviewSection, current: boolean): string {
  const diff = cents(s.difference);
  if (diff === null) return `${formatMoney(s.recorded)} recorded.`;
  const amount = money(Math.abs(diff));
  switch (s.category) {
    case "income":
      return diff === 0
        ? "Received as planned."
        : diff < 0
          ? `${amount} less than planned.`
          : `${amount} more than planned.`;
    case "spending":
      return diff > 0
        ? `${amount} over plan.`
        : current
          ? `${amount} left.`
          : diff === 0
            ? "Spent as planned."
            : `${amount} unspent.`;
    case "fixed_cost":
      return diff > 0
        ? `${amount} over plan.`
        : diff === 0
          ? "Paid as planned."
          : `${amount} under plan.`;
    default:
      if (diff >= 0) return diff ? `${amount} more than planned.` : "Planned amount reached.";
      return current ? `${amount} to go.` : `${amount} short of plan.`;
  }
}
function verdict(s: ReviewSection, current: boolean): string {
  if (s.category === "spending" && s.recorded === null)
    return "No guilt-free spending is recorded for this month.";
  if (s.unknown.length) {
    const known = s.lines.length - s.unknown.length;
    return `${known} of ${plural(s.lines.length, "line")} ${known === 1 ? "has" : "have"} an entry.`;
  }
  if (s.recorded == null) return "The recorded amount is unknown for this Plan version.";
  const lead = s.incomplete
    ? "Some amounts in this section are still incomplete."
    : standing(s, current);
  const differing = s.lines
    .filter((line) => line.recorded != null && cents(line.difference))
    .slice(0, 2)
    .map((line) =>
      line.planned == null
        ? `${line.name}: ${formatMoney(line.recorded)}, not in the plan.`
        : `${line.name}: ${formatMoney(line.recorded)} of ${formatMoney(line.planned)}.`,
    );
  return [lead, ...differing].join(" ");
}
const entryName = (entry: Entry) =>
  [
    fmtDate(entry.financial_date),
    entry.funding_origin === "savings" ? "Savings-funded" : "Income-funded",
    entry.is_adjustment && "Adjustment",
    entry.is_refund && "Linked refund",
    entry.fixed_cost_name,
    entry.note,
  ]
    .filter(Boolean)
    .join(", ");

/** Answers one unknown line where it sits: the planned amount, nothing, or another amount. */
function Ask({
  section,
  line,
  busy,
  resolve,
}: {
  section: ReviewSection;
  line: ReviewLine;
  busy: boolean;
  resolve?: (resolution: Resolution) => void;
}) {
  const [other, setOther] = useState<string | null>(null);
  const [error, setError] = useState("");
  const answerable =
    resolve &&
    (section.category === "spending" ||
      (line.id !== null &&
        (section.category === "income" ||
          section.category === "fixed_cost" ||
          section.category === "saving")));
  const record = (amount: string) =>
    resolve?.({ category: section.category, id: line.id, name: line.name, amount });
  const planned = cents(line.planned);
  return (
    <div className="ask">
      <span>
        {line.name} has no entry. Unknown is not treated as $0.00.
        {!answerable &&
          (section.category === "investing" || section.category === "giving") &&
          ` Record it in ${section.category === "investing" ? "Investments" : "Giving"}.`}
      </span>
      {answerable && other === null && (
        <>
          {section.category !== "spending" && planned !== null && planned > 0 && (
            <button
              type="button"
              className="btn sm"
              disabled={busy}
              onClick={() => record(inputMoney(planned))}
            >
              Record {money(planned)}
            </button>
          )}
          <button type="button" className="btn sm" disabled={busy} onClick={() => record("0.00")}>
            Nothing this month
          </button>
          <button
            type="button"
            className="btn sm quiet"
            disabled={busy}
            onClick={() => setOther("")}
          >
            Other amount
          </button>
        </>
      )}
      {answerable && other !== null && (
        <form
          className="ar-other"
          onSubmit={(e) => {
            e.preventDefault();
            const value = parseMoney(other);
            if (value === null) {
              setError("Enter an amount such as 42.50.");
              return;
            }
            record(inputMoney(value));
          }}
        >
          <input
            // biome-ignore lint/a11y/noAutofocus: Choosing Other amount asks for the amount.
            autoFocus
            className="input"
            inputMode="decimal"
            placeholder="0.00"
            aria-label={`Amount for ${line.name}`}
            aria-invalid={Boolean(error)}
            value={other}
            onChange={(e) => {
              setOther(e.target.value);
              setError("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                setOther(null);
              }
            }}
          />
          <button type="submit" className="btn sm pri" disabled={busy}>
            Record
          </button>
          <button type="button" className="btn sm quiet" onClick={() => setOther(null)}>
            Cancel
          </button>
          {error && (
            <span className="err" role="alert">
              {error}
            </span>
          )}
        </form>
      )}
    </div>
  );
}

function Lines({ section }: { section: ReviewSection }) {
  const entryRows = (parent: string, entries: Entry[]) =>
    entries.map((entry) => (
      <tr key={`${parent}/${entry.uuid}`} className="ar-entry-row">
        <th scope="row">{entryName(entry)}</th>
        <td className="num">{formatMoney(entry.amount)}</td>
        <td className="num c-plan" />
        <td />
      </tr>
    ));
  return (
    <table className="lines ar-lines">
      <caption className="ar-sr">
        {section.name}: recorded, planned, and recorded minus planned. Unknown is not zero.
      </caption>
      <thead>
        <tr className="ln-head">
          <th scope="col">Line</th>
          <th scope="col" className="num">
            Recorded
          </th>
          <th scope="col" className="num c-plan">
            Planned
          </th>
          <th scope="col" className="num">
            Difference
          </th>
        </tr>
      </thead>
      <tbody>
        {section.lines.map((line) => (
          <LineRows key={line.key} line={line} entries={entryRows(line.key, line.entries)} />
        ))}
        {section.lists.map((list) => [
          <tr key={list.key} className="ar-list-head">
            <th scope="rowgroup" colSpan={4}>
              {list.name} ({list.entries.length})
            </th>
          </tr>,
          ...entryRows(list.key, list.entries),
        ])}
        {!section.lines.length && !section.lists.length && (
          <tr>
            <td colSpan={4}>No lines or entries.</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
function LineRows({ line, entries }: { line: ReviewLine; entries: ReactNode[] }) {
  const unknown = line.recorded === null;
  return (
    <>
      <tr>
        <th scope="row">{line.name}</th>
        <td className={`num${unknown ? " warn" : ""}`}>{formatMoney(line.recorded)}</td>
        <td className="num c-plan">
          {line.planned === undefined ? "" : formatMoney(line.planned)}
        </td>
        <td className={`num${unknown ? " warn" : ""}`}>
          {unknown ? "Unknown" : line.difference === undefined ? "" : formatMoney(line.difference)}
        </td>
      </tr>
      {entries}
    </>
  );
}

/** Ratio cards: each shows its actual and planned figures and the amounts behind them. */
export function Metrics({ metrics, title }: { metrics: Metric[]; title: string }) {
  const [all, setAll] = useState(false);
  // Keys carry their basis ("planned:…", "actual:…"); a card pairs both bases of one ratio.
  const ratio = (metric: Metric) => metric.key.replace(/^(planned|actual):/, "");
  const keys = [...new Set(metrics.map(ratio))];
  const paired = keys.filter(
    (key) => new Set(metrics.filter((m) => ratio(m) === key).map((m) => m.basis)).size === 2,
  );
  const shown = all ? keys : (paired.length ? paired : keys).slice(0, 3);
  const figure = (metric?: Metric) =>
    !metric ? "Unavailable" : metric.percentage === null ? "Unavailable" : `${metric.percentage}%`;
  const formula = (metric: Metric) =>
    `${formatMoney(metric.numerator)} ÷ ${formatMoney(metric.denominator)}`;
  return (
    <section aria-label={title}>
      <h2 className="h2">
        Ratios <span>Each shows the amounts behind it</span>
        {keys.length > shown.length || all ? (
          <button type="button" className="btn sm quiet" onClick={() => setAll(!all)}>
            {all ? "Show fewer" : "All ratios"}
          </button>
        ) : null}
      </h2>
      <div className="grid3">
        {shown.map((key) => {
          const actual = metrics.find((m) => ratio(m) === key && m.basis === "actual");
          const planned = metrics.find((m) => ratio(m) === key && m.basis === "planned");
          const label = (actual ?? planned)?.label ?? key;
          return (
            <article className="card pad ar-ratio" key={key} aria-label={label}>
              <span className="cap">{label}</span>
              <div className="fig">{figure(actual)}</div>
              <span className="cap">
                {!actual
                  ? "No actual figure for this version."
                  : actual.unavailable_reason
                    ? `Unavailable: ${actual.unavailable_reason}`
                    : `${formula(actual)} recorded`}
              </span>
              {planned && (
                <span className="cap">
                  Planned {figure(planned)}: {formula(planned)}
                  {planned.unavailable_reason && `. Unavailable: ${planned.unavailable_reason}`}
                </span>
              )}
              <details className="ar-why">
                <summary>Amounts behind it</summary>
                {[actual, planned].map(
                  (metric) =>
                    metric && (
                      <div key={metric.basis}>
                        <p className="cap">
                          {metric.basis === "planned" ? "Planned" : "Actual"}:{" "}
                          {metric.numerator_label} ÷ {metric.denominator_label} × 100
                        </p>
                        <ul>
                          {metric.components.map((component, index) => (
                            <li key={`${component.name}-${index}`}>
                              {component.name}: {formatMoney(component.amount)}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ),
                )}
              </details>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function Strip({ label, items }: { label: string; items: Array<[string, string]> }) {
  return (
    <section className="card pad" aria-label={label}>
      <h2 className="h2">{label}</h2>
      <dl className="ar-strip">
        {items.map(([name, value]) => (
          <div key={name}>
            <dt>{name}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** A guided walk through the month: one verdict per section, and each unknown asks its question. */
export function ReviewDetails({
  review,
  current = false,
  busy = false,
  resolve,
  onHelp,
}: {
  review: ReviewView;
  current?: boolean;
  busy?: boolean;
  resolve?: (resolution: Resolution) => void;
  onHelp?: () => void;
}) {
  const { actual, summary, expected } = review;
  const sections = reviewSections(review);
  const [open, setOpen] = useState<Category[]>([]);
  const [selected, setSelected] = useState<Category>("income");
  const gridKeys = useGridKeys();
  const toggle = (category: Category) =>
    setOpen(open.includes(category) ? open.filter((c) => c !== category) : [...open, category]);
  const focus = (category: Category) => {
    setSelected(category);
    requestAnimationFrame(() => document.getElementById(`review-step-${category}`)?.focus());
  };
  function onKey(e: KeyboardEvent, category: Category, index: number) {
    gridKeys(e, {
      rowId: category,
      position: { row: index, col: 0 },
      rows: sections.length,
      columns: 1,
      move: (next) => focus(sections[next.row].category),
      edit: () => toggle(category),
      help: onHelp,
    });
  }
  return (
    <>
      <div className="card" aria-describedby="review-keys">
        {sections.map((s, index) => {
          const expanded = open.includes(s.category);
          const diff = cents(s.difference);
          const recorded = cents(s.recorded);
          const planned = cents(s.planned);
          return (
            <section className="step" key={s.category} aria-label={s.name}>
              <span
                className={`mark${complete(s) ? "" : " q"}`}
                role="img"
                aria-label={complete(s) ? "Complete" : "Not complete"}
              >
                {complete(s) ? "✓" : "?"}
              </span>
              <div>
                <h3 className="nm">
                  {s.name}
                  <button
                    type="button"
                    id={`review-step-${s.category}`}
                    className="disclose"
                    tabIndex={selected === s.category ? 0 : -1}
                    aria-expanded={expanded}
                    onFocus={() => setSelected(s.category)}
                    onKeyDown={(e) => onKey(e, s.category, index)}
                    onClick={() => toggle(s.category)}
                  >
                    {expanded
                      ? "Hide lines"
                      : s.category === "spending"
                        ? plural(
                            s.lists.reduce(
                              (n, list) => n + list.entries.length,
                              s.lines.reduce((n, line) => n + line.entries.length, 0),
                            ),
                            "entry",
                            "entries",
                          )
                        : plural(s.lines.length, "line")}
                  </button>
                </h3>
                <p className="say">{verdict(s, current)}</p>
              </div>
              <div className={`amt-col${s.recorded === null ? " warn" : ""}`}>
                {formatMoney(s.recorded)}
                <small>
                  of {s.planned == null ? "an unknown plan" : formatMoney(s.planned)}
                  {complete(s) &&
                    diff !== null &&
                    (diff === 0
                      ? ", on plan"
                      : `, ${money(Math.abs(diff))} ${diff < 0 ? "under" : "over"}`)}
                  {s.incomplete && s.recorded !== null && ", incomplete"}
                </small>
              </div>
              {recorded !== null && planned !== null ? (
                <Meter value={recorded} max={planned} kind={kinds[s.category]} />
              ) : (
                <Meter value={0} max={1} kind={kinds[s.category]} faint />
              )}
              {s.unknown.map((line) => (
                <Ask key={line.key} section={s} line={line} busy={busy} resolve={resolve} />
              ))}
              {expanded && <Lines section={s} />}
            </section>
          );
        })}
      </div>
      <p id="review-keys" className="note ar-keys">
        <kbd className="kbd">j</kbd> <kbd className="kbd">k</kbd> move between sections,{" "}
        <kbd className="kbd">Enter</kbd> shows or hides lines, <kbd className="kbd">?</kbd> all keys
      </p>
      {!review.destination_comparisons && (
        <p className="note">Destination comparison for this older version: Unknown</p>
      )}
      {!review.comparison && review.entries.length > 0 && (
        <section aria-label="Activity in this month">
          <h2 className="h2">Activity in this month</h2>
          <div className="card">
            {review.entries.map((entry) => (
              <div className="row" key={entry.uuid}>
                <span className="t">
                  {[entry.fixed_cost_name, entry.note].filter(Boolean).join(", ") ||
                    names[entry.category]}
                  <small>
                    {fmtShort(entry.financial_date)}, {names[entry.category]}
                    {entry.is_adjustment && ", adjustment"}
                  </small>
                </span>
                <span className="a">{formatMoney(entry.amount)}</span>
              </div>
            ))}
          </div>
        </section>
      )}
      {review.metrics && <Metrics title="Planned and actual metrics" metrics={review.metrics} />}
      {(summary || "savings_used" in actual || expected) && (
        <div className="grid2 ar-strips">
          {(summary || "savings_used" in actual) && (
            <Strip
              label="Same-month saving and funding"
              items={
                [
                  ...("savings_used" in actual
                    ? [["Outflows funded from savings", formatMoney(actual.savings_used ?? null)]]
                    : []),
                  ...(summary
                    ? [
                        ["New saving", formatMoney(summary.new_saving)],
                        [
                          "Savings used",
                          `${formatMoney(summary.savings_used)}${summary.savings_used_incomplete ? " (incomplete)" : ""}`,
                        ],
                        ["Net saving", formatMoney(summary.net_saving)],
                        ["Investment contributions", formatMoney(summary.total_investing)],
                        ["Income-funded investing", formatMoney(summary.income_funded_investing)],
                        [
                          "Income-funded fixed costs",
                          formatMoney(summary.income_funded_fixed_cost),
                        ],
                      ]
                    : []),
                ] as Array<[string, string]>
              }
            />
          )}
          {expected && (
            <Strip
              label="Planned funding"
              items={[
                ["Planned use of savings", formatMoney(expected.savings_funding)],
                ["Total planned funding", formatMoney(expected.funding)],
                ["Total planned allocation", formatMoney(expected.allocation)],
              ]}
            />
          )}
        </div>
      )}
    </>
  );
}
