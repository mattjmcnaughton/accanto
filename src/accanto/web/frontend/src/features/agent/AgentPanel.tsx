import { type CSSProperties, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ApiError, type BrowserSession, type UUID } from "../../lib/api";
import {
  type AgentMessage,
  type AgentSettings,
  type ApplyAllResult,
  type ConversationSummary,
  type PendingChange,
  type StreamDone,
  AGENT_MODES,
  type ToolLine,
  agent,
  streamReply,
} from "../../lib/agentStream";
import { formatMoney } from "../../lib/format";
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
  /** After a turn or a dismissal: screens reload, so new inbox proposals show. */
  changed: () => void;
  /** Whether a reply is streaming; the workspace blocks switching Entities meanwhile. */
  streaming?: (on: boolean) => void;
}
type Tab = "chat" | "pending" | "history";
/** A reply as it streamed, in the order things happened: text, tool steps and drafts. */
type Part =
  | { kind: "text"; text: string }
  | { kind: "tool"; line: ToolLine }
  | { kind: "change"; change: PendingChange };
/** A turn that has not been stored: streaming, or stopped or failed partway. */
interface Turn {
  content: string;
  image_count: number;
  parts: Part[];
  /** Set once the turn ends without a stored reply: why, and whether Retry can resend it. */
  ended?: { note: string; retry: boolean };
}

/** Starts the AGENT.md interview; the assistant's instructions say how it runs. */
export const INTERVIEW_PROMPT =
  "Interview me to write my AGENT.md: ask one question at a time, then propose the text.";
const TOOL_LABEL = (name: string) => name.split("_").join(" ");
/** What each read tool looks at, in plain words; other tools fall back to their name. */
const LOOKS_AT: Record<string, string> = {
  get_context: "your settings",
  list_plans: "your Plans",
  get_plan: "a Plan",
  get_monthly_review: "the month's Review",
  list_activity: "recorded activity",
  summarize_activity: "activity totals",
  get_position: "your net position",
  list_tags: "your tags",
  list_savings: "savings goals",
  list_destinations: "investments and giving",
  list_debts: "loans",
  list_investment_observations: "investment balances",
  list_income_estimates: "income estimates",
  list_inbox: "the inbox",
  get_inbox_item: "an inbox item",
  list_sources: "transaction sources",
  list_pending_changes: "pending changes",
  get_agent_instructions: "your AGENT.md",
};
/** Tools that compute rather than look something up. */
const COMPUTES: Record<string, Record<ToolLine["status"], string>> = {
  calculate: { started: "Calculating…", done: "Calculated", failed: "Could not calculate" },
  project: { started: "Projecting…", done: "Projected", failed: "Could not project" },
};
export function toolText({ name, status }: ToolLine): string {
  if (COMPUTES[name]) return COMPUTES[name][status];
  const what = LOOKS_AT[name];
  if (what)
    return {
      started: `Checking ${what}…`,
      done: `Checked ${what}`,
      failed: `Could not check ${what}`,
    }[status];
  const action = TOOL_LABEL(name);
  return { started: `Using ${action}…`, done: `Used ${action}`, failed: `Failed: ${action}` }[
    status
  ];
}
/** Nothing is visibly happening: no text arriving and no tool step under way. */
const thinking = (parts: Part[]) => {
  const last = parts[parts.length - 1];
  return (
    !last || (last.kind !== "text" && !(last.kind === "tool" && last.line.status === "started"))
  );
};
const WHEN = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
/** Within this many pixels of the end, the log counts as read to the end. */
const NEAR = 48;
/** Free text from tools may arrive as {"untrusted": "..."}; show it as plain text. */
export const plain = (value: unknown): string =>
  typeof value === "object" && value !== null && "untrusted" in value
    ? String((value as { untrusted: unknown }).untrusted)
    : value == null
      ? ""
      : String(value);

/**
 * The docked panel's width, dragged from its left edge, and whether it fills the screen. Both are
 * remembered on this device; neither is financial data. Below 1100px the panel is an overlay
 * sheet whose CSS ignores the width.
 */
