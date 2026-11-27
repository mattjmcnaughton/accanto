import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Balances } from "../balances/Balances";
import type { ScreenProps } from "../workspace/shared";
import { Destinations } from "./Destinations";

const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });
const destination = {
  uuid: "investment-1",
  name: "Example fund",
  target: "2000.00",
  active: true,
  revision: 1,
  contribution_progress: "1000.00",
  opening: { date: "2026-01-01", amount: "25000.00" },
  latest: { date: "2026-03-01", amount: "26100.00" },
};
const entry = {
  uuid: "entry-1",
  financial_date: "2026-02-01",
  category: "investing",
  amount: "1000.00",
  note: "",
  is_adjustment: false,
  revision: 3,
  investment_id: destination.uuid,
};
const observation = (uuid: string, date: string, amount: string, is_opening: boolean) => ({
  uuid,
  financial_date: date,
  amount,
  account_id: destination.uuid,
  is_opening,
  revision: 2,
  deleted: false,
});
const observations = [
  observation("opening-1", "2026-01-01", "25000.00", true),
  observation("observed-1", "2026-03-01", "26100.00", false),
];
const props = (): ScreenProps => ({
  entity: { id: "entity", name: "Synthetic Entity", today: "2026-11-10", time_zone: "UTC" },
  concealed: false,
  busy: false,
  refresh: 0,
  guard: () => true,
  dirty: vi.fn(),
  save: vi.fn(),
});
const mock = (routes: Record<string, unknown> = {}) =>
  vi.spyOn(globalThis, "fetch").mockImplementation(async (path) => {
    const url = String(path);
    for (const [suffix, value] of Object.entries(routes))
      if (url.endsWith(suffix)) return json(value);
    if (url.endsWith("/investment-activity")) return json([entry]);
    if (url.endsWith("/investment-observations")) return json(observations);
    if (url.endsWith("/investments")) return json([destination]);
    return json([]);
  });
const grid = (name: string) => screen.findByRole("grid", { name });
const show = async (view: "Cards" | "Table") =>
  fireEvent.click(
    within(await screen.findByRole("group", { name: "View" })).getByRole("button", { name: view }),
  );
const cell = (table: HTMLElement, text: string) =>
  within(table).getByText(text).closest("td") as HTMLElement;
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  // This jsdom may have no localStorage; the view choice then lasts for one render.
  window.localStorage?.clear();
});

it("keeps contribution progress apart from the observed value and corrects by revision", async () => {
  mock();
  const p = props();
  render(<Destinations {...p} />);
  await show("Table");
  const investments = await grid("Investments");
  const fund = within(investments).getByText("Example fund").closest("tr") as HTMLElement;
  expect(within(fund).getByText("$1,000.00")).toBeDefined();
  expect(within(fund).getByText("$26,100.00")).toBeDefined();
  expect(within(fund).queryByText("$25,000.00")).toBeNull();

  fireEvent.keyDown(cell(await grid("Investment contributions"), "Feb 1, 2026"), { key: "Enter" });
  fireEvent.change(screen.getByLabelText("Amount (USD)"), { target: { value: "900.00" } });
  fireEvent.keyDown(screen.getByLabelText("Amount (USD)"), { key: "s", ctrlKey: true });
  expect(p.save).toHaveBeenCalledWith(
    expect.objectContaining({
      method: "PUT",
      path: "/api/entities/entity/investment-activity/entry-1",
      body: expect.objectContaining({ amount: "900.00", expected_revision: 3 }),
    }),
    expect.any(Function),
  );
});

it("keeps a valid edit on Escape without saving and holds an invalid edit open", async () => {
  mock();
  const p = props();
  render(<Destinations {...p} />);
  await show("Table");
  fireEvent.keyDown(cell(await grid("Investment contributions"), "Feb 1, 2026"), { key: "i" });
  const amount = screen.getByLabelText("Amount (USD)");
  fireEvent.change(amount, { target: { value: "12.345" } });
  fireEvent.keyDown(amount, { key: "Escape" });
  expect(screen.getByRole("alert").textContent).toMatch(/up to two decimals/);
  expect(screen.getByLabelText("Amount (USD)")).toHaveValue("12.345");

  fireEvent.change(amount, { target: { value: "950.00" } });
  fireEvent.keyDown(amount, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(p.save).not.toHaveBeenCalled();
  expect(within(await grid("Investment contributions")).getByText("Unsaved")).toBeDefined();

  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(p.save).toHaveBeenCalledWith(
    expect.objectContaining({ body: expect.objectContaining({ amount: "950.00" }) }),
    expect.any(Function),
  );
});

it("deletes a later observation after confirmation but never an opening value", async () => {
  mock();
  const p = props();
  render(<Destinations {...p} />);
  await show("Table");
  const table = await grid("Investment value observations");
  const opening = cell(table, "Jan 1, 2026");
  fireEvent.keyDown(opening, { key: "d" });
  fireEvent.keyDown(opening, { key: "d" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByText("Opening values cannot be deleted.")).toBeDefined();

  const later = cell(table, "Mar 1, 2026");
  fireEvent.keyDown(later, { key: "d" });
  fireEvent.keyDown(later, { key: "d" });
  expect(p.save).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: "Delete observation" }),
  );
  expect(p.save).toHaveBeenCalledWith(
    expect.objectContaining({
      method: "DELETE",
      path: "/api/entities/entity/investment-observations/observed-1",
      body: { expected_revision: 2 },
    }),
    expect.any(Function),
  );
});

