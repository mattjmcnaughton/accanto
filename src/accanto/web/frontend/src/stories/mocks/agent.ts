/**
 * A stateful, synthetic assistant for stories: the conversation, and a reply that streams
 * slowly over SSE with text, tool steps and more text, the way a real turn arrives. A turn
 * is stored only when it finishes, as on the server. Synthetic data only.
 */
import { http, HttpResponse, delay } from "msw";

type Message = {
  id: string;
  role: "owner" | "agent";
  content: string;
  image_count: number;
  pending_change_ids: string[];
  created_at: string;
};
const at = "2026-11-20T09:00:00Z";
const turn = (n: number, question: string, answer: string): Message[] => [
  {
    id: `q${n}`,
    role: "owner",
    content: question,
    image_count: 0,
    pending_change_ids: [],
    created_at: at,
  },
  {
    id: `a${n}`,
    role: "agent",
    content: answer,
    image_count: 0,
    pending_change_ids: [],
    created_at: at,
  },
];
export const shortChat = turn(
  1,
  "How much is left for groceries this month?",
  "You planned **$600** for groceries and have recorded **$412.30**, so **$187.70** is left.\n\n- Example Grocer: $265.50\n- Corner Market: $146.80",
);
const topics = [
  [
    "How did dining out go in October?",
    "You recorded **$318.40** on dining out against **$250** planned, so October ran **$68.40** over.\n\n- Example Bistro: $142.10\n- Noodle Counter: $96.30\n- Corner Cafe: $80.00\n\nMost of the overage came in the last week of the month.",
  ],
  [
    "Am I on track for the Italy trip goal?",
    "The Italy trip goal has **$2,150** of **$4,000** saved. At the planned **$250** a month you reach it in about eight months, in July.\n\nIf you moved the **$68.40** dining overage back into saving each month, you would reach it about a month sooner.",
  ],
  [
    "What fixed costs are still unrecorded this month?",
    "Two fixed costs have no November entry yet:\n\n1. Annual insurance, **$120.02** planned\n2. New bicycle, **$300.00** planned\n\nRecord what happened in Review, or record $0.00 if nothing did.",
  ],
  [
    "Summarize my investing this year.",
    "You have contributed **$8,800** across two destinations this year:\n\n- Index fund: $7,200\n- Retirement account: $1,600\n\nThat is **$1,200** short of the **$10,000** you planned, with one month left.",
  ],
  [
    "Which category moved the most since September?",
    "Guilt-free spending moved the most. It went from **$1,402.12** recorded in September to **$1,719.98** planned for November, up **$317.86**. Fixed costs stayed within a few dollars.",
  ],
];
export const longChat = [...shortChat, ...topics.flatMap(([q, a], i) => turn(i + 2, q, a))];

/** What the streamed reply says, before and after its tool steps. */
const BEFORE = "Let me look at your savings goals and this month's Review before answering.";
const AFTER = [
  "Here is where your savings stand for **November 2026**.",
  "- Italy trip: **$2,150** of **$4,000**, on track for July\n- Emergency fund: **$9,400** of **$10,000**, about two months away\n- New laptop: **$600** of **$1,800**, behind by **$150**",
  "The laptop goal is the only one behind. Its monthly amount was lowered in September, so the original date no longer fits.",
  "You could either move the date to April, which keeps the current **$150** a month, or raise the monthly amount to **$300** to keep the February date.",
  "Nothing else needs attention: your emergency fund keeps growing on schedule, and the Italy trip goal already has its July date.",
  "If you want, I can draft the change to the laptop goal so you can review it before anything is recorded.",
].join("\n\n");

const frame = (event: string, data: unknown) =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const words = (text: string) => text.match(/\S+\s*/g) ?? [];

/** Handlers for one story; `seed` is the stored conversation it starts from. */
export function agentApi(seed: Message[], { wordMs = 70 } = {}) {
  let stored = [...seed];
  return {
    reset: () => {
      stored = [...seed];
    },
    handlers: [
      http.get("/api/entities/:entity/agent/conversation", () => HttpResponse.json(stored)),
      http.get("/api/entities/:entity/agent/pending-changes", () => HttpResponse.json([])),
      http.delete("/api/entities/:entity/agent/conversation", () => {
        stored = [];
        return HttpResponse.json({ cleared: true });
      }),
      http.post("/api/entities/:entity/agent/conversation/messages", async ({ request }) => {
        const content = String((await request.formData()).get("content") ?? "");
        const encoder = new TextEncoder();
        const body = new ReadableStream<Uint8Array>({
          async start(controller) {
            const send = async (text: string, ms = wordMs) => {
              await delay(ms);
              if (request.signal.aborted) throw new Error("stopped");
              controller.enqueue(encoder.encode(text));
            };
            try {
              for (const w of words(BEFORE)) await send(frame("delta", { text: w }));
              for (const name of ["list_savings", "get_monthly_review"]) {
                await send(frame("tool", { name, status: "started" }), 400);
                await send(frame("tool", { name, status: "done" }), 700);
              }
              for (const [i, w] of words(AFTER).entries())
                await send(frame("delta", { text: i === 0 ? `\n\n${w}` : w }));
              stored = [
                ...stored,
                ...turn(stored.length, content, `${BEFORE}\n\n${AFTER}`).map((m) => ({
                  ...m,
                  id: `${m.id}-${stored.length}`,
                })),
              ];
              await send(
                frame("done", {
                  owner_message_id: "o",
                  agent_message_id: "a",
                  pending_change_ids: [],
                }),
              );
              controller.close();
            } catch {
              // Stopped: the browser went away, and nothing is stored.
            }
          },
        });
        return new HttpResponse(body, { headers: { "Content-Type": "text/event-stream" } });
      }),
    ],
  };
}
