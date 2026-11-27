import { type LoadState, loadResource } from "./api";
import type { WriteSpec } from "./monthly";

export type DestinationKind = "investment" | "giving";
export interface Opening {
  date: string;
  amount: string;
}
export interface Destination {
  uuid: string;
  name: string;
  target: string | null;
  active: boolean;
  revision: number;
  contribution_progress: string;
  opening: Opening | null;
  latest: Opening | null;
  /** Investments only: projection assumptions, each optional. */
  expected_return_percent?: string | null;
  expected_contribution?: string | null;
  expected_contribution_frequency?: ContributionFrequency;
  /** Investments only: how the account is held. */
  tax_treatment?: TaxTreatment;
  liquidity?: Liquidity;
}
export type ContributionFrequency = "monthly" | "annual";
/** Taxable brokerage, or tax-advantaged such as a 401(k), IRA or HSA. */
export type TaxTreatment = "taxable" | "tax_advantaged";
/** Liquid such as a stock fund, or illiquid such as a house. */
export type Liquidity = "liquid" | "illiquid";
/** An investment's traits; omit one on an edit to keep it. */
export interface Traits {
  tax_treatment: TaxTreatment;
  liquidity: Liquidity;
}
/** The projection assumptions an investment carries; giving recipients have none. */
export interface Expectations {
  expected_return_percent: string | null;
  expected_contribution: string | null;
  expected_contribution_frequency: ContributionFrequency;
}
export interface Contribution {
  uuid: string;
  financial_date: string;
  category: "investing" | "giving";
  amount: string;
  note: string;
  is_adjustment: boolean;
  revision: number;
  investment_id?: string | null;
  giving_recipient_id?: string | null;
  /** Read-only: "savings" exactly when funding_goal_id is set. */
  funding_origin?: "income" | "savings";
  funding_goal_id?: string | null;
  is_refund?: boolean;
}
export interface ContributionInput {
  date: string;
  amount: string;
  investment_id?: string | null;
  giving_recipient_id?: string | null;
  note: string;
  is_adjustment: boolean;
  expected_revision?: number;
  /** The saving goal that funds this contribution; null is current income. */
  funding_goal_id?: string | null;
}
/** The entry field naming a contribution's assignment for each kind. */
export const assignmentField = (kind: DestinationKind) =>
  kind === "investment" ? "investment_id" : "giving_recipient_id";
export const assignmentOf = (kind: DestinationKind, entry: Contribution) =>
  entry[assignmentField(kind)] ?? null;
const root = (entity: string, kind: DestinationKind) =>
  `/api/entities/${encodeURIComponent(entity)}/${kind === "investment" ? "investments" : "giving-recipients"}`;
const activity = (entity: string, kind: DestinationKind) =>
  `/api/entities/${encodeURIComponent(entity)}/${kind === "investment" ? "investment" : "giving"}-activity`;
export const destinations = {
  list: (entity: string, kind: DestinationKind): Promise<LoadState<Destination[]>> =>
    loadResource(root(entity, kind), (rows: Destination[]) => rows.length === 0),
  history: (entity: string, kind: DestinationKind): Promise<LoadState<Contribution[]>> =>
    loadResource(activity(entity, kind), (rows: Contribution[]) => rows.length === 0),
  create: (
    entity: string,
    kind: DestinationKind,
    body: { name: string; target: string | null; opening?: Opening | null } & Partial<
      Expectations & Traits
    >,
  ): WriteSpec<Destination> => ({
    method: "POST",
    path: root(entity, kind),
    body,
  }),
  edit: (
    entity: string,
    kind: DestinationKind,
    destination: string,
    body: {
      name: string;
      target: string | null;
      active: boolean;
      expected_revision: number;
      /** Investments with an opening only; omit to keep the opening date. */
      opening_date?: string;
    } & Partial<Expectations & Traits>,
  ): WriteSpec<Destination> => ({
    method: "PUT",
    path: `${root(entity, kind)}/${encodeURIComponent(destination)}`,
    body,
  }),
  record: (
    entity: string,
    kind: DestinationKind,
    body: ContributionInput,
  ): WriteSpec<Contribution> => ({
    method: "POST",
    path: activity(entity, kind),
    body,
  }),
  correct: (
    entity: string,
    kind: DestinationKind,
    entry: string,
    body: ContributionInput,
  ): WriteSpec<Contribution> => ({
    method: "PUT",
    path: `${activity(entity, kind)}/${encodeURIComponent(entry)}`,
    body,
  }),
  remove: (
    entity: string,
    kind: DestinationKind,
    entry: string,
    expected_revision: number,
  ): WriteSpec<Contribution> => ({
    method: "DELETE",
    path: `${activity(entity, kind)}/${encodeURIComponent(entry)}`,
    body: { expected_revision },
  }),
};
