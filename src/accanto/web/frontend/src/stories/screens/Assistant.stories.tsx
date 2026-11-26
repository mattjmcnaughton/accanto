import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http } from "msw";
import { fn } from "storybook/test";
import { AgentPanel } from "../../features/agent/AgentPanel";
import { data, mockApi } from "../mocks/api";

const agentRoot = "/api/entities/:entity/agent";
const change = (id: string, name: string, target: string) => ({
  id,
  tool: "save_goal",
  summary: `Add saving goal ${name}`,
  status: "pending",
  created_by_interface: "agent",
  input: { values: { kind: "finite", name, target }, goal_id: null },
  created_at: "2026-11-20T00:00:00Z",
  revision: 1,
});
const pending = [
  change("pc1", "Synthetic reserve A", "1500.00"),
  change("pc2", "Synthetic reserve B", "6000.00"),
  change("pc3", "Synthetic reserve C", "5316.00"),
];
const messages = Array.from({ length: 8 }, (_, i) => ({
  id: `m${i}`,
  role: i % 2 ? "agent" : "owner",
  content:
    i % 2
      ? "I drafted three finite reserve goals using the synthetic monthly amounts. They are pending changes for your review."
      : "Please add reserve goals for the synthetic plan.",
  image_count: 0,
  pending_change_ids: i === 7 ? pending.map((c) => c.id) : [],
  created_at: "2026-11-20T00:00:00Z",
}));

const meta = {
  title: "Screens/Assistant",
  component: AgentPanel,
  // The phone sheet's styles apply inside the workspace's `.app.with-agent` grid.
  decorators: [
    (Story) => (
      <div className="app with-agent">
        <main style={{ minHeight: "200vh" }} />
        <Story />
      </div>
    ),
  ],
  args: {
    entity: data.entity,
    busy: false,
    refresh: 0,
    screen: "home",
    month: "2026-11",
    credentials: fn(async () => data.session).mockName("credentials"),
    save: fn().mockName("save"),
    close: fn().mockName("close"),
    openSettings: fn().mockName("openSettings"),
    changed: fn().mockName("changed"),
  },
  parameters: {
    msw: [
      http.get(`${agentRoot}/settings`, () =>
        HttpResponse.json({ ...data.agentSettings, enabled: true }),
      ),
      http.get(`${agentRoot}/conversations`, () =>
        HttpResponse.json([
          {
            id: "c1",
            title: messages[0].content,
            message_count: messages.length,
            created_at: "2026-11-20T00:00:00Z",
            updated_at: "2026-11-20T00:00:00Z",
          },
        ]),
      ),
      http.get(`${agentRoot}/conversations/c1`, () => HttpResponse.json(messages)),
      http.get(`${agentRoot}/pending-changes`, () => HttpResponse.json(pending)),
      ...mockApi(),
    ],
  },
} satisfies Meta<typeof AgentPanel>;
export default meta;
type Story = StoryObj<typeof meta>;

/** A long conversation with pending changes: the header and close button stay on screen. */
export const WithPendingChanges: Story = {};
