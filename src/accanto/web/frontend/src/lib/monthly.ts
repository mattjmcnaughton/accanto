/** Contracts for the implemented monthly API. Money is transported as decimal strings. */
import { type DecimalString, type IsoDate, type LoadState, type UUID, loadResource } from "./api";

export interface IncomeLineInput {
  source_id?: UUID | null;
  name: string;
  amount: DecimalString;
}
export interface PlanInput {
  name: string;
  incomes: IncomeLineInput[];
  spending: DecimalString;
  expected_revision?: number;
}
export interface ActivityInput {
  date: IsoDate;
  category: "income" | "spending";
  amount: DecimalString;
  source_id?: UUID | null;
  note?: string;
  expected_revision?: number;
}
export interface RevisionInput {
  expected_revision: number;
}
export interface ReviewInput {
  month: IsoDate;
  version_id: UUID;
}

export interface PlanRevision {
  uuid: UUID;
  name: string;
  number: number;
  revision: number;
  saved: boolean;
  saved_at: string | null;
  rule_version: string;
  incomes: Array<{ source_id: UUID; name: string; amount: DecimalString }>;
  income: DecimalString;
  spending: DecimalString;
  tithe_target: DecimalString;
  unassigned: DecimalString;
}
export interface PlanGroup {
  plan_id: UUID;
  revisions: PlanRevision[];
}
export interface Activity {
  uuid: UUID;
  financial_date: IsoDate;
  category: "income" | "spending";
  amount: DecimalString;
  source_id: UUID | null;
  note: string;
  revision: number;
}
export type ReviewEntry = Omit<Activity, "source_id"> & { source_uuid: UUID | null };
export interface ReviewResult {
  review: { uuid: UUID; month: IsoDate };
  version: PlanRevision;
  entries: ReviewEntry[];
  actual: {
    income_recorded: DecimalString | null;
    income_incomplete: boolean;
    missing_sources: UUID[];
    spending_recorded: DecimalString | null;
  };
  income_difference: DecimalString | null;
  spending_difference: DecimalString | null;
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
  createReview: (entityId: UUID, body: ReviewInput): WriteSpec<{ uuid: UUID; month: IsoDate }> => ({
    method: "POST",
    path: `${root(entityId)}/reviews`,
    body,
  }),
};
