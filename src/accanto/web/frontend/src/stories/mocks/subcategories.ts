/** Synthetic subcategory assignments for stories, with the Review breakdown they imply (TDD 07). */
import type { Activity, ReviewResult } from "../../lib/monthly";
import { decimalToCents, inputMoney } from "../../lib/format";
import * as data from "./fixtures";

const [eating, books] = data.spendingSubcategories;
/** Every third spending entry stays Unassigned. */
export function assign<T extends Pick<Activity, "category">>(entry: T, index: number): T {
  if (entry.category !== "spending") return entry;
  const sub = [eating, books, null][index % 3];
  return {
    ...entry,
    spending_subcategory_id: sub?.uuid ?? null,
    spending_subcategory_name: sub?.name ?? null,
  };
}
export const assignedActivity = data.activity.map(assign);
/** Review entries reuse the Activity assignment by ID, so both screens agree. */
const byId = new Map(assignedActivity.map((entry) => [entry.uuid, entry]));
const sameAs = <T extends Pick<Activity, "uuid" | "category">>(entry: T, index: number): T => {
  const known = byId.get(entry.uuid);
  return known
    ? {
        ...entry,
        spending_subcategory_id: known.spending_subcategory_id ?? null,
        spending_subcategory_name: known.spending_subcategory_name ?? null,
      }
    : assign(entry, index);
};

/** Each review's spending grouped like the API: groups sum to recorded, Unassigned last. */
export const assignedReviews: Record<string, ReviewResult> = Object.fromEntries(
  Object.entries(data.reviews).map(([month, review]) => {
    const entries = review.entries.map(sameAs);
    // Review entries are entry snapshots; the comparison lists type them as Activity.
    const spending = entries.filter((e) => e.category === "spending") as unknown as Activity[];
    const groups = new Map<string | null, Activity[]>();
    for (const entry of spending) {
      const id = entry.spending_subcategory_id ?? null;
      groups.set(id, [...(groups.get(id) ?? []), entry]);
    }
    const sum = (list: Activity[]) => list.reduce((n, e) => n + (decimalToCents(e.amount) ?? 0), 0);
    const breakdown = [...groups.entries()]
      .map(([id, list]) => ({
        id,
        name: list[0].spending_subcategory_name ?? null,
        recorded: inputMoney(sum(list)),
        entries: list,
      }))
      .sort(
        (a, b) => Number(a.id === null) - Number(b.id === null) || sum(b.entries) - sum(a.entries),
      );
    const comparison = review.comparison && {
      ...review.comparison,
      spending: { ...review.comparison.spending, unplanned: spending, breakdown },
    };
    return [month, { ...review, entries, comparison }];
  }),
);
