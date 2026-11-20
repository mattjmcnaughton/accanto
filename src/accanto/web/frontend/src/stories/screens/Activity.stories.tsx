import type { Meta, StoryObj } from "@storybook/react-vite";
import { ActivityScreen } from "../../features/workspace/Activity";
import { screenArgs, stateStory } from "../mocks/api";

const meta = {
  title: "Screens/Activity",
  component: ActivityScreen,
  args: screenArgs(),
} satisfies Meta<typeof ActivityScreen>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Loaded: Story = {};
export const Empty: Story = stateStory("empty");
export const Loading: Story = stateStory("loading");
export const Failed: Story = stateStory("failed");
