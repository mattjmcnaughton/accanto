import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { PlanRevision } from "../../lib/monthly";
import { PlanBreakdown } from "./PlanBreakdown";
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
  updated_at: null,
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
const nav = () => within(screen.getByRole("navigation", { name: "Workspace" }));
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
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

it.each([
  [
    "home",
    [
      "debts",
      "investments",
      "plans",
      "projections?years=20&dollars=today",
      "reviews/2026-11-01",
      "routines",
      "savings-accounts",
    ],
  ],
  ["plans", ["plans"]],
  ["activity", ["activity", "spending-subcategories", "tags"]],
  ["review", ["plans", "reviews/2026-10-01", "reviews/2026-11-01"]],
  [
    "inbox",
    [
      "activity",
      "giving-recipients",
      "inbox",
      "inbox/proposal-run",
      "investments",
      "plans",
      "savings-accounts",
      "sources",
      "spending-subcategories",
      "tags",
      "transaction-provider",
    ],
  ],
] as const)("loads only the foreground resources on cold %s", async (section, expected) => {
  const reads: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (path) => {
    const resource = String(path).replace(`/api/entities/${entity.id}/`, "");
    reads.push(resource);
    if (resource.startsWith("reviews/")) return json({ detail: { code: "review_not_found" } }, 404);
    return json(resource === "plans" ? plans : []);
  });
  await act(async () => {
    render(<Workspace initial={session} signedOut={vi.fn()} screen={section} />);
  });
  expect(reads.sort()).toEqual(expected);
});

it("splits Home by the version the month's Review links, else the latest saved version", async () => {
  const totals = (fixed: string, spending: string, saving: string, investing: string) => ({
    funding_total: "5000.00",
    fixed_cost_total: fixed,
    spending,
    saving_total: saving,
    investing_total: investing,
    giving_total: "500.00",
  });
  const baseline = (uuid: string, number: number, extra: Partial<PlanRevision>) => ({
    ...version,
    uuid,
    number,
    saved_at: `2026-0${number + 6}-01`,
    ...extra,
  });
  const v2 = baseline("b2", 2, totals("1000.00", "2500.00", "500.00", "500.00"));
  const groups = [
    {
      // Edited most recently, so it leads the list, but the Review links Baseline.
      plan_id: "other",
      revisions: [
        { ...version, uuid: "o1", name: "Other", ...totals("4500.00", "0.00", "0.00", "0.00") },
        {
          ...version,
          uuid: "o-draft",
          name: "Other",
          saved: false,
          number: 2,
          updated_at: "2026-11-09",
        },
      ],
    },
    {
      plan_id: "baseline",
      revisions: [
        baseline("b1", 1, totals("2500.00", "1000.00", "500.00", "500.00")),
        baseline("b3", 3, totals("1500.00", "1000.00", "1000.00", "1000.00")),
        v2,
        { ...version, uuid: "b-draft", saved: false, number: 4, updated_at: "2026-11-01" },
      ],
    },
  ];
  const group = (planned: string) => ({
    planned,
    recorded: null,
    incomplete: true,
    difference: null,
    items: [],
    unplanned: [],
    adjustments: [],
  });
  const review = {
    review: { uuid: "r", month: "2026-11-01", revision: 1, note: "", reviewed_at: "2026-11-05" },
    version: v2,
    comparison: {
      income: group("5000.00"),
      fixed_cost: group("1000.00"),
      spending: group("2500.00"),
      saving: group("500.00"),
      investing: group("500.00"),
      giving: group("500.00"),
    },
    spending_difference: null,
  };
  let linked = true;
  const reads: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (path) => {
    const resource = String(path).replace(`/api/entities/${entity.id}/`, "");
    reads.push(resource);
    if (resource.startsWith("reviews/"))
      return linked ? json(review) : json({ detail: { code: "review_not_found" } }, 404);
    return json(resource === "plans" ? groups : []);
  });
  await act(async () => {
    render(<Workspace initial={session} signedOut={vi.fn()} screen="home" />);
  });
  const card = () => screen.getByText("Plan split").closest(".glance-card") as HTMLElement;
  // Version 3 is newer, but November's Review links version 2, so Home shows version 2.
  expect(within(card()).getByText("Baseline, version 2, linked to November")).toBeDefined();
  const row = (name: string) => within(card()).getByText(name).closest("li")?.textContent;
  expect(row("Fixed costs")).toBe("Fixed costs$1,000.0020.0%");
  expect(row("Guilt-free spending")).toBe("Guilt-free spending$2,500.0050.0%");
  expect(row("Giving")).toBe("Giving$500.0010.0%");
  expect(card().textContent).not.toContain("no Review");
  // The month's figures compare against the same version.
  expect(
    screen.getByRole("heading", {
      name: "$2,500.00 is planned for guilt-free spending this month",
    }),
  ).toBeDefined();
  expect(reads.filter((read) => read === "plans" || read.startsWith("reviews/"))).toHaveLength(2);

  // Without a Review, the split shows the latest saved version of the most recently edited Plan.
  cleanup();
  linked = false;
  await act(async () => {
    render(<Workspace initial={session} signedOut={vi.fn()} screen="home" />);
  });
  expect(within(card()).getByText("Other, latest version 1")).toBeDefined();
  expect(card().textContent).toContain(
    "November has no Review yet, so this is the latest saved version.",
  );
});

