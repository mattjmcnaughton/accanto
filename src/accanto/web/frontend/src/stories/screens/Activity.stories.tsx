import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { ActivityScreen } from "../../features/workspace/Activity";
import { data, mockApi, screenArgs, stateStory } from "../mocks/api";

const meta = {
  title: "Screens/Activity",
  component: ActivityScreen,
  args: { ...screenArgs(), added: fn().mockName("added") },
} satisfies Meta<typeof ActivityScreen>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Loaded: Story = {};
/** Add activity in the top bar, or N, sends a request that opens the entry dialog. */
export const AddActivity: Story = { args: { add: 1 } };
export const Empty: Story = stateStory("empty");
export const Loading: Story = stateStory("loading");
export const Failed: Story = stateStory("failed");

const [trip, kids] = data.tags;
const tagged = data.activity.map((entry, index) =>
  entry.financial_date.startsWith("2026-11") && entry.category !== "income"
    ? {
        ...entry,
        tag_ids: index % 3 === 0 ? [trip.uuid, kids.uuid] : index % 3 === 1 ? [trip.uuid] : [],
      }
    : entry,
);
/** Entries carry tags; filter by one with Show tag, or open Manage tags. */
export const Tagged: Story = { parameters: { msw: mockApi("loaded", { activity: tagged }) } };
