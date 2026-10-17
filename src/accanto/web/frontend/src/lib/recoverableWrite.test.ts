import { afterEach, expect, test, vi } from "vitest";
import type { BrowserSession } from "./api";
import {
  RecoverableWrite,
  confirmInAppNavigation,
  guardUnsavedNavigation,
  logout,
  reauthenticate,
} from "./recoverableWrite";
import { monthly } from "./monthly";

const session = (userId = "original", csrf = "csrf-old"): BrowserSession => ({
  user: { id: userId },
  entities: [],
  csrf_token: csrf,
});
afterEach(() => vi.unstubAllGlobals());

test("lost response and expiry retain the exact serialized body and key for same-User retry", async () => {
  const fetcher = vi
    .fn()
    .mockRejectedValueOnce(new TypeError("lost response"))
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: { code: "session_expired", message: "Expired" } }), {
        status: 401,
      }),
    )
    .mockResolvedValueOnce(new Response(JSON.stringify({ uuid: "entry-1" }), { status: 200 }));
  vi.stubGlobal("fetch", fetcher);
  const write = new RecoverableWrite<{ uuid: string }>();
  const input = { date: "2026-10-15", category: "spending" as const, amount: "75.00" };
  write.prepare("original", monthly.createActivity("entity-1", input));
  input.amount = "99.00";
  expect((await write.submit(session())).kind).toBe("unavailable");
  expect((await write.submit(session())).kind).toBe("unauthenticated");
  expect((await write.submit(session("original", "csrf-new"))).kind).toBe("confirmed");
  const requests = fetcher.mock.calls.map((call) => call[1] as RequestInit);
  expect(new Set(requests.map((request) => request.body))).toEqual(
    new Set(['{"date":"2026-10-15","category":"spending","amount":"75.00"}']),
  );
  expect(
    new Set(requests.map((request) => new Headers(request.headers).get("Idempotency-Key"))).size,
  ).toBe(1);
  expect(new Headers(requests[2].headers).get("X-CSRF-Token")).toBe("csrf-new");
  expect(write.pendingFor("original")).toBeNull();
});

test("stale conflicts retain input; wrong User can neither inspect nor submit it", async () => {
  const fetcher = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ detail: { code: "stale_revision", message: "Reconcile" } }), {
      status: 409,
    }),
  );
  vi.stubGlobal("fetch", fetcher);
  const write = new RecoverableWrite();
  write.prepare("original", monthly.saveVersion("entity-1", "plan-1", { expected_revision: 2 }));
  expect((await write.submit(session())).kind).toBe("conflict");
  expect(write.pendingFor("other")).toBeNull();
  expect((await write.submit(session("other"))).kind).toBe("wrong_user");
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(write.pendingFor("original")?.body).toContain('"expected_revision":2');
});

test("an old in-flight response cannot clear a replacement pending operation", async () => {
  let respond!: (value: Response) => void;
  const fetcher = vi.fn().mockImplementation(
    () =>
      new Promise<Response>((resolve) => {
        respond = resolve;
      }),
  );
  vi.stubGlobal("fetch", fetcher);
  const write = new RecoverableWrite();
  write.prepare(
    "original",
    monthly.createActivity("entity-1", {
      date: "2026-10-15",
      category: "spending",
      amount: "75.00",
    }),
  );
  const first = write.submit(session());
  write.clear();
  write.prepare(
    "original",
    monthly.createActivity("entity-1", {
      date: "2026-10-16",
      category: "spending",
      amount: "80.00",
    }),
  );
  respond(new Response(JSON.stringify({ uuid: "old-entry" }), { status: 200 }));
  expect((await first).kind).toBe("superseded");
  expect(write.pendingFor("original")?.body).toContain('"amount":"80.00"');
});

test("blocked, cancelled and changed-User sign-in leave pending input intact", async () => {
  const write = new RecoverableWrite();
  write.prepare(
    "original",
    monthly.createReview("entity-1", { month: "2026-10-01", version_id: "version-1" }),
  );
  expect((await reauthenticate("original", () => null)).kind).toBe("blocked");
  expect(
    (
      await reauthenticate("original", () => {
        throw new Error("popup denied");
      })
    ).kind,
  ).toBe("blocked");
  expect(
    (
      await reauthenticate(
        "original",
        () => ({ closed: true }) as Window,
        async () => {
          throw new Error("closed");
        },
      )
    ).kind,
  ).toBe("cancelled");
  expect(
    (
      await reauthenticate(
        "original",
        () => ({ closed: false, close: vi.fn() }) as unknown as Window,
        async () => session("other"),
      )
    ).kind,
  ).toBe("wrong_user");
  expect(write.pendingFor("original")).not.toBeNull();
  expect(write.pendingFor("other")).toBeNull();
  write.clear();
  expect(write.pendingFor("original")).toBeNull();
});

test("verified same User returns refreshed CSRF; popup hints alone do not authorize retry", async () => {
  const close = vi.fn();
  const check = vi
    .fn()
    .mockRejectedValueOnce(new Error("anonymous"))
    .mockResolvedValueOnce(session("original", "csrf-fresh"));
  const result = await reauthenticate(
    "original",
    () => ({ closed: false, close }) as unknown as Window,
    check,
    async () => {},
  );
  expect(result).toMatchObject({ kind: "ready", session: { csrf_token: "csrf-fresh" } });
  expect(check).toHaveBeenCalledTimes(2);
  expect(close).toHaveBeenCalledOnce();
});

test("explicit logout clears financial memory even when server confirmation fails", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
  const clear = vi.fn();
  await expect(logout(session(), clear)).rejects.toMatchObject({ kind: "unavailable" });
  expect(clear).toHaveBeenCalledOnce();
});

test("logout clears financial memory before an indefinitely delayed response", async () => {
  let respond!: (value: Response) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          respond = resolve;
        }),
    ),
  );
  const clear = vi.fn();
  const request = logout(session(), clear);
  expect(clear).toHaveBeenCalledOnce();
  respond(new Response(JSON.stringify({ signed_out: true }), { status: 200 }));
  await request;
});

test("dirty navigation warns but clean navigation passes", () => {
  let dirty = true;
  const remove = guardUnsavedNavigation(() => dirty);
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(
    confirmInAppNavigation(
      () => dirty,
      () => false,
    ),
  ).toBe(false);
  dirty = false;
  expect(
    confirmInAppNavigation(
      () => dirty,
      () => false,
    ),
  ).toBe(true);
  remove();
});