it("refreshes only visible Activity after a write and restores the unsaved Plan", async () => {
  const reads: string[] = [];
  let saved = false;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (path, init) => {
    const resource = String(path).replace(`/api/entities/${entity.id}/`, "");
    const entry = {
      uuid: "new-entry",
      financial_date: entity.today,
      category: "spending",
      amount: "12.00",
      note: "Synthetic groceries",
      revision: 1,
    };
    if (init?.method === "POST") {
      saved = true;
      return json(entry);
    }
    reads.push(resource);
    return json(resource === "plans" ? plans : resource === "activity" && saved ? [entry] : []);
  });
  render(<Workspace initial={session} signedOut={vi.fn()} />);
  fireEvent.click(nav().getByRole("link", { name: "Plans" }));
  fireEvent.click(await screen.findByRole("button", { name: "Baseline" }));
  fireEvent.click(screen.getByRole("button", { name: "Details for Salary" }));
  fireEvent.change(screen.getByLabelText("Monthly amount"), { target: { value: "4200.00" } });
  await act(async () => fireEvent.click(nav().getByRole("link", { name: "Activity" })));
  reads.length = 0;
  const quick = screen.getByRole("textbox", { name: /Record guilt-free spending/ });
  fireEvent.change(quick, { target: { value: "12.00 Synthetic groceries" } });
  fireEvent.submit(quick.closest("form") as HTMLFormElement);
  expect(await screen.findByText("Synthetic groceries")).toBeDefined();
  const refreshReads = reads.splice(0).sort();
  await act(async () => fireEvent.click(nav().getByRole("link", { name: "Plans" })));
  fireEvent.click(screen.getByRole("button", { name: "Details for Salary" }));
  expect(screen.getByDisplayValue("4200.00")).toBeDefined();
  expect(refreshReads).toEqual(["activity", "spending-subcategories", "tags"]);
  expect(reads.sort()).toEqual([
    "debts",
    "giving-recipients",
    "investments",
    "plans",
    "savings-accounts",
    "spending-subcategories",
  ]);
});

