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
 * One point in time, in nominal dollars: inflation is not modelled yet. Savings and loans are
 * held at today's amounts. Totals are null while any investment has no observed value.
 */
export interface ProjectionYear {
  years: number;
  date: IsoDate;
  investments: DecimalString | null;
  net_worth: DecimalString | null;
  contributed: DecimalString;
}
export interface FireResult {
  annual_spending: DecimalString;
  withdrawal_percent: DecimalString;
  target: DecimalString;
  /** Months until projected investments reach the target; null when unknown or beyond 100 years. */
  months_to_target: number | null;
  reached_on: IsoDate | null;
}
export interface Projection {
  as_of: IsoDate;
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
  fire: FireResult | null;
}
export interface FireAssumptions {
  annual_spending: DecimalString | null;
  withdrawal_percent: DecimalString;
  revision: number;
}
const root = (entity: string) => `/api/entities/${encodeURIComponent(entity)}`;
export const projections = {
  /** Projects with the saved FIRE assumptions; financial inputs never travel in the URL. */
  read: (entity: string, years: number): Promise<LoadState<Projection>> =>
    loadResource(
      `${root(entity)}/projections?years=${years}`,
      (value: Projection) => value.investments.length === 0,
    ),
  /** Home's net worth card: today and the 5, 10 and 20 year milestones. */
  netWorth: (entity: string): Promise<LoadState<Projection>> =>
    loadResource(
      `${root(entity)}/projections?years=20`,
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
      expected_revision: number;
    },
  ): WriteSpec<FireAssumptions> => ({
    method: "PUT",
    path: `${root(entity)}/fire-assumptions`,
    body,
  }),
};
