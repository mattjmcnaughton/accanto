import type { Meta, StoryObj } from "@storybook/react-vite";
import { IncomeEstimates } from "../../features/estimates/IncomeEstimates";
import { screenArgs, stateStory } from "../mocks/api";

const meta = {
  title: "Screens/Income estimates",
  component: IncomeEstimates,
  args: screenArgs(),
} satisfies Meta<typeof IncomeEstimates>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Loaded: Story = {};
export const Empty: Story = stateStory("empty");
export const Loading: Story = stateStory("loading");
export const Failed: Story = stateStory("failed");
