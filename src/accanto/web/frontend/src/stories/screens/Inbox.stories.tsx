import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, userEvent } from "storybook/test";
import { Inbox } from "../../features/inbox/Inbox";
import { data, mockApi, screenArgs } from "../mocks/api";
import { inboxApi, proposedInbox, seedInbox, source } from "../mocks/inbox";

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
    openSettings: fn().mockName("openSettings"),
    openReview: fn().mockName("openReview"),
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

/** p (or the filter) shows only items with a proposal; the view counts follow it. */
export const WithProposals: Story = {
  play: () => press("p"),
};

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

/** Ignored items (status skipped): out of totals, kept on re-sync, returned with s. */
export const Ignored: Story = {
  parameters: {
    msw: [
      ...inboxApi(
        seedInbox().map((it) => (it.proposal?.skip ? { ...it, status: "skipped" as const } : it)),
      ),
      ...mockApi(),
    ],
  },
  play: async ({ canvas }) => {
    await canvas.findAllByText("Sample Street Market");
    await press("v");
  },
};

export const Recorded: Story = { play: () => press("v", "v") };

/** Flow starts once the items are on screen, then presses the keys. */
const flowPlay =
  (...keys: string[]) =>
  async ({ canvas }: { canvas: { findAllByText: (t: string) => Promise<unknown> } }) => {
    await canvas.findAllByText("Sample Street Market");
    // Keys wait for the previous write: flow drops keys while one is saving.
    for (const key of ["F", ...keys]) {
      await press(key);
      await new Promise((done) => setTimeout(done, 500));
    }
  };
const proposed = { msw: [...inboxApi(proposedInbox(), [source], { run: "done" }), ...mockApi()] };

/** The agent proposal run in the background, 25 items a step; the tab may close. */
export const AgentProposing: Story = {
  parameters: { msw: [...inboxApi(seedInbox(), [source], { run: "held" }), ...mockApi()] },
};

/** The run finished: unsure items carry the agent's question instead of a guess. */
export const ProposalsReady: Story = { parameters: proposed };

/** F starts flow: one waiting item at a time with its proposal and why. */
export const Flow: Story = { parameters: proposed, play: flowPlay() };

/** Enter accepted two; the toast offers undo and the header counts them. */
export const FlowAfterAccepting: Story = {
  parameters: proposed,
  play: flowPlay("{Enter}", "{Enter}"),
};

/** An item the agent was unsure about: its question shows, and Enter opens edit to choose. */
export const FlowNeedsYou: Story = {
  parameters: {
    msw: [
      ...inboxApi(
        proposedInbox().filter((it) =>
          ["Placeholder Pay App", "Example Coffee Cart"].includes(it.payee),
        ),
        [source],
        { run: "done" },
      ),
      ...mockApi(),
    ],
  },
  play: async ({ canvas }) => {
    await canvas.findAllByText("Placeholder Pay App");
    await press("F", "{Enter}");
  },
};

/** Edit inside flow uses the inbox's own fields; Enter records and moves on. */
export const FlowEdit: Story = {
  parameters: proposed,
  play: flowPlay("e", "3"),
};

/** The end of a pass, with items left for later. */
export const FlowPassComplete: Story = {
  parameters: {
    msw: [
      ...inboxApi(
        proposedInbox()
          .filter((it) => it.status === "waiting" && !it.parent_ref)
          .slice(0, 3),
        [source],
        { run: "done" },
      ),
      ...mockApi(),
    ],
  },
  play: flowPlay("{Enter}", "l", "s"),
};

export const Help: Story = { play: () => press("?") };

/** Owner notes: an unsure inflow explained, and a proposal refuted after the agent made it. */
const noted = () =>
  proposedInbox().map((it) =>
    it.payee === "Placeholder Pay App"
      ? {
          ...it,
          note: "My share of a group dinner, paid back by a friend. A refund of the Example Bistro meal.",
          noted_at: "2026-11-21T09:10:00Z",
        }
      : it.payee === "Example Coffee Cart"
        ? {
            ...it,
            note: "Not spending: a gift card for my sister's birthday. Giving.",
            noted_at: "2026-11-21T09:12:00Z",
          }
        : it,
  );
const notes = { msw: [...inboxApi(noted(), [source], { run: "done" }), ...mockApi()] };
type Canvas = { findAllByText: (text: string) => Promise<HTMLElement[]> };
const open = async (canvas: Canvas, payee: string) =>
  userEvent.click((await canvas.findAllByText(payee))[0]);

/** The owner's note disagrees with the proposal: the row and the panel show it beside the rationale. */
export const NoteRefutesProposal: Story = {
  parameters: notes,
  play: ({ canvas }) => open(canvas, "Example Coffee Cart"),
};

/** c opens the note on the current item; Enter saves, Esc cancels. */
export const WritingNote: Story = {
  parameters: proposed,
  play: async ({ canvas }) => {
    await open(canvas, "Placeholder Pay App");
    await press("c");
    await userEvent.keyboard("Payback from a friend for concert tickets. A refund, not income.");
  },
};

/** A noted item after Enter: recorded, its note kept on the actual entry. */
export const NoteRecorded: Story = {
  parameters: notes,
  play: async ({ canvas }) => {
    await open(canvas, "Example Coffee Cart");
    await press("{Enter}");
    await new Promise((done) => setTimeout(done, 800));
    await press("v", "v");
    await open(canvas, "Example Coffee Cart");
  },
};

