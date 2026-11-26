import type { LoadState } from "../../lib/api";
import type { Loan } from "../../lib/balances";
import type { Destination } from "../../lib/destinations";
import {
  daysInMonth,
  decimalToCents,
  fmtShort,
  formatMoney,
  money,
  monthName,
  plural,
} from "../../lib/format";
import type { ComparisonGroup, ReviewResult } from "../../lib/monthly";
import type { SavingsAccount } from "../../lib/savings";
import { Band, type BandPart, Empty, tint } from "../../ui";
import type { Screen } from "./Workspace";
import { LoadMessage } from "./shared";

/** A Plan Home asks about: overallocated, or edited in this tab and not saved. */
export type PlanAttention = {
  id: string;
  name: string;
  dirty: boolean;
  funding: number | null;
  allocated: number | null;
  unassigned: number | null;
};
type Item = {
  key: string;
  title: string;
  detail: string;
  action?: string;
  run?: () => void;
  quiet?: boolean;
};
type Category = keyof NonNullable<ReviewResult["comparison"]>;
const OUT: { key: Category; kind: string; name: string }[] = [
  { key: "fixed_cost", kind: "fixed", name: "Fixed costs" },
  { key: "spending", kind: "free", name: "Guilt-free spending" },
  { key: "saving", kind: "save", name: "Saving" },
  { key: "investing", kind: "invest", name: "Investing" },
  { key: "giving", kind: "give", name: "Giving" },
];
const cents = (value: string | null | undefined) =>
  value === null || value === undefined ? null : decimalToCents(value);

/** Words for a category's recorded-against-planned state, from the API's own difference. */
function status(key: Category, group: ComparisonGroup) {
  const missing = group.items.filter((item) => item.recorded === null).length;
  if (missing) return { tone: "warn", text: `${plural(missing, "line")} with no entry` };
  const difference = cents(group.difference);
  if (group.recorded === null || difference === null)
    return { tone: "", text: "Nothing recorded yet" };
  if (difference === 0) return { tone: "good", text: "On plan" };
  const outflow = key === "fixed_cost" || key === "spending";
  if (difference < 0)
    return key === "spending"
      ? { tone: "good", text: `${money(-difference)} left` }
      : { tone: "", text: `${money(-difference)} to go` };
  return outflow
    ? { tone: "bad", text: `${money(difference)} over` }
    : { tone: "good", text: `${money(difference)} more than planned` };
}

/**
 * Home answers three questions in order: what can I still spend freely, where has the month's
 * money gone against the plan, and what needs me. Every figure comes from the API as it is.
 */
