/**
 * Epoch milliseconds for an API timestamp, or null when absent or unreadable.
 * The API serializes UTC instants as "YYYY-MM-DD HH:MM:SS.ffffff+00:00"; ECMAScript only
 * guarantees "T" separators and millisecond precision, so normalize before parsing.
 */
export function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value.replace(" ", "T").replace(/(\.\d{3})\d+/, "$1"));
  return Number.isNaN(ms) ? null : ms;
}
