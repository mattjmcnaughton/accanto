import type { Meta, StoryObj } from "@storybook/react-vite";
import { http, HttpResponse } from "msw";
import { useState } from "react";
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

/** A synthetic reply long enough to outgrow a phone's log, streamed a few words at a time. */
const longReply = Array.from(
  { length: 14 },
  (_, i) =>
    `Part ${i + 1}: synthetic reserve ${String.fromCharCode(65 + (i % 3))} gets an example monthly amount, so this paragraph wraps over a few lines on a phone.`,
).join("\n\n");
const longQuestion = "Walk me through every synthetic reserve, one paragraph each.";
let streamed = false;

/**
 * Send a question: the reply streams for about ten seconds, longer than the log is tall. Closing
 * leaves a button to open the assistant again.
 */
export const StreamingLongReply: Story = {
  render: function Render(args) {
    const [open, setOpen] = useState(true);
    if (!open)
      return (
        <button
          type="button"
          className="btn pri"
          style={{ position: "fixed", top: 12, right: 12 }}
          onClick={() => setOpen(true)}
        >
          Assistant
        </button>
      );
    return (
      <AgentPanel
        {...args}
        close={() => {
          args.close();
          setOpen(false);
        }}
      />
    );
  },
  parameters: {
    msw: [
      http.post(`${agentRoot}/conversations/c1/messages`, () => {
        const words = longReply.split(/(?<= )/);
        const encoder = new TextEncoder();
        const frame = (event: string, data: unknown) =>
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        return new HttpResponse(
          new ReadableStream({
            async start(controller) {
              for (let i = 0; i < words.length; i += 3) {
                await new Promise((resolve) => setTimeout(resolve, 90));
                controller.enqueue(frame("delta", { text: words.slice(i, i + 3).join("") }));
              }
              streamed = true;
              controller.enqueue(
                frame("done", {
                  conversation_id: "c1",
                  owner_message_id: "q",
                  agent_message_id: "a",
                  pending_change_ids: [],
                }),
              );
              controller.close();
            },
          }),
          { headers: { "Content-Type": "text/event-stream" } },
        );
      }),
      // Once the reply is stored, the reload shows it after the earlier turns.
      http.get(`${agentRoot}/conversations/c1`, () =>
        HttpResponse.json(
          streamed
            ? [
                ...messages,
                { ...messages[0], id: "q", content: longQuestion },
                { ...messages[1], id: "a", content: longReply },
              ]
            : messages,
        ),
      ),
      ...meta.parameters.msw,
    ],
  },
};
