import { useEffect, useRef, useState } from "react";
import { ApiError, type BrowserSession, type UUID } from "../../lib/api";
import {
  type AgentMessage,
  type AgentSettings,
  AgentStreamError,
  type PendingChange,
  type ToolLine,
  agent,
  streamReply,
} from "../../lib/agentStream";
import type { WriteSpec } from "../../lib/monthly";
import { Icon } from "../../ui";
import type { Entity } from "../workspace/shared";
import { Markdown } from "./Markdown";
import "./agent.css";

export interface AgentPanelProps {
  entity: Entity;
  busy: boolean;
  refresh: number;
  screen: string;
  month: string;
  credentials: (signIn?: boolean) => Promise<BrowserSession>;
  save: <T>(spec: WriteSpec<T>, confirmed: (data: T) => void) => void;
  close: () => void;
  openSettings: () => void;
}
type Tab = "chat" | "pending";
interface Live {
  text: string;
  tools: ToolLine[];
  changes: PendingChange[];
}

const TOOL_LABEL = (name: string) => name.split("_").join(" ");
/** Free text from tools may arrive as {"untrusted": "..."}; show it as plain text. */
export const plain = (value: unknown): string =>
  typeof value === "object" && value !== null && "untrusted" in value
    ? String((value as { untrusted: unknown }).untrusted)
    : value == null
      ? ""
      : String(value);

