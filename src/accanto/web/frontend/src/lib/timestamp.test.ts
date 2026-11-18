import { expect, it } from "vitest";
import { parseTimestamp } from "./timestamp";

it("reads the API's space-separated microsecond timestamps and ISO instants alike", () => {
  const expected = Date.UTC(2026, 9, 24, 12, 0, 0, 123);
  expect(parseTimestamp("2026-10-24 12:00:00.123456+00:00")).toBe(expected);
  expect(parseTimestamp("2026-10-24T12:00:00.123Z")).toBe(expected);
  expect(parseTimestamp("2026-10-24 12:00:00+00:00")).toBe(Date.UTC(2026, 9, 24, 12));
});

it("treats absent and unreadable timestamps as unknown, not as an instant", () => {
  expect(parseTimestamp(null)).toBeNull();
  expect(parseTimestamp(undefined)).toBeNull();
  expect(parseTimestamp("")).toBeNull();
  expect(parseTimestamp("not a date")).toBeNull();
});