const WIDTH_KEY = "accanto.agent-width";
const FULL_KEY = "accanto.agent-full";
const WIDTH_DEFAULT = 480;
const WIDTH_MIN = 320;
const WIDTH_STEP = 16;
/** At most what leaves the 220px sidebar and a 560px screen beside it, never below the default. */
const clampWidth = (width: number) =>
  Math.round(
    Math.min(Math.max(WIDTH_DEFAULT, window.innerWidth - 780), Math.max(WIDTH_MIN, width)),
  );
function recall(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function remember(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable; the choice still holds while the panel is open.
  }
}

/** The built-in assistant: one conversation per Entity, plus the Entity's pending changes. */
export function AgentPanel(p: AgentPanelProps) {
  const [width, setWidth] = useState(() => clampWidth(Number(recall(WIDTH_KEY)) || WIDTH_DEFAULT));
  const [full, setFull] = useState(() => recall(FULL_KEY) === "true");
  const drag = useRef<{ x: number; width: number } | null>(null);
  const resize = (next: number) => {
    const clamped = clampWidth(next);
    setWidth(clamped);
    remember(WIDTH_KEY, String(clamped));
  };
  const toggleFull = () => {
    setFull(!full);
    remember(FULL_KEY, String(!full));
  };
  const [settings, setSettings] = useState<AgentSettings | null>(null);
  const [loadError, setLoadError] = useState("");
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [pending, setPending] = useState<PendingChange[]>([]);
  const [tab, setTab] = useState<Tab>("chat");
  const [text, setText] = useState("");
  const [images, setImages] = useState<File[]>([]);
  const thumbs = useMemo(() => images.map((file) => URL.createObjectURL(file)), [images]);
  useEffect(
    () => () => {
      for (const url of thumbs) URL.revokeObjectURL(url);
    },
    [thumbs],
  );
  const [live, setLive] = useState<Turn | null>(null);
  const [ended, setEnded] = useState<Turn | null>(null);
  const [announce, setAnnounce] = useState("");
  const [below, setBelow] = useState(false);
  /** Whether the log keeps up with new text; reading earlier text turns it off. */
  const follow = useRef(true);
  /** The question the latest turn answers: the log never scrolls it out of view on its own. */
  const anchor = useRef<string | null>(null);
  const [error, setError] = useState("");
  /** Owner edits to drafted cards, kept here so Apply all sends them too. */
  const [edits, setEdits] = useState<Record<UUID, Record<string, unknown>>>({});
  const [confirming, setConfirming] = useState(false);
  /** The last Apply all: what it did, and the change it stopped at. */
  const [outcome, setOutcome] = useState<{
    note: string;
    failed: UUID | null;
    message: string;
  } | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Edits and outcomes belong to one Entity.
  useEffect(() => {
    setEdits({});
    setConfirming(false);
    setOutcome(null);
  }, [p.entity.id]);
  const [reload, setReload] = useState(0);
  const abort = useRef<AbortController | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  const [list, setList] = useState<ConversationSummary[]>([]);
  /** The open conversation: null is a new one, undefined the latest until loaded. */
  const [current, setCurrent] = useState<UUID | null | undefined>(undefined);
  const currentRef = useRef(current);
  const choose = (id: UUID | null) => {
    currentRef.current = id;
    setCurrent(id);
  };
  /** The history, pending changes and the open conversation, which falls back to a new one
   * when it was archived or expired meanwhile. */
  const loadConversation = async (id = currentRef.current) => {
    const [summaries, changes] = await Promise.all([
      agent.conversations(p.entity.id),
      agent.pending(p.entity.id),
    ]);
    const wanted = id === undefined ? summaries[0]?.id : id;
    const chosen = summaries.some((c) => c.id === wanted) ? (wanted as UUID) : null;
    const conversation = chosen ? await agent.conversation(p.entity.id, chosen) : [];
    return { summaries, changes, chosen, conversation };
  };
  const show = (loaded: Awaited<ReturnType<typeof loadConversation>>) => {
    setList(loaded.summaries);
    setPending(loaded.changes);
    choose(loaded.chosen);
    setMessages(loaded.conversation);
  };
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
        const loaded = await loadConversation();
        if (disposed) return;
        show(loaded);
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
  const reportStreaming = useRef(p.streaming);
  reportStreaming.current = p.streaming;
  useEffect(() => {
    reportStreaming.current?.(live !== null);
  }, [live]);
  useEffect(() => () => reportStreaming.current?.(false), []);
  /** Where following stops: the end, or the latest question at the top once the reply outgrows the log. */
  const target = () => {
    const el = log.current;
    if (!el) return 0;
    const end = el.scrollHeight - el.clientHeight;
    const question =
      anchor.current === null
        ? null
        : el.querySelector<HTMLElement>(`[data-turn="${anchor.current}"]`);
    return question ? Math.min(end, question.offsetTop - 8) : end;
  };
  const measure = () => {
    const el = log.current;
    if (el) setBelow(el.scrollHeight - el.clientHeight - el.scrollTop > NEAR);
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: Follow whenever the transcript changes.
  useLayoutEffect(() => {
    const el = log.current;
    if (el && follow.current) el.scrollTop = target();
    measure();
  }, [messages, live, ended, tab]);
  const toLatest = () => {
    anchor.current = null;
    follow.current = true;
    // Instant: a smooth scroll would land short of a reply that keeps growing meanwhile.
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  };
  // Only with a mouse: on a phone, focusing opens the keyboard, and iOS scrolls or
  // zooms the full-screen sheet until its header and close button are off-screen.
  useEffect(() => {
    if (window.matchMedia?.("(pointer: fine)").matches) input.current?.focus();
  }, []);

  async function send(content = text.trim(), attached = images) {
    if ((!content && !images.length && !attached.length) || live) return;
    const local = `local-${Date.now()}`;
    setError("");
    setText("");
    setImages([]);
    setEnded(null);
    setTab("chat");
    anchor.current = String(messages.length);
    follow.current = true;
    setMessages((m) => [
      ...m,
      {
        id: local,
        role: "owner",
        content,
        image_count: attached.length,
        pending_change_ids: [],
        created_at: new Date().toISOString(),
      },
    ]);
    const turn: Turn = { content, image_count: attached.length, parts: [] };
    const update = (parts: Part[]) => {
      turn.parts = parts;
      setLive({ ...turn });
    };
    setLive({ ...turn });
    setAnnounce("The assistant is replying.");
    const controller = new AbortController();
    abort.current = controller;
    const handlers = {
      onDelta: (delta: string) => {
        const last = turn.parts[turn.parts.length - 1];
        update(
          last?.kind === "text"
            ? [...turn.parts.slice(0, -1), { kind: "text", text: last.text + delta }]
            : [...turn.parts, { kind: "text", text: delta }],
        );
      },
      onTool: (line: ToolLine) => {
        const at = turn.parts.findIndex(
          (part) =>
            part.kind === "tool" && part.line.name === line.name && part.line.status === "started",
        );
        update(
          at >= 0 && line.status !== "started"
            ? turn.parts.map((part, i) => (i === at ? { kind: "tool", line } : part))
            : [...turn.parts, { kind: "tool", line }],
        );
      },
      onPendingChange: (change: PendingChange) =>
        update([...turn.parts, { kind: "change", change }]),
    };
    const input = {
      conversation: currentRef.current ?? null,
      content,
      images: attached,
      screen: p.screen,
      month: `${p.month}-01`,
    };
    let done: StreamDone | null = null;
    try {
      try {
        done = await streamReply(
          await p.credentials(),
          p.entity.id,
          input,
          handlers,
          controller.signal,
        );
      } catch (issue) {
        if (!(issue instanceof ApiError) || issue.kind !== "unauthenticated") throw issue;
        done = await streamReply(
          await p.credentials(true),
          p.entity.id,
          input,
          handlers,
          controller.signal,
        );
      }
      setAnnounce("The reply finished.");
    } catch (issue) {
      // Nothing is stored for a stopped or failed turn: keep what arrived, and put the
      // question back in the box so it can be sent again or reworded.
      const stopped = controller.signal.aborted;
      const note = stopped
        ? "Stopped. Your question is back in the box."
        : issue instanceof Error && issue.message
          ? issue.message
          : "The reply did not come through.";
      setMessages((m) => m.filter((message) => message.id !== local));
      setEnded({ ...turn, ended: { note, retry: !stopped } });
      anchor.current = "ended";
      setText(content);
      setImages(attached);
      setAnnounce(stopped ? "Stopped." : note);
    } finally {
      abort.current = null;
      // The reply stays on screen until the stored copy replaces it, so nothing flashes away.
      try {
        // A new conversation exists once its first turn is stored.
        show(await loadConversation(done?.conversation_id ?? currentRef.current));
      } catch {
        // The next reload shows it.
      }
      setLive(null);
      // Only a tool that can change something reloads the screens; a read-only answer leaves
      // them as they are instead of flashing them.
      if (
        turn.parts.some(
          (part) => part.kind !== "text" && !(part.kind === "tool" && LOOKS_AT[part.line.name]),
        )
      )
        p.changed();
    }
  }

  /** Starts an empty conversation; the current one stays in History. */
  function startNew() {
    if (live) return;
    choose(null);
    setMessages([]);
    setEnded(null);
    setError("");
    setTab("chat");
    input.current?.focus();
  }
  function reopen(id: UUID) {
    if (live) return;
    choose(id);
    setEnded(null);
    setError("");
    anchor.current = null;
    follow.current = true;
    setTab("chat");
    setReload((x) => x + 1);
  }
  /** Hides a conversation from History; its messages stay until retention removes them. */
  async function archive(id: UUID) {
    try {
      await agent.archive(await p.credentials(), p.entity.id, id);
      setList((all) => all.filter((c) => c.id !== id));
      if (currentRef.current === id) {
        choose(null);
        setMessages([]);
        setEnded(null);
      }
      setAnnounce("Conversation archived.");
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "The conversation was not archived.");
    }
  }

  /** Applies changes with the owner's edits. The server applies them oldest first and stops at
   * the first rejection, which comes back as that change's result rather than a failed save:
   * a stale draft can never succeed on retry, so it is shown on its card to dismiss. */
  function applyChanges(changes: PendingChange[], edited: Record<UUID, Record<string, unknown>>) {
    setConfirming(false);
    setOutcome(null);
    p.save<ApplyAllResult>(
      {
        method: "POST",
        path: agent.applyAllPath(p.entity.id),
        body: { changes: changes.map((c) => ({ id: c.id, input: edited[c.id] ?? null })) },
      },
      ({ results }) => {
        const applied = results.filter((r) => r.status === "applied").length;
        const failed = results.find((r) => r.status === "failed");
        const message = failed?.error?.message ?? "It was not applied.";
        const summary = changes.find((c) => c.id === failed?.id)?.summary ?? "";
        const note =
          results.length === 1
            ? failed
              ? `“${summary}” was not applied: ${message}`
              : `Applied “${changes[0].summary}”.`
            : failed
              ? `Applied ${applied} of ${results.length}. Stopped at “${summary}”: ${message} It and the ones after it are still pending.`
              : `Applied all ${applied} changes.`;
        setOutcome({ note, failed: failed?.id ?? null, message: failed ? message : "" });
        setAnnounce(note);
        setReload((x) => x + 1);
      },
    );
  }
  async function dismiss(change: PendingChange) {
    try {
      await agent.dismiss(await p.credentials(), p.entity.id, change);
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Not dismissed.");
    }
    setReload((x) => x + 1);
    p.changed();
  }

  const open = new Map(pending.map((c) => [c.id, c]));
  const cards = (ids: UUID[]) =>
    ids
      .map((id) => open.get(id))
      .filter((c): c is PendingChange => Boolean(c))
      .map((c) => (
        <PendingCard
          key={c.id}
          change={c}
          canApply
          entityName={p.entity.name}
          disabled={p.busy}
          edited={edits[c.id] ?? null}
          edit={(values) => setEdits((all) => ({ ...all, [c.id]: values }))}
          problem={outcome?.failed === c.id ? outcome.message : ""}
          apply={(edited) => applyChanges([c], edited ? { [c.id]: edited } : {})}
          dismiss={() => void dismiss(c)}
        />
      ));

  /** A turn's parts in order; drafts are full cards, usable once the turn has ended. */
  const parts = (list: Part[], streaming: boolean) =>
    list.map((part, i) => {
      // biome-ignore lint/suspicious/noArrayIndexKey: A turn's parts only append.
      if (part.kind === "text") return <Markdown key={`t${i}`} text={part.text} />;
      if (part.kind === "tool")
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: A turn's parts only append.
          <small key={`u${i}`} className={`agent-tool ${part.line.status}`}>
            {toolText(part.line)}
          </small>
        );
      if (!streaming && open.has(part.change.id)) return cards([part.change.id]);
      return (
        <PendingCard
          key={part.change.id}
          change={part.change}
          canApply
          entityName={p.entity.name}
          disabled
          edited={null}
          edit={() => {}}
          problem=""
          apply={() => {}}
          dismiss={() => {}}
        />
      );
    });

  return (
    <aside
      className={full ? "agent full" : "agent"}
      onKeyDown={(event) => {
        if (event.key === "Escape" && live) {
          event.preventDefault();
          abort.current?.abort();
        }
      }}
      aria-label="Assistant"
      style={{ "--agent-width": `${width}px` } as CSSProperties}
    >
      <div
        className="agent-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize assistant"
        aria-valuenow={width}
        aria-valuemin={WIDTH_MIN}
        aria-valuemax={clampWidth(Number.POSITIVE_INFINITY)}
        tabIndex={0}
        title="Drag to resize; double-click to reset"
        onPointerDown={(event) => {
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { x: event.clientX, width };
        }}
        onPointerMove={(event) => {
          // The handle is on the panel's left edge: moving left widens it.
          if (drag.current) resize(drag.current.width + drag.current.x - event.clientX);
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onDoubleClick={() => resize(WIDTH_DEFAULT)}
        onKeyDown={(event) => {
          const next = {
            ArrowLeft: width + WIDTH_STEP,
            ArrowRight: width - WIDTH_STEP,
            Home: WIDTH_MIN,
            End: Number.POSITIVE_INFINITY,
          }[event.key];
          if (next === undefined) return;
          event.preventDefault();
          resize(next);
        }}
      />
      <header className="agent-h">
        {/* Title and Entity stack, so the actions keep one uncrowded row. */}
        <div className="agent-title">
          <b>Assistant</b>
          <span className="agent-entity" title="This conversation is limited to this Entity">
            {p.entity.name}
          </span>
        </div>
        <span className="spacer" />
        {settings?.enabled && (
          <button
            type="button"
            className="icon-btn"
            aria-label="History"
            title="Earlier conversations"
            aria-pressed={tab === "history"}
            onClick={() => setTab(tab === "history" ? "chat" : "history")}
          >
            <Icon name="history" />
          </button>
        )}
        {settings?.enabled && (
          <button
            type="button"
            className="icon-btn"
            aria-label="New conversation"
            title="New conversation"
            disabled={live !== null}
            onClick={() => void startNew()}
          >
            <Icon name="plus" />
          </button>
        )}
        <button
          type="button"
          className="icon-btn agent-full-btn"
          aria-label="Full screen"
          aria-pressed={full}
          title={full ? "Return to the side panel" : "Fill the screen"}
          onClick={toggleFull}
        >
          <Icon name={full ? "shrink" : "expand"} />
        </button>
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
          <div className="agent-bar">
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
                Pending changes
                {pending.length > 0 && (
                  <>
                    {" "}
                    <small className="agent-count">{pending.length}</small>
                  </>
                )}
              </button>
            </div>
            <span className={`agent-mode ${settings.mode}`}>
              <span className="sr-only">Agent mode: </span>
              {AGENT_MODES[settings.mode].label}
            </span>
          </div>
          {tab === "history" ? (
            <div className="agent-log agent-history">
              {list.length === 0 && (
                <p className="note">No conversations yet. Archived ones are not listed.</p>
              )}
              {list.map((c) => (
                <div key={c.id} className="agent-conv">
                  <button
                    type="button"
                    className="agent-conv-open"
                    aria-current={c.id === current ? "true" : undefined}
                    disabled={Boolean(live)}
                    onClick={() => reopen(c.id)}
                  >
                    <span className="agent-conv-title">{c.title}</span>
                    <small className="note">
                      {WHEN.format(new Date(c.updated_at))} · {c.message_count} messages
                    </small>
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Archive "${c.title}"`}
                    title="Archive: hide it from History"
                    disabled={Boolean(live) && c.id === current}
                    onClick={() => void archive(c.id)}
                  >
                    <Icon name="archive" />
                  </button>
                </div>
              ))}
            </div>
          ) : tab === "pending" ? (
            <div className="agent-log">
              {pending.length === 0 && <p className="note">No pending changes.</p>}
              {pending.length > 1 &&
                (confirming ? (
                  <div className="agent-apply-all card pad">
                    <p>
                      Apply all {pending.length} changes to <b>{p.entity.name}</b>? They apply
                      oldest first and stop at the first one that can't be applied.
                    </p>
                    <div className="agent-actions">
                      <button
                        type="button"
                        className="btn pri sm"
                        disabled={p.busy}
                        onClick={() => applyChanges(pending, edits)}
                      >
                        Apply {pending.length} changes
                      </button>
                      <button
                        type="button"
                        className="btn quiet sm"
                        onClick={() => setConfirming(false)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="agent-apply-all">
                    <button
                      type="button"
                      className="btn sm"
                      disabled={p.busy}
                      onClick={() => setConfirming(true)}
                    >
                      Apply all
                    </button>
                  </div>
                ))}
              {outcome &&
                (outcome.failed ? (
                  <div className="banner bad" role="alert">
                    <span>{outcome.note}</span>
                  </div>
                ) : (
                  // biome-ignore lint/a11y/useSemanticElements: An <output> here would read as a result.
                  <p className="note" role="status">
                    {outcome.note}
                  </p>
                ))}
              {pending.map((c) => (
                <PendingCard
                  key={c.id}
                  change={c}
                  canApply
                  entityName={p.entity.name}
                  disabled={p.busy}
                  edited={edits[c.id] ?? null}
                  edit={(values) => setEdits((all) => ({ ...all, [c.id]: values }))}
                  problem={outcome?.failed === c.id ? outcome.message : ""}
                  apply={(edited) => applyChanges([c], edited ? { [c.id]: edited } : {})}
                  dismiss={() => void dismiss(c)}
                />
              ))}
            </div>
          ) : (
            <div className="agent-logwrap">
              <div
                className="agent-log"
                ref={log}
                aria-busy={Boolean(live)}
                // Scrolling up is felt before its scroll event arrives, so stop following at once:
                // otherwise the next words of the reply pull the log back down.
                onWheel={(event) => {
                  if (event.deltaY < 0) follow.current = false;
                }}
                onTouchMove={() => {
                  follow.current = false;
                }}
                onKeyDown={(event) => {
                  if (["ArrowUp", "PageUp", "Home"].includes(event.key)) follow.current = false;
                }}
                onScroll={() => {
                  const el = log.current;
                  if (!el) return;
                  // Reading past the question frees the log to follow to the end.
                  if (el.scrollTop > target() + NEAR / 2) anchor.current = null;
                  follow.current = el.scrollTop >= target() - NEAR / 2;
                  measure();
                }}
              >
                {messages.length === 0 && !live && !ended && (
                  <>
                    <p className="note">
                      {settings.mode === "read_only"
                        ? "Ask about your finances. Read only: I can read but not change anything."
                        : settings.mode === "ask_first"
                          ? "Ask about your finances, or ask me to categorize the inbox. Ask first: changes I draft wait for you as cards; nothing is recorded until you apply it."
                          : "Ask about your finances, or ask me to categorize the inbox. Apply directly: I record changes myself; deletes that cannot be restored still wait for you."}
                    </p>
                    {/* Read only refuses the AGENT.md proposal, so the interview is hidden. */}
                    {settings.mode !== "read_only" && (
                      <div className="agent-interview card pad">
                        <b>Teach the assistant your conventions</b>
                        <small className="note">
                          I ask one question at a time, then propose AGENT.md for you to approve. An
                          existing AGENT.md is updated, not replaced.
                        </small>
                        <button
                          type="button"
                          className="btn sm"
                          disabled={p.busy}
                          onClick={() => void send(INTERVIEW_PROMPT, [])}
                        >
                          Interview me for AGENT.md
                        </button>
                      </div>
                    )}
                  </>
                )}
                {messages.map((m, i) => (
                  <div
                    key={m.id}
                    className={`agent-msg ${m.role === "owner" ? "owner" : "reply"}`}
                    data-turn={m.role === "owner" ? String(i) : undefined}
                  >
                    {m.role === "owner" ? <p>{m.content}</p> : <Markdown text={m.content} />}
                    {m.image_count > 0 && (
                      <small className="note">{m.image_count} image(s) sent, not kept</small>
                    )}
                    {cards(m.pending_change_ids)}
                  </div>
                ))}
                {ended && (
                  <>
                    <div className="agent-msg owner" data-turn="ended">
                      <p>{ended.content}</p>
                      {ended.image_count > 0 && (
                        <small className="note">{ended.image_count} image(s) attached</small>
                      )}
                    </div>
                    <div className="agent-msg reply">
                      {parts(ended.parts, false)}
                      <div className="agent-ended" role={ended.ended?.retry ? "alert" : undefined}>
                        <small className={ended.ended?.retry ? "bad" : "note"}>
                          {ended.ended?.note}
                        </small>
                        {ended.ended?.retry && (
                          <button
                            type="button"
                            className="btn sm"
                            disabled={Boolean(live)}
                            onClick={() => void send(ended.content, images)}
                          >
                            Retry
                          </button>
                        )}
                      </div>
                    </div>
                  </>
                )}
                {live && (
                  <div className="agent-msg reply">
                    {parts(live.parts, true)}
                    {thinking(live.parts) && <span className="note agent-thinking">Thinking…</span>}
                  </div>
                )}
              </div>
              {below && (
                <button type="button" className="btn sm agent-latest" onClick={toLatest}>
                  <Icon name="down" />
                  {live ? "Reply continues" : "Latest"}
                </button>
              )}
              {/* biome-ignore lint/a11y/useSemanticElements: An <output> here would read as a result. */}
              <p className="sr-only" role="status">
                {announce}
              </p>
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
              aria-keyshortcuts="ArrowUp"
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
                } else if (event.key === "ArrowUp" && !text && !live) {
                  // Up in an empty box brings back the last question to edit and send again.
                  const last = [...messages].reverse().find((m) => m.role === "owner");
                  if (last) {
                    event.preventDefault();
                    setText(last.content);
                  }
                }
              }}
            />
            <div className="agent-compose-bar">
              <label className="icon-btn agent-attach" title="Attach receipt images">
                <Icon name="clip" />
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  aria-label="Attach receipt images"
                  disabled={Boolean(live)}
                  onChange={(event) => {
                    const files = [...images, ...(event.target.files ?? [])];
                    event.target.value = "";
                    if (files.length > 4) return setError("Attach at most 4 images.");
                    if (files.some((f) => f.size > 5 * 1024 * 1024))
                      return setError("Each image must be 5 MB or smaller.");
                    setError("");
                    setImages(files);
                  }}
                />
              </label>
              {images.map((file, i) => (
                <span key={thumbs[i]} className="agent-thumb">
                  <img src={thumbs[i]} alt={file.name} />
                  <button
                    type="button"
                    className="x"
                    aria-label={`Remove ${file.name}`}
                    disabled={Boolean(live)}
                    onClick={() => setImages(images.filter((_, j) => j !== i))}
                  >
                    ×
                  </button>
                </span>
              ))}
              <small className="agent-hint">
                {text.length > 3600
                  ? `${4000 - text.length} characters left`
                  : "Enter to send · Shift+Enter for a new line"}
              </small>
              {live ? (
                <button
                  type="button"
                  className="icon-btn agent-send"
                  aria-label="Stop"
                  title="Stop (Esc)"
                  aria-keyshortcuts="Escape"
                  onClick={() => abort.current?.abort()}
                >
                  <Icon name="stop" />
                </button>
              ) : (
                <button
                  type="submit"
                  className="icon-btn agent-send"
                  aria-label="Send"
                  title="Send (Enter)"
                  disabled={!text.trim() && !images.length}
                >
                  <Icon name="send" />
                </button>
              )}
            </div>
          </form>
        </>
      )}
    </aside>
  );
}

const ACTIVITY_FIELDS = ["date", "category", "amount", "note"] as const;
const UUID_TEXT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONEY_KEY = /(amount|target|total|balance)$/;
const KIND: Record<string, string> = { finite: "Finite, with a target", ongoing: "Ongoing" };
/** "account_id" reads "account", "tag_ids" reads "tags", "opening_amount" reads "opening amount". */
const fieldName = (key: string) =>
  key.replace(/_ids$/, "s").replace(/_id$/, "").split("_").join(" ");

/**
 * A drafted input as rows a person can check: nested values inline, ids as the current names of
 * the records they point to, money and goal kinds as the Savings screen shows them, and the
 * revision checks that only guard against stale writes left out.
 */
export function inputRows(
  input: Record<string, unknown>,
  labels: Record<string, string> = {},
): [string, string][] {
  const shown = (key: string, value: unknown): string => {
    if (Array.isArray(value)) return value.map((v) => shown(key, v)).join(", ");
    if (typeof value === "boolean") return value ? "Yes" : "No";
    if (typeof value === "string") {
      if (UUID_TEXT.test(value)) return labels[value.toLowerCase()] ?? "An existing record";
      if (key === "kind" && KIND[value]) return KIND[value];
      if (MONEY_KEY.test(key)) return formatMoney(value);
    }
    return plain(value);
  };
  return Object.entries(input).flatMap(([key, value]): [string, string][] => {
    if (key.startsWith("expected_") || key === "_draft" || value == null) return [];
    if (value && typeof value === "object" && !Array.isArray(value) && !("untrusted" in value))
      return inputRows(value as Record<string, unknown>, labels);
    return [[fieldName(key), shown(key, value)]];
  });
}

/** A drafted change. save_activity drafts are editable before applying. */
export function PendingCard({
  change,
  canApply,
  entityName,
  disabled,
  edited,
  edit,
  problem,
  apply,
  dismiss,
}: {
  change: PendingChange;
  canApply: boolean;
  /** The Entity the change is for: a card never applies anywhere else. */
  entityName: string;
  disabled: boolean;
  /** The owner's edits to the drafted input, or null when unedited. */
  edited: Record<string, unknown> | null;
  edit: (values: Record<string, unknown>) => void;
  /** Why Apply all stopped at this change, if it did. */
  problem: string;
  apply: (edited?: Record<string, unknown>) => void;
  dismiss: () => void;
}) {
  const { _draft, ...input } = change.input as Record<string, unknown> & {
    _draft?: { uncertain_fields?: string[]; source_text?: string };
  };
  const values = edited ?? input;
  const editable = change.tool === "save_activity" && !input.id;
  const uncertain = new Set(_draft?.uncertain_fields ?? []);
  return (
    <div className="agent-card card pad" data-pending={change.id}>
      <b>{change.summary}</b>
      <small className="note">
        For {entityName} · Drafted by{" "}
        {change.created_by_interface === "mcp" ? "an MCP client" : "the assistant"} ·{" "}
        {TOOL_LABEL(change.tool)}
      </small>
      {change.tool === "propose_agent_instructions" ? (
        <div className="agent-md-draft">
          <Markdown text={plain(input.instructions)} />
          <small className="note">
            Replaces AGENT.md as of revision {plain(input.expected_revision)}.
          </small>
        </div>
      ) : editable ? (
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
                  onChange={(e) => edit({ ...values, [field]: e.target.value })}
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
                  onChange={(e) => edit({ ...values, [field]: e.target.value })}
                />
              )}
            </label>
          ))}
        </div>
      ) : (
        <dl className="agent-input">
          {inputRows(input, change.labels).map(([key, value], i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: Nested inputs may repeat a field name.
            <div key={i}>
              <dt>{key}</dt>
              <dd>{value}</dd>
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
      {problem && (
        <p className="agent-problem bad" role="alert">
          Not applied: {problem}
        </p>
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
