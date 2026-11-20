import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { Workspace } from "../../features/workspace/Workspace";
import { data } from "../mocks/api";

// The current shell. It is being rewritten with a URL per screen, so expect to replace this.
const meta = {
  title: "Shell/Workspace",
  component: Workspace,
  args: { initial: data.session, signedOut: fn() },
} satisfies Meta<typeof Workspace>;
export default meta;
type Story = StoryObj<typeof meta>;

export const SignedIn: Story = {};
