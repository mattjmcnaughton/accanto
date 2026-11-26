/** Contracts for Tags (TDD 05). Tags label entries; they never change amounts or totals. */
import { type LoadState, type UUID, loadResource } from "./api";
import type { Activity, WriteSpec } from "./monthly";

export interface Tag {
  uuid: UUID;
  name: string;
  active: boolean;
  revision: number;
  /** How many current entries carry it. A count, never an amount. */
  entries: number;
}
export interface EntryTagsChange {
  entry_id: UUID;
  expected_revision: number;
  tag_ids: UUID[];
}
const root = (entityId: UUID) => `/api/entities/${encodeURIComponent(entityId)}`;
const target = (id: UUID) => encodeURIComponent(id);

export const tags = {
  list: (entityId: UUID): Promise<LoadState<Tag[]>> =>
    loadResource(`${root(entityId)}/tags`, () => false),
  create: (entityId: UUID, body: { name: string }): WriteSpec<Tag> => ({
    method: "POST",
    path: `${root(entityId)}/tags`,
    body,
  }),
  edit: (
    entityId: UUID,
    tagId: UUID,
    body: { name: string; active: boolean; expected_revision: number },
  ): WriteSpec<Tag> => ({
    method: "PUT",
    path: `${root(entityId)}/tags/${target(tagId)}`,
    body,
  }),
  remove: (
    entityId: UUID,
    tagId: UUID,
    body: { expected_revision: number },
  ): WriteSpec<Tag & { entries_changed: number }> => ({
    method: "DELETE",
    path: `${root(entityId)}/tags/${target(tagId)}`,
    body,
  }),
  /** Label-only: replaces each entry's tags and nothing else. */
  setEntryTags: (
    entityId: UUID,
    entries: EntryTagsChange[],
  ): WriteSpec<{ entries: Activity[] }> => ({
    method: "POST",
    path: `${root(entityId)}/activity/tags`,
    body: { entries },
  }),
};
