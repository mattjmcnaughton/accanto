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
export interface Loan {
  uuid: string;
  name: string;
  active: boolean;
  revision: number;
  opening: { date: string; amount: string };
  latest: Observation;
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
  createLoan: (
    entity: string,
    body: { name: string; opening: { date: string; amount: string } },
  ): WriteSpec<Loan> => ({
    method: "POST",
    path: `${root(entity)}/debts`,
    body,
  }),
  editLoan: (
    entity: string,
    id: string,
    body: { name: string; active: boolean; expected_revision: number },
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
