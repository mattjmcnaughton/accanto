import { describe, expect, it } from "vitest";
import { decimalToCents, fmtDate, fmtMonth, formatMoney, money, parseMoney } from "./format";

describe("formatMoney", () => {
  it("groups thousands and pads cents without floating-point drift", () => {
    expect(formatMoney("1234.5")).toBe("$1,234.50");
    expect(formatMoney("999999999.99")).toBe("$999,999,999.99");
    expect(formatMoney("0.07")).toBe("$0.07");
  });
  it("puts a real minus sign before the currency symbol", () => {
    expect(formatMoney("-20.00")).toBe("−$20.00");
    expect(formatMoney("-0.00")).toBe("$0.00");
  });
  it("keeps a missing amount unknown instead of showing zero", () => {
    expect(formatMoney(null)).toBe("Unknown");
    expect(formatMoney(undefined)).toBe("Unknown");
  });
  it("shows a value it cannot read unchanged", () => {
    expect(formatMoney("1.234")).toBe("1.234");
  });
});

describe("cents", () => {
  it("converts API decimals and typed amounts exactly", () => {
    expect(decimalToCents("0.29")).toBe(29);
    expect(decimalToCents("-1.1")).toBe(-110);
    expect(parseMoney("$1,200.5")).toBe(120050);
    expect(parseMoney("12.345")).toBeNull();
    expect(money(-5)).toBe("−$0.05");
  });
});

describe("dates", () => {
  it("formats calendar dates without shifting them by the local time zone", () => {
    expect(fmtDate("2026-03-01")).toBe("Mar 1, 2026");
    expect(fmtMonth("2026-12")).toBe("December 2026");
  });
});
