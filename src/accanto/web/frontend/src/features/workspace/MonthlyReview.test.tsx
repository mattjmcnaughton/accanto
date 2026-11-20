import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { PlanRevision } from "../../lib/monthly";
import { MonthlyReview } from "./MonthlyReview";
import type { ScreenProps } from "./shared";
const entity = { id: "entity", name: "Synthetic Entity", today: "2026-11-10", time_zone: "UTC" };
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
  const choice = (await screen.findByLabelText("Compare with")) as HTMLSelectElement;
  await waitFor(() => expect(choice.value).toBe("v1"));
  fireEvent.click(screen.getByRole("button", { name: "Start Review" }));
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
  const target = (await screen.findByLabelText("Compared with")) as HTMLSelectElement;
  await waitFor(() => expect(target.value).toBe("v1"));
  fireEvent.change(target, { target: { value: "v2" } });
  fireEvent.change(screen.getByLabelText("Review note"), {
    target: { value: "Synthetic takeaway" },
  });
  fireEvent.click(
    screen.getByRole("button", {
      name: /^Mark reviewed with 2 unknown amounts?$|^Mark reviewed with 2 unknowns$/,
    }),
  );
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
  const choice = (await screen.findByLabelText("Compare with")) as HTMLSelectElement;
  expect(choice.value).toBe("");
  expect(screen.getByText(/October has no Review, so nothing is preselected/)).toBeDefined();
  expect((screen.getByRole("button", { name: "Start Review" }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  unmount();
  fetch.mockImplementation(async (path) =>
    String(path).endsWith("/plans") ? json(plans) : json({}, 503),
  );
  render(<MonthlyReview {...props()} />);
  await screen.findByRole("alert");
  expect(screen.queryByLabelText("Compare with")).toBeNull();
});
it("shows unknown rather than zero, retaining incomplete recorded income", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (path) =>
    String(path).endsWith("/plans")
      ? json(plans)
      : json({
          ...review,
          destination_comparisons: null,
          actual: { ...review.actual, income_recorded: "0.00" },
        }),
  );
  render(<MonthlyReview {...props()} />);
  const income = await screen.findByRole("region", { name: "Net income" });
  expect(income.textContent).toContain("$0.00");
  expect(within(income).getByLabelText("Not complete")).toBeDefined();
  expect(
    within(income).getByText("Salary has no entry. Unknown is not treated as $0.00."),
  ).toBeDefined();
  fireEvent.click(within(income).getByRole("button", { name: "1 line" }));
  expect(within(screen.getByRole("row", { name: /Salary/ })).getAllByText("Unknown")).toHaveLength(
    2,
  );
  expect(screen.getByText("Destination comparison for this older version: Unknown")).toBeDefined();
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
  for (const name of ["Saving", "Investing", "Giving"])
    fireEvent.click(
      within(await screen.findByRole("region", { name })).getByRole("button", { name: /line/ }),
    );
  const laptop = screen.getByRole("row", { name: /Laptop/ });
  expect(laptop.textContent).toContain("−$50.00");
  expect(screen.getByRole("row", { name: /Emergency fund/ }).textContent).toContain("$50.00");
  const retirement = screen.getByRole("row", { name: /Retirement/ });
  expect(within(retirement).getAllByText("Unknown")).toHaveLength(2);
  expect(retirement.textContent).toContain("$100.00");
  expect(screen.getByRole("row", { name: /Community Fund/ }).textContent).toContain("$400.00");
  // Destinations are recorded elsewhere, so their questions point there instead of writing.
  expect(screen.getByText(/Retirement has no entry.*Investments and giving/)).toBeDefined();
  const funding = within(screen.getByLabelText("Planned funding"));
  expect(funding.getByText("$1,000.00")).toBeDefined();
});
it("saves the edited Review once with Ctrl+S", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (path) =>
    String(path).endsWith("/plans")
      ? json(plans)
      : String(path).endsWith("2026-11-01")
        ? json(review)
        : absent(),
  );
  const p = props();
  render(<MonthlyReview {...p} />);
  const note = await screen.findByLabelText("Review note");
  fireEvent.change(note, { target: { value: "Synthetic takeaway" } });
  fireEvent.keyDown(note, { key: "s", ctrlKey: true });
  expect(p.save).toHaveBeenCalledTimes(1);
  expect(p.save).toHaveBeenCalledWith(
    expect.objectContaining({
      body: expect.objectContaining({ note: "Synthetic takeaway", expected_revision: 1 }),
    }),
    expect.any(Function),
  );
});
it("answers an unknown line with an explicit zero entry dated in the reviewed month", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (path) =>
    String(path).endsWith("/plans")
      ? json(plans)
      : String(path).endsWith("2026-10-01")
        ? json({ ...review, review: { ...review.review, month: "2026-10-01" } })
        : absent(),
  );
  const p = props();
  render(<MonthlyReview {...p} />);
  await screen.findByRole("button", { name: "Start Review" });
  fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
  const income = await screen.findByRole("region", { name: "Net income" });
  fireEvent.click(within(income).getByRole("button", { name: "Record $4,000.00" }));
  fireEvent.click(within(income).getByRole("button", { name: "Nothing this month" }));
  expect(p.save).toHaveBeenLastCalledWith(
    expect.objectContaining({
      method: "POST",
      body: expect.objectContaining({
        category: "income",
        source_id: "source",
        amount: "0.00",
        date: "2026-10-31",
      }),
    }),
    expect.any(Function),
  );
  expect(p.save).toHaveBeenCalledWith(
    expect.objectContaining({ body: expect.objectContaining({ amount: "4000.00" }) }),
    expect.any(Function),
  );
});
