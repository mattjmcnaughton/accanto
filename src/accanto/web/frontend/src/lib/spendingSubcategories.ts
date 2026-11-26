/** Contracts for Spending subcategories (TDD 07): guilt-free spending's assignment. */
import { type LoadState, type UUID, loadResource } from "./api";
import type { WriteSpec } from "./monthly";

export interface SpendingSubcategory {
  uuid: UUID;
  name: string;
  active: boolean;
  revision: number;
  /** How many current entries name it. Amounts are in the Review. */
  entries: number;
}
const root = (entityId: UUID) =>
  `/api/entities/${encodeURIComponent(entityId)}/spending-subcategories`;

export const spendingSubcategories = {
  list: (entityId: UUID): Promise<LoadState<SpendingSubcategory[]>> =>
    loadResource(root(entityId), () => false),
  create: (entityId: UUID, body: { name: string }): WriteSpec<SpendingSubcategory> => ({
    method: "POST",
    path: root(entityId),
    body,
  }),
  /** Rename, archive (active: false) or restore. Subcategories are never deleted. */
  edit: (
    entityId: UUID,
    id: UUID,
    body: { name: string; active: boolean; expected_revision: number },
  ): WriteSpec<SpendingSubcategory> => ({
    method: "PUT",
    path: `${root(entityId)}/${encodeURIComponent(id)}`,
    body,
  }),
};
