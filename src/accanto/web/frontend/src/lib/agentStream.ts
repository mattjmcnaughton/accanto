/**
 * The built-in agent's client contract and SSE reader, after aleph's lib/tutor-stream.ts.
 * Everything here is same-origin with the browser session; nothing is stored in the browser.
 */
import { ApiError, type BrowserSession, type UUID, fetchJson } from "./api";

export type AgentMode = "read_only" | "ask_first" | "apply_directly";
/** One name per Agent mode; the server enforces each. */
export const AGENT_MODES: Record<AgentMode, { label: string; help: string }> = {
  read_only: {
    label: "Read only",
    help: "Agents can read and answer, but every change is refused, including syncing and inbox proposals.",
  },
  ask_first: {
    label: "Ask first",
    help: "Each change waits in Pending changes until you apply it. Syncing and inbox proposals run.",
  },
  apply_directly: {
    label: "Apply directly",
    help: "Changes are recorded as soon as the assistant or an MCP client makes them.",
  },
};
export interface AgentSettings {
  enabled: boolean;
  mode: AgentMode;
  instructions: string;
  revision: number;
  provider: string;
  retention_days: number;
  daily_message_cap: number;
}
export interface PendingChange {
  id: UUID;
  tool: string;
  summary: string;
  status: "pending" | "applied" | "dismissed";
  created_by_interface: "mcp" | "agent";
  input: Record<string, unknown>;
  created_at: string;
  revision: number;
  /** Current names of the records the input refers to by id (absent while a reply streams). */
  labels?: Record<UUID, string>;
}
/** Apply all's outcome per change, in the order they were applied. */
export interface ApplyAllResult {
  results: {
    id: UUID;
    status: "applied" | "failed" | "not_applied";
    error?: { code: string; message: string };
  }[];
}
export interface AgentMessage {
  id: UUID;
  role: "owner" | "agent";
  content: string;
  image_count: number;
  pending_change_ids: UUID[];
  created_at: string;
}
/** One of the Entity's active conversations (TDD 08), titled by its first question. */
export interface ConversationSummary {
  id: UUID;
  title: string;
  message_count: number;
  created_at: string;
  updated_at: string;
}
export interface StreamDone {
  conversation_id: UUID;
  owner_message_id: UUID;
  agent_message_id: UUID;
  pending_change_ids: UUID[];
}
export interface ToolLine {
  name: string;
  status: "started" | "done" | "failed";
}
export interface StreamHandlers {
  onDelta?: (text: string) => void;
  onTool?: (line: ToolLine) => void;
  onPendingChange?: (change: PendingChange) => void;
}
export interface SendInput {
  /** The conversation to continue; null starts one. */
  conversation: UUID | null;
  content: string;
  screen?: string;
  month?: string;
  images?: Blob[];
  /** Names this turn (Idempotency-Key): sending it again follows the same turn. */
  key: string;
  /** Frames handled so far; streamReply counts up, and a resend continues after them. */
  received: number;
}

export class AgentStreamError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "AgentStreamError";
  }
}

const root = (entityId: UUID) => `/api/entities/${encodeURIComponent(entityId)}/agent`;
const csrf = (session: BrowserSession) => ({ "X-CSRF-Token": session.csrf_token });

export const agent = {
  settingsPath: (entityId: UUID) => `${root(entityId)}/settings`,
  settings: (entityId: UUID) => fetchJson<AgentSettings>(`${root(entityId)}/settings`),
  conversations: (entityId: UUID) =>
    fetchJson<ConversationSummary[]>(`${root(entityId)}/conversations`),
  conversation: (entityId: UUID, id: UUID) =>
    fetchJson<AgentMessage[]>(`${root(entityId)}/conversations/${encodeURIComponent(id)}`),
  /** Hides the conversation; its messages stay until retention removes them. */
  archive: (session: BrowserSession, entityId: UUID, id: UUID) =>
    fetchJson<{ archived: boolean }>(
      `${root(entityId)}/conversations/${encodeURIComponent(id)}/archive`,
      { method: "POST", headers: csrf(session) },
    ),
  /** Ends the reply sent with `key`; closing its stream does not, so a dropped one can
   * resume. Replies in other conversations keep running. */
  stop: (session: BrowserSession, entityId: UUID, key: string) =>
    fetchJson<{ stopped: boolean }>(`${root(entityId)}/turn/stop`, {
      method: "POST",
      headers: { ...csrf(session), "Idempotency-Key": key },
    }),
  pending: (entityId: UUID) => fetchJson<PendingChange[]>(`${root(entityId)}/pending-changes`),
  /** Applies the listed changes oldest first and stops at the first that is rejected. */
  applyAllPath: (entityId: UUID) => `${root(entityId)}/pending-changes/apply-all`,
  dismiss: (session: BrowserSession, entityId: UUID, change: PendingChange) =>
    fetchJson<PendingChange>(
      `${root(entityId)}/pending-changes/${encodeURIComponent(change.id)}/dismiss`,
      {
        method: "POST",
        headers: { ...csrf(session), "Content-Type": "application/json" },
        body: JSON.stringify({ expected_revision: change.revision }),
      },
    ),
};