/** The built-in assistant: one conversation per Entity, plus the Entity's pending changes. */
export function AgentPanel(p: AgentPanelProps) {
  const [settings, setSettings] = useState<AgentSettings | null>(null);
  const [loadError, setLoadError] = useState("");
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [pending, setPending] = useState<PendingChange[]>([]);
  const [tab, setTab] = useState<Tab>("chat");
  const [text, setText] = useState("");
  const [live, setLive] = useState<Live | null>(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const abort = useRef<AbortController | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Reload on Entity, saves and explicit retries.
  useEffect(() => {
    let disposed = false;
    setLoadError("");
    void (async () => {
      try {
        const next = await agent.settings(p.entity.id);
        if (disposed) return;
        setSettings(next);
        if (!next.enabled) return;
        const [conversation, changes] = await Promise.all([
          agent.conversation(p.entity.id),
          agent.pending(p.entity.id),
        ]);
        if (disposed) return;
        setMessages(conversation);
        setPending(changes);
      } catch (issue) {
        if (!disposed)
          setLoadError(issue instanceof Error ? issue.message : "Could not load the assistant.");
      }
    })();
    return () => {
      disposed = true;
    };
  }, [p.entity.id, p.refresh, reload]);
  useEffect(() => () => abort.current?.abort(), []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Scroll whenever the transcript grows.
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [messages, live]);
  useEffect(() => input.current?.focus(), []);

  async function send() {
    const content = text.trim();
    if (!content || live) return;
    setError("");
    setText("");
    setMessages((m) => [
      ...m,
      {
        id: `local-${Date.now()}`,
        role: "owner",
        content,
        image_count: 0,
        pending_change_ids: [],
        created_at: new Date().toISOString(),
      },
    ]);
    const state: Live = { text: "", tools: [], changes: [] };
    setLive({ ...state });
    const controller = new AbortController();
    abort.current = controller;
    const handlers = {
      onDelta: (delta: string) => {
        state.text += delta;
        setLive({ ...state });
      },
      onTool: (line: ToolLine) => {
        const at = state.tools.findIndex((t) => t.name === line.name && t.status === "started");
        state.tools =
          at >= 0 && line.status !== "started"
            ? state.tools.map((t, i) => (i === at ? line : t))
            : [...state.tools, line];
        setLive({ ...state });
      },
      onPendingChange: (change: PendingChange) => {
        state.changes = [...state.changes, change];
        setLive({ ...state });
      },
    };
    const input = {
      content,
      screen: p.screen,
      month: `${p.month}-01`,
    };
    try {
      try {
        await streamReply(await p.credentials(), p.entity.id, input, handlers, controller.signal);
      } catch (issue) {
        if (!(issue instanceof ApiError) || issue.kind !== "unauthenticated") throw issue;
        await streamReply(
          await p.credentials(true),
          p.entity.id,
          input,
          handlers,
          controller.signal,
        );
      }
    } catch (issue) {
      if (!controller.signal.aborted) {
        setError(issue instanceof AgentStreamError || issue instanceof Error ? issue.message : "");
        setText(content);
      }
    } finally {
      abort.current = null;
      setLive(null);
      setReload((x) => x + 1);
    }
  }

  async function clear() {
    if (live || !window.confirm("Clear this conversation? Pending changes stay listed.")) return;
    try {
      await agent.clear(await p.credentials(), p.entity.id);
      setMessages([]);
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "The conversation was not cleared.");
    }
  }

  function apply(change: PendingChange, edited?: Record<string, unknown>) {
    p.save<unknown>(
      {
        method: "POST",
        path: agent.applyPath(p.entity.id, change.id),
        body: { input: edited ?? null },
      },
      () => setReload((x) => x + 1),
    );
  }
  async function dismiss(change: PendingChange) {
    try {
      await agent.dismiss(await p.credentials(), p.entity.id, change);
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Not dismissed.");
    }
    setReload((x) => x + 1);
  }

  const open = new Map(pending.map((c) => [c.id, c]));
  const recordMode = settings?.mode === "record";
  const cards = (ids: UUID[]) =>
    ids
      .map((id) => open.get(id))
      .filter((c): c is PendingChange => Boolean(c))
      .map((c) => (
        <PendingCard
          key={c.id}
          change={c}
          canApply={recordMode}
          disabled={p.busy}
          apply={(edited) => apply(c, edited)}
          dismiss={() => void dismiss(c)}
        />
      ));

  return (
    <aside className="agent" aria-label="Assistant">
      <header className="agent-h">
        <b>Assistant</b>
        {settings?.enabled && (
          <span className={`agent-mode ${settings.mode}`}>
            {recordMode ? "Record with approval" : "Propose only"}
          </span>
        )}
        <span className="spacer" />
        {settings?.enabled && (
          <button type="button" className="btn quiet sm" onClick={() => void clear()}>
            Clear
          </button>
        )}
        <button type="button" className="icon-btn" aria-label="Close assistant" onClick={p.close}>
          <Icon name="x" />
        </button>
      </header>
      {loadError && (
        <div className="banner bad" role="alert">
          <span>Could not load the assistant. {loadError}</span>
          <button type="button" className="btn sm" onClick={() => setReload((x) => x + 1)}>
            Try again
          </button>
        </div>
      )}
      {settings && !settings.enabled && (
        <div className="agent-off card pad">
          <b>The assistant is off for {p.entity.name}</b>
          <p>
            Turn it on in Settings, where you can see which model provider it uses, what it sends,
            and how long conversations are kept.
          </p>
          <button type="button" className="btn pri sm" onClick={p.openSettings}>
            Open Settings
          </button>
        </div>
      )}
      {settings?.enabled && (
        <>
          {/* biome-ignore lint/a11y/useSemanticElements: The kit's segmented control is a button group. */}
          <div className="seg-control agent-tabs" role="group" aria-label="Assistant view">
            <button type="button" aria-pressed={tab === "chat"} onClick={() => setTab("chat")}>
              Conversation
            </button>
            <button
              type="button"
              aria-pressed={tab === "pending"}
              onClick={() => setTab("pending")}
            >
              Pending changes <small>{pending.length}</small>
            </button>
          </div>
          {tab === "pending" ? (
            <div className="agent-log">
              {pending.length === 0 && <p className="note">No pending changes.</p>}
              {pending.map((c) => (
                <PendingCard
                  key={c.id}
                  change={c}
                  canApply
                  disabled={p.busy}
                  apply={(edited) => apply(c, edited)}
                  dismiss={() => void dismiss(c)}
                />
              ))}
            </div>
          ) : (
            <div className="agent-log" ref={log} aria-live="polite">
              {messages.length === 0 && !live && (
                <p className="note">
                  Ask about your finances, or ask me to categorize the inbox. Changes I draft wait
                  for you as cards; nothing is recorded until you apply it.
                </p>
              )}
              {messages.map((m) => (
                <div key={m.id} className={`agent-msg ${m.role}`}>
                  {m.role === "owner" ? <p>{m.content}</p> : <Markdown text={m.content} />}
                  {m.image_count > 0 && (
                    <small className="note">{m.image_count} image(s) sent, not kept</small>
                  )}
                  {cards(m.pending_change_ids)}
                </div>
              ))}
              {live && (
                <div className="agent-msg agent">
                  {live.tools.map((t, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: Tool lines only append.
                    <small key={i} className={`agent-tool ${t.status}`}>
                      {t.status === "started" ? "Using" : t.status === "done" ? "Used" : "Failed:"}{" "}
                      {TOOL_LABEL(t.name)}
                    </small>
                  ))}
                  {live.text ? (
                    <Markdown text={live.text} />
                  ) : (
                    <output className="note">Thinking…</output>
                  )}
                  {live.changes.map((c) => (
                    <div key={c.id} className="agent-card card pad">
                      <b>Drafted: {c.summary}</b>
                    </div>
                  ))}
                </div>
              )}
              {!recordMode && pending.length > 0 && (
                <p className="note">
                  Propose only: apply drafted changes from <b>Pending changes</b>.
                </p>
              )}
            </div>
          )}
          {error && (
            <div className="banner bad" role="alert">
              <span>{error}</span>
            </div>
          )}
          <form
            className="agent-compose"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <textarea
              ref={input}
              className="input"
              aria-label="Message the assistant"
              maxLength={4000}
              rows={2}
              value={text}
              placeholder="What did I spend on groceries last month?"
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            {live ? (
              <button type="button" className="btn" onClick={() => abort.current?.abort()}>
                Stop
              </button>
            ) : (
              <button type="submit" className="btn pri" disabled={!text.trim()}>
                Send
              </button>
            )}
          </form>
        </>
      )}
    </aside>
  );
}

