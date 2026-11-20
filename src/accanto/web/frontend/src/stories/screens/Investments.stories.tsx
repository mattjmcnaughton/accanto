import type { Meta, StoryObj } from "@storybook/react-vite";
import { Destinations } from "../../features/destinations/Destinations";
import { screenArgs, stateStory } from "../mocks/api";

const meta = {
  title: "Screens/Investments",
  component: Destinations,
  args: { ...screenArgs(), kind: "investment" },
} satisfies Meta<typeof Destinations>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Loaded: Story = {};
export const Empty: Story = stateStory("empty");
export const Loading: Story = stateStory("loading");
export const Failed: Story = stateStory("failed");