it("shares a pending Home Review only within the same workspace", async () => {
  const finish: Array<(response: Response) => void> = [];
  const reviewPaths: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (path) => {
    if (String(path).endsWith("/reviews/2026-11-01")) {
      reviewPaths.push(String(path));
      return new Promise<Response>((resolve) => finish.push(resolve));
    }
    if (String(path).includes("/reviews/"))
      return json({ detail: { code: "review_not_found" } }, 404);
    return json([]);
  });
  const view = render(<Workspace key="first" initial={session} signedOut={vi.fn()} />);
  fireEvent.click(nav().getByRole("link", { name: "Review" }));
  const sameWorkspace = finish.length;
  const secondSession = { ...session, user: { id: "second-user" }, csrf_token: "other-token" };
  view.rerender(
    <Workspace key="second" initial={secondSession} signedOut={vi.fn()} screen="review" />,
  );
  const differentSession = finish.length;
  const otherEntity = { ...entity, id: "other-entity" };
  view.rerender(
    <Workspace
      key="other-entity"
      entityId={otherEntity.id}
      initial={{ ...secondSession, entities: [entity, otherEntity] }}
      signedOut={vi.fn()}
      screen="review"
    />,
  );
  await act(async () => {
    for (const complete of finish) complete(json({ detail: { code: "review_not_found" } }, 404));
  });
  expect(sameWorkspace).toBe(1);
  expect(differentSession).toBe(2);
  expect(reviewPaths).toEqual([
    "/api/entities/entity/reviews/2026-11-01",
    "/api/entities/entity/reviews/2026-11-01",
    "/api/entities/other-entity/reviews/2026-11-01",
  ]);
});

