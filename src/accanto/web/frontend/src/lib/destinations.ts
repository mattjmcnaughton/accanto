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
}
export interface Contribution {
  uuid: string;
  financial_date: string;
  category: "investing" | "giving";
  amount: string;
  note: string;
  is_adjustment: boolean;
  revision: number;
  destination_id: string | null;
}
export interface ContributionInput {
  date: string;
  amount: string;
  destination_id: string | null;
  note: string;
  is_adjustment: boolean;
  expected_revision?: number;
}
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
    body: { name: string; target: string | null; opening?: Opening | null },
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
    },
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
