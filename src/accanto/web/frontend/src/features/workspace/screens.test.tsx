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
  fixed_costs: [],
  fixed_cost_total: "0.00",
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
    fixed_cost_recorded: null,
    fixed_cost_incomplete: true,
    missing_fixed_costs: [],
  },
  income_difference: null,
  spending_difference: null,
  fixed_cost_difference: null,
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
it("edits annual fixed-cost inputs and keeps the stored monthly result visible", async () => {
  const fixed = {
    fixed_cost_id: "fixed-a",
    name: "Synthetic subscription",
    canonical_name: "Synthetic subscription",
    amount: "100.00",
    frequency: "annual" as const,
    monthly_amount: "8.33",
  };
  const fixedDraft = {
    ...version,
    uuid: "fixed-draft",
    saved: false,
    fixed_costs: [fixed],
    fixed_cost_total: "8.33",
    unassigned: "3191.67",
  };
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    json([{ plan_id: "fixed-plan", revisions: [fixedDraft] }]),
  );
  const save = vi.fn();
  render(<Plans {...props()} save={save} />);
  fireEvent.click(await screen.findByText("Edit Baseline"));
  expect(screen.getByText("$8.33")).toBeDefined();
  expect(screen.getByDisplayValue("100.00")).toBeDefined();
  fireEvent.change(screen.getByDisplayValue("100.00"), { target: { value: "120.00" } });
  fireEvent.click(screen.getByText("Save draft"));
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({
      body: expect.objectContaining({
        fixed_costs: [
          {
            fixed_cost_id: "fixed-a",
            name: "Synthetic subscription",
            amount: "120.00",
            frequency: "annual",
          },
        ],
      }),
    }),
    expect.any(Function),
  );
});
it("records a payment assigned to a saved cost removed from the current draft", async () => {
  const fixedVersion = {
    ...version,
    fixed_costs: [
      {
        fixed_cost_id: "fixed-a",
        name: "Synthetic subscription",
        canonical_name: "Synthetic subscription",
        amount: "100.00",
        frequency: "annual" as const,
        monthly_amount: "8.33",
      },
    ],
  };
  vi.spyOn(globalThis, "fetch").mockImplementation(async (path) =>
    String(path).endsWith("/plans")
      ? json([
          {
            plan_id: "fixed-plan",
            revisions: [
              fixedVersion,
              { ...fixedVersion, uuid: "draft", saved: false, fixed_costs: [] },
            ],
          },
        ])
      : json([]),
  );
  const save = vi.fn();
  render(<ActivityScreen {...props()} save={save} />);
  fireEvent.click(await screen.findByText("Record activity"));
  fireEvent.change(screen.getByLabelText("Category"), { target: { value: "fixed_cost" } });
  fireEvent.change(screen.getByLabelText("Fixed cost"), { target: { value: "fixed-a" } });
  fireEvent.change(screen.getByLabelText("Amount (USD)"), { target: { value: "12.00" } });
  fireEvent.click(screen.getByText("Save activity"));
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({
      body: expect.objectContaining({
        category: "fixed_cost",
        fixed_cost_id: "fixed-a",
        amount: "12.00",
        funding_origin: "income",
      }),
    }),
    expect.any(Function),
  );
});
it("shows named investment and giving destinations in shared Activity", async () => {
  const entries = [
    {
      uuid: "investment-entry",
      financial_date: "2026-11-03",
      category: "investing",
      amount: "100.00",
      source_id: null,
      saving_goal_id: null,
      destination_id: "investment-1",
      funding_origin: "income",
      note: "",
      revision: 1,
      is_adjustment: false,
    },
    {
      uuid: "giving-entry",
      financial_date: "2026-11-04",
      category: "giving",
      amount: "50.00",
      source_id: null,
      saving_goal_id: null,
      destination_id: "recipient-1",
      funding_origin: "income",
      note: "",
      revision: 1,
      is_adjustment: false,
    },
  ];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (path) => {
    const url = String(path);
    if (url.endsWith("/activity")) return json(entries);
    if (url.endsWith("/investments")) return json([{ uuid: "investment-1", name: "Example fund" }]);
    if (url.endsWith("/giving-recipients"))
      return json([{ uuid: "recipient-1", name: "Example recipient" }]);
    return json([]);
  });
  render(<ActivityScreen {...props()} />);
  expect(await screen.findByText("Example fund")).toBeDefined();
  expect(await screen.findByText("Example recipient")).toBeDefined();
  expect(screen.getAllByText("Correct this entry in Investments and giving.")).toHaveLength(2);
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
  expect(screen.getAllByText("Unknown").length).toBeGreaterThanOrEqual(4);
  expect(screen.getByText("Salary")).toBeDefined();
});
it("shows saved destination expectations and category differences in Review", async () => {
  const planned = {
    ...version,
    saving_goals: [
      { goal_id: "goal", goal_name: "Laptop", amount: "200.00" },
      { goal_id: "other-goal", goal_name: "Emergency fund", amount: "100.00" },
    ],
    investments: [{ destination_id: "invest", destination_name: "Retirement", amount: "100.00" }],
    giving: [{ destination_id: "recipient", destination_name: "Community Fund", amount: "400.00" }],
  };
  vi.spyOn(globalThis, "fetch").mockImplementation(async (path) =>
    String(path).endsWith("/plans")
      ? json(plans)
      : json({
          ...review,
          version: planned,
          expected: {
            saving: "300.00",
            investing: "100.00",
            giving: "400.00",
            savings_funding: "1000.00",
            funding: "5000.00",
            allocation: "1600.00",
          },
          differences: { saving: "0.00", investing: null, giving: null },
          destination_comparisons: {
            saving_goals: [
              {
                goal_id: "goal",
                goal_name: "Laptop",
                planned: "200.00",
                recorded: "150.00",
                difference: "-50.00",
              },
              {
                goal_id: "other-goal",
                goal_name: "Emergency fund",
                planned: "100.00",
                recorded: "150.00",
                difference: "50.00",
              },
            ],
            investments: [
              {
                destination_id: "invest",
                destination_name: "Retirement",
                planned: "100.00",
                recorded: null,
                difference: null,
              },
            ],
            giving: [
              {
                destination_id: "recipient",
                destination_name: "Community Fund",
                planned: "400.00",
                recorded: null,
                difference: null,
              },
            ],
          },
          actual: { ...review.actual, saving_recorded: "300.00" },
        }),
  );
  render(<MonthlyReview {...props()} />);
  expect(await screen.findByText("Saving · Laptop")).toBeDefined();
  expect(screen.getByText("Saving · Emergency fund")).toBeDefined();
  expect(screen.getByText("Investing · Retirement")).toBeDefined();
  expect(screen.getByText("Giving · Community Fund")).toBeDefined();
  expect(screen.getByText(/Expected planned use of savings: \$1000\.00/)).toBeDefined();
  expect(screen.getByText("$-50.00")).toBeDefined();
  expect(screen.getByText("$50.00")).toBeDefined();
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
  expect((await screen.findAllByText(/Could not load this workspace/)).length).toBeGreaterThan(0);
  expect(screen.getByDisplayValue("Attempt retained")).toBeDefined();
  expect(screen.queryByText(/Current records reloaded/)).toBeNull();
});
