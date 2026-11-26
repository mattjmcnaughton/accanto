import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, userEvent, within } from "storybook/test";
import { Workspace } from "../../features/workspace/Workspace";
import { agentApi, longChat, shortChat } from "../mocks/agent";
import { data, mockApi } from "../mocks/api";

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

// The assistant turned on, with a synthetic conversation that answers new messages slowly.
const assistant = (seed: typeof shortChat) => {
  const api = agentApi(seed);
  return {
    parameters: {
      msw: [
        ...api.handlers,
        ...mockApi("loaded", { agentSettings: { ...data.agentSettings, enabled: true } }),
      ],
    },
    reset: api.reset,
  };
};
const short = assistant(shortChat);
const long = assistant(longChat);
const agentOn = short.parameters;
const openAssistant: Story["play"] = async ({ canvasElement }) => {
  await userEvent.click(await within(canvasElement).findByRole("button", { name: "Assistant" }));
};
/** The layout is remembered on the device; seeding it is the state the owner returns to. */
const LAYOUT = ["accanto.agent-width", "accanto.agent-full"];
const remembered = (values: Record<string, string>) => () => {
  for (const key of LAYOUT) localStorage.removeItem(key);
  for (const [key, value] of Object.entries(values)) localStorage.setItem(key, value);
  return () => {
    for (const key of LAYOUT) localStorage.removeItem(key);
  };
};

/** The docked panel; drag its left edge, or focus it and use the arrow keys, to resize. */
export const AssistantOpen: Story = {
  parameters: agentOn,
  beforeEach: () => {
    short.reset();
    return remembered({})();
  },
  play: openAssistant,
};
export const AssistantWidened: Story = {
  parameters: agentOn,
  beforeEach: remembered({ "accanto.agent-width": "640" }),
  play: openAssistant,
};
/** The full-screen button fills the screen with the conversation and returns to the panel. */
export const AssistantFullScreen: Story = {
  parameters: agentOn,
  beforeEach: remembered({ "accanto.agent-full": "true" }),
  play: openAssistant,
};

/**
 * A long conversation: send a message, then scroll up while the reply streams. The log stops
 * following while you read, Esc or Stop keeps what arrived, and the question stays in view.
 */
export const AssistantLongConversation: Story = {
  parameters: long.parameters,
  beforeEach: () => {
    long.reset();
    return remembered({})();
  },
  play: openAssistant,
};

/** Ctrl K opens the Ask bar: suggested phrases, / commands, screens, and free text to ask. */
export const AskBar: Story = {
  parameters: agentOn,
  beforeEach: () => short.reset(),
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByRole("button", { name: "Ask or jump" });
    await userEvent.keyboard("{Control>}k{/Control}");
  },
};
/** /left shows Home's own figure, read from the Review: no model turn. */
export const AskBarCard: Story = {
  parameters: agentOn,
  beforeEach: () => short.reset(),
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByRole("button", { name: "Ask or jump" });
    await userEvent.keyboard("{Control>}k{/Control}");
    await userEvent.keyboard("/left{Enter}");
  },
};
