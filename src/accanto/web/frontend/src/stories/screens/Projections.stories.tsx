import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, userEvent, within } from "storybook/test";
import { Projections } from "../../features/projections/Projections";
import { mockApi, projection, screenArgs, stateStory } from "../mocks/api";

const meta = {
  title: "Screens/Projections",
  component: Projections,
  args: { ...screenArgs(), openInvestments: fn().mockName("openInvestments") },
} satisfies Meta<typeof Projections>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Both investments projected; FIRE target from $60,000 a year at 4%. */
export const Loaded: Story = {};
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
export const Empty: Story = stateStory("empty");
export const Loading: Story = stateStory("loading");
export const Failed: Story = stateStory("failed");
