import type { Meta, StoryObj } from "@storybook/react-vite";
import { Balances } from "../../features/balances/Balances";
import { screenArgs, stateStory } from "../mocks/api";

const meta = {
  title: "Screens/Loans and balances",
  component: Balances,
  args: screenArgs(),
} satisfies Meta<typeof Balances>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Loaded: Story = {};
export const Empty: Story = stateStory("empty");
export const Loading: Story = stateStory("loading");
export const Failed: Story = stateStory("failed");
