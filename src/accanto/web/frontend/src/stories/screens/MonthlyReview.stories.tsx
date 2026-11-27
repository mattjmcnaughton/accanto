import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { MonthlyReview } from "../../features/workspace/MonthlyReview";
import { mockApi, screenArgs, stateStory } from "../mocks/api";
import { endedReviews, midMonthReviews } from "../mocks/midMonth";
import { assignedActivity, assignedReviews } from "../mocks/subcategories";

const meta = {
  title: "Screens/Monthly Review",
  component: MonthlyReview,
  args: { ...screenArgs(), go: fn().mockName("go") },
} satisfies Meta<typeof MonthlyReview>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Loaded: Story = {};
export const AnotherMonth: Story = { args: { month: "2026-09" } };
export const Empty: Story = stateStory("empty");
export const Loading: Story = stateStory("loading");
export const Failed: Story = stateStory("failed");
/** The 10th of the month: most income and fixed costs are still to come. */
export const MidMonth: Story = {
  parameters: { msw: mockApi("loaded", { reviews: midMonthReviews }) },
};
/** The same lines in a month that has ended: lines with no entry are now past due. */
export const MonthEnded: Story = {
  args: { month: "2026-10" },
  parameters: { msw: mockApi("loaded", { reviews: endedReviews }) },
};
/** Guilt-free spending grouped by subcategory; the groups add up to the recorded total. */
export const Subcategorized: Story = {
  parameters: {
    msw: mockApi("loaded", { activity: assignedActivity, reviews: assignedReviews }),
  },
};
