import { type LoadState, loadResource } from "./api";
import type { WriteSpec } from "./monthly";

export interface Goal {
  uuid: string;
  name: string;
  role: "ordinary" | "unallocated";
  kind: "finite" | "ongoing";
  target: string | null;
  opening_amount: string;
  remaining_saved: string;
  contribution_progress: string;
  funded_status: "Funded" | "Not yet funded" | null;
  revision: number;
  active: boolean;
}
export interface SavingsAccount {
  uuid: string;
  name: string;
  opening_date: string;
  opening_amount: string;
  balance: string;
  revision: number;
  active: boolean;
  goals: Goal[];
}
export interface OpeningGoal {
  name: string;
  kind: "finite" | "ongoing";
  target: string | null;
  opening_amount: string;
}
export interface SavingsMovement {
  uuid: string;
  kind: "reassignment" | "transfer" | "reconciliation";
  date: string;
  amount: string;
  note: string;
  revision: number;
  from_goal_id: string | null;
  to_goal_id: string | null;
  goal_id: string | null;
}
export type MovementBody = {
  kind: SavingsMovement["kind"];
  date: string;
  from_goal_id?: string;
  to_goal_id?: string;
  goal_id?: string;
  amount?: string;
  known_amount?: string;
  note: string;
};
const root = (entity: string) => `/api/entities/${encodeURIComponent(entity)}/savings-accounts`;
const movements = (entity: string) => `${root(entity)}/movements`;
const record = (entity: string, account: string) =>
  `${root(entity)}/${encodeURIComponent(account)}`;
export const savings = {
  movements: (entity: string): Promise<LoadState<SavingsMovement[]>> =>
    loadResource(movements(entity), (rows: SavingsMovement[]) => rows.length === 0),
  move: (entity: string, body: MovementBody): WriteSpec<SavingsMovement> => ({
    method: "POST",
    path: movements(entity),
    body,
  }),
  correctMovement: (
    entity: string,
    movement: string,
    body: MovementBody & { expected_revision: number },
  ): WriteSpec<SavingsMovement> => ({
    method: "PUT",
    path: `${movements(entity)}/${encodeURIComponent(movement)}`,
    body,
  }),
  deleteMovement: (entity: string, movement: SavingsMovement): WriteSpec<SavingsMovement> => ({
    method: "DELETE",
    path: `${movements(entity)}/${encodeURIComponent(movement.uuid)}`,
    body: { kind: movement.kind, expected_revision: movement.revision },
  }),
  list: (entity: string): Promise<LoadState<SavingsAccount[]>> =>
    loadResource(root(entity), (rows: SavingsAccount[]) => rows.length === 0),
  create: (
    entity: string,
    body: {
      name: string;
      opening_date: string;
      opening_amount: string;
      goals: OpeningGoal[];
    },
  ): WriteSpec<SavingsAccount> => ({ method: "POST", path: root(entity), body }),
  edit: (
    entity: string,
    account: string,
    body: {
      name: string;
      opening_date: string;
      opening_amount: string;
      designations: Array<{ goal_id: string; opening_amount: string }>;
      expected_revision: number;
    },
  ): WriteSpec<SavingsAccount> => ({ method: "PUT", path: record(entity, account), body }),
  addGoal: (
    entity: string,
    account: string,
    body: {
      name: string;
      kind: "finite" | "ongoing";
      target: string | null;
      expected_account_revision: number;
    },
  ): WriteSpec<SavingsAccount> => ({
    method: "POST",
    path: `${record(entity, account)}/goals`,
    body,
  }),
  editGoal: (
    entity: string,
    account: string,
    goal: string,
    body: {
      name: string;
      kind: "finite" | "ongoing";
      target: string | null;
      active: boolean;
      expected_revision: number;
    },
  ): WriteSpec<SavingsAccount> => ({
    method: "PUT",
    path: `${record(entity, account)}/goals/${encodeURIComponent(goal)}`,
    body,
  }),
};