it("edits annual fixed-cost inputs, previews a weekly change and keeps the stored monthly result visible", async () => {
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
  fireEvent.click(await screen.findByRole("button", { name: "Baseline" }));
  expect(screen.getAllByText("$8.33").length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("button", { name: "Details for Synthetic subscription" }));
  expect(screen.getByDisplayValue("100.00")).toBeDefined();
  fireEvent.change(screen.getByDisplayValue("100.00"), { target: { value: "120.00" } });
  fireEvent.change(screen.getByLabelText("Frequency"), { target: { value: "Weekly" } });
  // 120.00 × 52 payments ÷ 12 months, not 120.00 × 4 weeks.
  expect(screen.getAllByText("$520.00").length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({
      body: expect.objectContaining({
        fixed_costs: [
          {
            fixed_cost_id: "fixed-a",
            name: "Synthetic subscription",
            amount: "120.00",
            frequency: "weekly",
            debt_account_id: null,
          },
        ],
      }),
    }),
    expect.any(Function),
  );
});
it("keeps source UUID and expected revision when saving an edited draft", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(json(plans));
  const p = props();
  render(<Plans {...p} />);
  fireEvent.click(await screen.findByRole("button", { name: "Baseline" }));
  fireEvent.click(screen.getByRole("button", { name: "Details for Salary" }));
  fireEvent.change(screen.getByLabelText("Monthly amount"), { target: { value: "4200.00" } });
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
it("retains the exact attempted write on network failure and retry", async () => {
  const writes: RequestInit[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_path, init) => {
    if (!init?.method) return json([]);
    writes.push(init);
    if (writes.length === 1) throw new TypeError("lost response");
    return json({ plan_id: "plan", draft: { ...version, saved: false } });
  });
  render(<Workspace initial={session} signedOut={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Create your first Plan" }));
  fireEvent.change(screen.getByLabelText("Plan name"), { target: { value: "Attempted Plan" } });
  fireEvent.click(screen.getByRole("button", { name: "Create and open" }));
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
  fireEvent.click(await screen.findByRole("button", { name: "Create your first Plan" }));
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
  fireEvent.click(await screen.findByRole("button", { name: "Baseline" }));
  fireEvent.click(screen.getByRole("button", { name: "Rename Plan: Baseline" }));
  fireEvent.change(screen.getByLabelText("Plan name"), { target: { value: "Attempt retained" } });
  fireEvent.keyDown(screen.getByLabelText("Plan name"), { key: "Escape" });
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  fireEvent.click(await screen.findByRole("button", { name: "Review current record" }));
  expect((await screen.findAllByText(/Could not load this workspace/)).length).toBeGreaterThan(0);
  expect(screen.getByRole("button", { name: "Rename Plan: Attempt retained" })).toBeDefined();
  expect(screen.queryByText(/Current records reloaded/)).toBeNull();
});

it("retains exact keyboard edits across Home and flags one cent but not exact zero", async () => {
  const draft = {
    ...version,
    uuid: "draft",
    saved: false,
    saved_at: null,
    updated_at: "2026-10-24T12:00:00Z",
    spending: "3999.99",
    funding_total: "4000.00",
    allocation_total: "3999.99",
    unassigned: "0.01",
    savings_funding: [],
    saving_goals: [],
    investments: [],
    giving: [],
  };
  vi.spyOn(globalThis, "fetch").mockImplementation(async (path) =>
    json(String(path).endsWith("/plans") ? [{ plan_id: "p", revisions: [draft] }] : []),
  );
  render(<Workspace initial={session} signedOut={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Baseline" }));
  const cell = screen.getByRole("cell", { name: "Guilt-free spending, Entered amount" });
  fireEvent.keyDown(cell, { key: "i" });
  fireEvent.change(screen.getByLabelText("Amount for Guilt-free spending"), {
    target: { value: "4000.01" },
  });
  fireEvent.keyDown(screen.getByLabelText("Amount for Guilt-free spending"), { key: "Escape" });
  expect(screen.queryByLabelText("Amount for Guilt-free spending")).toBeNull();
  fireEvent.click(nav().getByRole("link", { name: "Home" }));
  const attention = await screen.findByRole("list", { name: "Needs you" });
  fireEvent.click(
    within(attention).getByRole("button", { name: /\$0.01 overallocated.*Open draft/ }),
  );
  fireEvent.keyDown(screen.getByRole("cell", { name: "Guilt-free spending, Entered amount" }), {
    key: "i",
  });
  fireEvent.change(screen.getByLabelText("Amount for Guilt-free spending"), {
    target: { value: "4000.00" },
  });
  fireEvent.keyDown(screen.getByLabelText("Amount for Guilt-free spending"), { key: "Escape" });
  fireEvent.click(nav().getByRole("link", { name: "Home" }));
  expect(screen.queryByRole("button", { name: /overallocated/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /has unsaved changes.*Open draft/ }));
  fireEvent.keyDown(screen.getByRole("cell", { name: "Guilt-free spending, Entered amount" }), {
    key: "i",
  });
  fireEvent.change(screen.getByLabelText("Amount for Guilt-free spending"), {
    target: { value: "invalid" },
  });
  fireEvent.keyDown(screen.getByLabelText("Amount for Guilt-free spending"), { key: "Escape" });
  expect(screen.getByDisplayValue("invalid")).toBeDefined();
  fireEvent.click(nav().getByRole("link", { name: "Home" }));
  expect(screen.queryByRole("button", { name: /overallocated/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /has unsaved changes.*Open draft/ }));
  expect(screen.getByDisplayValue("invalid")).toBeDefined();
});

it("orders Plans by server update time and never recalculates saved worksheet results", async () => {
  const old = {
    ...version,
    updated_at: "2026-10-22T12:00:00Z",
    funding_total: "4000.00",
    allocation_total: "812.34",
    unassigned: "3187.66",
    tithe_target: "375.00",
    fixed_cost_total: "12.34",
    fixed_costs: [
      {
        fixed_cost_id: "cost",
        debt_account_id: null,
        name: "Legacy annual",
        canonical_name: "Legacy annual",
        amount: "100.00",
        frequency: "annual" as const,
        monthly_amount: "12.34",
      },
    ],
  };
  const later = {
    ...version,
    uuid: "later",
    name: "Most recent",
    saved: false,
    updated_at: "2026-10-24T12:00:00Z",
  };
  const groups = [
    { plan_id: "old", revisions: [old, { ...old, uuid: "draft", saved: false }] },
    { plan_id: "new", revisions: [later] },
  ];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (path) =>
    json(String(path).endsWith("/plans") ? groups : []),
  );
  render(<Plans {...props()} />);
  await screen.findByRole("button", { name: "Most recent" });
  const list = screen.getByRole("list", { name: "Plans" });
  expect(within(list).getAllByRole("listitem")[0].textContent).toContain("Most recent");
  fireEvent.click(screen.getByRole("button", { name: "Baseline" }));
  fireEvent.click(screen.getByRole("button", { name: "Rename Plan: Baseline" }));
  fireEvent.change(screen.getByLabelText("Plan name"), { target: { value: "Local name" } });
  fireEvent.keyDown(screen.getByLabelText("Plan name"), { key: "Escape" });
  fireEvent.change(screen.getByLabelText("Viewing Plan version"), { target: { value: "0" } });
  expect(screen.getByRole("heading", { name: "Baseline" })).toBeDefined();
  expect(screen.getByText("$375.00")).toBeDefined();
  expect(screen.getByRole("cell", { name: "Legacy annual, Monthly amount" }).textContent).toBe(
    "$12.34",
  );
  fireEvent.keyDown(screen.getByRole("cell", { name: "Legacy annual, Entered amount" }), {
    key: "i",
  });
  expect(screen.queryByLabelText("Amount for Legacy annual")).toBeNull();
  expect(screen.queryByRole("button", { name: "Save draft" })).toBeNull();
  fireEvent.click(screen.getByText("Plan breakdown"));
  const breakdown = screen.getByRole("table", { name: "Plan allocation breakdown" });
  expect(within(breakdown).getByRole("row", { name: /Fixed costs/ }).textContent).toContain(
    "$12.34",
  );
  fireEvent.click(screen.getByRole("button", { name: "Return to draft" }));
  expect(screen.getByRole("button", { name: "Rename Plan: Local name" })).toBeDefined();
});

it("numbers workspace navigation without intercepting numeric input", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => json([]));
  render(<Workspace initial={session} signedOut={() => {}} />);
  fireEvent.keyDown(document.body, { key: "4" });
  expect(nav().getByRole("link", { name: "Plans" }).getAttribute("aria-current")).toBe("page");
  expect(screen.queryByText("Compare saved scenarios")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /New Plan/ }));
  const name = screen.getByLabelText("Plan name");
  fireEvent.keyDown(name, { key: "1" });
  fireEvent.change(name, { target: { value: "123" } });
  expect(nav().getByRole("link", { name: "Plans" }).getAttribute("aria-current")).toBe("page");
  fireEvent.keyDown(document.body, { key: "1" });
  expect(nav().getByRole("link", { name: "Home" }).getAttribute("aria-current")).toBe("page");
  fireEvent.keyDown(document.body, { key: "4" });
  expect(screen.getByLabelText("Plan name").getAttribute("value")).toBe("123");
});

