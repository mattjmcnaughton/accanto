import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { Plans } from "../../features/workspace/Plans";
import { screenArgs, stateStory } from "../mocks/api";

// Home is the Plans screen with `home` set, as Workspace renders it.
const meta = {
  title: "Screens/Home",
  component: Plans,
  args: {
    ...screenArgs(),
    home: true,
    visible: true,
    showPlans: fn().mockName("showPlans"),
    go: fn().mockName("go"),
  },
} satisfies Meta<typeof Plans>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Loaded: Story = {};
/** A past month chosen in the top bar: its figures, without today's pace marker. */
export const AnotherMonth: Story = { args: { month: "2026-09" } };
export const Empty: Story = stateStory("empty");
export const Loading: Story = stateStory("loading");
export const Failed: Story = stateStory("failed");
