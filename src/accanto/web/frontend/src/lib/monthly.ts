/** Contracts for the implemented monthly API. Money is transported as decimal strings. */
import { type DecimalString, type IsoDate, type LoadState, type UUID, loadResource } from "./api";

export interface IncomeLineInput {
  source_id?: UUID | null;
  name: string;
  amount: DecimalString;
}
export interface FixedCostLineInput {
  fixed_cost_id?: UUID | null;
  debt_account_id?: UUID | null;
  name: string;
  amount: DecimalString;
  frequency: "monthly" | "annual";
}
export interface PlanInput {
  name: string;
  incomes: IncomeLineInput[];
  fixed_costs: FixedCostLineInput[];
  spending: DecimalString;
  savings_funding: Array<{ account_id: UUID; amount: DecimalString }>;
  saving_goals: Array<{ goal_id: UUID; amount: DecimalString }>;
  investments: Array<{ destination_id: UUID; amount: DecimalString }>;
  giving: Array<{ destination_id: UUID; amount: DecimalString }>;
  expected_revision?: number;
}
export interface KnownTotalInput {
  date: IsoDate;
  month: IsoDate;
  category: "income" | "spending" | "saving" | "fixed_cost";
  desired_total: DecimalString;
  source_id?: UUID | null;
  saving_goal_id?: UUID | null;
  note?: string;
  contributing_entries: Array<{ uuid: UUID; revision: number }>;
}
export interface ActivityInput {
  date: IsoDate;
  category: "income" | "spending" | "saving" | "fixed_cost";
  amount: DecimalString;
  source_id?: UUID | null;
  fixed_cost_id?: UUID | null;
  debt_account_id?: UUID | null;
  note?: string;
  expected_revision?: number;
  is_adjustment?: boolean;
  /** Saving entries only: the goal the money goes to. */
  saving_goal_id?: UUID | null;
  /** Outflows only: the saving goal that pays; null is current income. */
  funding_goal_id?: UUID | null;
  /** Replaces the entry's tags; omit to leave them unchanged. */
  tag_ids?: UUID[];
}
export interface RevisionInput {
  expected_revision: number;
}
export interface ReviewInput {
  month: IsoDate;
  version_id: UUID;
}
export interface ReviewEditInput {
  expected_revision: number;
  version_id: UUID;
  note: string;
  reviewed: boolean;
  checkpoint?: boolean;
}