it("shows funding-based half-even percentages and never invents zero-funding ratios", () => {
  const input = {
    funding: 800,
    allocated: 4,
    rows: [
      { name: "Saving", amount: 1 },
      { name: "Giving", amount: 3 },
    ],
    state: "Unsaved preview",
  };
  const { rerender } = render(<PlanBreakdown {...input} />);
  expect(screen.getByText("Plan breakdown").closest("details")?.open).toBe(false);
  fireEvent.click(screen.getByText("Plan breakdown"));
  const table = screen.getByRole("table", { name: "Plan allocation breakdown" });
  expect(within(table).getByRole("row", { name: /Saving/ }).textContent).toContain("0.12%");
  expect(within(table).getByRole("row", { name: /Giving/ }).textContent).toContain("0.38%");
  rerender(<PlanBreakdown {...input} funding={0} />);
  expect(within(table).queryByText("0.00%")).toBeNull();
  expect(within(table).getAllByText("Unavailable")).toHaveLength(2);
  rerender(<PlanBreakdown {...input} funding={null} rows={[{ name: "Saving", amount: null }]} />);
  expect(within(table).getByText("Unknown")).toBeDefined();
  expect(within(table).getByText("Unavailable")).toBeDefined();
});

const sheetDraft = {
  ...version,
  uuid: "draft",
  saved: false,
  saved_at: null,
  updated_at: "2026-10-24 12:00:00.123456+00:00",
  spending: "3999.99",
  funding_total: "4000.00",
  allocation_total: "3999.99",
  unassigned: "0.01",
  savings_funding: [],
  saving_goals: [],
  investments: [],
  giving: [],
};
const spendingCell = () =>
  screen.getByRole("cell", { name: "Guilt-free spending, Entered amount" });
