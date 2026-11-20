import type { Meta, StoryObj } from "@storybook/react-vite";
import { MonthlyReview } from "../../features/workspace/MonthlyReview";
import { screenArgs, stateStory } from "../mocks/api";

const meta = {
  title: "Screens/Monthly Review",
  component: MonthlyReview,
  args: screenArgs(),
} satisfies Meta<typeof MonthlyReview>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Loaded: Story = {};
export const Empty: Story = stateStory("empty");
export const Loading: Story = stateStory("loading");
export const Failed: Story = stateStory("failed");
