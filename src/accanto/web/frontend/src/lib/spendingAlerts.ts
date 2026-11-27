/**
 * Spending alerts (TDD 23): thresholds on a Plan amount. A rule stores no amount; the API reads
 * the Plan version Home compares against and returns this month's progress for each rule.
 */
import { type LoadState, type UUID, loadResource } from "./api";
import type { WriteSpec } from "./monthly";

export type AlertCategory = "spending" | "fixed_cost";
export type AlertWaiting = "no_plan_version" | "no_estimate" | "not_planned";
export interface SpendingAlert {
  uuid: UUID;
  category: AlertCategory;
  spending_subcategory_id: UUID | null;
  fixed_cost_id: UUID | null;
  name: string;
  /** Whole percentages, lowest first; over 100 means overspent. */
  thresholds: number[];
  revision: number;
  /** A subcategory reads its Spending estimate; everything else a planned amount. */
  basis: "planned" | "estimate";
  amount: string | null;
  /** Null when nothing is recorded this month. */
  recorded: string | null;
  /** Recorded of amount, rounded down; null without both. */
  percent: number | null;
  /** The highest threshold reached this month. */
  reached: number | null;
  waiting: AlertWaiting | null;
  /** Dismissed on Home by this User for its reached threshold this month. */
  dismissed: boolean;
}
export interface SpendingAlerts {
  /** The Entity's current month, YYYY-MM: alerts are for this month only. */
  month: string;
  version: { uuid: UUID; name: string; number: number } | null;
  spending_alerts: SpendingAlert[];
}
export interface AlertTarget {
  category: AlertCategory;
  spending_subcategory_id: UUID | null;
  fixed_cost_id: UUID | null;
}

export const PRESETS = [50, 70, 90, 100];
export const DEFAULT_THRESHOLDS = [70, 90];
export const TYPE_NAMES: Record<AlertCategory, string> = {
  spending: "Guilt-free spending",
  fixed_cost: "Fixed costs",
};

const root = (entityId: UUID) => `/api/entities/${encodeURIComponent(entityId)}/spending-alerts`;
const one = (entityId: UUID, id: UUID) => `${root(entityId)}/${encodeURIComponent(id)}`;

export const spendingAlerts = {
  list: (entityId: UUID): Promise<LoadState<SpendingAlerts>> =>
    loadResource(root(entityId), () => false),
  create: (
    entityId: UUID,
    body: AlertTarget & { thresholds: number[] },
  ): WriteSpec<Omit<SpendingAlert, "basis">> => ({ method: "POST", path: root(entityId), body }),
  edit: (
    entityId: UUID,
    id: UUID,
    body: { thresholds: number[]; expected_revision: number },
  ): WriteSpec<SpendingAlert> => ({ method: "PUT", path: one(entityId, id), body }),
  remove: (entityId: UUID, id: UUID, expected_revision: number): WriteSpec<unknown> => ({
    method: "DELETE",
    path: one(entityId, id),
    body: { expected_revision },
  }),
  /** Hides it on Home for this User until its next threshold or next month. */
  dismiss: (entityId: UUID, id: UUID): WriteSpec<SpendingAlert> => ({
    method: "POST",
    path: `${one(entityId, id)}/dismissal`,
    body: {},
  }),
};

/** "Eating out passed 70% of its estimate": the same words as the push. */
export const headline = (alert: SpendingAlert) =>
  `${alert.name} passed ${alert.reached}% of its ${alert.basis === "estimate" ? "estimate" : "plan"}`;

/** Why a rule cannot measure yet, in words. */
export const waitingText: Record<AlertWaiting, string> = {
  no_plan_version: "Waiting for a saved Plan version",
  no_estimate: "Waiting for an estimate in the Plan",
  not_planned: "Not planned in this Plan version",
};
