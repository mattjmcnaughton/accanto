/** Independent scenarios: no Plan or actual-Income relationship. */
import { type DecimalString, type LoadState, type UUID, loadResource } from "./api";
import type { WriteSpec } from "./monthly";

export type Frequency = "annual" | "monthly" | "twice_monthly" | "weekly" | "daily";
export interface EstimateLineInput {
  line_id?: UUID;
  name: string;
  gross: DecimalString;
  withholding: DecimalString;
  payroll: DecimalString;
  frequency: Frequency;
  paid_days?: string | null;
}
export interface EstimateInput {
  name: string;
  lines: EstimateLineInput[];
  expected_revision?: number;
}
export interface EstimateLine extends Omit<EstimateLineInput, "line_id"> {
  uuid: UUID;
  paid_days: string | null;
  monthly_net: DecimalString;
}
export interface EstimateResult {
  uuid: UUID;
  name: string;
  revision: number;
  monthly_total: DecimalString;
  lines: EstimateLine[];
}

const root = (entityId: UUID) => `/api/entities/${encodeURIComponent(entityId)}/income-estimates`;
const target = (id: UUID) => encodeURIComponent(id);

export const incomeEstimates = {
  list: (entityId: UUID): Promise<LoadState<EstimateResult[]>> =>
    loadResource(`${root(entityId)}`, (records) => records.length === 0),
  create: (entityId: UUID, body: EstimateInput): WriteSpec<EstimateResult> => ({
    method: "POST",
    path: root(entityId),
    body,
  }),
  edit: (entityId: UUID, id: UUID, body: EstimateInput): WriteSpec<EstimateResult> => ({
    method: "PUT",
    path: `${root(entityId)}/${target(id)}`,
    body,
  }),
  duplicate: (
    entityId: UUID,
    id: UUID,
    body: { name: string; expected_revision: number },
  ): WriteSpec<EstimateResult> => ({
    method: "POST",
    path: `${root(entityId)}/${target(id)}/duplicate`,
    body,
  }),
};