it("permits a destination without a target or opening", async () => {
  mock({ "/investments": [], "/investment-activity": [], "/investment-observations": [] });
  const p = props();
  render(<Destinations {...p} />);
  await show("Table");
  const investments = await grid("Investments");
  fireEvent.keyDown(within(investments).getByText(/No investments yet/), { key: "a" });
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Example fund" } });
  fireEvent.click(screen.getByRole("button", { name: "Save investment" }));
  expect(p.save).toHaveBeenCalledWith(
    expect.objectContaining({
      body: {
        name: "Example fund",
        target: null,
        opening: null,
        expected_return_percent: null,
        expected_contribution: null,
        expected_contribution_frequency: "monthly",
        tax_treatment: "taxable",
        liquidity: "liquid",
      },
    }),
    expect.any(Function),
  );
});

it("moves an investment's opening date only when it changed", async () => {
  mock();
  const p = props();
  render(<Destinations {...p} />);
  await show("Table");
  const investments = await grid("Investments");
  fireEvent.click(within(investments).getByRole("button", { name: "Edit Example fund" }));
  const opening = screen.getByLabelText("Opening date");
  expect(opening).toHaveValue("2026-01-01");
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Renamed fund" } });
  fireEvent.keyDown(opening, { key: "s", ctrlKey: true });
  expect(vi.mocked(p.save).mock.calls[0][0].body).not.toHaveProperty("opening_date");

  fireEvent.click(within(investments).getByRole("button", { name: "Edit Example fund" }));
  fireEvent.change(screen.getByLabelText("Opening date"), { target: { value: "2025-12-01" } });
  fireEvent.keyDown(screen.getByLabelText("Opening date"), { key: "s", ctrlKey: true });
  expect(p.save).toHaveBeenLastCalledWith(
    expect.objectContaining({
      method: "PUT",
      path: "/api/entities/entity/investments/investment-1",
      body: expect.objectContaining({ opening_date: "2025-12-01", expected_revision: 1 }),
    }),
    expect.any(Function),
  );
});

