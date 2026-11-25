import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, userEvent, within } from "storybook/test";
import { Workspace } from "../../features/workspace/Workspace";
import { data } from "../mocks/api";

// The shell keeps its own screen and month here; the app keeps both, and the Entity, in the
// address. Switching Entities is recorded in the Actions panel.
const meta = {
  title: "Shell/Workspace",
  component: Workspace,
  args: {
    initial: data.session,
    entityId: data.entity.id,
    signedOut: fn(),
    switchEntity: fn().mockName("switchEntity"),
  },
} satisfies Meta<typeof Workspace>;
export default meta;
type Story = StoryObj<typeof meta>;

export const SignedIn: Story = {};
/** Add activity opens the entry dialog from any screen. */
export const AddActivity: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(
      await within(canvasElement).findByRole("button", { name: "Add activity" }),
    );
  },
};
