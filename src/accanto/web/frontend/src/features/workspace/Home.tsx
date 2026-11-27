import type { ReactNode } from "react";
import type { LoadState } from "../../lib/api";
import {
  daysBetween,
  daysInMonth,
  decimalToCents,
  fmtShort,
  formatMoney,
  money,
  monthName,
  plural,
} from "../../lib/format";
import type { ComparisonGroup, PlanRevision, ReviewResult } from "../../lib/monthly";
import type { Dollars, Projection } from "../../lib/projections";
import type { Routine } from "../../lib/routines";
import { Band, type BandPart, Empty, tint, Wait } from "../../ui";
import { share } from "./PlanBreakdown";
import type { Screen } from "./Workspace";
import { storedCents, storedGroups } from "./planWorksheetModel";
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
  detail?: string;
  action?: string;
  run?: () => void;
  quiet?: boolean;
};
type Category = keyof NonNullable<ReviewResult["comparison"]>;
const OUT: { key: Category; group: Allocation; kind: string; name: string }[] = [
  { key: "fixed_cost", group: "fixed", kind: "fixed", name: "Fixed costs" },
  { key: "spending", group: "spending", kind: "free", name: "Guilt-free spending" },
  { key: "saving", group: "saving", kind: "save", name: "Saving" },
  { key: "investing", group: "investing", kind: "invest", name: "Investing" },
  { key: "giving", group: "giving", kind: "give", name: "Giving" },
];
type Allocation = "fixed" | "spending" | "saving" | "investing" | "giving";
const cents = (value: string | null | undefined) =>
  value === null || value === undefined ? null : decimalToCents(value);

/**
 * Words for a category's recorded-against-planned state, from the API's own difference. Lines
 * with no entry are still to come while the month runs, and a warning once it has ended.
 */
