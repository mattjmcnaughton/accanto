import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";
import { Destinations } from "../../features/destinations/Destinations";
import { screenArgs, stateStory } from "../mocks/api";

const meta = {
  title: "Screens/Investments",
  component: Destinations,
  args: { ...screenArgs(), kind: "investment" },
} satisfies Meta<typeof Destinations>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Loaded: Story = {};
export const Empty: Story = stateStory("empty");
export const Loading: Story = stateStory("loading");
export const Failed: Story = stateStory("failed");
/** The edit dialog with the projection assumptions: expected return and contribution. */
export const EditAssumptions: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(
      await within(canvasElement).findByRole("button", {
        name: "Edit Fixture long-term fund settings",
      }),
    );
  },
};
