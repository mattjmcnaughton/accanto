// One money formatter and one date formatter for the whole app (audit idea 2).
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** Cents to "$1,234.56", with a real minus sign for negatives. */
export const money = (cents: number) => (cents < 0 ? "−" : "") + usd.format(Math.abs(cents) / 100);
/** An API decimal string such as "1234.5" or "-20.00" to cents, or null when it is not an amount. */
export function decimalToCents(value: string): number | null {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const cents = Number(match[2]) * 100 + Number(`${match[3] ?? ""}00`.slice(0, 2));
  return match[1] ? -cents : cents;
}
/** Money as the API sends it. A missing amount is "Unknown", never zero. */
export function formatMoney(value: string | null | undefined): string {
  if (value === null || value === undefined) return "Unknown";
  const cents = decimalToCents(value);
  return cents === null ? value : money(cents);
}
export const inputMoney = (cents: number) => (cents / 100).toFixed(2);
export const pct = (part: number, whole: number, digits = 1) =>
  whole > 0 ? `${((part / whole) * 100).toFixed(digits)}%` : null;

/** Accepts "42", "42.5", "$1,200.00". Returns cents, or null when it is not an amount. */
export function parseMoney(text: string): number | null {
  const clean = text.replace(/[$,\s]/g, "");
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(clean)) return null;
  const [whole, frac = ""] = clean.split(".");
  return Number(whole) * 100 + Number(`${frac}00`.slice(0, 2));
}

/** Integer division rounded half to even, as the product's monetary rules require. */
export function divHalfEven(n: number, d: number): number {
  const q = Math.floor(n / d);
  const twice = (n - q * d) * 2;
  if (twice > d || (twice === d && q % 2 === 1)) return q + 1;
  return q;
}

const utc = (iso: string) => new Date(`${iso.length === 7 ? `${iso}-01` : iso}T00:00:00Z`);
const fmt = (options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" });
const F = {
  date: fmt({ month: "short", day: "numeric", year: "numeric" }),
  short: fmt({ month: "short", day: "numeric" }),
  day: fmt({ weekday: "long", month: "short", day: "numeric" }),
  month: fmt({ month: "long", year: "numeric" }),
  monthName: fmt({ month: "long" }),
  mon: fmt({ month: "short" }),
};
export const fmtDate = (iso: string) => F.date.format(utc(iso));
export const fmtShort = (iso: string) => F.short.format(utc(iso));
export const fmtDay = (iso: string) => F.day.format(utc(iso));
export const fmtMonth = (ym: string) => F.month.format(utc(ym));
export const monthName = (ym: string) => F.monthName.format(utc(ym));
export const fmtMon = (iso: string) => F.mon.format(utc(iso));

export function addMonths(ym: string, by: number): string {
  const d = utc(ym);
  d.setUTCMonth(d.getUTCMonth() + by);
  return d.toISOString().slice(0, 7);
}
export const daysInMonth = (ym: string) => {
  const d = utc(addMonths(ym, 1));
  d.setUTCDate(0);
  return d.getUTCDate();
};
export const daysBetween = (from: string, to: string) =>
  Math.round((utc(to).getTime() - utc(from).getTime()) / 86400000);
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
