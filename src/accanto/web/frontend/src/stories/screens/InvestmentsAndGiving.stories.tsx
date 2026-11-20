import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";
import { Destinations } from "../../features/destinations/Destinations";
import { screenArgs, stateStory } from "../mocks/api";

const meta = {
  title: "Screens/Investments and giving",
  component: Destinations,
  args: screenArgs(),
} satisfies Meta<typeof Destinations>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Loaded: Story = {};
/** The same screen switched to giving recipients. */
export const Giving: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(
      await within(canvasElement).findByRole("button", { name: "Giving recipients" }),
    );
  },
};
export const Empty: Story = stateStory("empty");
export const Loading: Story = stateStory("loading");
export const Failed: Story = stateStory("failed");
