import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { PlanRevision } from "../../lib/monthly";
import { ActivityScreen } from "./Activity";
import { MonthlyReview } from "./MonthlyReview";
import { Plans } from "./Plans";
import { Workspace } from "./Workspace";
import type { ScreenProps } from "./shared";
const entity = { id: "entity", name: "Synthetic Entity", today: "2026-11-10", time_zone: "UTC" };
const session = { user: { id: "user" }, csrf_token: "synthetic", entities: [entity] };
const version: PlanRevision = {
  uuid: "v1",
  name: "Baseline",
  number: 1,
  revision: 1,
  saved: true,
  saved_at: "2026-10-01",
  rule_version: "1",
  incomes: [{ source_id: "source", name: "Salary", amount: "4000.00" }],
  income: "4000.00",
  spending: "800.00",
  tithe_target: "400.00",
  unassigned: "3200.00",
};
const plans = [
  {
    plan_id: "plan",
    revisions: [
      version,
      { ...version, uuid: "v2", number: 2 },
      { ...version, uuid: "draft", saved: false, number: 3 },
    ],
  },
];
const review = {
  review: { uuid: "review", month: "2026-10-01", revision: 1, note: "", reviewed_at: null },
  checkpoint_changed: false,
  version,
  entries: [],
  actual: {
    income_recorded: null,
    income_incomplete: true,
    missing_sources: ["source"],
    spending_recorded: null,
  },
  income_difference: null,
  spending_difference: null,
};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const absent = () =>
  json({ detail: { code: "review_not_found", message: "Create a Review first" } }, 404);
