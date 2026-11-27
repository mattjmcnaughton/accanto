import type { Meta, StoryObj } from "@storybook/react-vite";
import { fireEvent, fn, userEvent, within } from "storybook/test";
import { Projections } from "../../features/projections/Projections";
import { mockApi, projection, screenArgs, stateStory } from "../mocks/api";

const meta = {
  title: "Screens/Projections",
  component: Projections,
  args: { ...screenArgs(), openInvestments: fn().mockName("openInvestments") },
} satisfies Meta<typeof Projections>;
export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Both investments projected in today's dollars at 3% inflation; FIRE target from $60,000 a year
 * at 4%, with the education payment held level as a cost fixed in dollars.
 */
export const Loaded: Story = {
  play: async () => localStorage.removeItem("accanto.projection-dollars"),
};
/** The same projection in future (nominal) dollars. */
export const FutureDollars: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(
      await within(canvasElement).findByRole("button", { name: "Future dollars" }),
    );
  },
};
/** Hovering the chart reads every series on one year. */
export const ChartHover: Story = {
  play: async ({ canvasElement }) => {
    localStorage.removeItem("accanto.projection-dollars");
    const plot = await within(canvasElement).findByRole("slider");
    const box = plot.getBoundingClientRect();
    fireEvent.pointerMove(plot, {
      clientX: box.left + box.width * 0.5,
      clientY: box.top + 40,
      pointerType: "touch",
    });
  },
};
/** The 30-year horizon chosen in the header. */
export const ThirtyYears: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole("button", { name: "30 yr" }));
  },
};
/** No annual spending saved yet: no FIRE target or date. */
export const NoFireSpending: Story = {
  parameters: {
    msw: mockApi("loaded", {
      projections: projection.projectionsNoSpending,
      fireAssumptions: projection.noFireAssumptions,
    }),
  },
};
/** An active investment without an observed value: it is left out and net worth is unknown. */
export const UnknownValue: Story = {
  parameters: { msw: mockApi("loaded", { projections: projection.projectionsUnknown }) },
};
const many = [
  ["Mortgage (fixed rate)", "2350.00", false],
  ["Property tax", "410.00", true],
  ["Home insurance", "145.00", true],
  ["Electricity", "120.00", true],
  ["Water and sewer", "65.00", true],
  ["Internet", "70.00", false],
  ["Phones", "85.00", true],
  ["Groceries", "900.00", true],
  ["Car insurance", "110.00", true],
  ["Fuel", "160.00", true],
  ["Car payment", "380.00", false],
  ["Health premiums", "520.00", true],
  ["Childcare", "1200.00", true],
  ["Streaming", "38.00", true],
  ["Gym", "45.00", true],
] as const;
const manyLines = many.map(([name, monthly, rises], i) => ({
  fixed_cost_id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
  name,
  monthly_amount: monthly,
  annual_amount: (Number(monthly) * 12).toFixed(2),
  rises_with_inflation: rises,
}));
const manyMonthly = manyLines.reduce((s, l) => s + Number(l.monthly_amount), 0);
/**
 * Fifteen planned fixed costs, three fixed in dollars, chosen from the multi-select. The other
 * figures are the Loaded story's, not recomputed for these costs.
 */
export const ManyFixedCosts: Story = {
  parameters: {
    msw: mockApi("loaded", {
      projections: Object.fromEntries(
        Object.entries(projection.projections).map(([k, v]) => [
          k,
          {
            ...v,
            planned_fixed_costs: {
              plan_name: "Everyday balance",
              version_number: 4,
              month: "2026-11",
              monthly_total: manyMonthly.toFixed(2),
              annual_total: (manyMonthly * 12).toFixed(2),
              steady_annual: manyLines
                .filter((l) => !l.rises_with_inflation)
                .reduce((s, l) => s + Number(l.annual_amount), 0)
                .toFixed(2),
              lines: manyLines,
            },
          },
        ]),
      ),
    }),
  },
};
/** The multi-select open over fifteen costs, filtered as the owner types. */
export const ManyFixedCostsOpen: Story = {
  parameters: ManyFixedCosts.parameters,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await userEvent.click(
      await c.findByRole("button", { name: /Fixed costs that do not rise with inflation/ }),
    );
  },
};
/** No Plan has a saved version yet: no planned fixed costs to show. */
export const NoPlannedFixedCosts: Story = {
  parameters: {
    msw: mockApi("loaded", {
      projections: Object.fromEntries(
        Object.entries(projection.projections).map(([k, v]) => [
          k,
          { ...v, planned_fixed_costs: null },
        ]),
      ),
    }),
  },
};
export const Empty: Story = stateStory("empty");
export const Loading: Story = stateStory("loading");
export const Failed: Story = stateStory("failed");
/** Mockup: the entry to the FIRE number interview, below the projection. */
export const FireInterviewEntry: Story = {
  args: { interview: fn().mockName("interview") },
};
/** Mockup: the same entry on a phone. */
export const FireInterviewEntryPhone: Story = {
  args: { interview: fn().mockName("interview") },
  globals: { viewport: { value: "phone", isRotated: false } },
};
