import type { Meta, StoryObj } from "@storybook/react-vite";
import { Savings } from "../../features/savings/Savings";
import { screenArgs, stateStory } from "../mocks/api";

const meta = {
  title: "Screens/Savings",
  component: Savings,
  args: screenArgs(),
} satisfies Meta<typeof Savings>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Loaded: Story = {};
export const Empty: Story = stateStory("empty");
export const Loading: Story = stateStory("loading");
export const Failed: Story = stateStory("failed");