const ACTIVITY_FIELDS = ["date", "category", "amount", "note"] as const;

/** A drafted change. save_activity drafts are editable before applying. */
export function PendingCard({
  change,
  canApply,
  disabled,
  apply,
  dismiss,
}: {
  change: PendingChange;
  canApply: boolean;
  disabled: boolean;
  apply: (edited?: Record<string, unknown>) => void;
  dismiss: () => void;
}) {
  const { _draft, ...input } = change.input as Record<string, unknown> & {
    _draft?: { uncertain_fields?: string[]; source_text?: string };
  };
  const [edited, setEdited] = useState<Record<string, unknown> | null>(null);
  const values = edited ?? input;
  const editable = change.tool === "save_activity" && !input.id;
  const uncertain = new Set(_draft?.uncertain_fields ?? []);
  return (
    <div className="agent-card card pad" data-pending={change.id}>
      <b>{change.summary}</b>
      <small className="note">
        Drafted by {change.created_by_interface === "mcp" ? "an MCP client" : "the assistant"} ·{" "}
        {TOOL_LABEL(change.tool)}
      </small>
      {editable ? (
        <div className="agent-fields">
          {ACTIVITY_FIELDS.map((field) => (
            <label
              key={field}
              htmlFor={`${change.id}-${field}`}
              className={uncertain.has(field) ? "uncertain" : ""}
            >
              <span>
                {field}
                {uncertain.has(field) && " (check this)"}
              </span>
              {field === "category" ? (
                <select
                  id={`${change.id}-${field}`}
                  className="input"
                  value={String(values[field] ?? "spending")}
                  onChange={(e) => setEdited({ ...values, [field]: e.target.value })}
                >
                  {["spending", "income", "fixed_cost", "saving"].map((c) => (
                    <option key={c} value={c}>
                      {c.replace("_", " ")}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id={`${change.id}-${field}`}
                  className="input"
                  type={field === "date" ? "date" : "text"}
                  inputMode={field === "amount" ? "decimal" : undefined}
                  value={String(values[field] ?? "")}
                  onChange={(e) => setEdited({ ...values, [field]: e.target.value })}
                />
              )}
            </label>
          ))}
        </div>
      ) : (
        <dl className="agent-input">
          {Object.entries(input).map(([key, value]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>{typeof value === "object" ? JSON.stringify(value) : plain(value)}</dd>
            </div>
          ))}
        </dl>
      )}
      {_draft?.source_text && (
        <details>
          <summary>Text read from the image</summary>
          <p className="agent-source">{_draft.source_text}</p>
        </details>
      )}
      <div className="agent-actions">
        {canApply && (
          <button
            type="button"
            className="btn pri sm"
            disabled={disabled}
            onClick={() => apply(edited ?? undefined)}
          >
            Apply
          </button>
        )}
        <button type="button" className="btn quiet sm" disabled={disabled} onClick={dismiss}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