export interface PlanRevision {
  uuid: UUID;
  name: string;
  number: number;
  revision: number;
  saved: boolean;
  saved_at: string | null;
  updated_at: string | null;
  rule_version: string;
  incomes: Array<{ source_id: UUID; name: string; amount: DecimalString }>;
  fixed_costs: Array<{
    fixed_cost_id: UUID;
    debt_account_id: UUID | null;
    debt_account_name?: string | null;
    name: string;
    canonical_name: string;
    amount: DecimalString;
    frequency: "monthly" | "annual";
    monthly_amount: DecimalString;
  }>;
  savings_funding?: Array<{ account_id: UUID; account_name: string; amount: DecimalString }>;
  saving_goals?: Array<{ goal_id: UUID; goal_name: string; amount: DecimalString }>;
  investments?: Array<{ destination_id: UUID; destination_name: string; amount: DecimalString }>;
  giving?: Array<{ destination_id: UUID; destination_name: string; amount: DecimalString }>;
  income: DecimalString;
  spending: DecimalString;
  fixed_cost_total: DecimalString;
  tithe_target: DecimalString;
  savings_funding_total?: DecimalString | null;
  funding_total?: DecimalString | null;
  saving_total?: DecimalString | null;
  investing_total?: DecimalString | null;
  giving_total?: DecimalString | null;
  allocation_total?: DecimalString | null;
  giving_difference?: DecimalString | null;
  unassigned: DecimalString;
  planned_metrics?: Metric[];
}
export interface PlanGroup {
  plan_id: UUID;
  revisions: PlanRevision[];
}
export interface Activity {
  uuid: UUID;
  financial_date: IsoDate;
  category: "income" | "spending" | "saving" | "fixed_cost" | "investing" | "giving";
  amount: DecimalString;
  source_id: UUID | null;
  fixed_cost_id: UUID | null;
  fixed_cost_name: string | null;
  debt_account_id: UUID | null;
  note: string;
  revision: number;
  is_adjustment: boolean;
  /** Read-only: "savings" exactly when funding_goal_id is set. */
  funding_origin: "income" | "savings";
  saving_goal_id: UUID | null;
  funding_goal_id: UUID | null;
  investment_id?: UUID | null;
  giving_recipient_id?: UUID | null;
  is_refund?: boolean;
  refund_of?: UUID | null;
  remaining_refundable?: DecimalString | null;
  tag_ids?: UUID[];
}
export interface RefundInput {
  date: IsoDate;
  amount: DecimalString;
  note?: string;
  expected_revision?: number;
}
export type ReviewEntry = Omit<Activity, "source_id"> & {
  source_uuid: UUID | null;
  fixed_cost_uuid: UUID | null;
};
export interface Metric {
  key: string;
  basis: "planned" | "actual";
  label: string;
  numerator_label: string;
  denominator_label: string;
  numerator: DecimalString | null;
  denominator: DecimalString | null;
  percentage: DecimalString | null;
  unavailable_reason: string | null;
  components: Array<{ name: string; amount: DecimalString | null }>;
}
export interface ComparisonGroup {
  planned: DecimalString | null;
  recorded: DecimalString | null;
  incomplete: boolean;
  difference: DecimalString | null;
  items: Array<{
    id: UUID | null;
    name: string;
    planned: DecimalString | null;
    recorded: DecimalString | null;
    difference: DecimalString | null;
    entries: Activity[];
  }>;
  unplanned: Activity[];
  adjustments: Activity[];
}
export interface ReviewResult {
  comparison?: Record<
    "income" | "fixed_cost" | "spending" | "saving" | "investing" | "giving",
    ComparisonGroup
  >;
  summary?: {
    new_saving: DecimalString | null;
    savings_used: DecimalString | null;
    savings_used_incomplete?: boolean;
    net_saving: DecimalString | null;
    total_investing: DecimalString | null;
    income_funded_investing: DecimalString | null;
    income_funded_fixed_cost: DecimalString | null;
  };
  metrics?: Metric[];
  review: {
    uuid: UUID;
    month: IsoDate;
    revision: number;
    note: string;
    reviewed_at: string | null;
  };
  checkpoint_changed: boolean;
  /** Staged transactions dated in this month still waiting in the Transactions inbox. */
  inbox_waiting?: number;
  version: PlanRevision;
  entries: ReviewEntry[];
  actual: {
    income_recorded: DecimalString | null;
    income_incomplete: boolean;
    missing_sources: UUID[];
    spending_recorded: DecimalString | null;
    fixed_cost_recorded: DecimalString | null;
    fixed_cost_incomplete: boolean;
    missing_fixed_costs: UUID[];
    saving_recorded?: DecimalString | null;
    investing_recorded?: DecimalString | null;
    giving_recorded?: DecimalString | null;
    savings_used?: DecimalString;
  };
  income_difference: DecimalString | null;
  spending_difference: DecimalString | null;
  fixed_cost_difference: DecimalString | null;
  expected?: {
    saving: DecimalString | null;
    investing: DecimalString | null;
    giving: DecimalString | null;
    savings_funding: DecimalString | null;
    funding: DecimalString | null;
    allocation: DecimalString | null;
  };
  differences?: {
    saving: DecimalString | null;
    investing: DecimalString | null;
    giving: DecimalString | null;
  };
  destination_comparisons?: {
    saving_goals: Array<{
      goal_id: UUID;
      goal_name: string;
      planned: DecimalString;
      recorded: DecimalString | null;
      difference: DecimalString | null;
    }>;
    investments: Array<{
      destination_id: UUID;
      destination_name: string;
      planned: DecimalString;
      recorded: DecimalString | null;
      difference: DecimalString | null;
    }>;
    giving: Array<{
      destination_id: UUID;
      destination_name: string;
      planned: DecimalString;
      recorded: DecimalString | null;
      difference: DecimalString | null;
    }>;
  } | null;
}

