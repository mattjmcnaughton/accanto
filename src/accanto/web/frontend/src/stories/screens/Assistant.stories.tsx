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

const settingsChanges = [
  {
    id: "pc4",
    tool: "save_entity_settings",
    summary: "Update settings: name Example Household, time zone America/Chicago",
    status: "pending",
    created_by_interface: "agent",
    input: { name: "Example Household", time_zone: "America/Chicago", expected_revision: 3 },
    created_at: "2026-11-20T00:00:00Z",
    revision: 1,
  },
  {
    id: "pc5",
    tool: "save_fire_assumptions",
    summary: "Update FIRE assumptions: spending 40000.00, withdrawal 3.50%",
    status: "pending",
    created_by_interface: "agent",
    input: { annual_spending: "40000.00", withdrawal_percent: "3.50", expected_revision: 3 },
    created_at: "2026-11-20T00:00:01Z",
    revision: 1,
  },
];
const settingsMessages = [
  {
    id: "s0",
    role: "owner",
    content: "We moved to Chicago. Also plan FIRE on 40,000 a year at 3.5%.",
    image_count: 0,
    pending_change_ids: [],
    created_at: "2026-11-20T00:00:00Z",
  },
  {
    id: "s1",
    role: "agent",
    content:
      "I drafted both changes for Synthetic fixture workspace. Apply them to save the new settings.",
    image_count: 0,
    pending_change_ids: settingsChanges.map((c) => c.id),
    created_at: "2026-11-20T00:00:01Z",
  },
];

/** Entity settings drafted in Ask first: each is a card the owner applies. */
export const SettingsChangesPending: Story = {
  parameters: {
    msw: [
      http.get(`${agentRoot}/conversations/c1`, () => HttpResponse.json(settingsMessages)),
      http.get(`${agentRoot}/pending-changes`, () => HttpResponse.json(settingsChanges)),
      ...meta.parameters.msw,
    ],
  },
};

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

/*
 * Mockup of the FIRE number interview (synthetic). The assistant pre-fills fixed costs from the
 * latest saved Plan version, asks four questions one per reply, explains the FIRE number, and on
 * approval drafts one Pending change: the FIRE assumptions plus each Fixed cost that does not
 * rise with inflation (`fixed_cost.rises_with_inflation`, TDD 17); the card names them.
 */
