import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { RecoveryNotice } from "../../features/recovery/RecoveryNotice";

const meta = {
  title: "Shared/RecoveryNotice",
  component: RecoveryNotice,
  args: {
    status: "unavailable",
    onRetry: fn(),
    onSignIn: fn(),
    onReconcile: fn(),
    onDiscard: fn(),
  },
  argTypes: {
    status: {
      control: "select",
      options: [
        "unavailable",
        "unauthenticated",
        "conflict",
        "validation",
        "blocked",
        "cancelled",
        "failed",
        "wrong_user",
      ],
    },
  },
} satisfies Meta<typeof RecoveryNotice>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Unavailable: Story = {};
export const SignInExpired: Story = { args: { status: "unauthenticated" } };
export const Conflict: Story = { args: { status: "conflict" } };
export const WrongUser: Story = { args: { status: "wrong_user" } };
