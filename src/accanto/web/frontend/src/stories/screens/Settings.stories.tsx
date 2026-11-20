import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { Settings } from "../../features/settings/Settings";
import { data, screenArgs, stateStory } from "../mocks/api";

const meta = {
  title: "Screens/Settings",
  component: Settings,
  args: {
    ...screenArgs(),
    credentials: fn(async () => data.session).mockName("credentials"),
    saved: fn().mockName("saved"),
  },
} satisfies Meta<typeof Settings>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Loaded: Story = {};
/** Settings always exist; empty means no API keys. */
export const Empty: Story = stateStory("empty");
export const Loading: Story = stateStory("loading");
export const Failed: Story = stateStory("failed");
