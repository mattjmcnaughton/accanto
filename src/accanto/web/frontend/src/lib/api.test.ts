import { afterEach, expect, test, vi } from "vitest";
import { ApiError, fetchJson, loadResource, readSession } from "./api";

afterEach(() => vi.unstubAllGlobals());

test("uses same-origin cookies and normalized current session", async () => {
  const fetcher = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ user: { id: "user-1" }, entities: [], csrf_token: "csrf-1" }), {
      status: 200,
    }),
  );
  vi.stubGlobal("fetch", fetcher);
  expect((await readSession()).user.id).toBe("user-1");
  expect(fetcher).toHaveBeenCalledWith(
    "/api/auth/session",
    expect.objectContaining({ credentials: "same-origin", cache: "no-store", redirect: "error" }),
  );
  await expect(fetchJson("https://other.example/api/steal")).rejects.toThrow(
    "Same-origin API path required",
  );
});

test("distinguishes empty, unavailable, unauthenticated and conflict loads", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(new Response("[]", { status: 200 }))
    .mockRejectedValueOnce(new TypeError("Failed to fetch"))
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: { code: "invalid_credential", message: "Expired" } }), {
        status: 401,
      }),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: { code: "stale_revision", message: "Reconcile" } }), {
        status: 409,
      }),
    );
  vi.stubGlobal("fetch", fetcher);
  expect(
    await loadResource<unknown[]>("/api/entities/e/plans", (value) => value.length === 0),
  ).toMatchObject({ kind: "empty" });
  expect(
    await loadResource<unknown[]>("/api/entities/e/plans", (value) => value.length === 0),
  ).toMatchObject({ kind: "unavailable" });
  expect(
    await loadResource<unknown[]>("/api/entities/e/plans", (value) => value.length === 0),
  ).toMatchObject({ kind: "unauthenticated" });
  expect(
    await loadResource<unknown[]>("/api/entities/e/plans", (value) => value.length === 0),
  ).toMatchObject({ kind: "conflict" });
});

test("normalizes validation and specific absent Review without treating every 404 as empty", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: [{ msg: "Invalid date" }] }), { status: 422 }),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: { code: "review_not_found", message: "No Review" } }), {
        status: 404,
      }),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: "Entity unavailable" }), { status: 404 }),
    );
  vi.stubGlobal("fetch", fetcher);
  await expect(fetchJson("/api/entities/e/plans")).rejects.toMatchObject({
    kind: "validation",
    message: "Invalid date",
  });
  expect(await loadResource("/api/entities/e/reviews/2026-10-01", () => false)).toMatchObject({
    kind: "empty",
  });
  await expect(fetchJson("/api/entities/e/plans")).rejects.toBeInstanceOf(ApiError);
});