/** In flow, c writes a note on the item in front of you without leaving the pass. */
export const FlowNote: Story = {
  parameters: notes,
  play: async ({ canvas }) => {
    await canvas.findAllByText("Sample Street Market");
    await press("F");
    await new Promise((done) => setTimeout(done, 300));
    await press("c");
    await userEvent.keyboard("Market run for the block party; split with neighbours.");
  },
};

/** With a selection, c writes one note for every selected item. */
export const BatchNote: Story = {
  parameters: notes,
  play: async ({ canvas }) => {
    await canvas.findAllByText("Sample Street Market");
    await press("j", "j", "x", "j", "x", "j", "x", "c");
    await userEvent.keyboard("Trip to the coast in November.");
  },
};

/** Every item is recorded or skipped. */
/** Every item was recorded or ignored before this visit: inbox zero, nothing new since the sync. */
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

/** Four waiting items, all with proposals: three record, one is ignored. */
const lastFour = {
  msw: [
    ...inboxApi(
      seedInbox().filter(
        (it) =>
          [
            "Sample Pharmacy",
            "Example Streaming",
            "Sample Street Market",
            "Example Coffee Cart",
          ].includes(it.payee) || it.status === "recorded",
      ),
    ),
    ...mockApi(),
  ],
};
const phone = { globals: { viewport: { value: "phone", isRotated: false } } };
const clearAll = async ({
  canvas,
}: { canvas: { findAllByText: (t: string) => Promise<unknown> } }) => {
  await canvas.findAllByText("Sample Pharmacy");
  for (const key of ["F", "{Enter}", "{Enter}", "{Enter}", "s"]) {
    await press(key);
    await new Promise((done) => setTimeout(done, 500));
  }
};
const clearAllThenLeave = async (ctx: Parameters<typeof clearAll>[0]) => {
  await clearAll(ctx);
  await press("{Escape}");
};

/**
 * Inbox zero, the recommended design: a calm card with this session's tally (recorded amounts
 * only; ignored items are in no total), the last sync with Sync now, and this month's Review.
 * The check draws once; reduced motion shows it still.
 */
export const InboxZero: Story = { parameters: lastFour, play: clearAllThenLeave };
export const InboxZeroPhone: Story = { ...phone, parameters: lastFour, play: clearAllThenLeave };

/** The last item of a flow pass leaves nothing waiting: the pass ends on inbox zero. */
export const FlowInboxZero: Story = { parameters: lastFour, play: clearAll };
export const FlowInboxZeroPhone: Story = { ...phone, parameters: lastFour, play: clearAll };

/** Option B: the same card with the session's recorded amounts by category. */
export const InboxZeroLedger: Story = {
  args: { zeroStyle: "ledger" },
  parameters: lastFour,
  play: clearAllThenLeave,
};
export const InboxZeroLedgerPhone: Story = { ...InboxZeroLedger, ...phone };

/** Option C: one quiet line in the inbox's own layout, no card. */
export const InboxZeroQuiet: Story = {
  args: { zeroStyle: "quiet" },
  parameters: lastFour,
  play: clearAllThenLeave,
};
export const InboxZeroQuietPhone: Story = { ...InboxZeroQuiet, ...phone };

/** Search matches only a recorded item ($129.00): the Waiting view says what it hides, not "all done". */
export const HeldBySearch: Story = {
  play: async ({ canvas }) => {
    await canvas.findAllByText("Sample Street Market");
    await press("/");
    await userEvent.keyboard("129");
  },
};

/** The proposals filter hides the waiting items that have none. */
export const HeldByFilter: Story = {
  parameters: {
    msw: [
      ...inboxApi(seedInbox().filter((it) => it.status === "recorded" || !it.proposal)),
      ...mockApi(),
    ],
  },
  play: async ({ canvas }) => {
    await canvas.findAllByText("Placeholder Hardware");
    await press("p");
  },
};
export const HeldByFilterPhone: Story = { ...HeldByFilter, ...phone };

export const NoSource: Story = {
  parameters: { msw: [...inboxApi([], []), ...mockApi()] },
};

/** No token in Settings yet: the inbox points there instead of asking for one. */
export const NoToken: Story = {
  parameters: {
    msw: [...inboxApi([], []), ...mockApi("loaded", { transactionProvider: "empty" })],
  },
};

const unsynced = { ...source, synced: false, last_synced_at: null };

/** A plan with more accounts than fit on screen: the list scrolls inside the panel. */
export const ChooseManyAccounts: Story = {
  parameters: { msw: [...inboxApi([], [{ ...unsynced, accounts: [] }]), ...mockApi()] },
};

/** Accounts chosen but never synced: the inbox prompts for the first sync. */
export const ReadyToSync: Story = {
  parameters: {
    msw: [...inboxApi([], [unsynced], { syncDelay: "infinite" }), ...mockApi()],
  },
};

/** A sync in progress: the header button spins and a strip says what is being read. */
export const Syncing: Story = {
  parameters: {
    msw: [...inboxApi(seedInbox(), [source], { syncDelay: "infinite" }), ...mockApi()],
  },
  play: async ({ canvas }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "Sync now" }));
  },
};

export const Loading: Story = { parameters: { msw: mockApi("loading") } };
export const Failed: Story = { parameters: { msw: mockApi("failed") } };