const props = (): ScreenProps => ({
  entity,
  concealed: false,
  busy: false,
  refresh: 0,
  guard: () => true,
  dirty: vi.fn(),
  save: vi.fn(),
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("keeps the viewed contributing-entry fingerprint through a background refresh", async () => {
  let refreshed = false;
  const first = {
    uuid: "first",
    financial_date: "2026-11-03",
    category: "spending",
    amount: "210.00",
    source_id: null,
    note: "",
    revision: 1,
    is_adjustment: false,
  };
  vi.spyOn(globalThis, "fetch").mockImplementation(async (path) =>
    String(path).endsWith("/activity")
      ? json(refreshed ? [first, { ...first, uuid: "new" }] : [first])
      : json([]),
  );
  const p = props();
  const view = render(<ActivityScreen {...p} />);
  fireEvent.click(await screen.findByRole("button", { name: "Enter known total" }));
  expect(screen.getByText("1 contributing entries were captured for this total.")).toBeDefined();
  refreshed = true;
  view.rerender(<ActivityScreen {...p} refresh={1} />);
  await waitFor(() =>
    expect(screen.getAllByRole("button", { name: /Edit spending/ })).toHaveLength(2),
  );
  fireEvent.change(screen.getByLabelText("Known total (USD)"), { target: { value: "250" } });
  fireEvent.click(screen.getByRole("button", { name: "Save adjustment" }));
  expect(p.save).toHaveBeenCalledWith(
    expect.objectContaining({
      body: expect.objectContaining({ contributing_entries: [{ uuid: "first", revision: 1 }] }),
    }),
    expect.any(Function),
  );
});
it("keeps source UUID and expected revision when saving an edited draft", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(json(plans));
  const p = props();
  render(<Plans {...p} />);
  fireEvent.click(await screen.findByRole("button", { name: "Edit Baseline" }));
  fireEvent.change(screen.getByLabelText("Net amount 1"), { target: { value: "4200.00" } });
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  expect(p.save).toHaveBeenCalledWith(
    expect.objectContaining({
      body: expect.objectContaining({
        expected_revision: 1,
        incomes: [{ source_id: "source", name: "Salary", amount: "4200.00" }],
      }),
    }),
    expect.any(Function),
  );
});
it("preselects the previous calendar month version rather than a newer version", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (path) =>
    String(path).endsWith("/plans")
      ? json(plans)
      : String(path).endsWith("2026-10-01")
        ? json(review)
        : absent(),
  );
  const p = props();
  render(<MonthlyReview {...p} />);
  const choice = (await screen.findByLabelText("Comparison version")) as HTMLSelectElement;
  await waitFor(() => expect(choice.value).toBe("v1"));
  fireEvent.click(screen.getByRole("button", { name: "Create Review" }));
  expect(p.save).toHaveBeenCalledWith(
    expect.objectContaining({ body: { month: "2026-11-01", version_id: "v1" } }),
    expect.any(Function),
  );
});
it("edits an incomplete Review with same-Plan version, notes, and annotation", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (path) =>
    String(path).endsWith("/plans")
      ? json(plans)
      : String(path).endsWith("2026-11-01")
        ? json(review)
        : absent(),
  );
  const p = props();
  render(<MonthlyReview {...p} />);
  const target = (await screen.findByLabelText("Comparison version")) as HTMLSelectElement;
  await waitFor(() => expect(target.value).toBe("v1"));
  fireEvent.change(target, { target: { value: "v2" } });
  fireEvent.change(screen.getByLabelText("Review note"), {
    target: { value: "Synthetic takeaway" },
  });
  fireEvent.click(screen.getByLabelText("Mark reviewed"));
  fireEvent.click(screen.getByRole("button", { name: "Save Review" }));
  expect(p.save).toHaveBeenCalledWith(
    expect.objectContaining({
      body: {
        expected_revision: 1,
        version_id: "v2",
        note: "Synthetic takeaway",
        reviewed: true,
        checkpoint: false,
      },
    }),
    expect.any(Function),
  );
});
it("keeps attempted Review input across a conflict reload", async () => {
  let current = review;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (path) =>
    String(path).endsWith("/plans")
      ? json(plans)
      : String(path).endsWith("2026-11-01")
        ? json(current)
        : absent(),
  );
  const p = props();
  const { rerender } = render(<MonthlyReview {...p} />);
  const note = (await screen.findByLabelText("Review note")) as HTMLTextAreaElement;
  fireEvent.change(note, { target: { value: "Unsaved synthetic note" } });
  current = { ...review, review: { ...review.review, revision: 2, note: "Other writer" } };
  rerender(<MonthlyReview {...p} refresh={1} />);
  await waitFor(() => expect(note.value).toBe("Unsaved synthetic note"));
});
it("requires explicit choice without a preceding Review and blocks creation after a failed load", async () => {
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (path) => (String(path).endsWith("/plans") ? json(plans) : absent()));
  const { unmount } = render(<MonthlyReview {...props()} />);
  const choice = (await screen.findByLabelText("Comparison version")) as HTMLSelectElement;
  expect(choice.value).toBe("");
  expect(
    (screen.getByRole("button", { name: "Create Review" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  unmount();
  fetch.mockImplementation(async (path) =>
    String(path).endsWith("/plans") ? json(plans) : json({}, 503),
  );
  render(<MonthlyReview {...props()} />);
  await screen.findByRole("alert");
  expect(screen.queryByLabelText("Comparison version")).toBeNull();
});
it("shows unknown rather than zero, retaining incomplete recorded income", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (path) =>
    String(path).endsWith("/plans")
      ? json(plans)
      : json({ ...review, actual: { ...review.actual, income_recorded: "0.00" } }),
  );
  render(<MonthlyReview {...props()} />);
  await screen.findByText("$0.00 (incomplete)");
  expect(screen.getAllByText("Unknown").length).toBe(3);
  expect(screen.getByText("Salary")).toBeDefined();
});
it("retains the exact attempted write on network failure and retry", async () => {
  const writes: RequestInit[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_path, init) => {
    if (!init?.method) return json([]);
    writes.push(init);
    if (writes.length === 1) throw new TypeError("lost response");
    return json({ plan_id: "plan", draft: { ...version, saved: false } });
  });
  render(<Workspace initial={session} signedOut={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "New Plan" }));
  fireEvent.change(screen.getByLabelText("Plan name"), { target: { value: "Attempted Plan" } });
  fireEvent.change(screen.getByLabelText("Income source 1"), { target: { value: "Salary" } });
  fireEvent.change(screen.getByLabelText("Net amount 1"), { target: { value: "4000" } });
  fireEvent.change(screen.getByLabelText("Monthly guilt-free spending"), {
    target: { value: "800" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  fireEvent.click(await screen.findByRole("button", { name: "Retry save" }));
  await waitFor(() => expect(writes.length).toBe(2));
  expect(writes[0].body).toBe(writes[1].body);
  expect(new Headers(writes[0].headers).get("Idempotency-Key")).toBe(
    new Headers(writes[1].headers).get("Idempotency-Key"),
  );
});
it("hides original User form data after another User signs in", async () => {
  const popup = vi
    .spyOn(window, "open")
    .mockReturnValue({ close: vi.fn(), closed: false } as unknown as Window);
  vi.spyOn(globalThis, "fetch").mockImplementation(async (path, init) =>
    path === "/api/auth/session"
      ? json({ ...session, user: { id: "other" } })
      : init?.method
        ? json({}, 401)
        : json([]),
  );
  render(<Workspace initial={session} signedOut={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "New Plan" }));
  fireEvent.change(screen.getByLabelText("Plan name"), { target: { value: "Hidden Plan" } });
  fireEvent.submit(screen.getByLabelText("Plan name").closest("form") as HTMLFormElement);
  fireEvent.click(await screen.findByRole("button", { name: "Sign in in a new window" }));
  await screen.findByText(/A different User signed in/);
  expect(screen.queryByDisplayValue("Hidden Plan")).toBeNull();
  expect(screen.queryByText("Synthetic Entity")).toBeNull();
  popup.mockReturnValue(null);
  fireEvent.click(screen.getByRole("button", { name: "Sign in in a new window" }));
  await waitFor(() => expect(popup).toHaveBeenCalledTimes(2));
  expect(screen.queryByDisplayValue("Hidden Plan")).toBeNull();
  expect(screen.queryByText("Synthetic Entity")).toBeNull();
});

it("retains attempted input without claiming success when conflict reload fails", async () => {
  let conflict = false;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_path, init) => {
    if (init?.method) {
      conflict = true;
      return json({ detail: { code: "stale_revision", message: "Changed elsewhere" } }, 409);
    }
    return conflict ? json({}, 503) : json(plans);
  });
  render(<Workspace initial={session} signedOut={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Edit Baseline" }));
  fireEvent.change(screen.getByLabelText("Plan name"), { target: { value: "Attempt retained" } });
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  fireEvent.click(await screen.findByRole("button", { name: "Review current record" }));
  await screen.findByText(/Could not load this workspace/);
  expect(screen.getByDisplayValue("Attempt retained")).toBeDefined();
  expect(screen.queryByText(/Current records reloaded/)).toBeNull();
});
