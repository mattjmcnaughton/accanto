import { type LoadState, loadResource } from "./api";
import type { WriteSpec } from "./monthly";

export interface Observation {
  uuid: string;
  financial_date: string;
  amount: string;
  account_id: string | null;
  is_opening: boolean;
  revision: number;
  deleted: boolean;
}
/**
 * Why a loan has no schedule, or "scheduled". A payment at or under the monthly interest is
 * interest_not_covered: the balance never falls, so there is no payoff date.
 */
export type PayoffStatus =
  | "scheduled"
  | "paid_off"
  | "no_terms"
  | "interest_not_covered"
  | "beyond_limit";
/** From the latest recorded amount owed at the fixed rate and monthly payment. Illustrative. */
export interface PayoffSummary {
  status: PayoffStatus;
  as_of: string;
  balance: string;
  interest_rate_percent: string | null;
  monthly_payment: string | null;
  monthly_interest: string | null;
  months: number | null;
  payoff_date: string | null;
  total_interest: string | null;
  total_paid: string | null;
}
export interface PayoffRow {
  month: number;
  date: string;
  payment: string;
  interest: string;
  principal: string;
  balance: string;
}
export interface PayoffSchedule extends PayoffSummary {
  rows: PayoffRow[];
}
export interface LoanTerms {
  /** Fixed annual interest rate, percent. */
  interest_rate_percent: string | null;
  monthly_payment: string | null;
}
export interface Loan extends LoanTerms {
  uuid: string;
  name: string;
  active: boolean;
  revision: number;
  opening: { date: string; amount: string };
  latest: Observation;
  payoff: PayoffSummary;
  draft_fixed_cost_lines: string[];
}
export interface ObservationInput {
  date: string;
  amount: string;
  account_id: string | null;
  expected_revision?: number;
}
const root = (entity: string) => `/api/entities/${encodeURIComponent(entity)}`;
const observations = (entity: string, kind: "debt" | "investment") =>
  `${root(entity)}/${kind}-observations`;
export const balances = {
  loans: (entity: string): Promise<LoadState<Loan[]>> =>
    loadResource(`${root(entity)}/debts`, (rows: Loan[]) => rows.length === 0),
  list: (entity: string, kind: "debt" | "investment"): Promise<LoadState<Observation[]>> =>
    loadResource(observations(entity, kind), (rows: Observation[]) => rows.length === 0),
  schedule: (entity: string, id: string): Promise<LoadState<PayoffSchedule>> =>
    loadResource(`${root(entity)}/debts/${encodeURIComponent(id)}/payoff-schedule`, () => false),
  createLoan: (
    entity: string,
    body: { name: string; opening: { date: string; amount: string } } & LoanTerms,
  ): WriteSpec<Loan> => ({
    method: "POST",
    path: `${root(entity)}/debts`,
    body,
  }),
  editLoan: (
    entity: string,
    id: string,
    /** Omitted terms stay as they are; null clears one. */
    body: { name: string; active: boolean; expected_revision: number } & Partial<LoanTerms>,
  ): WriteSpec<Loan> => ({
    method: "PUT",
    path: `${root(entity)}/debts/${encodeURIComponent(id)}`,
    body,
  }),
  create: (
    entity: string,
    kind: "debt" | "investment",
    body: ObservationInput,
  ): WriteSpec<Observation> => ({
    method: "POST",
    path: observations(entity, kind),
    body,
  }),
  correct: (
    entity: string,
    kind: "debt" | "investment",
    id: string,
    body: ObservationInput,
  ): WriteSpec<Observation> => ({
    method: "PUT",
    path: `${observations(entity, kind)}/${encodeURIComponent(id)}`,
    body,
  }),
  remove: (
    entity: string,
    kind: "debt" | "investment",
    id: string,
    expected_revision: number,
  ): WriteSpec<Observation> => ({
    method: "DELETE",
    path: `${observations(entity, kind)}/${encodeURIComponent(id)}`,
    body: { expected_revision },
  }),
};