const DROPPED = "The connection dropped before the reply finished.";
const MALFORMED = "The assistant's reply didn't come through.";
/** Waits before each resume of a dropped reply; the server keeps the turn running meanwhile. */
const RESUME_DELAYS_MS = [500, 1000, 2000, 4000, 8000];
/** Errors where the turn may still be running on the server, so resending its key resumes it. */
export const RESUMABLE = new Set(["stream_dropped", "network_unavailable"]);

const pause = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });

/** Send one message and stream the reply until done or error. A dropped connection (iOS
 * suspends a backgrounded page's fetch) resumes the same turn from the frames already
 * handled, so nothing is shown or run twice. */
export async function streamReply(
  session: BrowserSession,
  entityId: UUID,
  input: SendInput,
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<StreamDone> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await streamOnce(session, entityId, input, handlers, signal);
    } catch (error) {
      const resumable = error instanceof AgentStreamError && RESUMABLE.has(error.code);
      if (!resumable || signal?.aborted || attempt >= RESUME_DELAYS_MS.length) throw error;
      await pause(RESUME_DELAYS_MS[attempt], signal);
      if (signal?.aborted) throw error;
    }
  }
}

async function streamOnce(
  session: BrowserSession,
  entityId: UUID,
  input: SendInput,
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<StreamDone> {
  const form = new FormData();
  form.set("content", input.content);
  form.set("after", String(input.received));
  if (input.screen) form.set("screen", input.screen);
  if (input.month) form.set("month", input.month);
  for (const image of input.images ?? []) form.append("images", image);
  let response: Response;
  try {
    const path = input.conversation
      ? `conversations/${encodeURIComponent(input.conversation)}`
      : "conversations";
    response = await fetch(`${root(entityId)}/${path}/messages`, {
      method: "POST",
      headers: { ...csrf(session), "Idempotency-Key": input.key },
      body: form,
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new AgentStreamError("Could not reach Accanto.", "network_unavailable");
  }
  if (!response.ok || response.body === null) {
    let code = `http_${response.status}`;
    let message = "The message was not sent.";
    try {
      const detail = (await response.json())?.detail;
      if (typeof detail?.code === "string") code = detail.code;
      if (typeof detail?.message === "string") message = detail.message;
    } catch {
      // Not JSON.
    }
    if (response.status === 401) throw new ApiError("unauthenticated", 401, code, message);
    throw new AgentStreamError(message, code);
  }
  return readFrames(response.body, handlers, input, signal);
}

/** Parse SSE frames; exported for tests. Blank-line boundaries, JSON data, `:` comments.
 * Counts each data frame on `progress.received` once it is handled. */
export async function readFrames(
  body: ReadableStream<Uint8Array>,
  handlers: StreamHandlers,
  progress: { received: number } = { received: 0 },
  signal?: AbortSignal,
): Promise<StreamDone> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (error) {
        // Safari reports a dropped stream as a bare "Load failed"; say what happened.
        if (signal?.aborted) throw error;
        throw new AgentStreamError(DROPPED, "stream_dropped");
      }
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const terminal = handleFrame(frame, handlers, progress);
        if (terminal) return terminal;
        boundary = buffer.indexOf("\n\n");
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  throw new AgentStreamError(DROPPED, "stream_dropped");
}

function handleFrame(
  frame: string,
  handlers: StreamHandlers,
  progress: { received: number },
): StreamDone | null {
  let event = "message";
  let data = "";
  for (const line of frame.split("\n")) {
    if (line.startsWith(":")) continue;
    if (line.startsWith("event: ")) event = line.slice(7);
    else if (line.startsWith("data: ")) data += line.slice(6);
  }
  if (!data) return null;
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(data);
  } catch {
    throw new AgentStreamError(MALFORMED, "malformed_frame");
  }
  progress.received += 1;
  if (event === "delta" && typeof payload.text === "string") handlers.onDelta?.(payload.text);
  else if (event === "tool") handlers.onTool?.(payload as unknown as ToolLine);
  else if (event === "pending_change")
    handlers.onPendingChange?.(payload as unknown as PendingChange);
  else if (event === "done") return payload as unknown as StreamDone;
  else if (event === "error")
    throw new AgentStreamError(
      typeof payload.message === "string" ? payload.message : MALFORMED,
      typeof payload.code === "string" ? payload.code : "error",
    );
  return null;
}
