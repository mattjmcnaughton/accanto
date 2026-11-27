/** Same-origin browser transport. Financial data never enters a URL configured by the client. */
import { recordCall } from "./bugReport";

export type UUID = string;
export type DecimalString = string;
export type IsoDate = string;

export interface BrowserSession {
  user: { id: UUID };
  entities: Array<{
    id: UUID;
    name: string;
    time_zone: string;
    today: IsoDate;
    /** The caller's access (TDD 19); absent from older servers. */
    role?: "owner" | "member";
  }>;
  csrf_token: string;
  screen_timing?: boolean;
  /** Report bug (TDD 19): on only for Users the operator listed. */
  report_bug?: boolean;
}

export type ApiErrorKind =
  | "unauthenticated"
  | "conflict"
  | "validation"
  | "unavailable"
  | "not_found"
  | "error";

export class ApiError extends Error {
  constructor(
    public readonly kind: ApiErrorKind,
    public readonly status: number | null,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type LoadState<T> =
  | { kind: "loading" }
  // `stale` marks the last result, shown while its fresh read is pending: decide nothing from it.
  | { kind: "ready"; data: T; stale?: true }
  | { kind: "empty"; stale?: true }
  | { kind: ApiErrorKind; error: ApiError };

export const loading: LoadState<never> = { kind: "loading" };

function sameOriginApiPath(path: string): string {
  if (!path.startsWith("/api/") || path.startsWith("//") || path.includes("\\")) {
    throw new Error("Same-origin API path required");
  }
  return path;
}

function errorKind(status: number): ApiErrorKind {
  if (status === 401) return "unauthenticated";
  if (status === 409) return "conflict";
  if (status === 422) return "validation";
  if (status === 503) return "unavailable";
  if (status === 404) return "not_found";
  return "error";
}

async function apiError(response: Response): Promise<ApiError> {
  let detail: unknown;
  try {
    const payload: unknown = await response.json();
    detail =
      typeof payload === "object" && payload !== null && "detail" in payload
        ? payload.detail
        : undefined;
  } catch {
    // An error response need not be JSON.
  }
  let code = `http_${response.status}`;
  let message = response.statusText || "The request could not be completed.";
  if (typeof detail === "string") message = detail;
  else if (Array.isArray(detail) && typeof detail[0]?.msg === "string") message = detail[0].msg;
  else if (typeof detail === "object" && detail !== null) {
    if ("code" in detail && typeof detail.code === "string") code = detail.code;
    if ("message" in detail && typeof detail.message === "string") message = detail.message;
  }
  return new ApiError(errorKind(response.status), response.status, code, message);
}

export async function fetchJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const url = sameOriginApiPath(path);
  const headers = new Headers(init.headers);
  const method = init.method ?? "GET";
  const started = performance.now();
  try {
    const response = await fetch(url, {
      ...init,
      headers,
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
    });
    if (!response.ok) {
      const error = await apiError(response);
      recordCall(method, url, response.status, performance.now() - started, error.code);
      throw error;
    }
    recordCall(method, url, response.status, performance.now() - started, null);
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    recordCall(method, url, null, performance.now() - started, "network_unavailable");
    throw new ApiError(
      "unavailable",
      null,
      "network_unavailable",
      "Could not reach Accanto. Your input is still here.",
    );
  }
}

export async function readSession(): Promise<BrowserSession> {
  const session = await fetchJson<BrowserSession>("/api/auth/session");
  if (
    typeof session?.user?.id !== "string" ||
    typeof session.csrf_token !== "string" ||
    !Array.isArray(session.entities)
  ) {
    throw new ApiError(
      "unavailable",
      null,
      "invalid_session_response",
      "Could not verify this sign-in.",
    );
  }
  return session;
}

export async function loadResource<T>(
  path: string,
  isEmpty: (value: T) => boolean,
): Promise<LoadState<T>> {
  try {
    const data = await fetchJson<T>(path);
    return isEmpty(data) ? { kind: "empty" } : { kind: "ready", data };
  } catch (error) {
    const issue =
      error instanceof ApiError
        ? error
        : new ApiError("error", null, "unexpected", "The request could not be completed.");
    if (issue.status === 404 && issue.code === "review_not_found") return { kind: "empty" };
    return { kind: issue.kind, error: issue };
  }
}