function status(key: Category, group: ComparisonGroup, ended: boolean) {
  const missing = group.items.filter((item) => item.recorded === null).length;
  if (missing)
    return ended
      ? { tone: "warn", text: `${plural(missing, "line")} with no entry` }
      : { tone: "muted", text: `${missing} still to come` };
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
  split,
  worth,
  dollars = "today",
  setDollars = () => {},
  open,
  newPlan,
  showPlans,
  go,
  routines,
  openRoutine,
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
  /** The version the month's Review links, or without one the latest saved version. */
  split?: PlanRevision;
  worth: LoadState<Projection>;
  /** Today's or future dollars for the projected milestones, shared with Projections. */
  dollars?: Dollars;
  setDollars?: (value: Dollars) => void;
  open: (id: string) => void;
  newPlan: () => void;
  showPlans: () => void;
  /** Opens another screen; without it, items say where to go instead of linking. */
  go?: (to: Screen) => void;
  routines?: LoadState<Routine[]>;
  openRoutine?: (routine: string, on: string) => void;
  retry: () => void;
}) {
  // A routine is due whether or not the Entity has a Plan yet, and comes first: it has a date.
  const items: Item[] = [];
  for (const r of routines?.kind === "ready" ? routines.data : []) {
    const c = r.current;
    if (!r.active || !c || (c.state !== "due" && c.state !== "overdue")) continue;
    const late = daysBetween(c.scheduled_on, today);
    items.push({
      key: `r-${r.uuid}`,
      title: `${r.name} is ${c.state === "due" ? "due today" : `${plural(late, "day")} overdue`}`,
      action: "Open",
      run: () => openRoutine?.(r.uuid, c.scheduled_on),
    });
  }
  if (!plans)
    return (
      <Welcome newPlan={newPlan}>
        <NeedsYou items={items} />
      </Welcome>
    );
  const toReview = go && (() => go("review"));
  const name = monthName(month);
  // An empty mocked or legacy body is treated as no Review rather than as zeros.
  const result = review.kind === "ready" && review.data?.review ? review.data : null;
  const comparison = result?.comparison;
  // While the month runs, a planned line with no entry is still to come, as in Review.
  const ended = month < today.slice(0, 7);

  if (comparison && ended) {
    const unknown = (["income", "fixed_cost", "saving", "investing", "giving"] as const).flatMap(
      (key) => comparison[key].items.filter((item) => item.recorded === null),
    );
    if (unknown.length > 4)
      items.push({
        key: "unknown",
        title: `${unknown.length} planned lines have no ${name} entry`,
        action: toReview && "Resolve in Review",
        run: toReview,
      });
    else
      for (const line of unknown)
        items.push({
          key: `u-${line.id}-${line.name}`,
          title: `${line.name} has no ${name} entry`,
          detail: `Planned ${formatMoney(line.planned)}`,
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
        ? `Funding ${money(plan.funding ?? 0)} − allocations ${money(plan.allocated ?? 0)}${plan.dirty ? ", unsaved changes" : ""}`
        : undefined,
      action: plan.dirty ? "Open draft" : "Open Plan",
      run: () => open(plan.id),
    });
  }
  // A running month cannot be reviewed yet; only a Review without a comparison needs a visit.
  if (result && !result.review.reviewed_at && (ended || !comparison))
    items.push({
      key: "review",
      title: `${name} is not reviewed yet`,
      action: toReview && `Review ${name}`,
      run: toReview,
      quiet: true,
    });

  return (
    <div className="screen home">
      <NeedsYou items={items} />
      {review.kind === "loading" ? (
        <Wait>
          <div className="card pad sk-card" aria-busy="true" aria-label="Loading this month">
            {/* Shaped like the month's hero: headline, spent line, pace bar and its dates, fixed costs. */}
            <div className="sk" style={{ width: "55%", height: 32 }} />
            <div className="sk" style={{ width: "40%", height: 16 }} />
            <div className="sk" style={{ height: 8 }} />
            <div className="sk" style={{ height: 12 }} />
            <div className="sk" style={{ width: "45%", height: 18, marginTop: 16 }} />
          </div>
        </Wait>
      ) : result ? (
        comparison && (
          <Hero
            month={month}
            today={today}
            spending={comparison.spending}
            difference={result.spending_difference}
            fixed={comparison.fixed_cost}
            fixedDifference={result.fixed_cost_difference}
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
            ? "Compare the month against a saved Plan version."
            : "Save a Plan version first."}
        </Empty>
      ) : (
        <div className="card pad">
          <LoadMessage state={review} retry={retry} />
        </div>
      )}
      {(split || worth.kind !== "empty") && (
        <div className="grid2 glance">
          {split && (
            <PlanSplit version={split} linked={result?.version?.uuid === split.uuid} month={name} />
          )}
          {worth.kind !== "empty" && (
            <NetWorthCard worth={worth} retry={retry} dollars={dollars} setDollars={setDollars} />
          )}
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
          <MonthBreakdown comparison={comparison} name={name} ended={ended} />
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
    </div>
  );
}

/** Where a month's money is going: recorded against planned per category, as the API reports it. */
export function MonthBreakdown({
  comparison,
  name,
  ended,
}: {
  comparison: NonNullable<ReviewResult["comparison"]>;
  name: string;
  /** The month is over: a line with no entry is a warning, not a line still to come. */
  ended: boolean;
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
            const st = status(key, group, ended);
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
      <p
        className="note home-legend"
        title="Solid is recorded, pale is planned, hatched is a planned line with no entry."
      >
        Income: {formatMoney(comparison.income.recorded)} of{" "}
        {formatMoney(comparison.income.planned)} received ·{" "}
        {status("income", comparison.income, ended).text}
      </p>
    </div>
  );
}

export function Hero({
  month,
  today,
  spending,
  difference,
  fixed,
  fixedDifference,
}: {
  month: string;
  today: string;
  spending: ComparisonGroup;
  difference: string | null;
  /** Fixed costs, shown as a second line under guilt-free spending when given. */
  fixed?: ComparisonGroup;
  fixedDifference?: string | null;
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
      {fixed && <FixedLine fixed={fixed} difference={fixedDifference ?? null} />}
    </div>
  );
}

/** What is left of the month's fixed costs, with unpaid lines kept as unknown rather than zero. */
function FixedLine({ fixed, difference }: { fixed: ComparisonGroup; difference: string | null }) {
  const planned = cents(fixed.planned) ?? 0;
  const recorded = cents(fixed.recorded) ?? 0;
  const over = cents(difference);
  return (
    <div className="hero-fixed" style={tint("fixed")}>
      <p>
        <span className="dot" />{" "}
        <b>
          {over !== null && over > 0
            ? `${money(over)} over on fixed costs`
            : `${money(Math.max(0, planned - recorded))} left on fixed costs`}
        </b>{" "}
        <span className="muted">
          {money(recorded)} of {formatMoney(fixed.planned)} paid
        </span>
      </p>
      <div className="meter" role="presentation">
        <i style={{ width: `${planned ? Math.min(1, recorded / planned) * 100 : 0}%` }} />
      </div>
    </div>
  );
}

/**
 * A Plan version's split of monthly funding, as percentages: the version the month's Review
 * links, or the latest saved version when the month has no Review.
 */
function PlanSplit({
  version,
  linked,
  month,
}: { version: PlanRevision; linked: boolean; month: string }) {
  const funding = version.funding_total ?? null;
  const total = storedCents(funding);
  const amounts = storedGroups(version);
  const rows = OUT.map(({ key, group, kind, name }) => {
    const planned = amounts[group];
    return { key, kind, name, planned, share: share(planned, total) };
  });
  return (
    <div className="card pad glance-card">
      <span className="cap">
        Plan split{" "}
        <span className="muted">
          {linked
            ? `${version.name}, version ${version.number}, linked to ${month}`
            : `${version.name}, latest version ${version.number}`}
        </span>
      </span>
      <Band
        label="Share of monthly funding by category"
        parts={rows.map(
          (row): BandPart => ({
            key: row.key,
            kind: row.kind,
            weight: row.planned ?? 0,
            title: `${row.name}: ${row.share === null ? "Unavailable" : `${row.share.toFixed(1)}%`}`,
          }),
        )}
      />
      <ul className="split-rows">
        {rows.map((row) => (
          <li key={row.key} style={tint(row.kind)}>
            <span className="dot" />
            <span className="t">{row.name}</span>
            <span className="muted">{row.planned === null ? "Unknown" : money(row.planned)}</span>
            <b>{row.share === null ? "—" : `${row.share.toFixed(1)}%`}</b>
          </li>
        ))}
      </ul>
      <p className="note">Of {formatMoney(funding)} monthly funding</p>
    </div>
  );
}

/** Net worth today and its Projection; an unobserved account leaves both unknown. */
function NetWorthCard({
  worth,
  retry,
  dollars,
  setDollars,
}: {
  worth: LoadState<Projection>;
  retry: () => void;
  dollars: Dollars;
  setDollars: (value: Dollars) => void;
}) {
  if (worth.kind === "loading")
    return (
      <Wait>
        <div className="card pad glance-card" aria-busy="true" aria-label="Loading net worth">
          <div className="sk" style={{ width: "40%", height: 14 }} />
          <div className="sk" style={{ width: "60%", height: 28 }} />
          <div className="sk" style={{ height: 60 }} />
        </div>
      </Wait>
    );
  if (worth.kind !== "ready")
    return (
      <div className="card pad glance-card">
        <span className="cap">Net worth</span>
        {worth.kind !== "empty" && <LoadMessage state={worth} retry={retry} />}
      </div>
    );
  const { today, milestones, investments, default_return_percent } = worth.data;
  const missing = investments.filter((i) => i.status === "no_value");
  const defaulted = investments.filter((i) => i.return_source === "default").length;
  return (
    <div className="card pad glance-card">
      <span className="cap">Net worth today</span>
      {today.net_worth === null ? (
        <>
          <p className="big">Unknown</p>
          <p className="note">Not observed: {missing.map((m) => m.name).join(", ")}</p>
        </>
      ) : (
        <>
          <p className="big">{formatMoney(today.net_worth)}</p>
          <p className="note">
            Savings {formatMoney(today.savings)} + investments {formatMoney(today.investments)} −
            loans {formatMoney(today.loans)}
          </p>
        </>
      )}
      {today.net_worth !== null && (
        <>
          <div className="glance-proj-head">
            <span
              className="cap projected"
              title={`A Projection, not a balance: investments grow at their expected return and contribution, fixed-rate loans are paid down, savings stay as today.${defaulted ? ` ${plural(defaulted, "investment")} ${defaulted === 1 ? "uses" : "use"} the default ${default_return_percent}% return.` : ""}`}
            >
              Projected
            </span>
            {/* biome-ignore lint/a11y/useSemanticElements: The kit's segmented control is a button group. */}
            <div className="seg-control sm" role="group" aria-label="Dollars">
              {(["today", "future"] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={dollars === d}
                  onClick={() => setDollars(d)}
                >
                  {d === "today" ? "Today's $" : "Future $"}
                </button>
              ))}
            </div>
          </div>
          <ul className="split-rows proj-rows">
            {milestones.map((p) => (
              <li key={p.years}>
                <span className="t">
                  In {p.years} years{" "}
                  <small>
                    {fmtShort(p.date)}, {p.date.slice(0, 4)}
                  </small>
                </span>
                <b>{formatMoney(p.net_worth)}</b>
              </li>
            ))}
          </ul>
          <p className="note">
            {dollars === "today"
              ? `Today's dollars, ${worth.data.inflation_percent}% inflation`
              : "Future dollars"}
          </p>
        </>
      )}
    </div>
  );
}

/** What needs the person, one line each; nothing at all when nothing does. */
function NeedsYou({ items }: { items: Item[] }) {
  if (!items.length) return null;
  return (
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
                {item.detail && <small>{item.detail}</small>}
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
  );
}

/** First run: say what the app is for and offer the first action. */
function Welcome({ newPlan, children }: { newPlan: () => void; children?: ReactNode }) {
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
      {children}
    </div>
  );
}