const at = (s: number) => `2026-11-27T15:${String(10 + s).padStart(2, "0")}:00Z`;
const fireChange = {
  id: "pc-fire",
  tool: "save_fire_assumptions",
  summary:
    "Update FIRE assumptions: spending 61320.00, withdrawal 4.00%; 1 fixed cost does not rise with inflation",
  status: "pending",
  created_by_interface: "agent",
  input: {
    annual_spending: "61320.00",
    withdrawal_percent: "4.00",
    fixed_costs_not_rising_with_inflation: ["5b0e7f1c-2d4a-4c8e-9f31-6a7d2e4b8c10"],
    expected_revision: 4,
  },
  labels: { "5b0e7f1c-2d4a-4c8e-9f31-6a7d2e4b8c10": "Mortgage" },
  created_at: at(9),
  revision: 1,
};
const fireMessages = [
  [
    "owner",
    "Interview me for my FIRE number: ask one question at a time, starting from my Plan's fixed costs, then propose FIRE assumptions to save.",
  ],
  [
    "agent",
    [
      "Your latest saved Plan version, **November 2026**, has these fixed costs:",
      "",
      "- Mortgage: $1,850.00 a month",
      "- Childcare: $1,100.00 a month",
      "- Utilities: $240.00 a month",
      "- Car insurance: $1,440.00 a year, $120.00 a month",
      "",
      "Total **$3,310.00 a month**.",
      "",
      "**1 of 4. Are these still your fixed costs today?**",
      "",
      "Why: they are the base of your retirement spending.",
      "",
      "- Yes, all correct",
      "- One amount is different",
      "- Something is missing",
      "",
      "Answer in your own words, or say skip.",
    ].join("\n"),
  ],
  ["owner", "Yes, all correct."],
  [
    "agent",
    [
      "**2 of 4. Which of these will change by the time you retire?**",
      "",
      "Why: spending in retirement is rarely today's spending. A cost that ends lowers the number; a new one raises it.",
      "",
      "- Childcare ends",
      "- A new cost such as health insurance",
      "- Nothing changes",
      "",
      "Answer in your own words, or say skip.",
    ].join("\n"),
  ],
  ["owner", "Childcare ends. Add about $400 a month for health insurance."],
  [
    "agent",
    [
      "Noted: without Childcare and with $400.00 for health insurance, fixed costs in retirement are **$2,610.00 a month**.",
      "",
      "**3 of 4. Which of these will not grow with inflation?**",
      "",
      "Why: a fixed-rate mortgage payment stays the same while prices rise, so it costs less in today's dollars each year.",
      "",
      "- Mortgage (fixed rate)",
      "- None of them",
      "- Another one",
      "",
      "Answer in your own words, or say skip.",
    ].join("\n"),
  ],
  ["owner", "The mortgage is fixed rate."],
  [
    "agent",
    [
      "**4 of 4. How much do you want to spend each month beyond fixed costs?**",
      "",
      "Why: this is guilt-free spending in retirement. Your Plan sets $1,900.00 a month today.",
      "",
      "- $1,900.00, the same as today",
      "- $2,500.00",
      "- Another amount",
    ].join("\n"),
  ],
  ["owner", "$2,500 a month."],
  [
    "agent",
    [
      "Here is your FIRE number for Synthetic fixture workspace.",
      "",
      "- Fixed costs: $2,610.00 × 12 = $31,320.00 a year",
      "- Discretionary: $2,500.00 × 12 = $30,000.00 a year",
      "- **Annual spending: $61,320.00**",
      "",
      "**FIRE number: $61,320.00 ÷ 4.00% = $1,533,000.00**, in today's dollars, at your saved withdrawal rate.",
      "",
      "- **Grows with inflation:** Utilities, Car insurance, health insurance and discretionary spending, $39,120.00 a year.",
      "- **Does not:** Mortgage, $22,200.00 a year. At your 3.00% inflation, Projections lets it shrink in today's dollars, so your target falls a little each year.",
      "",
      "Shall I save it? I will save the annual spending and withdrawal rate, and mark Mortgage as not rising with inflation. Say yes, or tell me what to change.",
    ].join("\n"),
  ],
  ["owner", "Yes, save it."],
  [
    "agent",
    "I drafted it as a pending change for Synthetic fixture workspace. Nothing changes until you apply it; Projections then shows the new target.",
  ],
].map(([role, content], i) => ({
  id: `f${i}`,
  role,
  content,
  image_count: 0,
  pending_change_ids: i === 11 ? [fireChange.id] : [],
  created_at: at(i),
}));
const fireMsw = [
  http.get(`${agentRoot}/conversations/c1`, () => HttpResponse.json(fireMessages)),
  http.get(`${agentRoot}/pending-changes`, () => HttpResponse.json([fireChange])),
  ...meta.parameters.msw,
];

/** Mockup: the whole FIRE number interview in Ask first, ending in one pending change. */
export const FireInterview: Story = {
  args: { screen: "projections" },
  parameters: { msw: fireMsw },
};
/** Mockup: the same interview on a phone. */
export const FireInterviewPhone: Story = {
  args: { screen: "projections" },
  parameters: { msw: fireMsw },
  globals: { viewport: { value: "phone", isRotated: false } },
};

/**
 * A stand-in for the browser's speech recognizer: Speak your message hears a synthetic question
 * word by word, then pauses, which ends listening. Real browsers ask for the microphone first.
 */
class ScriptedRecognition {
  onresult: ((event: { results: { transcript: string }[][] }) => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  timers: number[] = [];
  start() {
    const words = "How much is left in the synthetic vacation fund this month?".split(" ");
    words.forEach((_, i) =>
      this.timers.push(
        window.setTimeout(
          () => this.onresult?.({ results: [[{ transcript: words.slice(0, i + 1).join(" ") }]] }),
          600 + i * 350,
        ),
      ),
    );
    this.timers.push(window.setTimeout(() => this.stop(), 1800 + words.length * 350));
  }
  stop() {
    for (const timer of this.timers) clearTimeout(timer);
    this.onend?.();
  }
  abort() {
    this.stop();
  }
}
const withSpeech = () => {
  const w = window as unknown as Record<string, unknown>;
  const before = [w.SpeechRecognition, w.webkitSpeechRecognition];
  w.SpeechRecognition = w.webkitSpeechRecognition = ScriptedRecognition;
  return () => {
    [w.SpeechRecognition, w.webkitSpeechRecognition] = before;
  };
};
/** Press the mic: the question appears in the box as it is heard, and waits for Send. */
export const Dictation: Story = { beforeEach: withSpeech };
/** The same on a phone browser that can listen, such as Chrome on Android. iPhones hide the mic. */
export const DictationPhone: Story = {
  beforeEach: withSpeech,
  globals: { viewport: { value: "phone", isRotated: false } },
};