const spendingInput = () => screen.getByLabelText("Amount for Guilt-free spending");
function mockPlans(groups: unknown[] = [{ plan_id: "p", revisions: [version, sheetDraft] }]) {
  return vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (path) => json(String(path).endsWith("/plans") ? groups : []));
}

it("lists saved Plan versions newest first, under the current draft", async () => {
  const newer = { ...version, uuid: "v2", name: "Revised", number: 2, saved_at: "2026-11-05" };
  mockPlans([{ plan_id: "p", revisions: [version, newer, { ...sheetDraft, number: 3 }] }]);
  render(<Plans {...props()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Details for Baseline" }));
  expect(screen.getByText(/2 saved versions, latest version 2/)).toBeDefined();
  const expanded = document.querySelectorAll(".plan-versions p");
  expect([...expanded].map((row) => row.textContent)).toEqual([
    "Version 2, saved Nov 5, 2026 · Revised",
    "Version 1, saved Oct 1, 2026 · Baseline",
  ]);
  fireEvent.click(screen.getByRole("button", { name: "Baseline" }));
  const picker = screen.getByLabelText("Viewing Plan version") as HTMLSelectElement;
  expect([...picker.options].map((option) => option.text)).toEqual([
    "Current draft",
    "Version 2, saved Nov 5, 2026",
    "Version 1, saved Oct 1, 2026",
  ]);
  fireEvent.change(picker, { target: { value: picker.options[2].value } });
  expect(screen.getByRole("heading", { name: "Baseline" })).toBeDefined();
});

it("keeps Enter and Escape edits local and writes only on Ctrl+S, never mid-edit or read-only", async () => {
  mockPlans();
  const p = props();
  render(<Plans {...p} />);
  fireEvent.click(await screen.findByRole("button", { name: "Baseline" }));
  fireEvent.keyDown(spendingCell(), { key: "i" });
  fireEvent.change(spendingInput(), { target: { value: "3999.50" } });
  fireEvent.keyDown(spendingInput(), { key: "Enter" });
  expect(screen.queryByLabelText("Amount for Guilt-free spending")).toBeNull();
  fireEvent.keyDown(spendingCell(), { key: "i" });
  fireEvent.change(spendingInput(), { target: { value: "3999.40" } });
  fireEvent.keyDown(spendingInput(), { key: "Escape" });
  expect(screen.queryByLabelText("Amount for Guilt-free spending")).toBeNull();
  expect(p.save).not.toHaveBeenCalled();
  // Ctrl+S is refused while a cell edit is still open.
  fireEvent.keyDown(spendingCell(), { key: "i" });
  fireEvent.keyDown(spendingInput(), { key: "s", ctrlKey: true });
  expect(p.save).not.toHaveBeenCalled();
  expect(screen.getByText(/Finish the active cell edit/)).toBeDefined();
  fireEvent.keyDown(spendingInput(), { key: "Enter" });
  fireEvent.keyDown(spendingCell(), { key: "s", metaKey: true });
  expect(p.save).toHaveBeenCalledOnce();
  const spec = vi.mocked(p.save).mock.calls[0][0];
  expect(spec).toMatchObject({ method: "PUT", path: "/api/entities/entity/plans/p/draft" });
  expect(JSON.stringify(spec.body)).toContain("3999.40");
  // A saved version is read-only: Ctrl+S does nothing.
  fireEvent.change(screen.getByLabelText("Viewing Plan version"), { target: { value: "0" } });
  fireEvent.keyDown(spendingCell(), { key: "s", ctrlKey: true });
  expect(p.save).toHaveBeenCalledOnce();
});

it("ignores Enter and Escape that confirm an input-method candidate", async () => {
  mockPlans();
  render(<Plans {...props()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Baseline" }));
  fireEvent.keyDown(spendingCell(), { key: "i" });
  fireEvent.change(spendingInput(), { target: { value: "3999.50" } });
  fireEvent.keyDown(spendingInput(), { key: "Enter", isComposing: true });
  fireEvent.keyDown(spendingInput(), { key: "Escape", keyCode: 229 });
  expect(spendingInput()).toBeDefined();
  fireEvent.keyDown(spendingInput(), { key: "Enter" });
  expect(screen.queryByLabelText("Amount for Guilt-free spending")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Rename Plan: Baseline" }));
  fireEvent.keyDown(screen.getByLabelText("Plan name"), { key: "Enter", isComposing: true });
  expect(screen.getByLabelText("Plan name")).toBeDefined();
  fireEvent.keyDown(screen.getByLabelText("Plan name"), { key: "Enter" });
  expect(screen.queryByLabelText("Plan name")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /All Plans/ }));
  fireEvent.click(screen.getByRole("button", { name: /New Plan/ }));
  fireEvent.keyDown(screen.getByLabelText("Plan name"), { key: "Escape", isComposing: true });
  expect(screen.queryByText("Enter a Plan name.")).toBeNull();
  fireEvent.keyDown(screen.getByLabelText("Plan name"), { key: "Escape" });
  expect(screen.getByText("Enter a Plan name.")).toBeDefined();
});

it("sorts Plans by instant, with unknown update time last, and survives unreadable dates", async () => {
  const draft = (uuid: string, name: string, updated_at: string | null) => ({
    ...sheetDraft,
    uuid,
    name,
    updated_at,
  });
  // The API's space-separated, microsecond form sorts by instant, not as text.
  mockPlans([
    { plan_id: "a", revisions: [draft("da", "Unknown time", null)] },
    { plan_id: "b", revisions: [draft("db", "Garbled time", "yesterday")] },
    { plan_id: "c", revisions: [draft("dc", "Earlier", "2026-10-24 09:00:00.5+00:00")] },
    { plan_id: "d", revisions: [draft("dd", "Later", "2026-10-24 10:00:00.000001+00:00")] },
  ]);
  render(<Plans {...props()} />);
  await screen.findByRole("button", { name: "Later" });
  const rows = within(screen.getByRole("list", { name: "Plans" })).getAllByRole("listitem");
  expect(rows.slice(0, 2).map((row) => row.textContent)).toEqual([
    expect.stringContaining("Later"),
    expect.stringContaining("Earlier"),
  ]);
  expect(rows[2].textContent).toContain("Updated Unknown");
  expect(rows[3].textContent).toContain("Updated Unknown");
});

it("flags a replaced draft even when its revision number is the same", async () => {
  const spy = mockPlans();
  const p = props();
  const view = render(<Plans {...p} />);
  fireEvent.click(await screen.findByRole("button", { name: "Baseline" }));
  expect(screen.queryByText(/The stored draft changed/)).toBeNull();
  // Another tab saved a version: the new draft starts again at revision 1 under a new identity.
  spy.mockImplementation(async (path) =>
    json(
      String(path).endsWith("/plans")
        ? [
            {
              plan_id: "p",
              revisions: [version, { ...sheetDraft, uuid: "draft-b", number: 4, revision: 1 }],
            },
          ]
        : [],
    ),
  );
  view.rerender(<Plans {...p} refresh={1} />);
  expect(await screen.findByText(/The stored draft changed/)).toBeDefined();
});

it("does not prompt about retained Plan edits when acting on another screen", async () => {
  mockPlans();
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  render(<Workspace initial={session} signedOut={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Baseline" }));
  fireEvent.keyDown(spendingCell(), { key: "i" });
  fireEvent.change(spendingInput(), { target: { value: "4000.00" } });
  fireEvent.keyDown(spendingInput(), { key: "Escape" });
  fireEvent.click(nav().getByRole("link", { name: "Loans" }));
  fireEvent.click(await screen.findByRole("button", { name: "Add loan" }));
  expect(await screen.findByRole("dialog", { name: "Add loan" })).toBeDefined();
  expect(confirm).not.toHaveBeenCalled();
  // The retained Plan edit still returns when coming back to it.
  fireEvent.click(nav().getByRole("link", { name: "Plans" }));
  expect(spendingCell().textContent).toMatch(/4,?000\.00/);
});
