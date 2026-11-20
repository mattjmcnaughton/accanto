import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { LoadMessage } from "../../features/workspace/shared";
import { ApiError } from "../../lib/api";

const meta = {
  title: "Shared/LoadMessage",
  component: LoadMessage,
  args: { state: { kind: "loading" }, retry: fn() },
} satisfies Meta<typeof LoadMessage>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Loading: Story = {};
export const Failed: Story = {
  args: {
    state: {
      kind: "unavailable",
      error: new ApiError("unavailable", null, "network_unavailable", "Could not reach Accanto."),
    },
  },
};
