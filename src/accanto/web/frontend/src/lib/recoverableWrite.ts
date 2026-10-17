import { ApiError, type BrowserSession, type UUID, fetchJson, readSession } from "./api";
import type { WriteSpec } from "./monthly";

type Pending = Readonly<{
  ownerUserId: UUID;
  method: "POST" | "PUT" | "DELETE";
  path: string;
  body: string;
  key: string;
}>;
export type WriteOutcome<T> =
  | { kind: "idle" | "wrong_user" | "superseded" }
  | { kind: "confirmed"; data: T }
  | {
      kind: "unauthenticated" | "conflict" | "unavailable" | "validation" | "not_found" | "error";
      error: ApiError;
    };

/** One financial operation at a time. The exact body and key live only in this tab's memory. */
export class RecoverableWrite<T = unknown> {
  private pending: Pending | null = null;

  prepare(ownerUserId: UUID, spec: WriteSpec<T>): void {
    if (this.pending) throw new Error("Resolve the pending write before starting another.");
    this.pending = Object.freeze({
      ownerUserId,
      method: spec.method,
      path: spec.path,
      body: JSON.stringify(spec.body),
      key: crypto.randomUUID(),
    });
  }

  pendingFor(userId: UUID): Pending | null {
    return this.pending?.ownerUserId === userId ? this.pending : null;
  }

  hasPending(): boolean {
    return this.pending !== null;
  }

  async submit(session: BrowserSession): Promise<WriteOutcome<T>> {
    const operation = this.pending;
    if (!operation) return { kind: "idle" };
    if (session.user.id !== operation.ownerUserId) return { kind: "wrong_user" };
    try {
      const data = await fetchJson<T>(operation.path, {
        method: operation.method,
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": operation.key,
          "X-CSRF-Token": session.csrf_token,
        },
        body: operation.body,
      });
      if (this.pending !== operation) return { kind: "superseded" };
      this.pending = null;
      return { kind: "confirmed", data };
    } catch (error) {
      if (this.pending !== operation) return { kind: "superseded" };
      const issue =
        error instanceof ApiError
          ? error
          : new ApiError(
              "error",
              null,
              "unexpected",
              "Save was not confirmed. Your input is still here.",
            );
      return { kind: issue.kind, error: issue };
    }
  }

  clear(): void {
    this.pending = null;
  }
}

export type Reauthentication =
  | { kind: "ready"; session: BrowserSession }
  | { kind: "blocked" | "cancelled" | "failed" | "wrong_user" };

/** Popup events are never trusted as identity. Poll the same-origin session endpoint. */
export async function reauthenticate(
  originalUserId: UUID,
  openPopup: () => Window | null = () =>
    window.open("/api/auth/login", "accanto-sign-in", "popup,width=520,height=680"),
  checkSession: () => Promise<BrowserSession> = readSession,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<Reauthentication> {
  let popup: Window | null;
  try {
    popup = openPopup();
  } catch {
    return { kind: "blocked" };
  }
  if (!popup) return { kind: "blocked" };
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      const session = await checkSession();
      if (session.user.id !== originalUserId) return { kind: "wrong_user" };
      popup.close();
      return { kind: "ready", session };
    } catch {
      if (popup.closed) return { kind: "cancelled" };
    }
    await wait(1000);
  }
  return { kind: "failed" };
}

/** Logout erases financial memory even if the server cannot confirm sign-out. */
export async function logout(
  session: BrowserSession,
  clearFinancialState: () => void,
): Promise<void> {
  clearFinancialState();
  await fetchJson("/api/auth/logout", {
    method: "POST",
    headers: { "X-CSRF-Token": session.csrf_token },
  });
}

export function guardUnsavedNavigation(isDirty: () => boolean): () => void {
  const warn = (event: BeforeUnloadEvent) => {
    if (!isDirty()) return;
    event.preventDefault();
    event.returnValue = "";
  };
  window.addEventListener("beforeunload", warn);
  return () => window.removeEventListener("beforeunload", warn);
}

export function confirmInAppNavigation(
  isDirty: () => boolean,
  confirm: (message: string) => boolean = window.confirm,
): boolean {
  return !isDirty() || confirm("Leave this page? Unsaved input in this tab will be lost.");
}