it("shows and edits an investment's tax treatment and liquidity", async () => {
  mock({
    "/investments": [{ ...destination, tax_treatment: "tax_advantaged", liquidity: "liquid" }],
  });
  const p = props();
  render(<Destinations {...p} />);
  await show("Table");
  const investments = await grid("Investments");
  const fund = within(investments).getByText("Example fund").closest("tr") as HTMLElement;
  expect(within(fund).getByText("Tax-advantaged")).toBeDefined();
  expect(within(fund).getByText("Liquid")).toBeDefined();

  fireEvent.click(within(investments).getByRole("button", { name: "Edit Example fund" }));
  const liquidity = screen.getByRole("group", { name: "Liquidity" });
  expect(within(liquidity).getByRole("button", { name: "Liquid" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  fireEvent.click(within(liquidity).getByRole("button", { name: "Illiquid" }));
  fireEvent.keyDown(screen.getByLabelText("Name"), { key: "s", ctrlKey: true });
  expect(p.save).toHaveBeenLastCalledWith(
    expect.objectContaining({
      method: "PUT",
      body: expect.objectContaining({ tax_treatment: "tax_advantaged", liquidity: "illiquid" }),
    }),
    expect.any(Function),
  );
});

it("totals observed values and splits them by liquidity and tax treatment", async () => {
  mock({
    "/investments": [
      {
        ...destination,
        latest: { date: "2026-03-01", amount: "30000.00" },
        tax_treatment: "tax_advantaged",
        liquidity: "liquid",
      },
      {
        ...destination,
        uuid: "house",
        name: "Example house",
        latest: { date: "2026-03-01", amount: "10000.00" },
        tax_treatment: "taxable",
        liquidity: "illiquid",
      },
      { ...destination, uuid: "new", name: "Example new fund", latest: null },
    ],
  });
  render(<Destinations {...props()} />);
  const summary = (await screen.findByText("Total observed value")).closest(
    "section",
  ) as HTMLElement;
  expect(within(summary).getByText("$40,000.00")).toBeDefined();
  expect(within(summary).getByText(/Leaves out 1 investment with no value yet/)).toBeDefined();
  const share = (name: string) => {
    const titled = within(summary).getAllByTitle(new RegExp(`^${name}:`));
    expect(titled).toHaveLength(2); // the band segment and its legend entry
    return titled[0].getAttribute("title");
  };
  expect(share("Liquid")).toBe("Liquid: $30,000.00 (75%)");
  expect(share("Illiquid")).toBe("Illiquid: $10,000.00 (25%)");
  expect(share("Taxable")).toBe("Taxable: $10,000.00 (25%)");
  expect(share("Tax-advantaged")).toBe("Tax-advantaged: $30,000.00 (75%)");
});

it("records an investment contribution from one saving goal", async () => {
  mock({
    "/savings-accounts": [
      {
        uuid: "account-1",
        name: "Synthetic savings",
        active: true,
        opening_date: "2026-01-01",
        goals: [{ uuid: "goal-1", name: "Reserve" }],
      },
    ],
  });
  const p = props();
  render(<Destinations {...p} />);
  await show("Table");
  fireEvent.click(await screen.findByRole("button", { name: "Record contribution" }));
  fireEvent.change(screen.getByLabelText("Amount (USD)"), { target: { value: "100.00" } });
  fireEvent.change(screen.getByLabelText("Funding origin"), { target: { value: "savings" } });
  fireEvent.click(screen.getByRole("button", { name: "Save contribution" }));
  expect(p.save).not.toHaveBeenCalled();
  expect(screen.getByRole("alert").textContent).toBe("Choose a saving goal.");
  await screen.findByRole("option", { name: "Synthetic savings · Reserve" });
  fireEvent.change(screen.getByLabelText("Saving goal"), { target: { value: "goal-1" } });
  fireEvent.click(screen.getByRole("button", { name: "Save contribution" }));
  expect(p.save).toHaveBeenCalledWith(
    expect.objectContaining({
      method: "POST",
      body: expect.objectContaining({
        funding_goal_id: "goal-1",
        amount: "100.00",
      }),
    }),
    expect.any(Function),
  );
  // The retired pair is never sent; funding_goal_id alone names the origin.
  const body = vi.mocked(p.save).mock.calls[0][0].body;
  expect(body).not.toHaveProperty("funding_origin");
  expect(body).not.toHaveProperty("saving_goal_id");
});

it("shows net donations and leaves linked refunds to Activity", async () => {
  mock({
    "/giving-recipients": [
      {
        ...destination,
        uuid: "recipient-1",
        name: "Example charity",
        contribution_progress: "450.00",
        target: null,
        latest: null,
      },
    ],
    "/giving-activity": [
      {
        ...entry,
        uuid: "gift",
        category: "giving",
        amount: "500.00",
        giving_recipient_id: "recipient-1",
      },
      {
        ...entry,
        uuid: "refund",
        category: "giving",
        financial_date: "2026-02-09",
        amount: "-50.00",
        giving_recipient_id: "recipient-1",
        is_refund: true,
      },
    ],
  });
  const p = props();
  render(<Destinations {...p} kind="giving" />);
  await show("Table");
  expect(screen.getByRole("heading", { level: 1, name: "Giving" })).toBeDefined();
  expect(screen.queryByRole("grid", { name: "Investments" })).toBeNull();
  const recipients = await grid("Giving recipients");
  expect(within(recipients).getByRole("columnheader", { name: "Net donations" })).toBeDefined();
  const charity = within(recipients).getByText("Example charity").closest("tr") as HTMLElement;
  expect(within(charity).getByText("$450.00")).toBeDefined();
  expect(within(charity).getByText("—")).toBeDefined();

  const donations = await grid("Donations");
  const refund = cell(donations, "Feb 9, 2026");
  expect(
    within(refund.closest("tr") as HTMLElement).getByText("Correct in Activity"),
  ).toBeDefined();
  fireEvent.keyDown(refund, { key: "Enter" });
  fireEvent.keyDown(refund, { key: "d" });
  fireEvent.keyDown(refund, { key: "d" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByText("Correct this linked refund in Activity.")).toBeDefined();
});

it("names each dialog by its own title", async () => {
  mock();
  render(<Destinations {...props()} />);
  await show("Table");
  const later = cell(await grid("Investment value observations"), "Mar 1, 2026");
  fireEvent.keyDown(later, { key: "d" });
  fireEvent.keyDown(later, { key: "d" });
  expect(screen.getByRole("dialog", { name: "Delete observation?" })).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  fireEvent.keyDown(later, { key: "?" });
  expect(screen.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeDefined();
});

it("keeps attempted values while a write is pending", async () => {
  mock();
  const p = props();
  const { rerender } = render(<Destinations {...p} />);
  await show("Table");
  const contributions = await grid("Investment contributions");
  fireEvent.keyDown(cell(contributions, "Feb 1, 2026"), { key: "Enter" });
  fireEvent.change(screen.getByLabelText("Amount (USD)"), { target: { value: "975.00" } });
  fireEvent.keyDown(screen.getByLabelText("Amount (USD)"), { key: "Escape" });
  rerender(<Destinations {...p} busy />);
  expect(screen.getByRole("button", { name: "Discard" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Add investment" })).toBeDisabled();
  fireEvent.keyDown(cell(await grid("Investments"), "Example fund"), { key: "Enter" });
  fireEvent.keyDown(cell(contributions, "Feb 1, 2026"), { key: "a" });
  expect(screen.queryByLabelText("Name")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Review" }));
  rerender(<Destinations {...p} busy={false} />);
  expect(screen.getByLabelText("Amount (USD)")).toHaveValue("975.00");
});

it("keeps keyboard focus in the grid after a confirmed delete reloads the list", async () => {
  let rows = [...observations, observation("observed-2", "2026-04-01", "26300.00", false)];
  mock();
  const fetch = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
  const base = fetch.getMockImplementation() as (path: unknown) => Promise<Response>;
  fetch.mockImplementation(async (path: unknown) =>
    String(path).endsWith("/investment-observations") ? json(rows) : base(path),
  );
  const p = props();
  p.save = vi.fn((spec, confirmed) => {
    rows = rows.filter((row) => !spec.path.endsWith(row.uuid));
    confirmed(undefined as never);
  });
  render(<Destinations {...p} />);
  await show("Table");
  const table = await grid("Investment value observations");
  const doomed = cell(table, "Mar 1, 2026");
  doomed.focus();
  fireEvent.keyDown(doomed, { key: "d" });
  fireEvent.keyDown(doomed, { key: "d" });
  fireEvent.click(screen.getByRole("button", { name: "Delete observation" }));
  await waitFor(() =>
    expect(
      within(screen.getByRole("grid", { name: "Investment value observations" })).queryByText(
        "Mar 1, 2026",
      ),
    ).toBeNull(),
  );
  await waitFor(() => {
    const focused = document.activeElement as HTMLElement;
    expect(focused.tagName).toBe("TD");
    expect(focused.closest("table")).toBe(
      screen.getByRole("grid", { name: "Investment value observations" }),
    );
  });
});

it("returns Escape focus to the grid when the opening click did not focus its trigger", async () => {
  mock();
  const p = props();
  render(<Destinations {...p} />);
  await show("Table");
  await grid("Investment value observations");
  // fireEvent.click, like WebKit, does not focus the clicked button.
  fireEvent.click(screen.getByRole("button", { name: "Correct observation on Mar 1, 2026" }));
  const amount = screen.getByLabelText("Observed value (USD)");
  amount.focus();
  fireEvent.change(amount, { target: { value: "31025.50" } });
  fireEvent.keyDown(amount, { key: "Escape" });
  await waitFor(() =>
    expect((document.activeElement as HTMLElement).closest("[role=grid]")).not.toBeNull(),
  );
  fireEvent.keyDown(document.activeElement as HTMLElement, { key: "s", ctrlKey: true });
  expect(p.save).toHaveBeenCalledWith(
    expect.objectContaining({
      method: "PUT",
      path: "/api/entities/entity/investment-observations/observed-1",
      body: expect.objectContaining({ amount: "31025.50", expected_revision: 2 }),
    }),
    expect.any(Function),
  );
});

it("keeps the Escape fallback inside this screen, past hidden grids and another screen's cell", async () => {
  mock({ "/debts": [] });
  const loans = render(<Balances {...props()} />);
  await show("Table");
  (await screen.findByRole("grid", { name: "Loans" })).querySelector<HTMLElement>("td")?.focus();
  loans.unmount();
  mock();
  render(
    <>
      <div hidden>
        {/* biome-ignore lint/a11y/useSemanticElements: Stands in for the hidden Plans worksheet grid. */}
        <table role="grid" aria-label="Hidden worksheet">
          <tbody>
            <tr>
              {/* biome-ignore lint/a11y/noNoninteractiveTabindex: Mirrors a roving-focus grid cell. */}
              <td tabIndex={0}>hidden</td>
            </tr>
          </tbody>
        </table>
      </div>
      <Destinations {...props()} />
    </>,
  );
  await show("Table");
  await grid("Investment value observations");
  fireEvent.click(screen.getByRole("button", { name: "Correct observation on Mar 1, 2026" }));
  const amount = screen.getByLabelText("Observed value (USD)");
  amount.focus();
  fireEvent.keyDown(amount, { key: "Escape" });
  await waitFor(() => expect(screen.queryByLabelText("Observed value (USD)")).toBeNull());
  await waitFor(() =>
    expect((document.activeElement as HTMLElement).closest(".records [role=grid]")).not.toBeNull(),
  );
});