export function Home({
  month,
  today,
  plans,
  hasVersion,
  attention,
  recent,
  review,
  accounts,
  investments,
  loans,
  open,
  newPlan,
  showPlans,
  go,
  retry,
}: {
  /** The month Home shows, YYYY-MM. */
  month: string;
  today: string;
  plans: number;
  hasVersion: boolean;
  attention: PlanAttention[];
  /** The most recently updated Plans, to return to a draft quickly. */
  recent: { id: string; name: string; detail: string }[];
  review: LoadState<ReviewResult>;
  accounts: LoadState<SavingsAccount[]>;
  investments: LoadState<Destination[]>;
  loans: LoadState<Loan[]>;
  open: (id: string) => void;
  newPlan: () => void;
  showPlans: () => void;
  /** Opens another screen; without it, items say where to go instead of linking. */
  go?: (to: Screen) => void;
  retry: () => void;
}) {
  if (!plans) return <Welcome newPlan={newPlan} />;
  const toReview = go && (() => go("review"));
  const name = monthName(month);
  // An empty mocked or legacy body is treated as no Review rather than as zeros.
  const result = review.kind === "ready" && review.data?.review ? review.data : null;
  const comparison = result?.comparison;

  const items: Item[] = [];
  if (comparison) {
    const unknown = (["income", "fixed_cost", "saving", "investing", "giving"] as const).flatMap(
      (key) => comparison[key].items.filter((item) => item.recorded === null),
    );
    if (unknown.length > 4)
      items.push({
        key: "unknown",
        title: `${unknown.length} planned lines have no ${name} entry`,
        detail: "Resolve each in Review: record what happened, or $0.00 if nothing did.",
        action: toReview && "Resolve in Review",
        run: toReview,
      });
    else
      for (const line of unknown)
        items.push({
          key: `u-${line.id}-${line.name}`,
          title: `${line.name} has no ${name} entry`,
          detail: `Planned ${formatMoney(line.planned)}. Record what happened in Review, or $0.00 if nothing did.`,
          action: toReview && "Resolve in Review",
          run: toReview,
        });
  }
  for (const plan of attention) {
    const over = plan.unassigned !== null && plan.unassigned < 0;
    items.push({
      key: `p-${plan.id}`,
      title: over
        ? `Plan "${plan.name}" is ${money(-(plan.unassigned ?? 0))} overallocated`
        : `Plan "${plan.name}" has unsaved changes`,
      detail: over
        ? `Monthly funding ${money(plan.funding ?? 0)} − allocations ${money(plan.allocated ?? 0)}. You can still save a version; the overage stays visible.${plan.dirty ? " Unsaved changes in this tab." : ""}`
        : "Unsaved changes in this tab. Save the draft to keep them.",
      action: plan.dirty ? "Open draft" : "Open Plan",
      run: () => open(plan.id),
    });
  }
  if (result && !result.review.reviewed_at)
    items.push({
      key: "review",
      title: `${name} is not reviewed yet`,
      detail: comparison
        ? "Mark it reviewed in Review once the month is complete."
        : "Open Review to compare the month against its Plan version.",
      action: toReview && `Review ${name}`,
      run: toReview,
      quiet: true,
    });

  return (
    <div className="screen home">
      {review.kind === "loading" ? (
        <div className="card pad sk-card" aria-busy="true" aria-label="Loading this month">
          <div className="sk" style={{ width: "55%", height: 28 }} />
          <div className="sk" style={{ width: "40%", height: 14 }} />
          <div className="sk" style={{ height: 8 }} />
        </div>
      ) : result ? (
        comparison && (
          <Hero
            month={month}
            today={today}
            spending={comparison.spending}
            difference={result.spending_difference}
          />
        )
      ) : review.kind === "not_found" || review.kind === "empty" || review.kind === "ready" ? (
        <Empty
          title={`${name} has no Review yet`}
          action={
            hasVersion ? (
              toReview && (
                <button type="button" className="btn pri" onClick={toReview}>
                  Start {name}'s Review
                </button>
              )
            ) : (
              <button type="button" className="btn pri" onClick={showPlans}>
                Open Plans
              </button>
            )
          }
        >
          {hasVersion
            ? `Start ${name}'s Review and choose a saved Plan version to compare this month against. Home then shows what is left to spend and where the money is going.`
            : "Save a Plan version first. A Review compares a month against one saved version."}
        </Empty>
      ) : (
        <div className="card pad">
          <LoadMessage state={review} retry={retry} />
        </div>
      )}
      {result && comparison && (
        <section aria-labelledby="home-going">
          <h2 className="h2" id="home-going">
            Where {name}'s money is going{" "}
            <span>
              Recorded so far against {result.version.name}, version {result.version.number}
            </span>
          </h2>
          <MonthBreakdown comparison={comparison} name={name} />
        </section>
      )}
      {items.length > 0 && (
        <section aria-labelledby="home-needs">
          <h2 className="h2" id="home-needs">
            Needs you <span>{plural(items.length, "item")}</span>
          </h2>
          <ul className="card home-list" aria-label="Needs you">
            {items.map((item) => {
              const body = (
                <>
                  <span className={`pip${item.quiet ? " quiet" : ""}`} />
                  <span className="t">
                    {item.title}
                    <small>{item.detail}</small>
                  </span>
                  {item.action && <span className="go">{item.action}</span>}
                </>
              );
              return (
                <li key={item.key}>
                  {item.run ? (
                    <button type="button" className="row" onClick={item.run} data-row>
                      {body}
                    </button>
                  ) : (
                    <div className="row">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {recent.length > 0 && (
        <section aria-labelledby="home-plans">
          <h2 className="h2" id="home-plans">
            Your Plans <span>{plural(plans, "Plan")}, most recently updated first</span>
            <button type="button" className="btn sm quiet" onClick={showPlans}>
              All Plans
            </button>
          </h2>
          <ul className="card home-list" aria-label="Your Plans">
            {recent.map((plan) => (
              <li key={plan.id} className="row">
                <span className="t">
                  <button type="button" className="home-plan" onClick={() => open(plan.id)}>
                    {plan.name}
                  </button>
                  <small>{plan.detail}</small>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <Standing accounts={accounts} investments={investments} loans={loans} retry={retry} />
    </div>
  );
}

/** Where a month's money is going: recorded against planned per category, as the API reports it. */
export function MonthBreakdown({
  comparison,
  name,
}: {
  comparison: NonNullable<ReviewResult["comparison"]>;
  name: string;
}) {
  return (
    <div className="card pad">
      <Band
        label={`Recorded against planned for ${name}`}
        parts={OUT.map(({ key, kind, name: title }): BandPart => {
          const group = comparison[key];
          const planned = cents(group.planned) ?? 0;
          const recorded = cents(group.recorded) ?? 0;
          const missing = group.items
            .filter((item) => item.recorded === null)
            .reduce((total, item) => total + (cents(item.planned) ?? 0), 0);
          return {
            key,
            kind,
            weight: planned,
            fill: planned ? recorded / planned : 0,
            hatch: planned ? missing / planned : 0,
            title: `${title}: ${formatMoney(group.recorded)} recorded of ${formatMoney(group.planned)}`,
          };
        })}
      />
      <table className="buckets">
        <caption className="sr-only">Recorded against planned by category</caption>
        <thead>
          <tr>
            <th scope="col">
              <span className="sr-only">Color</span>
            </th>
            <th scope="col">Category</th>
            <th scope="col" className="num">
              Recorded
            </th>
            <th scope="col" className="num">
              Planned
            </th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {OUT.map(({ key, kind, name: title }) => {
            const group = comparison[key];
            const st = status(key, group);
            return (
              <tr key={key} style={tint(kind)}>
                <td>
                  <span className="dot" />
                </td>
                <th scope="row">{title}</th>
                <td className="num">{formatMoney(group.recorded)}</td>
                <td className="num muted">{formatMoney(group.planned)}</td>
                <td className={st.tone}>{st.text}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="note home-legend">
        Income: {formatMoney(comparison.income.recorded)} of{" "}
        {formatMoney(comparison.income.planned)} received.{" "}
        {status("income", comparison.income).text}. Solid is recorded, pale is planned, and hatching
        is a planned line with no entry.
      </p>
    </div>
  );
}

export function Hero({
  month,
  today,
  spending,
  difference,
}: {
  month: string;
  today: string;
  spending: ComparisonGroup;
  difference: string | null;
}) {
  const days = daysInMonth(month);
  const day = Number(today.slice(8, 10));
  // Only the current month has a today; another month shows its figures without a pace marker.
  const current = month === today.slice(0, 7);
  const name = monthName(month);
  const planned = cents(spending.planned) ?? 0;
  const recorded = cents(spending.recorded);
  const over = cents(difference);
  return (
    <div className="card pad home-hero">
      <h1 className="h1">
        {over === null
          ? `${formatMoney(spending.planned)} is planned for guilt-free spending ${current ? "this month" : `in ${name}`}`
          : over <= 0
            ? current
              ? `${money(-over)} left to spend freely this month`
              : `${money(-over)} left of ${name}'s guilt-free plan`
            : `${money(over)} over your guilt-free plan${current ? "" : ` in ${name}`}`}
      </h1>
      <p className="sub">
        {recorded === null
          ? "Nothing is recorded for guilt-free spending yet."
          : `${money(recorded)} of ${formatMoney(spending.planned)} planned is spent.`}
      </p>
      <div className="pace" role="presentation">
        <i
          style={{
            width: `${planned && recorded !== null ? Math.min(1, Math.max(0, recorded / planned)) * 100 : 0}%`,
            background: over !== null && over > 0 ? "var(--bad)" : undefined,
          }}
        />
        {current && <b style={{ left: `${(day / days) * 100}%` }} />}
      </div>
      <div className="pace-labels">
        <span>{fmtShort(`${month}-01`)}</span>
        {current && (
          <span>
            Today is day {day} of {days}
          </span>
        )}
        <span>{fmtShort(`${month}-${days}`)}</span>
      </div>
    </div>
  );
}

/** Savings, investments and loans stay separate measures, each as the API reports it. */
function Standing({
  accounts,
  investments,
  loans,
  retry,
}: {
  accounts: LoadState<SavingsAccount[]>;
  investments: LoadState<Destination[]>;
  loans: LoadState<Loan[]>;
  retry: () => void;
}) {
  const cards = [
    {
      key: "save",
      label: "Savings, tracked from your entries",
      state: accounts,
      rows:
        accounts.kind === "ready"
          ? accounts.data
              .filter((a) => a.active)
              .map((a) => ({
                id: a.uuid,
                name: a.name,
                value: formatMoney(a.balance),
                when: `${plural(a.goals.filter((g) => g.active && !g.completed).length, "goal")}`,
              }))
          : [],
    },
    {
      key: "invest",
      label: "Investments, latest observations",
      state: investments,
      rows:
        investments.kind === "ready"
          ? investments.data
              .filter((d) => d.active)
              .map((d) => ({
                id: d.uuid,
                name: d.name,
                value: d.latest ? formatMoney(d.latest.amount) : "Not observed",
                when: d.latest ? `Observed ${fmtShort(d.latest.date)}` : "",
              }))
          : [],
    },
    {
      key: "fixed",
      label: "Loans owed, latest observations",
      state: loans,
      rows:
        loans.kind === "ready"
          ? loans.data
              .filter((l) => l.active)
              .map((l) => ({
                id: l.uuid,
                name: l.name,
                value: l.latest ? formatMoney(l.latest.amount) : "Not observed",
                when: l.latest ? `Observed ${fmtShort(l.latest.financial_date)}` : "",
              }))
          : [],
    },
  ].filter(
    (card) => card.state.kind !== "empty" && !(card.state.kind === "ready" && !card.rows.length),
  );
  if (!cards.length) return null;
  return (
    <section aria-labelledby="home-stand">
      <h2 className="h2" id="home-stand">
        Where things stand <span>Separate measures as of today, not one total</span>
      </h2>
      <div className="grid3">
        {cards.map((card) => (
          <div key={card.key} className="card pad stand-card" style={tint(card.key)}>
            <span className="cap">
              <span className="dot" /> {card.label}
            </span>
            {card.state.kind === "loading" ? (
              <div className="sk" style={{ height: 40, marginTop: 10 }} />
            ) : card.state.kind === "ready" ? (
              <ul className="stand-rows">
                {card.rows.map((row) => (
                  <li key={row.id}>
                    <span className="t">
                      {row.name}
                      {row.when && <small>{row.when}</small>}
                    </span>
                    <b>{row.value}</b>
                  </li>
                ))}
              </ul>
            ) : (
              <LoadMessage state={card.state} retry={retry} />
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

/** First run: say what the app is for and offer the first action. */
function Welcome({ newPlan }: { newPlan: () => void }) {
  return (
    <div className="screen home">
      <div>
        <h1 className="h1">Plan a month, record what happens, then compare the two</h1>
        <p className="sub">
          Accanto keeps what you intended, what you recorded and what your accounts held as separate
          things, so the comparison stays honest.
        </p>
      </div>
      <ol className="card steps3">
        <li>
          <button
            type="button"
            className="row"
            id="home-create"
            aria-label="Create your first Plan"
            onClick={newPlan}
            data-row
          >
            <span className="t">
              Create a Plan
              <small>Name your income, then give every dollar a job.</small>
            </span>
            <span className="go">Create a Plan</span>
          </button>
        </li>
        <li>
          <div className="row">
            <span className="t">
              Record activity
              <small>Record what you earn, spend, save and give in Activity.</small>
            </span>
          </div>
        </li>
        <li>
          <div className="row">
            <span className="t">
              Review the month
              <small>See recorded against planned in Review, and resolve anything unknown.</small>
            </span>
          </div>
        </li>
      </ol>
    </div>
  );
}
