/**
 * Search as you type, shared by the Transactions inbox and Activity so both match the same way.
 */
import { decimalToCents } from "./format";

/** Lowercase without accents, with a typed minus sign read as a hyphen. */
const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\u2212/g, "-")
    .toLowerCase();
/** What search reads on a row: its words, and its signed amount in cents (null when unknown). */
export type Searchable = { text: string; cents: number | null };
export const searchable = (
  parts: Array<string | null | undefined>,
  cents: number | null,
): Searchable => ({ text: fold(parts.filter(Boolean).join("\n")), cents });
/** True when the query has a word to search for. */
export const searching = (query: string) => fold(query).trim() !== "";
/**
 * True when every word of the query matches. A number such as "12", "$1,234.5" or "-12" matches
 * that exact amount (signed only when typed with a sign) or the same digits in the text.
 */
export function matches(item: Searchable, query: string): boolean {
  return fold(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => {
      if (item.text.includes(word)) return true;
      const typed = decimalToCents(word.replace(/^\+/, "").replace(/[$,]/g, ""));
      if (typed === null || item.cents === null) return false;
      return /^[+-]/.test(word) ? typed === item.cents : Math.abs(typed) === Math.abs(item.cents);
    });
}
