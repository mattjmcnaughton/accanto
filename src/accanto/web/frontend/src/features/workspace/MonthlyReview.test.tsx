import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
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
it("preselects the latest saved version of the previous month's Plan", async () => {
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
  // October compared with v1; v2 is newer and the unsaved draft is never offered.
  await waitFor(() => expect(choice.value).toBe("v2"));
  fireEvent.click(screen.getByRole("button", { name: "Start Review" }));
  expect(p.save).toHaveBeenCalledWith(
    expect.objectContaining({ body: { month: "2026-11-01", version_id: "v2" } }),
    expect.any(Function),
  );
});
it("offers a one-click switch when a reviewed month compares with an older version", async () => {
  const reviewed = {
    ...review,
    review: { ...review.review, month: "2026-11-01", revision: 4, reviewed_at: "2026-11-20" },
  };
  vi.spyOn(globalThis, "fetch").mockImplementation(async (path) =>
    String(path).endsWith("/plans")
      ? json(plans)
      : String(path).endsWith("2026-11-01")
        ? json(reviewed)
        : absent(),
  );
  const p = props();
  render(<MonthlyReview {...p} />);
  expect(
    await screen.findByText(/A newer version is saved: Baseline v2.*marked reviewed against it/),
  ).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Compare with v2" }));
  expect(p.save).toHaveBeenCalledWith(
    expect.objectContaining({
      body: {
        expected_revision: 4,
        version_id: "v2",
        note: "",
        reviewed: true,
        checkpoint: false,
      },
    }),
    expect.any(Function),
  );
});
it("shows no newer-version notice on the latest saved version", async () => {
  const latest = { ...review, version: { ...version, uuid: "v2", number: 2 } };
  vi.spyOn(globalThis, "fetch").mockImplementation(async (path) =>
    String(path).endsWith("/plans")
      ? json(plans)
      : String(path).endsWith("2026-11-01")
        ? json(latest)
        : absent(),
  );
  render(<MonthlyReview {...props()} />);
  const target = (await screen.findByLabelText("Compared with")) as HTMLSelectElement;
  await waitFor(() => expect(target.options.length).toBe(2));
  expect(screen.queryByText(/A newer version is saved/)).toBeNull();
});
it("saves a changed compared version at once, leaving an unsaved note unsaved", async () => {
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
  fireEvent.change(screen.getByLabelText("Review note"), { target: { value: "Draft thought" } });
  fireEvent.change(target, { target: { value: "v2" } });
  expect(p.save).toHaveBeenCalledTimes(1);
  expect(p.save).toHaveBeenCalledWith(
    expect.objectContaining({
      body: {
        expected_revision: 1,
        version_id: "v2",
        note: "",
        reviewed: false,
        checkpoint: false,
      },
    }),
    expect.any(Function),
  );
  vi.mocked(p.save).mock.calls[0][1](undefined);
  expect(p.dirty).toHaveBeenLastCalledWith(true);
});
it("edits an incomplete Review with notes and annotation", async () => {
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
        version_id: "v1",
        note: "Synthetic takeaway",
        reviewed: true,
        checkpoint: false,
      },
    }),
    expect.any(Function),
  );
});
it("keeps attempted Review input across a conflict reload", async () => {
  let current: object = review;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (path) =>
    String(path).endsWith("/plans")
      ? json(plans)
      : String(path).endsWith("2026-11-01")
        ? json(current)
        : absent(),
  );
  // A slow runner: React's scheduler sees every slice over budget, so work left after a
  // commit runs in a later task, after input that arrives as soon as the note appears.
  const now = performance.now.bind(performance);
  let calls = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now() + 6 * ++calls);
  const p = props();
  const { rerender } = render(<MonthlyReview {...p} />);
  const note = (await screen.findByLabelText("Review note")) as HTMLTextAreaElement;
  fireEvent.change(note, { target: { value: "Unsaved synthetic note" } });
  expect(note.value).toBe("Unsaved synthetic note");
  current = {
    ...review,
    review: { ...review.review, revision: 2, note: "Other writer" },
    actual: { ...review.actual, spending_recorded: "12.34" },
  };
  rerender(<MonthlyReview {...p} refresh={1} />);
  // The reloaded Review has landed once its new spending total shows. The reload may keep or
  // replace the textarea, so read whichever note is on screen then, not the original element.
  await screen.findByText("$12.34");
  expect((screen.getByLabelText("Review note") as HTMLTextAreaElement).value).toBe(
    "Unsaved synthetic note",
  );
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
  expect(screen.getByText(/Retirement has no entry.*Record it in Investments\./)).toBeDefined();
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
  // The shell passes the month chosen in the top bar.
  render(<MonthlyReview {...p} month="2026-10" />);
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
it("lists saved versions newest first when starting and editing a Review", async () => {
  const groups = [
    {
      plan_id: "plan",
      revisions: [version, { ...version, uuid: "v2", number: 2, saved_at: "2026-11-05" }],
    },
    {
      plan_id: "other",
      revisions: [{ ...version, uuid: "w1", name: "Side", saved_at: "2026-10-20" }],
    },
  ];
  const names = (select: HTMLSelectElement) =>
    [...select.options].filter((option) => option.value).map((option) => option.value);
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (path) =>
      String(path).endsWith("/plans") ? json(groups) : absent(),
    );
  const { unmount } = render(<MonthlyReview {...props()} />);
  expect(names((await screen.findByLabelText("Compare with")) as HTMLSelectElement)).toEqual([
    "v2",
    "w1",
    "v1",
  ]);
  unmount();
  fetch.mockImplementation(async (path) =>
    String(path).endsWith("/plans")
      ? json(groups)
      : String(path).endsWith("2026-11-01")
        ? json(review)
        : absent(),
  );
  render(<MonthlyReview {...props()} />);
  expect(names((await screen.findByLabelText("Compared with")) as HTMLSelectElement)).toEqual([
    "v2",
    "v1",
  ]);
});
const groceries = {
  uuid: "entry-1",
  financial_date: "2026-11-03",
  category: "spending" as const,
  amount: "42.50",
  source_id: null,
  fixed_cost_id: null,
  fixed_cost_name: null,
  debt_account_id: null,
  note: "Synthetic groceries",
  revision: 3,
  is_adjustment: false,
  funding_origin: "income" as const,
  saving_goal_id: null,
  funding_goal_id: null,
  tag_ids: [],
};
/** November's Review with one guilt-free entry, whose recorded total follows `spent`. */
function mockMonth(spent: () => string) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (path) => {
    const url = String(path);
    if (url.endsWith("/plans")) return json(plans);
    if (url.endsWith("/activity")) return json([{ ...groceries, amount: spent() }]);
    if (url.endsWith("2026-11-01"))
      return json({
        ...review,
        review: { ...review.review, month: "2026-11-01" },
        entries: [{ ...groceries, amount: spent() }],
        actual: { ...review.actual, spending_recorded: spent() },
        spending_difference: "0.00",
      });
    if (url.includes("/reviews/")) return absent();
    return json([]);
  });
}
/** The shell's part: a confirmed write runs its callback, then every screen reads again. */
function Shell({ p }: { p: ScreenProps }) {
  const [refresh, setRefresh] = useState(0);
  return (
    <MonthlyReview
      {...p}
      refresh={refresh}
      save={(spec, confirmed) => {
        p.save(spec, confirmed);
        confirmed(undefined as never);
        setRefresh((x) => x + 1);
      }}
    />
  );
}
it("opens an entry from a section's lines in Activity's dialog and keeps the Review open after saving it", async () => {
  let spent = "42.50";
  mockMonth(() => spent);
  const p = props();
  vi.mocked(p.save).mockImplementation(() => {
    spent = "50.00";
  });
  render(<Shell p={p} />);
  const spending = await screen.findByRole("region", { name: "Guilt-free spending" });
  fireEvent.click(within(spending).getByRole("button", { name: "1 entry" }));
  fireEvent.click(within(spending).getByRole("button", { name: /Synthetic groceries/ }));
  const dialog = await screen.findByRole("dialog", { name: "Edit activity" });
  const amount = within(dialog).getByLabelText("Amount (USD)") as HTMLInputElement;
  expect(amount.value).toBe("42.50");
  fireEvent.change(amount, { target: { value: "50.00" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));
  // The same edit Activity sends, checked against the revision the entry was read at.
  expect(p.save).toHaveBeenCalledWith(
    expect.objectContaining({
      method: "PUT",
      path: "/api/entities/entity/activity/entry-1",
      body: expect.objectContaining({ amount: "50.00", expected_revision: 3 }),
    }),
    expect.any(Function),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  // The refreshed total lands in the section that is still open, without a loading card.
  await waitFor(() =>
    expect(spending.querySelector(".amt-col")?.firstChild?.textContent).toBe("$50.00"),
  );
  expect(within(spending).getByRole("button", { name: "Hide lines" })).toBeDefined();
  expect(screen.queryByLabelText("Loading the Review")).toBeNull();
});
it("keeps an opened entry's unsaved changes apart from the Review note", async () => {
  mockMonth(() => "42.50");
  const p = props();
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  render(<MonthlyReview {...p} />);
  fireEvent.change(await screen.findByLabelText("Review note"), {
    target: { value: "Unsaved synthetic note" },
  });
  const spending = screen.getByRole("region", { name: "Guilt-free spending" });
  fireEvent.click(within(spending).getByRole("button", { name: "1 entry" }));
  const open = () => {
    fireEvent.click(within(spending).getByRole("button", { name: /Synthetic groceries/ }));
    return screen.findByRole("dialog", { name: "Edit activity" });
  };
  // An unsaved note does not stop an entry opening, and the note stays unsaved.
  let dialog = await open();
  expect(confirm).not.toHaveBeenCalled();
  expect(vi.mocked(p.dirty).mock.lastCall).toEqual([true]);
  fireEvent.change(within(dialog).getByLabelText("Amount (USD)"), {
    target: { value: "60.00" },
  });
  // Ctrl+S in the dialog saves the entry, not the Review.
  fireEvent.keyDown(within(dialog).getByLabelText("Amount (USD)"), { key: "s", ctrlKey: true });
  await waitFor(() => expect(p.save).toHaveBeenCalledTimes(1));
  expect(vi.mocked(p.save).mock.calls[0][0].path).toBe("/api/entities/entity/activity/entry-1");
  // Leaving with unsaved entry changes asks first; declining keeps the dialog and its edit.
  fireEvent(dialog, new Event("cancel", { cancelable: true }));
  expect(confirm).toHaveBeenCalledTimes(1);
  expect((within(dialog).getByLabelText("Amount (USD)") as HTMLInputElement).value).toBe("60.00");
  confirm.mockReturnValue(true);
  fireEvent(dialog, new Event("cancel", { cancelable: true }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  // Discarding the entry's edit leaves the Review note's unsaved flag in place.
  expect(vi.mocked(p.dirty).mock.lastCall).toEqual([true]);
  dialog = await open();
  expect((within(dialog).getByLabelText("Amount (USD)") as HTMLInputElement).value).toBe("42.50");
});
