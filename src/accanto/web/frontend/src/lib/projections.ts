import { type DecimalString, type IsoDate, type LoadState, loadResource } from "./api";
import type { WriteSpec } from "./monthly";

/**
 * Each investment grows at its own expected return, or the Entity's default return when it has
 * none. An investment without an observed value is left out, and every total that needs it is
 * unknown (null): unknown is never projected from zero.
 */
export type ProjectedStatus = "projected" | "no_value";

export interface ProjectedInvestment {
  investment_id: string;
  name: string;
  status: ProjectedStatus;
  latest: { date: IsoDate; amount: DecimalString } | null;
  /** The investment's own expected return, as entered; null uses the default. */
  expected_return_percent: DecimalString | null;
  /** The annual return the projection used, and where it came from. */
  return_percent: DecimalString;
  return_source: "investment" | "default";
  /** The expected contribution as entered, and the monthly amount the projection adds. */
  expected_contribution: DecimalString | null;
  expected_contribution_frequency: "monthly" | "annual";
  monthly_contribution: DecimalString;
  /** Projected value at each milestone. */
  milestones: { years: number; amount: DecimalString | null }[];
}
/**
 * A loan with a fixed rate and a payment that covers its interest is paid down month by month
 * from its latest recorded amount owed; any other loan stays at that amount.
 */
export interface ProjectedLoan {
  debt_id: string;
  name: string;
  active: boolean;
  status: "amortizing" | "no_terms" | "interest_not_covered" | "paid_off";
  latest: { date: IsoDate; amount: DecimalString };
  interest_rate_percent: DecimalString | null;
  monthly_payment: DecimalString | null;
  /** Within the projection's span; null when not repaid in it or not amortizing. */
  payoff_date: IsoDate | null;
  milestones: { years: number; amount: DecimalString }[];
}
/**
 * One point in time, in the projection's dollars. Savings are held at today's amount; loans are
 * paid down where they have terms. Totals are null while any investment has no observed value.
 */
export interface ProjectionYear {
  years: number;
  date: IsoDate;
  investments: DecimalString | null;
  loans: DecimalString;
  net_worth: DecimalString | null;
  contributed: DecimalString;
  /** The FIRE target at this date; null without annual spending. */
  fire_target: DecimalString | null;
}
/**
 * Future dollars are nominal, as balances will read. Today's dollars divide each amount by
 * (1 + inflation)^years, so they buy what that amount buys today.
 */
export type Dollars = "today" | "future";
export interface FireResult {
  /** Entered in today's dollars. */
  annual_spending: DecimalString;
  /** The part of annual spending that stays level: planned fixed costs that do not rise with inflation. */
  steady_spending: DecimalString;
  withdrawal_percent: DecimalString;
  /** Annual spending ÷ the withdrawal rate, today. */
  target_today: DecimalString;
  /** The target on the FIRE date, in the projection's dollars; null when not reached. */
  target: DecimalString | null;
  /** Months until projected investments reach the target; null when unknown or beyond 100 years. */
  months_to_target: number | null;
  reached_on: IsoDate | null;
}
/** One planned fixed cost of the active month's latest saved Plan version. */
export interface PlannedFixedCost {
  fixed_cost_id: string;
  name: string;
  monthly_amount: DecimalString;
  annual_amount: DecimalString;
  /** False for a cost fixed in dollars, such as a fixed-rate mortgage payment. */
  rises_with_inflation: boolean;
}
export interface PlannedFixedCosts {
  plan_name: string;
  version_number: number;
  /** The active month, YYYY-MM. */
  month: string;
  monthly_total: DecimalString;
  annual_total: DecimalString;
  /** Annual total of the costs that do not rise with inflation. */
  steady_annual: DecimalString;
  lines: PlannedFixedCost[];
}
export interface Projection {
  as_of: IsoDate;
  dollars: Dollars;
  inflation_percent: DecimalString;
  default_return_percent: DecimalString;
  today: {
    investments: DecimalString | null;
    savings: DecimalString;
    loans: DecimalString;
    net_worth: DecimalString | null;
  };
  /** Year 0 is today; one row per year to the horizon. */
  timeline: ProjectionYear[];
  /** Always 5, 10 and 20 years, whatever the horizon. */
  milestones: ProjectionYear[];
  investments: ProjectedInvestment[];
  loans: ProjectedLoan[];
  fire: FireResult | null;
  /** The active month's latest saved Plan version; null when no Plan has one. */
  planned_fixed_costs: PlannedFixedCosts | null;
}
export interface FireAssumptions {
  annual_spending: DecimalString | null;
  withdrawal_percent: DecimalString;
  inflation_percent: DecimalString;
  revision: number;
}
const root = (entity: string) => `/api/entities/${encodeURIComponent(entity)}`;
export const projections = {
  /** Projects with the saved FIRE assumptions; financial inputs never travel in the URL. */
  read: (entity: string, years: number, dollars: Dollars): Promise<LoadState<Projection>> =>
    loadResource(
      `${root(entity)}/projections?years=${years}&dollars=${dollars}`,
      (value: Projection) => value.investments.length === 0,
    ),
  /** Home's net worth card: today and the 5, 10 and 20 year milestones. */
  netWorth: (entity: string, dollars: Dollars): Promise<LoadState<Projection>> =>
    loadResource(
      `${root(entity)}/projections?years=20&dollars=${dollars}`,
      // An Entity with no investments, savings or loans has no net worth to show.
      (value: Projection) =>
        !value.investments.length && !Number(value.today.savings) && !Number(value.today.loans),
    ),
  assumptions: (entity: string): Promise<LoadState<FireAssumptions>> =>
    loadResource(`${root(entity)}/fire-assumptions`, () => false),
  saveAssumptions: (
    entity: string,
    body: {
      annual_spending: string | null;
      withdrawal_percent: string;
      inflation_percent: string;
      /** Planned fixed costs that stay level; the rest rise with inflation. Omit to keep each. */
      fixed_costs_not_rising_with_inflation?: string[];
      expected_revision: number;
    },
  ): WriteSpec<FireAssumptions> => ({
    method: "PUT",
    path: `${root(entity)}/fire-assumptions`,
    body,
  }),
};

const DOLLARS_KEY = "accanto.projection-dollars";
/** The browser's last choice of dollars, shared by Projections and Home; today's by default. */
export const savedDollars = (): Dollars => {
  try {
    return localStorage.getItem(DOLLARS_KEY) === "future" ? "future" : "today";
  } catch {
    return "today";
  }
};
export const saveDollars = (value: Dollars) => {
  try {
    localStorage.setItem(DOLLARS_KEY, value);
  } catch {
    // Private browsing may refuse storage; the choice then lasts for this view only.
  }
};
