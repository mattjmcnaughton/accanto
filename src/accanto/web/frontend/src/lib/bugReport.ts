/**
 * Report bug (TDD 21): what a report carries besides its note.
 *
 * Only allowlisted diagnostics, kept in this tab's memory and sent only with a report:
 * API calls as method, path template, status, time and error code, and client error
 * class names. Never page text, request or response bodies, query strings or error
 * messages, which can quote amounts and names. The API checks the same allowlist.
 */

export type ReportKind = "bug" | "idea" | "fix";
export interface ApiCall {
  method: string;
  path: string;
  status: number | null;
  ms: number;
  code: string | null;
}
export interface ReportContext {
  screen: string;
  month: string | null;
  build: string;
  viewport: { width: number; height: number; pixel_ratio: number };
  theme: "light" | "dark";
  user_agent: string;
  api: ApiCall[];
  errors: { name: string }[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WORD = /^[a-z][a-z0-9_-]{0,39}$/;
const DAY = /^\d{4}-\d{2}(-\d{2})?$/;
const CODE = /^[a-z0-9_]{1,64}$/;
const NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

/** An API path with identifiers and every other value replaced, and no query string. */
export function pathTemplate(url: string): string {
  return url
    .split(/[?#]/)[0]
    .split("/")
    .map((part, i) =>
      i === 0
        ? part
        : UUID.test(part)
          ? ":id"
          : WORD.test(part) || DAY.test(part)
            ? part
            : ":value",
    )
    .join("/");
}

const calls: ApiCall[] = [];
const errors: { name: string }[] = [];
const keep = <T>(list: T[], item: T, size: number) => {
  list.push(item);
  if (list.length > size) list.shift();
};

/** Called by fetchJson for each API call; the latest 20 are kept. */
export function recordCall(
  method: string,
  path: string,
  status: number | null,
  ms: number,
  code: string | null,
) {
  const verb = method.toUpperCase();
  keep(
    calls,
    {
      method: METHODS.includes(verb) ? verb : "GET",
      path: pathTemplate(path),
      status,
      ms: Math.max(0, Math.min(600_000, Math.round(ms))),
      code: code && CODE.test(code) ? code : null,
    },
    20,
  );
}

function recordError(error: unknown) {
  const name = error instanceof Error ? error.name : "";
  keep(errors, { name: NAME.test(name) ? name : "Error" }, 10);
}

let started = false;
/** Keeps the class names of uncaught errors from now on. */
export function startDiagnostics() {
  if (started || typeof window === "undefined") return;
  started = true;
  window.addEventListener("error", (event) => recordError(event.error));
  window.addEventListener("unhandledrejection", (event) => recordError(event.reason));
}

export const BUILD: string =
  typeof import.meta.env.VITE_BUILD_SHA === "string" &&
  /^[0-9a-f]{7,40}$/.test(import.meta.env.VITE_BUILD_SHA)
    ? import.meta.env.VITE_BUILD_SHA
    : "dev";

export function reportContext(screen: string, month: string | null): ReportContext {
  return {
    screen,
    month,
    build: BUILD,
    viewport: {
      width: Math.min(20_000, window.innerWidth),
      height: Math.min(20_000, window.innerHeight),
      pixel_ratio: Math.min(8, Math.max(0.25, window.devicePixelRatio || 1)),
    },
    theme: document.documentElement.dataset.theme === "dark" ? "dark" : "light",
    user_agent: navigator.userAgent.slice(0, 300),
    api: calls.map((call) => ({ ...call })),
    errors: errors.map((error) => ({ ...error })),
  };
}
