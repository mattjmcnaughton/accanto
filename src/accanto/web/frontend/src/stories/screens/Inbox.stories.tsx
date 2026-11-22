import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, userEvent } from "storybook/test";
import { Inbox } from "../../features/inbox/Inbox";
import { data, mockApi, screenArgs } from "../mocks/api";
import { inboxApi, seedInbox } from "../mocks/inbox";

/**
 * The Transactions inbox over a stateful synthetic inbox: the keys in the legend really record,
 * skip and undo against the mock. Proposals were set by an agent through the API.
 */
const meta = {
  title: "Screens/Transactions inbox",
  component: Inbox,
  args: {
    ...screenArgs(),
    credentials: fn(async () => data.session).mockName("credentials"),
  },
  parameters: { layout: "padded", msw: [...inboxApi(), ...mockApi()] },
} satisfies Meta<typeof Inbox>;
export default meta;
type Story = StoryObj<typeof meta>;

const press = async (...keys: string[]) => {
  for (const key of keys) await userEvent.keyboard(key);
};

/** Waiting items, oldest first by month, with each proposal's rationale. */
export const Waiting: Story = {};

/** A proposal whose dry run the record checks rejected: $640 from a goal with $400 saved. */
export const ProposalRejected: Story = {
  play: () => press(...Array(6).fill("j")),
};

/** An inflow in a spending category waits for a refund link, from ranked purchases. */
export const RefundCandidates: Story = {
  play: () => press(...Array(7).fill("j"), "r"),
};

/** 1–6 set the category and open the assignment picker when one is needed. */
export const AssignmentPicker: Story = {
  play: () => press("j", "2"),
};

/** f chooses the funding origin; goals with less saved than the outflow are flagged. */
export const FundingOrigin: Story = {
  play: () => press("j", "j", "j", "j", "f"),
};

/** Split lines sit under their YNAB parent. */
export const SplitLines: Story = {
  play: () => press(...Array(11).fill("j")),
};

/** A recorded item YNAB later deleted: Enter offers keep or delete, and nothing else changes. */
export const Conflict: Story = {
  play: () => press(...Array(25).fill("j"), "{Enter}"),
};

/** x selects items; Enter records them all and reports each outcome. */
export const BulkSelection: Story = {
  play: () => press("j", "j", "x", "j", "j", "j", "x", "j", "x"),
};

export const Skipped: Story = {
  parameters: {
    msw: [
      ...inboxApi(
        seedInbox().map((it) => (it.proposal?.skip ? { ...it, status: "skipped" as const } : it)),
      ),
      ...mockApi(),
    ],
  },
  play: () => press("v"),
};

export const Recorded: Story = { play: () => press("v", "v") };

export const Help: Story = { play: () => press("?") };

/** Every item is recorded or skipped. */
export const NothingWaiting: Story = {
  parameters: {
    msw: [
      ...inboxApi(
        seedInbox()
          .filter((it) => it.status !== "conflict")
          .map((it) => ({
            ...it,
            status: it.status === "recorded" ? "recorded" : ("skipped" as const),
          })),
      ),
      ...mockApi(),
    ],
  },
};

export const NoSource: Story = {
  parameters: { msw: [...inboxApi([], []), ...mockApi()] },
};

export const Loading: Story = { parameters: { msw: mockApi("loading") } };
export const Failed: Story = { parameters: { msw: mockApi("failed") } };
