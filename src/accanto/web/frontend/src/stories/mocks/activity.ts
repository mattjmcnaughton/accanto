/**
 * A stand-in for GET /activity/page over a fixed list, for stories and tests: newest first,
 * filtered by month, category, tag and entry, cut at the cursor. Search keeps entries whose
 * note holds every word; the server also reads names, dates and amounts.
 */
import type { ActivityPage } from "../../lib/monthly";

type Entry = Record<string, unknown> & {
  uuid: string;
  financial_date: string;
  category: string;
  note: string;
  tag_ids?: string[];
  refund_of?: string | null;
};

export function activityPage(url: string, entries: Entry[]): ActivityPage {
  const query = new URL(url, "http://test").searchParams;
  const param = (name: string) => query.get(name) ?? "";
  const words = param("q").toLowerCase().split(/\s+/).filter(Boolean);
  const scoped = entries
    .filter((entry) => entry.financial_date.startsWith(param("month").slice(0, 7)))
    .sort((a, b) => b.financial_date.localeCompare(a.financial_date));
  const kept = scoped.filter(
    (entry) =>
      (!param("category") || entry.category === param("category")) &&
      (!param("tag_id") || (entry.tag_ids ?? []).includes(param("tag_id"))) &&
      (!param("entry_id") || entry.uuid === param("entry_id")) &&
      words.every((word) => entry.note.toLowerCase().includes(word)),
  );
  const start = param("cursor") ? kept.findIndex((entry) => entry.uuid === param("cursor")) + 1 : 0;
  const limit = Number(param("limit") || 100);
  const page = kept.slice(start, start + limit);
  return {
    entries: page,
    purchases: entries.filter(
      (entry) => !page.includes(entry) && page.some((row) => row.refund_of === entry.uuid),
    ),
    next_cursor: start + limit < kept.length ? page[page.length - 1].uuid : null,
    total: scoped.length,
    matching: kept.length,
  } as unknown as ActivityPage;
}
