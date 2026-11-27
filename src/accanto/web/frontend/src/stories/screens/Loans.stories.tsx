import type { Meta, StoryObj } from "@storybook/react-vite";
import { Balances } from "../../features/balances/Balances";
import { mockApi, screenArgs, stateStory } from "../mocks/api";
import { loans } from "../mocks/fixtures";

const meta = {
  title: "Screens/Loans",
  component: Balances,
  args: screenArgs(),
} satisfies Meta<typeof Balances>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Loaded: Story = {};
export const Empty: Story = stateStory("empty");
export const Loading: Story = stateStory("loading");
export const Failed: Story = stateStory("failed");

/** $12,500 at 6.90% accrues $71.88 a month, so a $60.00 payment is flagged, not scheduled. */
const underInterest = {
  ...loans[1],
  interest_rate_percent: "6.90",
  monthly_payment: "60.00",
  payoff: {
    ...loans[1].payoff,
    status: "interest_not_covered" as const,
    interest_rate_percent: "6.90",
    monthly_payment: "60.00",
    monthly_interest: "71.88",
  },
};
export const PaymentUnderInterest: Story = {
  parameters: {
    msw: mockApi("loaded", {
      loans: [loans[0], underInterest],
      payoffSchedules: { [underInterest.uuid]: { ...underInterest.payoff, rows: [] } },
    }),
  },
};