export interface WriteSpec<T> {
  method: "POST" | "PUT" | "DELETE";
  path: string;
  body: object;
  readonly result?: T;
}
const root = (entityId: UUID) => `/api/entities/${encodeURIComponent(entityId)}`;
const target = (id: UUID) => encodeURIComponent(id);

export const monthly = {
  plans: (entityId: UUID): Promise<LoadState<PlanGroup[]>> =>
    loadResource(`${root(entityId)}/plans`, (plans) => plans.length === 0),
  activity: (entityId: UUID): Promise<LoadState<Activity[]>> =>
    loadResource(`${root(entityId)}/activity`, (entries) => entries.length === 0),
  review: (entityId: UUID, month: IsoDate): Promise<LoadState<ReviewResult>> =>
    loadResource(`${root(entityId)}/reviews/${encodeURIComponent(month)}`, () => false),
  createPlan: (
    entityId: UUID,
    body: PlanInput,
  ): WriteSpec<{ plan_id: UUID; draft: PlanRevision }> => ({
    method: "POST",
    path: `${root(entityId)}/plans`,
    body,
  }),
  copyPlan: (
    entityId: UUID,
    planId: UUID,
    body: { name: string; source_revision_id: UUID; expected_revision: number },
  ): WriteSpec<{ plan_id: UUID; draft: PlanRevision }> => ({
    method: "POST",
    path: `${root(entityId)}/plans/${target(planId)}/copies`,
    body,
  }),
  editPlan: (
    entityId: UUID,
    planId: UUID,
    body: PlanInput,
  ): WriteSpec<{ plan_id: UUID; draft: PlanRevision }> => ({
    method: "PUT",
    path: `${root(entityId)}/plans/${target(planId)}/draft`,
    body,
  }),
  saveVersion: (
    entityId: UUID,
    planId: UUID,
    body: RevisionInput,
  ): WriteSpec<{ version: PlanRevision; draft: PlanRevision }> => ({
    method: "POST",
    path: `${root(entityId)}/plans/${target(planId)}/versions`,
    body,
  }),
  createActivity: (entityId: UUID, body: ActivityInput): WriteSpec<Activity> => ({
    method: "POST",
    path: `${root(entityId)}/activity`,
    body,
  }),
  recordKnownTotal: (entityId: UUID, body: KnownTotalInput): WriteSpec<Activity> => ({
    method: "POST",
    path: `${root(entityId)}/activity/known-total`,
    body,
  }),
  editActivity: (entityId: UUID, activityId: UUID, body: ActivityInput): WriteSpec<Activity> => ({
    method: "PUT",
    path: `${root(entityId)}/activity/${target(activityId)}`,
    body,
  }),
  deleteActivity: (entityId: UUID, activityId: UUID, body: RevisionInput): WriteSpec<Activity> => ({
    method: "DELETE",
    path: `${root(entityId)}/activity/${target(activityId)}`,
    body,
  }),
  createRefund: (entityId: UUID, purchaseId: UUID, body: RefundInput): WriteSpec<Activity> => ({
    method: "POST",
    path: `${root(entityId)}/activity/${target(purchaseId)}/refunds`,
    body,
  }),
  editRefund: (entityId: UUID, refundId: UUID, body: RefundInput): WriteSpec<Activity> => ({
    method: "PUT",
    path: `${root(entityId)}/activity/refunds/${target(refundId)}`,
    body,
  }),
  deleteRefund: (entityId: UUID, refundId: UUID, body: RevisionInput): WriteSpec<Activity> => ({
    method: "DELETE",
    path: `${root(entityId)}/activity/refunds/${target(refundId)}`,
    body,
  }),
  createReview: (entityId: UUID, body: ReviewInput): WriteSpec<{ uuid: UUID; month: IsoDate }> => ({
    method: "POST",
    path: `${root(entityId)}/reviews`,
    body,
  }),
  editReview: (entityId: UUID, month: IsoDate, body: ReviewEditInput): WriteSpec<object> => ({
    method: "PUT",
    path: `${root(entityId)}/reviews/${encodeURIComponent(month)}`,
    body,
  }),
};
