import type { Activity, Metric, ReviewResult } from "../../lib/monthly";
import { dollars } from "./shared";

export function Metrics({ metrics, title }: { metrics: Metric[]; title: string }) {
  return (
    <section aria-label={title}>
      <h3>{title}</h3>
      <p>Each ratio uses its own stated basis and same-period amounts.</p>
      {metrics.map((metric) => (
        <details key={`${metric.basis}-${metric.key}`}>
          <summary>
            {metric.basis === "planned" ? "Planned" : "Actual"} · {metric.label}:{" "}
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
      ))}
    </section>
  );
}
function Contributors({ entries }: { entries: Activity[] }) {
  return entries.length ? (
    <ul>
      {entries.map((entry) => (
        <li key={entry.uuid}>
          <time>{entry.financial_date}</time> · {dollars(entry.amount)} ·{" "}
          {entry.funding_origin === "savings" ? "Savings-funded" : "Income-funded"}
          {entry.is_adjustment && " · Adjustment"}
          {entry.is_refund && " · Linked refund"}
          {entry.note && ` · ${entry.note}`}
        </li>
      ))}
    </ul>
  ) : (
    <p>No recorded entries. Unknown is not zero.</p>
  );
}
const labels = {
  income: "Net income",
  fixed_cost: "Fixed costs",
  spending: "Guilt-free spending",
  saving: "New saving",
  investing: "Investing",
  giving: "Giving",
};
export function ReviewDetails({
  review,
}: { review: Pick<ReviewResult, "comparison" | "summary" | "metrics"> }) {
  return (
    <>
      {review.comparison && (
        <section aria-label="Comparison by saved identity">
          <h3>Comparison by saved identity</h3>
          <p>
            Recorded minus planned. Missing expected identities remain unknown. Unplanned activity
            contributes once to its category.
          </p>
          {Object.entries(review.comparison).map(([category, group]) => (
            <section
              key={category}
              aria-label={`${labels[category as keyof typeof labels]} details`}
            >
              <h4>{labels[category as keyof typeof labels]}</h4>
              <p>
                Planned {dollars(group.planned)} · Recorded {dollars(group.recorded)}
                {group.incomplete && " (incomplete)"} · Difference {dollars(group.difference)}
              </p>
              {group.items.map((item, index) => (
                <details key={item.id ?? index}>
                  <summary>
                    {item.name} · Planned {dollars(item.planned)} · Recorded{" "}
                    {dollars(item.recorded)} · Difference {dollars(item.difference)}
                  </summary>
                  <Contributors entries={item.entries} />
                </details>
              ))}
              {group.unplanned.length > 0 && (
                <details>
                  <summary>Unplanned {labels[category as keyof typeof labels]} activity</summary>
                  <Contributors entries={group.unplanned} />
                </details>
              )}
              {group.adjustments.length > 0 && (
                <details>
                  <summary>Contributing adjustments (already included)</summary>
                  <Contributors entries={group.adjustments} />
                </details>
              )}
            </section>
          ))}
        </section>
      )}
      {review.summary && (
        <section aria-label="Same-month saving and funding">
          <h3>Same-month saving and funding</h3>
          <p>
            New saving {dollars(review.summary.new_saving)} − savings used{" "}
            {dollars(review.summary.savings_used)} = net saving {dollars(review.summary.net_saving)}
            .
          </p>
          <p>
            Total investment contributions: {dollars(review.summary.total_investing)}. Income-funded
            investment contributions: {dollars(review.summary.income_funded_investing)}.
          </p>
          <p>
            Income-funded fixed costs: {dollars(review.summary.income_funded_fixed_cost)}.
            Observations and transfers do not enter activity totals.
          </p>
        </section>
      )}
      {review.metrics && <Metrics title="Planned and actual metrics" metrics={review.metrics} />}
    </>
  );
}
