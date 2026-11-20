import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { Plans } from "../../features/workspace/Plans";
import { screenArgs, stateStory } from "../mocks/api";

const meta = {
  title: "Screens/Plans",
  component: Plans,
  args: { ...screenArgs(), visible: true },
} satisfies Meta<typeof Plans>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Loaded: Story = {};
export const Empty: Story = stateStory("empty");
export const Loading: Story = stateStory("loading");
export const Failed: Story = stateStory("failed");
/** The worksheet for one Plan, opened from the list. */
export const Worksheet: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Everyday balance" }));
    await expect(await canvas.findByRole("button", { name: "Save draft" })).toBeVisible();
  },
};
