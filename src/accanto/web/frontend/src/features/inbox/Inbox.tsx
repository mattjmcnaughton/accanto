import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, type BrowserSession, type LoadState } from "../../lib/api";
import { destinations } from "../../lib/destinations";
import { decimalToCents, fmtDay, fmtMonth, fmtShort, formatMoney, money } from "../../lib/format";
import {
  type Completion,
  type InboxCategory,
  type InboxWrite,
  type ProposalRun,
  type StagedTransaction,
  inbox,
  send,
} from "../../lib/inbox";
import { monthly } from "../../lib/monthly";
import { savings } from "../../lib/savings";
import { spendingSubcategories } from "../../lib/spendingSubcategories";
import { tags } from "../../lib/tags";
import { tint } from "../../ui";
import { LoadProblem, LoadingCard } from "../workspace/Activity";
import { type ScreenProps, keysBelongElsewhere, sourceChoices, useLoad } from "../workspace/shared";
import {
  CATEGORIES,
  CATEGORY,
  type Choices,
  type Option,
  SKIP_REASONS,
  type View,
  cents,
  effective,
  fundingName,
  isInflow,
  isReadyToAssign,
  lineName,
  precheck,
  purchaseLabel,
  readable,
  refundCandidates,
  rows,
  summary,
  waitingLabel,
} from "./inboxModel";
import "./inbox.css";
import { ConnectSource } from "./ConnectSource";

type Picker = {
  kind: "line" | "funding" | "refund" | "resolve" | "tag";
  title: string;
  placeholder: string;
  options: Option[];
  foot?: string;
  none?: string;
  ranked?: boolean;
  query: string;
  at: number;
  /** The selected items a batch choice applies to; otherwise the current item. */
  ids?: string[];
};
type Outcome = { item_id: string; ok: boolean; item?: unknown; error?: { message: string } };
type Toast = { text: string; tone?: "warn" | "bad"; undo?: boolean };
type Undo = Array<{ id: string; action: "undo" | "unskip" | "skip" | "later" }>;
/**
 * Flow mode: one waiting item at a time. `queue` holds the pass's item ids in order; items
 * leave it when they stop waiting, and Later moves one to the end without saving anything.
 */
type Flow = { ids: string[]; queue: string[]; later: string[]; editing: boolean };
const RUN_ERRORS: Record<string, string> = {
  agent_disabled: "the assistant is turned off in Settings.",
  read_only: "the Agent mode is Read only.",
  invalid_credential: "the sign-in that started it ended. Start it again.",
  agent_unavailable: "the assistant is not configured.",
  upstream_error: "the model did not answer. Start it again.",
  step_timeout: "a step took too long. Start it again.",
};
const isItem = (x: unknown): x is StagedTransaction =>
  typeof x === "object" && x !== null && "id" in x && "revision" in x && "status" in x;
const VIEWS: View[] = ["waiting", "skipped", "recorded"];
/** The `skipped` status is shown as Ignored: it lasts across re-syncs. */
const VIEW_NAMES: Record<View, string> = {
  waiting: "Waiting",
  skipped: "Ignored",
  recorded: "Recorded",
};
const INTERFACES: Record<string, string> = {
  direct_api: "API key",
  browser: "you, in the browser",
  mcp: "MCP",
};
const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  Boolean(target.closest("input,textarea,select,[contenteditable]"));
const Key = ({ k }: { k: string }) => <kbd className="kbd">{k}</kbd>;
const signed = (it: StagedTransaction) => `${isInflow(it) ? "+" : ""}${money(Math.abs(cents(it)))}`;
/** Keep showing the last loaded data while a reload after a write is in flight. */
function useSettled<T>(state: LoadState<T>): LoadState<T> {
  const last = useRef<LoadState<T>>(state);
  if (state.kind !== "loading") last.current = state;
  return last.current;
}

/**
 * The Transactions inbox: staged transactions from a source, recorded or ignored from the keyboard.
 * Every write is an explicit inbox command; the server re-runs every check when recording.
 */
export function Inbox(
  p: ScreenProps & {
    credentials: (signIn?: boolean) => Promise<BrowserSession>;
    changed?: () => void;
    openSettings?: () => void;
    /** A one-shot request to start flow mode, from the Ask bar's /inbox; a new value asks again. */
    flow?: number;
    flowStarted?: () => void;
  },
) {
  const [reload, setReload] = useState(0);
  const deps = [p.entity.id, p.refresh, reload];
  // Proposals and keyboard pickers need their options as soon as the rows arrive.
  const enabled = !p.concealed;
  const items = useSettled(useLoad(() => inbox.list(p.entity.id), deps, { enabled }));
  const sources = useSettled(useLoad(() => inbox.sources(p.entity.id), deps, { enabled }));
  const plans = useSettled(
    useLoad(() => monthly.plans(p.entity.id), deps, { enabled, share: "plans" }),
  );
  const accounts = useSettled(
    useLoad(() => savings.list(p.entity.id), deps, { enabled, share: "savings" }),
  );
  const activity = useSettled(
    useLoad(() => monthly.activity(p.entity.id), deps, { enabled, share: "activity" }),
  );
  const investments = useSettled(
    useLoad(() => destinations.list(p.entity.id, "investment"), deps, {
      enabled,
      share: "investments",
    }),
  );
  const recipients = useSettled(
    useLoad(() => destinations.list(p.entity.id, "giving"), deps, { enabled, share: "giving" }),
  );
  const tagState = useSettled(
    useLoad(() => tags.list(p.entity.id), deps, { enabled, share: "tags" }),
  );
  const subcategoryState = useSettled(
    useLoad(() => spendingSubcategories.list(p.entity.id), deps, {
      enabled,
      share: "spending-subcategories",
    }),
  );
  const [view, setView] = useState<View>("waiting");
  /** Show only items that carry a proposal; the views and their counts follow it. */
  const [proposedOnly, setProposedOnly] = useState(false);
  const [cur, setCur] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** The last checkbox toggled; a shift-click selects the rows between it and the click. */
  const anchor = useRef<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Completion>>({});
  const [hints, setHints] = useState<Record<string, string>>({});
  const [picker, setPicker] = useState<Picker | null>(null);
  const [help, setHelp] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [busy, setBusy] = useState(false);
  /** The source being synced, so the inbox can say so while YNAB is read. */
  const [syncing, setSyncing] = useState<string | null>(null);
  const undo = useRef<Undo[]>([]);
  const list = useRef<HTMLDivElement>(null);
  /** Items returned by this screen's writes, newer than the last load. */
  const [patched, setPatched] = useState<Record<string, StagedTransaction>>({});
  const [flow, setFlow] = useState<Flow | null>(null);
  /** In flow, writes patch the list instead of reloading every screen read (§9). */
  const quiet = useRef(false);
  quiet.current = Boolean(flow);
  const [proposals, setProposals] = useState<ProposalRun | null>(null);
  const proposing = Boolean(proposals?.run && ["queued", "running"].includes(proposals.run.state));

  const all = (items.kind === "ready" ? items.data : []).map((i) => {
    const newer = patched[i.id];
    return newer && newer.revision > i.revision ? newer : i;
  });
  const choices: Choices = useMemo(() => {
    const unassigned = (name: string): Option => ({
      id: "unassigned",
      name: `Unassigned ${name}`,
      note: "Counts in the category total; assign it later",
    });
    const fixed =
      plans.kind === "ready"
        ? [
            ...new Map(
              plans.data.flatMap((plan) =>
                plan.revisions.flatMap((r) =>
                  r.fixed_costs.map((c) => [c.fixed_cost_id, c] as const),
                ),
              ),
            ).values(),
          ]
        : [];
    const goals =
      accounts.kind === "ready"
        ? accounts.data.flatMap((a) =>
            a.goals
              .filter((g) => g.active)
              .map((g) => ({
                id: g.uuid,
                name: `${a.name} · ${g.name}`,
                saved: decimalToCents(g.remaining_saved) ?? 0,
                note: `${formatMoney(g.remaining_saved)} saved`,
              })),
          )
        : [];
    const destination = (state: typeof investments) =>
      state.kind === "ready"
        ? state.data.filter((d) => d.active).map((d) => ({ id: d.uuid, name: d.name }))
        : [];
    return {
      lines: {
        income: [
          ...(plans.kind === "ready"
            ? sourceChoices(plans.data).map((s) => ({ id: s.id, name: s.label }))
            : []),
          unassigned("income"),
        ],
        fixed_cost: [
          ...fixed.map((c) => ({
            id: c.fixed_cost_id,
            name: c.name,
            note: c.debt_account_name ? `Debt account: ${c.debt_account_name}` : undefined,
          })),
          unassigned("fixed cost"),
        ],
        spending: [
          ...(subcategoryState.kind === "ready"
            ? subcategoryState.data
                .filter((sub) => sub.active)
                .map((sub) => ({ id: sub.uuid, name: sub.name }))
            : []),
          unassigned("guilt-free spending"),
        ],
        saving: goals,
        investing: [...destination(investments), unassigned("investing")],
        giving: [...destination(recipients), unassigned("giving")],
      },
      goals,
      entries: activity.kind === "ready" ? activity.data : [],
      purchases:
        activity.kind === "ready"
          ? activity.data.filter(
              (e) =>
                ["spending", "fixed_cost", "giving"].includes(e.category) &&
                !e.is_adjustment &&
                !e.refund_of &&
                Number(e.amount) > 0,
            )
          : [],
      tags: tagState.kind === "ready" ? tagState.data : [],
    } satisfies Choices;
  }, [plans, accounts, activity, investments, recipients, tagState, subcategoryState]);

  /** What a row shows: the recorded entry once recorded, else the edit or proposal. */
  const shownAs = (it: StagedTransaction): Completion => {
    if (it.status !== "recorded" && it.status !== "conflict") return effective(it, drafts[it.id]);
    const entry = choices.entries.find((e) => e.uuid === it.actual_entry_id);
    return entry?.refund_of
      ? { refund_of: entry.refund_of }
      : {
          category: entry?.category ?? null,
          funding: entry?.funding_goal_id ?? null,
        };
  };
  const scope = proposedOnly ? all.filter((i) => i.proposal) : all;
  const shown = rows(scope, view);
  const ids = shown.flatMap((r) => ("it" in r ? [r.it.id] : []));
  /** Rows with a checkbox: waiting items in the Waiting view, under the current filter. */
  const selectable =
    view === "waiting"
      ? shown.flatMap((r) => ("it" in r && r.it.status === "waiting" ? [r.it.id] : []))
      : [];
  /** The selection a batch acts on: selected items still waiting, in list order. */
  const chosen = selectable.flatMap((id) => {
    const it = selected.has(id) ? all.find((i) => i.id === id) : undefined;
    return it ? [it] : [];
  });
  const waitingIds = new Set(all.filter((i) => i.status === "waiting").map((i) => i.id));
  const queue = flow ? flow.queue.filter((id) => waitingIds.has(id)) : [];
  const passOver = Boolean(flow) && queue.every((id) => flow?.later.includes(id));
  const current = flow
    ? passOver
      ? null
      : (all.find((i) => i.id === queue[0]) ?? null)
    : (all.find((i) => i.id === cur && ids.includes(i.id)) ?? null);
  const visible = ids.join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: The cursor follows the visible rows.
  useEffect(() => {
    if (!cur || !ids.includes(cur)) setCur(ids[0] ?? null);
  }, [visible]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(timer);
  }, [toast]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Scroll when the cursor or view moves.
  useEffect(() => {
    list.current?.querySelector(".ix-row.cur")?.scrollIntoView?.({ block: "nearest" });
  }, [cur, view]);

  const counts = {
    waiting: scope.filter((i) => i.status === "waiting").length,
    skipped: scope.filter((i) => i.status === "skipped").length,
    recorded: scope.filter((i) => i.status === "recorded").length,
  };
  const flowDone = {
    recorded: flow ? flow.ids.filter((id) => statusOf(id) === "recorded").length : 0,
    ignored: flow ? flow.ids.filter((id) => statusOf(id) === "skipped").length : 0,
  };
  function statusOf(id: string) {
    return all.find((i) => i.id === id)?.status;
  }
  const month = (current?.financial_date ?? p.entity.today).slice(0, 7);
  const monthWaiting = all.filter(
    (i) => i.status === "waiting" && i.financial_date.startsWith(month),
  ).length;

  async function run<T>(spec: InboxWrite): Promise<T | null> {
    const key = crypto.randomUUID();
    setBusy(true);
    try {
      let result: T;
      try {
        result = await send<T>(await p.credentials(), spec, key);
      } catch (error) {
        if (!(error instanceof ApiError) || error.kind !== "unauthenticated") throw error;
        result = await send<T>(await p.credentials(true), spec, key);
      }
      // Record and undo return { item }; ignore and return-to-inbox return the item;
      // batch commands return { results: [{ item }] }.
      const out = result as { item?: unknown; results?: Outcome[] } | null;
      const fresh = (out?.results ? out.results.map((r) => r.item) : [out?.item ?? result]).filter(
        isItem,
      );
      if (fresh.length)
        setPatched((x) => ({ ...x, ...Object.fromEntries(fresh.map((i) => [i.id, i])) }));
      return result;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "The inbox could not save. Try again.";
      setToast({ text: `Not saved. ${readable(choices, message)}`, tone: "bad" });
      return null;
    } finally {
      setBusy(false);
      if (!quiet.current) refreshAll();
    }
  }
  function refreshAll() {
    if (p.changed) p.changed();
    else setReload((x) => x + 1);
  }
  /** After an item leaves the view, the cursor lands on the next one still there. */
  const advance = (leaving: string[]) => {
    const at = ids.indexOf(cur ?? "");
    const next =
      ids.slice(at + 1).find((id) => !leaving.includes(id)) ??
      ids
        .slice(0, at)
        .reverse()
        .find((id) => !leaving.includes(id));
    setCur(next ?? null);
  };
  const describe = (it: StagedTransaction, c: Completion) => {
    if (c.refund_of) return `${it.payee} as a refund`;
    const line = lineName(choices, c);
    const goal = choices.goals.find((g) => g.id === c.funding);
    return `${it.payee} as ${CATEGORY[c.category as InboxCategory].name.toLowerCase()}${line ? `, ${line}` : ""}${goal ? `, from ${goal.name}` : ""}`;
  };
  const clearDraft = (id: string) => {
    setDrafts(({ [id]: _, ...rest }) => rest);
    setHints(({ [id]: _, ...rest }) => rest);
  };

  /** Record the current item from its proposal or draft; true when it was saved. */
  async function record(): Promise<boolean> {
    if (!current) return false;
    if (current.status === "conflict") {
      openPicker("resolve", current);
      return false;
    }
    const c = effective(current, drafts[current.id]);
    if (c.skip) return skip(current);
    const reason = precheck(current, c);
    if (reason) {
      setHints((h) => ({ ...h, [current.id]: reason }));
      return false;
    }
    const result = await run<{ item: StagedTransaction }>(
      inbox.record(p.entity.id, current, drafts[current.id]),
    );
    if (!result) return false;
    clearDraft(current.id);
    undo.current.push([{ id: current.id, action: "undo" }]);
    advance([current.id]);
    setToast({ text: `Recorded ${describe(current, c)}.`, undo: true });
    return true;
  }
  /** An outflow whose category takes a funding origin. */
  const fundable = (it: StagedTransaction) => {
    const c = effective(it, drafts[it.id]);
    return (
      !isInflow(it) &&
      !c.refund_of &&
      Boolean(c.category) &&
      !["saving", "income"].includes(c.category ?? "")
    );
  };
  /** Send one batch command; an unsaved request reports every item as not saved. */
  async function many(spec: InboxWrite, its: StagedTransaction[]): Promise<Outcome[]> {
    const result = await run<{ results: Outcome[] }>(spec);
    return result?.results ?? its.map((it) => ({ item_id: it.id, ok: false }));
  }
  /**
   * Batch resolve: record every selected item from its proposal or the batch's choices, and
   * ignore those set to ignore (or all of them), one request each. Items that cannot be saved
   * stay selected with the reason on their row; z returns the saved ones together.
   */
  async function resolveSelected(ignore = false) {
    const ready: StagedTransaction[] = [];
    const skips: StagedTransaction[] = [];
    const reasons: Record<string, string> = {};
    for (const it of chosen) {
      const c = effective(it, drafts[it.id]);
      const reason = ignore ? null : precheck(it, c);
      if (reason) reasons[it.id] = reason;
      else (ignore || c.skip ? skips : ready).push(it);
    }
    const outcomes = [
      ...(ready.length
        ? (
            await many(
              inbox.recordMany(
                p.entity.id,
                ready.map((it) => ({ it, completion: drafts[it.id] })),
              ),
              ready,
            )
          ).map((r) => ({ ...r, action: "undo" as const }))
        : []),
      ...(skips.length
        ? (await many(inbox.actMany(p.entity.id, skips, "skip"), skips)).map((r) => ({
            ...r,
            action: "unskip" as const,
          }))
        : []),
    ];
    const done: Undo = [];
    for (const r of outcomes) {
      if (r.ok) done.push({ id: r.item_id, action: r.action });
      else
        reasons[r.item_id] = r.error
          ? `Not saved. ${readable(choices, r.error.message)}`
          : "Not saved. Try again.";
    }
    for (const { id } of done) clearDraft(id);
    setHints((h) => ({ ...h, ...reasons }));
    const stayed = Object.keys(reasons);
    setSelected(new Set(stayed));
    if (done.length) undo.current.push(done);
    // Land on the first item that stayed, so its reason is in view.
    if (stayed.length) setCur(stayed[0]);
    else advance(done.map((d) => d.id));
    const recorded = done.filter((d) => d.action === "undo").length;
    setToast({
      text: `${[
        recorded && `Recorded ${recorded}`,
        done.length - recorded && `Ignored ${done.length - recorded}`,
        stayed.length &&
          `${stayed.length} stayed selected with the reason on ${stayed.length === 1 ? "its row" : "each row"}`,
      ]
        .filter(Boolean)
        .join(". ")}.`,
      tone: stayed.length ? "warn" : undefined,
      undo: done.length > 0,
    });
  }
  /** Check or uncheck a row; with shift, every row from the last one toggled takes its state. */
  function toggle(id: string, range = false) {
    const from = range && anchor.current ? selectable.indexOf(anchor.current) : -1;
    const to = selectable.indexOf(id);
    const span =
      from >= 0 && to >= 0 ? selectable.slice(Math.min(from, to), Math.max(from, to) + 1) : [id];
    anchor.current = id;
    setSelected((s) => {
      const next = new Set(s);
      const on = !s.has(id);
      for (const x of span) on ? next.add(x) : next.delete(x);
      return next;
    });
  }
  /** Select every waiting row under the current filter, or clear when all are selected. */
  function selectAll() {
    anchor.current = null;
    setSelected(chosen.length === selectable.length ? new Set() : new Set(selectable));
  }
  /** Ignore a waiting item, or return an ignored one; true when it was saved. */
  async function skip(it: StagedTransaction): Promise<boolean> {
    const back = it.status === "skipped";
    if (!(await run(inbox.action(p.entity.id, it, back ? "unskip" : "skip")))) return false;
    undo.current.push([{ id: it.id, action: back ? "skip" : "unskip" }]);
    setSelected((s) => {
      const next = new Set(s);
      next.delete(it.id);
      return next;
    });
    advance([it.id]);
    setToast({
      text: back
        ? `${it.payee} is back in the inbox.`
        : `Ignored ${it.payee}. It stays under Ignored, even after a re-sync.`,
      undo: true,
    });
    return true;
  }
  async function undoLast(): Promise<boolean> {
    const last = undo.current.pop();
    if (!last) {
      setToast({ text: "Nothing to undo.", tone: "warn" });
      return false;
    }
    // Each command needs the item's current revision, which changed with the last action.
    // In flow the list holds it already: every write's response patched it.
    const fresh = flow ? null : await inbox.list(p.entity.id);
    const latest = fresh?.kind === "ready" ? fresh.data : all;
    let done = 0;
    for (const action of ["undo", "unskip", "skip"] as const) {
      const its = last.flatMap((u) => {
        const it = u.action === action ? latest.find((i) => i.id === u.id) : undefined;
        return it ? [it] : [];
      });
      if (its.length === 1) {
        if (await run(inbox.action(p.entity.id, its[0], action))) done++;
      } else if (its.length)
        done += (await many(inbox.actMany(p.entity.id, its, action), its)).filter(
          (r) => r.ok,
        ).length;
    }
    const first = last[0];
    setView(first.action === "skip" ? "skipped" : "waiting");
    setCur(first.id);
    const name =
      last.length > 1
        ? `${last.length} items are`
        : `${all.find((i) => i.id === first.id)?.payee ?? "The item"} is`;
    setToast({
      text:
        done === last.length
          ? first.action === "skip"
            ? `Undone. ${name} ignored again.`
            : `Undone. ${name} back in the inbox${first.action === "undo" ? " and out of the totals" : ""}.`
          : "Undo did not finish. The reason is shown above.",
      tone: done === last.length ? undefined : "bad",
    });
    return done === last.length;
  }

  // Flow mode -------------------------------------------------------------------
  function startFlow() {
    const order = rows(all, "waiting").flatMap((r) =>
      "it" in r && r.it.status === "waiting" ? [r.it.id] : [],
    );
    if (!order.length) return setToast({ text: "Nothing is waiting in the inbox.", tone: "warn" });
    setSelected(new Set());
    setProposedOnly(false);
    setView("waiting");
    setPicker(null);
    setFlow({ ids: order, queue: order, later: [], editing: false });
  }
  const flowAsked = useRef(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Start once the items have loaded.
  useEffect(() => {
    if (!p.flow || p.flow === flowAsked.current || items.kind !== "ready") return;
    flowAsked.current = p.flow;
    startFlow();
    p.flowStarted?.();
  }, [p.flow, items.kind]);
  function endFlow() {
    setFlow(null);
    setPicker(null);
    // One refresh of the other screens' reads for the whole pass.
    refreshAll();
  }
  const editing = (on: boolean) => setFlow((f) => f && { ...f, editing: on });
  /** Enter: accept the proposal; an unsure, incomplete or rejected one opens edit instead. */
  async function accept() {
    if (!current) return;
    const c = effective(current, drafts[current.id]);
    if (!c.skip && !c.category && !c.refund_of) {
      setHints((h) => ({
        ...h,
        [current.id]: current.proposal
          ? "The agent was not sure. Choose a category: 1–6."
          : "No proposal yet. Choose a category: 1–6.",
      }));
      return editing(true);
    }
    if (!(await record())) editing(true);
  }
  function later() {
    if (!current) return;
    const id = current.id;
    undo.current.push([{ id, action: "later" }]);
    setFlow(
      (f) =>
        f && {
          ...f,
          queue: [...f.queue.filter((x) => x !== id), id],
          later: f.later.includes(id) ? f.later : [...f.later, id],
          editing: false,
        },
    );
    setToast({ text: `${current.payee} waits until the end of this pass. Nothing was saved.` });
  }
  /** z in flow: undo the last action, including Later, and return to that item. */
  async function flowUndo() {
    const last = undo.current[undo.current.length - 1];
    const id = last?.[0]?.id;
    const front = (f: Flow | null) =>
      f && id
        ? {
            ...f,
            queue: [id, ...f.queue.filter((x) => x !== id)],
            later: f.later.filter((x) => x !== id),
            editing: false,
          }
        : f;
    if (last?.length === 1 && last[0].action === "later") {
      undo.current.pop();
      setFlow(front);
      return setToast({ text: "Undone. Back on that item." });
    }
    if (await undoLast()) setFlow(front);
  }
  /** Keys while flow is on; false lets an edit key reach the normal handler. */
  function flowKey(key: string): boolean {
    if (!flow) return false;
    if (passOver) {
      if (key === "l" && flow.later.length) setFlow({ ...flow, later: [], editing: false });
      else if (key === "z") void flowUndo();
      else if (key === "Escape") endFlow();
      else if (key === "?") setHelp(true);
      return true;
    }
    if (flow.editing) {
      if (key === "Enter") {
        void record().then((ok) => ok && editing(false));
        return true;
      }
      if (key === "Escape") {
        if (current) setHints(({ [current.id]: _, ...rest }) => rest);
        editing(false);
        return true;
      }
      if (["1", "2", "3", "4", "5", "6", "a", "f", "t", "r"].includes(key)) return false;
    }
    switch (key) {
      case "Enter":
        void accept();
        break;
      case "l":
      case "ArrowRight":
        later();
        break;
      case "s":
        if (current) void skip(current);
        break;
      case "e":
        editing(true);
        break;
      case "z":
        void flowUndo();
        break;
      case "Escape":
        endFlow();
        break;
      case "?":
        setHelp(true);
        break;
    }
    return true;
  }

  // Proposal run ----------------------------------------------------------------
  // biome-ignore lint/correctness/useExhaustiveDependencies: Poll while a run is active.
  useEffect(() => {
    if (p.concealed) return;
    let live = true;
    const poll = async () => {
      const state = await inbox.proposalRun(p.entity.id);
      if (live && state.kind === "ready") setProposals(state.data);
    };
    void poll();
    const timer = proposing ? window.setInterval(poll, 2000) : undefined;
    return () => {
      live = false;
      if (timer) window.clearInterval(timer);
    };
  }, [p.entity.id, p.concealed, p.refresh, proposing]);
  const seen = useRef<number | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Reload the items when proposals arrive.
  useEffect(() => {
    if (!proposals) return;
    if (seen.current !== null && seen.current !== proposals.proposed) setReload((x) => x + 1);
    seen.current = proposals.proposed;
  }, [proposals?.proposed]);
  async function startRun() {
    const started = await run<ProposalRun>(inbox.startRun(p.entity.id));
    if (started) setProposals(started);
  }
  async function stopRun() {
    const stopped = await run<ProposalRun>(inbox.stopRun(p.entity.id));
    if (stopped) setProposals(stopped);
  }

  function setDraft(next: Record<string, Completion>) {
    setDrafts((d) => ({ ...d, ...next }));
    setHints((h) => Object.fromEntries(Object.entries(h).filter(([id]) => !(id in next))));
  }
  /** Set one category on the current item, or on every selected item. */
  function setCategory(its: StagedTransaction[], category: InboxCategory) {
    const batch = chosen.length > 0;
    const next: Record<string, Completion> = {};
    for (const it of its) {
      const c = effective(it, drafts[it.id]);
      if (c.refund_of && !batch)
        return setToast({
          text: "A refund keeps its purchase's category and funding origin. Press r to change or remove the link.",
          tone: "warn",
        });
      next[it.id] =
        c.category === category && !c.refund_of
          ? { ...c, skip: false }
          : {
              category,
              assignment: null,
              funding:
                isInflow(it) || category === "saving" || category === "income" ? null : "income",
              tag_ids: c.refund_of ? [] : c.tag_ids,
            };
    }
    setDraft(next);
    const first = next[its[0].id];
    if (CATEGORY[category].article && its.some((it) => !next[it.id].assignment))
      openPicker("line", its[0], first, batch ? its.map((it) => it.id) : undefined);
  }
  function openPicker(
    kind: Picker["kind"],
    it: StagedTransaction,
    c = effective(it, drafts[it.id]),
    ids?: string[],
  ) {
    const base = { query: "", at: 0, ids };
    const target = ids ? `${ids.length} selected` : it.payee;
    if (kind === "line") {
      const category = CATEGORY[c.category as InboxCategory];
      setPicker({
        ...base,
        kind,
        title: `${category.line} for ${target}`,
        placeholder: `Type to filter ${category.line?.toLowerCase()}s`,
        options:
          c.category === "saving" ? choices.goals : choices.lines[c.category as InboxCategory],
        foot:
          c.category === "saving"
            ? "Saving always names a goal. Unallocated savings is a goal too."
            : undefined,
        none:
          c.category === "spending"
            ? "No subcategories yet. Add them from Activity, Spending subcategories."
            : "Nothing to choose here yet. Add one on its own screen first.",
      });
    } else if (kind === "funding") {
      const targets = ids ? chosen.filter((x) => ids.includes(x.id)) : [it];
      const amount = targets.reduce((sum, x) => sum + Math.abs(cents(x)), 0);
      setPicker({
        ...base,
        kind,
        title: `Funding origin for ${target}, ${money(amount)}`,
        placeholder: "Type to filter funding origins",
        options: [
          { id: "income", name: "Current income", note: "the current-income pool" },
          ...choices.goals.map((g) => ({
            id: g.id,
            name: `Saved money: ${g.name}`,
            note: `${g.note}${g.saved < amount ? ", less than this outflow" : ""}`,
            warn: g.saved < amount,
          })),
        ],
      });
    } else if (kind === "tag") {
      // In a batch, a tag counts as added when every selected item carries it.
      const on = (tag: string) =>
        (ids ? chosen.filter((x) => ids.includes(x.id)) : [it]).every((x) =>
          (effective(x, drafts[x.id]).tag_ids ?? []).includes(tag),
        );
      setPicker({
        ...base,
        kind,
        title: `Tags for ${target}`,
        placeholder: "Type to filter tags",
        options: (choices.tags ?? [])
          .filter((tag) => tag.active || on(tag.uuid))
          .map((tag) => ({
            id: tag.uuid,
            name: tag.name,
            note: on(tag.uuid) ? "added, choose to remove" : undefined,
          })),
        foot: ids
          ? "Choose a tag to add it to every selected item, or to remove it when all carry it."
          : "An entry can carry several tags. Choose one to add or remove it.",
        none: "No tags yet. Create them in Activity with Manage tags.",
      });
    } else if (kind === "refund") {
      const options = refundCandidates(it, choices.purchases);
      if (c.refund_of) options.push({ id: "", name: "Remove the refund link" });
      setPicker({
        ...base,
        kind,
        ranked: true,
        title: `Which purchase does ${signed(it)} from ${it.payee} refund?`,
        placeholder: "Type to filter purchases",
        options,
        foot: "Ranked by same payee, then nearest earlier date. Only purchases with enough left to refund are listed. Nothing links until you choose.",
        none: `No earlier purchase can take this ${signed(it)} refund.`,
      });
    } else {
      setPicker({
        ...base,
        kind,
        title: `${it.payee}, ${money(Math.abs(cents(it)))}: recorded, then changed in YNAB`,
        placeholder: "Type to filter",
        options: [
          { id: "keep", name: "Keep the actual entry", note: "it stays in totals" },
          { id: "delete", name: "Delete the actual entry", note: "normal deletion checks apply" },
        ],
        foot: "Undecided policy (F7): nothing changes until you choose.",
      });
    }
  }
  async function choose(option: Option) {
    const it = current;
    const kind = picker?.kind;
    const ids = picker?.ids;
    setPicker(null);
    const targets = ids ? chosen.filter((x) => ids.includes(x.id)) : it ? [it] : [];
    if (!it || !kind || !targets.length) return;
    const each = (change: (c: Completion) => Completion, only = targets) =>
      setDraft(Object.fromEntries(only.map((x) => [x.id, change(effective(x, drafts[x.id]))])));
    const on = targets.every((x) => effective(x, drafts[x.id]).tag_ids?.includes(option.id));
    if (kind === "line") each((c) => ({ ...c, assignment: option.id }));
    else if (kind === "funding")
      each((c) => ({ ...c, funding: option.id }), targets.filter(fundable));
    else if (kind === "tag")
      each((c) => {
        const tagged = (c.tag_ids ?? []).filter((id) => id !== option.id);
        return { ...c, tag_ids: on ? tagged : [...tagged, option.id] };
      });
    else if (kind === "refund") setDraft({ [it.id]: option.id ? { refund_of: option.id } : {} });
    else if (await run(inbox.resolve(p.entity.id, it, option.id as "keep" | "delete"))) {
      advance([it.id]);
      setToast({
        text:
          option.id === "keep"
            ? `Kept the actual entry for ${it.payee}.`
            : `Deleted the actual entry for ${it.payee}. Its history is retained.`,
      });
    }
  }
  const filtered = picker
    ? picker.options.filter((o) =>
        `${o.name} ${o.note ?? ""} ${o.sub ?? ""}`.toLowerCase().includes(picker.query),
      )
    : [];

  /** Keys that act on every selected item; false lets the key reach the normal handler. */
  function batchKey(key: string, selection: string[]): boolean {
    const shared = new Set(chosen.map((it) => effective(it, drafts[it.id]).category ?? null));
    const category = shared.size === 1 ? [...shared][0] : null;
    const warn = (text: string) => setToast({ text, tone: "warn" });
    if (["1", "2", "3", "4", "5", "6"].includes(key))
      setCategory(chosen, CATEGORIES[Number(key) - 1].id);
    else if (key === "Enter") void resolveSelected();
    else if (key === "s") void resolveSelected(true);
    else if (key === "a") {
      if (!category) warn(`Choose one category for the ${chosen.length} selected first: 1–6.`);
      else openPicker("line", chosen[0], effective(chosen[0], drafts[chosen[0].id]), selection);
    } else if (key === "f") {
      const outflows = chosen.filter(fundable);
      if (!outflows.length)
        warn("A funding origin applies to outflows with a category. None is selected.");
      else
        openPicker(
          "funding",
          outflows[0],
          undefined,
          outflows.map((it) => it.id),
        );
    } else if (key === "t") {
      const taggable = chosen.filter((it) => {
        const c = effective(it, drafts[it.id]);
        return !c.refund_of && !c.skip;
      });
      if (!taggable.length) warn("Refunds and ignored items take no tags here.");
      else
        openPicker(
          "tag",
          taggable[0],
          undefined,
          taggable.map((it) => it.id),
        );
    } else if (key === "r")
      warn("A refund links one purchase. Press Esc to clear the selection, then link it.");
    else if (key === "Escape") {
      anchor.current = null;
      setSelected(new Set());
    } else return false;
    return true;
  }
  function press(key: string) {
    setToast(null);
    if (help) {
      if (key === "Escape" || key === "?") setHelp(false);
      return;
    }
    if (picker) {
      if (key === "Escape") setPicker(null);
      else if (key === "ArrowDown")
        setPicker({ ...picker, at: Math.min(filtered.length - 1, picker.at + 1) });
      else if (key === "ArrowUp") setPicker({ ...picker, at: Math.max(0, picker.at - 1) });
      else if (key === "Enter") {
        if (filtered[picker.at]) void choose(filtered[picker.at]);
      } else if (key === "Backspace")
        setPicker({ ...picker, query: picker.query.slice(0, -1), at: 0 });
      else if (key.length === 1)
        setPicker({ ...picker, query: picker.query + key.toLowerCase(), at: 0 });
      return;
    }
    if (busy && !["j", "k", "ArrowDown", "ArrowUp", "?", "v", "Escape"].includes(key)) return;
    if (flowKey(key)) return;
    const at = ids.indexOf(cur ?? "");
    const waiting = current?.status === "waiting";
    const notHere = () =>
      setToast({
        text: current
          ? "Only an item waiting in the inbox can be changed."
          : "Nothing is selected.",
        tone: "warn",
      });
    const c = current ? effective(current, drafts[current.id]) : {};
    const batch = chosen.length > 0;
    const selection = chosen.map((it) => it.id);
    if (batch && batchKey(key, selection)) return;
    switch (key) {
      case "j":
      case "ArrowDown":
        return setCur(ids[Math.min(ids.length - 1, at + 1)] ?? null);
      case "k":
      case "ArrowUp":
        return setCur(ids[Math.max(0, at - 1)] ?? null);
      case "Enter":
        if (view !== "waiting")
          return setToast({
            text:
              view === "skipped"
                ? "This item is ignored. Press s to return it to the inbox."
                : "Already recorded. z undoes the last recording.",
            tone: "warn",
          });
        return void record();
      case "1":
      case "2":
      case "3":
      case "4":
      case "5":
      case "6":
        if (!current || !waiting) return notHere();
        return setCategory([current], CATEGORIES[Number(key) - 1].id);
      case "a":
        if (!current || !waiting) return notHere();
        if (c.refund_of)
          return setToast({
            text: "A refund is assigned through its purchase. Press r to change the link.",
            tone: "warn",
          });
        if (!c.category)
          return setHints((h) => ({ ...h, [current.id]: "Choose a category first: 1–6." }));
        return openPicker("line", current);
      case "f":
        if (!current || !waiting) return notHere();
        if (isInflow(current))
          return setToast({
            text: "A funding origin applies to outflows. This item is an inflow.",
            tone: "warn",
          });
        if (c.category === "saving" || c.category === "income")
          return setToast({
            text: "A saving contribution here comes from current income.",
            tone: "warn",
          });
        return openPicker("funding", current);
      case "t":
        if (!current || !waiting) return notHere();
        if (c.refund_of)
          return setToast({
            text: "A refund carries its purchase's tags. Change them on the purchase in Activity.",
            tone: "warn",
          });
        if (c.skip) return setToast({ text: "An ignored item records nothing.", tone: "warn" });
        return openPicker("tag", current);
      case "r":
        if (!current || !waiting) return notHere();
        if (!isInflow(current))
          return setToast({
            text: "Only an inflow can be linked as a refund. This item is an outflow.",
            tone: "warn",
          });
        return openPicker("refund", current);
      case "s":
        if (!current) return notHere();
        if (current.status === "conflict")
          return setToast({
            text: "A conflict is not ignored. Press Enter to choose a resolution.",
            tone: "warn",
          });
        if (current.status === "recorded")
          return setToast({
            text: "Recorded items are not ignored. z undoes the last recording.",
            tone: "warn",
          });
        return void skip(current);
      case "x":
        if (!current || !waiting || view !== "waiting") return notHere();
        return toggle(current.id);
      case "X":
        return selectAll();
      case "z":
        return void undoLast();
      case "v": {
        setSelected(new Set());
        return setView(VIEWS[(VIEWS.indexOf(view) + 1) % VIEWS.length]);
      }
      case "p":
        setSelected(new Set());
        return setProposedOnly((on) => !on);
      case "F":
        return startFlow();
      case "?":
        return setHelp(true);
      case "Escape":
        if (current) setHints(({ [current.id]: _, ...rest }) => rest);
    }
  }
  const keys = useRef(press);
  keys.current = press;
  const overlay = useRef(false);
  overlay.current = Boolean(picker) || help;
  useEffect(() => {
    // Capture runs before the workspace's own shortcuts, which skip handled events.
    const listener = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
      if (keysBelongElsewhere(e.target)) return;
      if (
        e.key.length > 1 &&
        !["Enter", "Escape", "ArrowUp", "ArrowDown", "ArrowRight", "Backspace"].includes(e.key)
      )
        return;
      // Space, N and the month keys stay with the workspace unless a picker is filtering.
      if (!overlay.current && [" ", "n", "[", "]"].includes(e.key)) return;
      if (e.repeat && !["j", "k", "ArrowUp", "ArrowDown", "Backspace"].includes(e.key)) {
        e.preventDefault();
        return;
      }
      if (e.key === "Enter" && e.target instanceof HTMLElement && e.target.closest("button"))
        return;
      e.preventDefault();
      keys.current(e.key);
    };
    window.addEventListener("keydown", listener, true);
    return () => window.removeEventListener("keydown", listener, true);
  }, []);

  if (p.concealed) return null;
  const source = sources.kind === "ready" ? sources.data.find((s) => s.connected) : undefined;
  const failed = [items, sources, plans, accounts, activity, investments, recipients];
  async function sync(target = source) {
    if (!target || syncing) return;
    setSyncing(target.name);
    const result = await run<{ counts: Record<string, number> }>(
      inbox.sync(p.entity.id, target.id),
    ).finally(() => setSyncing(null));
    if (result)
      setToast({
        text: `Synced ${target.name}: ${result.counts.added} new, ${result.counts.changed} changed, ${result.counts.removed + result.counts.conflicts} removed or in conflict.`,
      });
  }

  return (
    <div className="ix ar" aria-label="Transactions inbox">
      <header className="ix-top">
        <div className="ix-title">
          <b>Transactions inbox</b>
          {source && (
            <span className="note">
              {source.name}
              {source.last_synced_at
                ? ` · synced ${fmtShort(source.last_synced_at.slice(0, 10))}`
                : " · not synced yet"}
            </span>
          )}
        </div>
        <span className="spacer" />
        {source && (
          <button
            type="button"
            className="btn sm"
            disabled={busy || Boolean(syncing)}
            aria-busy={Boolean(syncing)}
            onClick={() => void sync()}
          >
            {syncing ? (
              <>
                <span className="ix-spin" aria-hidden="true" /> Syncing…
              </>
            ) : (
              "Sync now"
            )}
          </button>
        )}
        {flow ? (
          <div className="ix-progress" aria-label="Flow progress">
            <span>
              <b>
                {flowDone.recorded + flowDone.ignored} / {flow.ids.length}
              </b>{" "}
              · {flowDone.recorded} recorded · {flowDone.ignored} ignored · {flow.later.length}{" "}
              later
            </span>
            <span className="ix-track">
              <span
                style={{
                  width: `${(100 * (flowDone.recorded + flowDone.ignored)) / Math.max(1, flow.ids.length)}%`,
                }}
              />
            </span>
          </div>
        ) : (
          <>
            {source && (
              <button
                type="button"
                className="btn sm"
                disabled={
                  busy || proposing || !proposals || proposals.proposed >= proposals.waiting
                }
                onClick={() => void startRun()}
              >
                {proposing ? "Proposing…" : "Propose with agent"}
              </button>
            )}
            {source && (
              <button
                type="button"
                className="btn pri sm"
                disabled={!counts.waiting}
                onClick={startFlow}
              >
                Start flow <Key k="F" />
              </button>
            )}
            {/* biome-ignore lint/a11y/useSemanticElements: The kit's segmented control is a button group. */}
            <div className="seg-control" role="group" aria-label="View">
              {VIEWS.map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v}
                  onClick={() => {
                    setSelected(new Set());
                    setView(v);
                  }}
                >
                  {VIEW_NAMES[v]} <small>{counts[v]}</small>
                </button>
              ))}
            </div>
            <Key k="v" />
            {/* biome-ignore lint/a11y/useSemanticElements: The kit's segmented control is a button group. */}
            <div className="seg-control" role="group" aria-label="Filter">
              {[false, true].map((on) => (
                <button
                  key={String(on)}
                  type="button"
                  aria-pressed={proposedOnly === on}
                  onClick={() => {
                    setSelected(new Set());
                    setProposedOnly(on);
                  }}
                >
                  {on ? "With proposals" : "All"}
                </button>
              ))}
            </div>
            <Key k="p" />
          </>
        )}
      </header>
      {proposals && proposing ? (
        <output className="ix-syncing ix-run">
          <span className="ix-bar" aria-hidden="true" />
          <span>
            <span className="ix-spin" aria-hidden="true" /> <b>Agent proposing</b> ·{" "}
            {proposals.proposed} of {proposals.waiting} waiting items have a proposal. It runs on
            the server, so you can close this tab. Nothing is recorded.
          </span>
          <button type="button" className="btn sm" disabled={busy} onClick={() => void stopRun()}>
            Stop
          </button>
        </output>
      ) : proposals?.run?.state === "failed" ? (
        <div className="ix-msg bad ix-run-msg" role="alert">
          The proposal run stopped:{" "}
          {RUN_ERRORS[proposals.run.error_code ?? ""] ?? "something went wrong. Start it again."}{" "}
          Proposals it set stay.
        </div>
      ) : proposals?.run && proposals.waiting > 0 ? (
        <div className="ix-ready">
          <b>
            Proposals ready: {proposals.proposed - proposals.needs_you} proposed,{" "}
            {proposals.needs_you} need you
          </b>
          <span>Unsure items carry the agent's question instead of a guess.</span>
        </div>
      ) : null}
      {syncing && (
        <output className="ix-syncing">
          <span className="ix-bar" aria-hidden="true" />
          <span>
            <span className="ix-spin" aria-hidden="true" /> Syncing {syncing} — reading new, changed
            and deleted transactions from YNAB. Nothing is recorded.
          </span>
        </output>
      )}
      <div className="ix-strip">
        <b>Review {fmtMonth(month)}</b>
        {waitingLabel(monthWaiting)}
        <span>as this month's Review shows it</span>
      </div>
      <LoadProblem states={failed} retry={() => setReload((x) => x + 1)} />
      {items.kind === "loading" && !syncing ? (
        <LoadingCard label="Loading the inbox" />
      ) : syncing && !all.length ? (
        <LoadingCard label={`Syncing ${syncing}`} />
      ) : source && !source.synced && source.accounts.length && !all.length ? (
        <div className="ix-empty">
          <b>Ready to sync {source.name}</b>
          <p className="note">
            {source.accounts.length} account{source.accounts.length === 1 ? "" : "s"} chosen. Sync
            to bring their transactions into this inbox; none becomes an actual entry until you
            record it.
          </p>
          <button type="button" className="btn pri sm" disabled={busy} onClick={() => void sync()}>
            Sync {source.name} now
          </button>
        </div>
      ) : (sources.kind === "empty" && !all.length) || (source && !source.accounts.length) ? (
        <div className="ix-empty">
          <p className="note">
            Imported transactions wait here; none becomes an actual entry until you record it.
          </p>
          <ConnectSource
            key={source?.id ?? "new"}
            entityId={p.entity.id}
            today={p.entity.today}
            source={source}
            credentials={p.credentials}
            openSettings={p.openSettings}
            connected={(saved) => void sync(saved)}
          />
        </div>
      ) : flow ? (
        <div className="ix-flow">
          {passOver || !current ? (
            <article className="ix-card ix-end" aria-label="Pass complete">
              <div className="ix-d-t">Pass complete</div>
              <p>
                {flowDone.recorded} recorded · {flowDone.ignored} ignored · {flow.later.length} left
                for later
              </p>
              <p className="note">
                Recorded items are actual entries now and count in their Reviews. Items left for
                later are still waiting; nothing was saved for them.
              </p>
              <div className="ix-do">
                {flow.later.length > 0 && (
                  <button
                    type="button"
                    className="btn pri"
                    onClick={() => setFlow({ ...flow, later: [], editing: false })}
                  >
                    Go through {flow.later.length} later <Key k="l" />
                  </button>
                )}
                <button type="button" className="btn" onClick={endFlow}>
                  Back to the inbox <Key k="Esc" />
                </button>
                <button type="button" className="btn quiet" onClick={() => void flowUndo()}>
                  Undo last <Key k="z" />
                </button>
              </div>
            </article>
          ) : (
            <>
              <article
                className={`ix-card${flow.editing ? " editing" : ""}`}
                aria-label={`${current.payee}, ${signed(current)}`}
              >
                {flow.editing ? (
                  <>
                    <Detail
                      it={current}
                      c={shownAs(current)}
                      touched={Boolean(drafts[current.id])}
                      choices={choices}
                      hint={hints[current.id]}
                      press={press}
                    />
                    <button type="button" className="btn quiet" onClick={() => press("Escape")}>
                      Back to flow <Key k="Esc" />
                    </button>
                  </>
                ) : (
                  <FlowCard
                    it={current}
                    c={shownAs(current)}
                    choices={choices}
                    later={flow.later.includes(current.id)}
                    press={press}
                  />
                )}
              </article>
              {queue[1] && (
                <p className="note">
                  Next: {all.find((i) => i.id === queue[1])?.payee} · {queue.length - 1} more
                  waiting in this pass
                </p>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="ix-cols">
          <div className="ix-side">
            {selectable.length > 0 && (
              <div className="ix-selbar">
                <button
                  // biome-ignore lint/a11y/useSemanticElements: A native checkbox would take focus and keys from the inbox's handler.
                  type="button"
                  role="checkbox"
                  className="ix-pick"
                  tabIndex={-1}
                  aria-checked={
                    chosen.length === selectable.length ? true : chosen.length ? "mixed" : false
                  }
                  aria-label={`Select all ${selectable.length} waiting`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={selectAll}
                >
                  <span className={`ix-chk${chosen.length ? " on" : ""}`} aria-hidden="true">
                    {chosen.length === selectable.length ? "✓" : chosen.length ? "–" : ""}
                  </span>
                </button>
                <span>
                  {chosen.length
                    ? `${chosen.length} of ${selectable.length} selected · ${money(
                        chosen.reduce((sum, it) => sum + Math.abs(cents(it)), 0),
                      )}`
                    : `Select all ${selectable.length}`}
                </span>
                <Key k="X" />
                {chosen.length > 0 && (
                  <span className="ix-selbar-do">
                    <button
                      type="button"
                      className="btn pri sm"
                      disabled={busy}
                      onClick={() => press("Enter")}
                    >
                      Record {chosen.length}
                    </button>
                    <button
                      type="button"
                      className="btn sm"
                      disabled={busy}
                      onClick={() => press("s")}
                    >
                      Ignore {chosen.length}
                    </button>
                    <button type="button" className="btn quiet sm" onClick={() => press("Escape")}>
                      Clear
                    </button>
                  </span>
                )}
              </div>
            )}
            {/* biome-ignore lint/a11y/useSemanticElements: The inbox's own keys move the cursor through this list. */}
            <div
              role="listbox"
              className="ix-list"
              ref={list}
              tabIndex={-1}
              aria-label={`${view} items`}
              aria-activedescendant={current ? `ix-${current.id}` : undefined}
            >
              {shown.length === 0 && (
                <div className="ix-empty">
                  <b>{proposedOnly ? "No proposals here" : "Nothing here"}</b>
                </div>
              )}
              {shown.map((row) =>
                "head" in row ? (
                  <div className="ix-dayh" key={`h-${row.head}`}>
                    <b>{/^\d{4}-\d{2}$/.test(row.head) ? fmtMonth(row.head) : row.head}</b>
                    <span className={row.warn ? "chip warn" : undefined}>{row.sub}</span>
                  </div>
                ) : "parent" in row ? (
                  <div className="ix-row par" key={`p-${row.parent}`}>
                    <span className="t">
                      <b>{row.payee}</b> · split in YNAB into {row.lines} lines · {row.waiting}{" "}
                      waiting
                    </span>
                    <span>{formatMoney(row.total.replace("-", ""))}</span>
                  </div>
                ) : (
                  <ItemRow
                    key={row.it.id}
                    it={row.it}
                    c={shownAs(row.it)}
                    choices={choices}
                    current={row.it.id === current?.id}
                    checked={selected.has(row.it.id)}
                    hint={hints[row.it.id]}
                    undoable={
                      undo.current[undo.current.length - 1]?.some((u) => u.id === row.it.id) ??
                      false
                    }
                    inWaiting={view === "waiting"}
                    onClick={() => setCur(row.it.id)}
                    onCheck={(range) => toggle(row.it.id, range)}
                  />
                ),
              )}
            </div>
          </div>
          <section className="ix-detail" aria-live="polite">
            {chosen.length ? (
              <BatchDetail
                its={chosen}
                cs={chosen.map((it) => effective(it, drafts[it.id]))}
                choices={choices}
                busy={busy}
                press={press}
              />
            ) : current ? (
              <Detail
                it={current}
                c={shownAs(current)}
                touched={Boolean(drafts[current.id])}
                choices={choices}
                hint={hints[current.id]}
                press={press}
              />
            ) : (
              <div className="ix-empty">
                <b>
                  {view === "waiting"
                    ? "Nothing is waiting in the inbox"
                    : view === "skipped"
                      ? "Nothing is ignored"
                      : "Nothing is recorded"}
                </b>
                <p>
                  Press <Key k="v" /> to change the view.
                </p>
              </div>
            )}
          </section>
        </div>
      )}
      <footer className="ix-foot">
        {(flow && !picker
          ? passOver
            ? [
                [["l"], "Go through later"],
                [["z"], "Undo"],
                [["Esc"], "Back to the inbox"],
              ]
            : flow.editing
              ? [
                  [["1–6"], "Category"],
                  [["a", "f", "t", "r"], "Pickers"],
                  [["Enter"], "Record and continue"],
                  [["s"], "Ignore"],
                  [["Esc"], "Back to flow"],
                ]
              : [
                  [["Enter"], "Accept"],
                  [["l", "→"], "Later"],
                  [["s"], "Ignore"],
                  [["e"], "Edit"],
                  [["z"], "Undo"],
                  [["Esc"], "Leave flow"],
                ]
          : picker
            ? [
                [["↑", "↓"], "Move"],
                [[], "Type to filter"],
                [["Enter"], "Choose"],
                [["Esc"], "Cancel"],
              ]
            : chosen.length
              ? [
                  [["j", "k"], "Move"],
                  [["x"], "Select"],
                  [["X"], "Select all"],
                  [["1–6"], "Category for all"],
                  [["a", "f", "t"], "Pickers for all"],
                  [["Enter"], `Record ${chosen.length}`],
                  [["s"], `Ignore ${chosen.length}`],
                  [["z"], "Undo"],
                  [["Esc"], "Clear selection"],
                ]
              : [
                  [["j", "k"], "Move"],
                  [["Enter"], "Accept"],
                  [["1–6"], "Category"],
                  [["a"], "Assignment"],
                  [["f"], "Funding origin"],
                  [["r"], "Refund"],
                  [["s"], "Ignore"],
                  [["x"], "Select"],
                  [["z"], "Undo"],
                  [["v"], "View"],
                  [["p"], "Proposals"],
                  [["F"], "Flow"],
                  [["?"], "Help"],
                ]
        ).map(([k, label]) => (
          <span key={String(label)}>
            {(k as string[]).map((x) => (
              <Key key={x} k={x} />
            ))}{" "}
            {label as string}
          </span>
        ))}
      </footer>
      {toast && (
        <output className={`ix-toast${toast.tone ? ` ${toast.tone}` : ""}`}>
          <span>{toast.text}</span>
          {toast.undo && (
            <button type="button" onClick={() => press("z")}>
              Undo (z)
            </button>
          )}
        </output>
      )}
      {picker && (
        <div className="ix-ov" onClick={() => setPicker(null)} onKeyDown={undefined}>
          {/* biome-ignore lint/a11y/useSemanticElements: A picker over the inbox; focus stays with its key handler. */}
          <div
            role="dialog"
            className="ix-pal"
            aria-label={picker.title}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={undefined}
          >
            <div className="ix-pal-h">
              <b>{picker.title}</b>
            </div>
            <div className={`ix-pal-q${picker.query ? "" : " ph"}`}>
              {picker.query}
              <i />
              {picker.query ? "" : picker.placeholder}
            </div>
            <div className="ix-pal-list">
              {filtered.length ? (
                filtered.map((o, i) => (
                  <button
                    key={o.id || "remove"}
                    type="button"
                    aria-current={i === picker.at}
                    onClick={() => void choose(o)}
                  >
                    {picker.ranked && o.id && <span className="rk">{i + 1}</span>}
                    <span className="o">
                      {o.name}
                      {o.sub && <small>{o.sub}</small>}
                    </span>
                    <span className={`n${o.warn ? " warn" : ""}`}>{o.note}</span>
                  </button>
                ))
              ) : (
                <div className="ix-pal-none">
                  {picker.query ? `Nothing matches "${picker.query}".` : picker.none}
                </div>
              )}
            </div>
            {picker.foot && <div className="ix-pal-f">{picker.foot}</div>}
          </div>
        </div>
      )}
      {help && <Help close={() => setHelp(false)} />}
    </div>
  );
}

function ItemRow({
  it,
  c,
  choices,
  current,
  checked,
  hint,
  undoable,
  inWaiting,
  onClick,
  onCheck,
}: {
  it: StagedTransaction;
  c: Completion;
  choices: Choices;
  current: boolean;
  checked: boolean;
  hint?: string;
  undoable: boolean;
  inWaiting: boolean;
  onClick: () => void;
  onCheck: (range: boolean) => void;
}) {
  const s = summary(it, c, choices);
  const kid = Boolean(it.parent_ref) && inWaiting;
  const proposed = it.status === "waiting" && it.proposal && !hint && !it.rejection;
  return (
    // biome-ignore lint/a11y/useSemanticElements: An option of the inbox listbox; its keys move the cursor.
    <div
      role="option"
      id={`ix-${it.id}`}
      tabIndex={-1}
      className={`ix-row it${current ? " cur" : ""}${kid ? " kid" : ""}`}
      onKeyDown={undefined}
      aria-selected={current}
      data-id={it.id}
      onClick={onClick}
    >
      {it.status === "waiting" && inWaiting && (
        <button
          // biome-ignore lint/a11y/useSemanticElements: A native checkbox would take focus and keys from the inbox's handler.
          type="button"
          role="checkbox"
          className="ix-pick"
          tabIndex={-1}
          aria-checked={checked}
          aria-label={`Select ${it.payee}, ${signed(it)}`}
          // Keep focus off the box, so Enter still records instead of pressing it again.
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.stopPropagation();
            onCheck(e.shiftKey);
          }}
        >
          <span className={`ix-chk${checked ? " on" : ""}`} aria-hidden="true">
            {checked ? "✓" : ""}
          </span>
        </button>
      )}
      <i className="dot" style={tint(s.kind)} />
      <div className="t">
        <div className="tt">
          <span>{kid ? (it.source_category?.name ?? it.payee) : it.payee}</span>
          <span className="yc">{kid ? "split line" : it.source_category?.name}</span>
          {it.rejection && it.status === "waiting" && (
            <span className="chip bad">Not recorded</span>
          )}
          {hint && <span className="chip warn">Needs you</span>}
          {it.proposal_rejection && it.status === "waiting" && !it.rejection && (
            <span className="chip warn">Proposal rejected</span>
          )}
          {!it.approved && <span className="chip">Unapproved</span>}
          {!it.cleared && <span className="chip">Uncleared</span>}
          {it.changed_after_staging && it.status !== "conflict" && (
            <span className="chip">Updated in YNAB</span>
          )}
          {it.status === "conflict" && (
            <span className="chip bad">
              {it.deleted_in_source ? "Deleted in YNAB" : "Changed in YNAB"}
            </span>
          )}
          {it.status === "recorded" && undoable && (
            <span className="chip">
              <kbd className="kbd">z</kbd>&nbsp;undoes this
            </span>
          )}
        </div>
        <small>
          <b>{s.text}</b>
          {proposed && it.proposal?.rationale && (
            <>
              {" "}
              · <span className="nb">{it.proposal.rationale}</span>
            </>
          )}
          {hint && <span className="ix-why-row"> · {hint}</span>}
        </small>
      </div>
      <div className={`a${isInflow(it) ? " good" : ""}`}>{signed(it)}</div>
    </div>
  );
}

/** Flow mode's card: the item, the agent's proposal and why, and the flow's keys. */
function FlowCard({
  it,
  c,
  choices,
  later,
  press,
}: {
  it: StagedTransaction;
  c: Completion;
  choices: Choices;
  later: boolean;
  press: (key: string) => void;
}) {
  const unsure = !c.skip && !c.category && !c.refund_of;
  const inflow = isInflow(it);
  return (
    <>
      <div className="ix-d-h">
        <div>
          <div className="ix-d-t">{it.payee}</div>
          <div className="note">
            {fmtDay(it.financial_date)} · {it.account_name}
            {it.source_category && ` · YNAB: ${it.source_category.name}`}
            {it.memo && ` · ${it.memo}`}
          </div>
        </div>
        <div className={`ix-fig${inflow ? " good" : ""}`}>{signed(it)}</div>
      </div>
      {later && <div className="ix-msg">You passed this one with Later.</div>}
      {it.proposal ? (
        <div className={`ix-proposal${unsure ? " ix-needs" : ""}`}>
          <div className="lab">
            {unsure ? "Needs you" : `Proposal: ${summary(it, c, choices).text}`}
            {it.proposed_by && <span>{INTERFACES[it.proposed_by.interface] ?? "agent"}</span>}
          </div>
          {it.proposal.rationale && <p className="ix-why">{it.proposal.rationale}</p>}
          {it.proposal_rejection && !unsure && (
            <div className="ix-msg warn">
              The record checks would reject this now:{" "}
              {readable(choices, it.proposal_rejection.message)}
            </div>
          )}
        </div>
      ) : (
        <div className="ix-msg">No proposal yet. Enter opens edit to choose a category.</div>
      )}
      <div className="ix-do">
        <button type="button" className="btn pri" onClick={() => press("Enter")}>
          {unsure ? "Choose" : c.skip ? "Accept: ignore" : "Accept"} <Key k="Enter" />
        </button>
        <button type="button" className="btn" onClick={() => press("l")}>
          Later <Key k="l" />
        </button>
        <button type="button" className="btn" onClick={() => press("s")}>
          Ignore <Key k="s" />
        </button>
        <button type="button" className="btn" onClick={() => press("e")}>
          Edit <Key k="e" />
        </button>
        <button type="button" className="btn quiet" onClick={() => press("z")}>
          Undo <Key k="z" />
        </button>
      </div>
    </>
  );
}

function Detail({
  it,
  c,
  touched,
  choices,
  hint,
  press,
}: {
  it: StagedTransaction;
  c: Completion;
  touched: boolean;
  choices: Choices;
  hint?: string;
  press: (key: string) => void;
}) {
  const waiting = it.status === "waiting";
  const inflow = isInflow(it);
  const category = c.category ? CATEGORY[c.category] : null;
  const purchase = c.refund_of ? choices.purchases.find((x) => x.uuid === c.refund_of) : null;
  const goal = choices.goals.find((g) => g.id === c.funding);
  const proposer = it.proposed_by;
  const field = (key: string, label: string, value: string | null, extra?: string) => {
    const body = (
      <>
        <Key k={key} />
        <span>
          <span className="fl">{label}</span>
          <span className={`fv${value ? "" : " none"}`}>{value ?? "Not chosen"}</span>
          {extra && <span className="fx">{extra}</span>}
        </span>
      </>
    );
    return waiting ? (
      <button type="button" className="ix-fld" onClick={() => press(key)}>
        {body}
      </button>
    ) : (
      <div className="ix-fld">{body}</div>
    );
  };
  return (
    <>
      <div className="ix-d-h">
        <div>
          <div className="ix-d-t">{it.payee}</div>
          <div className="note">
            {fmtDay(it.financial_date)} · {inflow ? "Inflow" : "Outflow"}
          </div>
        </div>
        <div className={`ix-fig${inflow ? " good" : ""}`}>{signed(it)}</div>
      </div>
      <div className="note">
        Source YNAB: {it.source_category?.name ?? "Uncategorized"} · {it.account_name} ·{" "}
        {it.cleared ? "cleared" : "uncleared"}, {it.approved ? "approved" : "unapproved"}
        {it.split && ` · split line in a ${formatMoney(it.split.total.replace("-", ""))} split`}
        {it.kind !== "ordinary" && ` · ${it.kind.split("_").join(" ")}`}
        {it.memo && (
          <>
            <br />
            Memo: {it.memo}
          </>
        )}
      </div>
      {it.rejection && waiting && (
        <div className="ix-msg bad" role="alert">
          Not recorded. {readable(choices, it.rejection.message)}
        </div>
      )}
      {hint && (
        <div className="ix-msg warn" role="alert">
          {hint}
        </div>
      )}
      {it.changed_after_staging && it.status !== "conflict" && (
        <div className="ix-msg">
          Updated in YNAB after it was staged. These are the latest facts.
        </div>
      )}
      {it.status === "conflict" && (
        <div className="ix-msg bad">
          <b>Conflict.</b> This item was recorded as an actual entry, and YNAB{" "}
          {it.deleted_in_source ? "deleted" : "changed"} its transaction. The actual entry is
          unchanged and still counts in totals.
        </div>
      )}
      {it.proposal && waiting && (
        <div className="ix-proposal">
          <div className="lab">
            {touched ? "Proposal (replaced by your choices)" : "Proposal"}
            {proposer && (
              <span>
                by {INTERFACES[proposer.interface] ?? proposer.interface} ·{" "}
                {fmtShort(proposer.at.slice(0, 10))}
              </span>
            )}
          </div>
          {it.proposal.rationale && <p className="ix-why">{it.proposal.rationale}</p>}
          {it.proposal_rejection && (
            <div className="ix-msg warn">
              The record checks would reject this proposal now:{" "}
              {readable(choices, it.proposal_rejection.message)}
            </div>
          )}
        </div>
      )}
      {c.skip ? (
        <>
          <div className="lab">
            {it.status === "skipped" ? "Ignored" : "Proposed: ignore"}
            <span>{SKIP_REASONS[it.kind]?.[0]}</span>
          </div>
          <div className="ix-msg">
            {SKIP_REASONS[it.kind]?.[1]} An ignored item is not an actual entry and counts in no
            total. A re-sync keeps it ignored.
          </div>
        </>
      ) : !c.category && !purchase && waiting ? (
        <>
          <div className="lab">No proposal yet</div>
          <div className="ix-msg">
            {inflow && !isReadyToAssign(it) ? (
              <>
                An inflow in a spending category is usually a refund. <Key k="r" /> links the
                purchase it refunds. Nothing links automatically.
              </>
            ) : it.kind === "transfer_tracking" ? (
              <>
                <Key k="5" /> an investing contribution, or <Key k="s" /> ignore.
              </>
            ) : (
              <>
                Choose a category: <Key k="1" />–<Key k="6" />.
              </>
            )}
          </div>
        </>
      ) : (
        <div className="lab">
          {it.status === "recorded"
            ? "Recorded as"
            : it.status === "conflict"
              ? "Actual entry"
              : it.status === "skipped"
                ? "Ignored. Was set to"
                : "Will record as"}
        </div>
      )}
      {(waiting || c.category) && !purchase && !c.skip && (
        <div className={`ix-cats${waiting ? "" : " ro"}`}>
          {CATEGORIES.map((x, i) => (
            <button
              key={x.id}
              type="button"
              tabIndex={waiting ? 0 : -1}
              aria-pressed={c.category === x.id}
              onClick={() => waiting && press(String(i + 1))}
            >
              <Key k={String(i + 1)} />
              <i className="dot" style={tint(x.kind)} />
              {x.name}
            </button>
          ))}
        </div>
      )}
      {category?.line &&
        !purchase &&
        field("a", category.line, lineName(choices, c) ?? (category.article ? null : "Unassigned"))}
      {(purchase || (waiting && inflow && !isReadyToAssign(it) && !c.category)) &&
        field(
          "r",
          "Refund of",
          purchase ? `${purchaseLabel(purchase)}, ${formatMoney(purchase.amount)}` : null,
          purchase
            ? `${formatMoney(purchase.remaining_refundable ?? null)} refundable. Keeps the purchase's category and funding origin.`
            : "Shows ranked purchase candidates.",
        )}
      {category &&
        !inflow &&
        c.category !== "saving" &&
        field(
          "f",
          "Funding origin",
          fundingName(choices, c),
          goal ? `${goal.name} has ${goal.note}.` : undefined,
        )}
      {!c.skip &&
        (purchase
          ? field("t", "Tags", "From the purchase")
          : Boolean(c.category || c.tag_ids?.length) &&
            field(
              "t",
              "Tags",
              c.tag_ids?.length
                ? c.tag_ids
                    .map(
                      (id) => choices.tags?.find((tag) => tag.uuid === id)?.name ?? "Deleted tag",
                    )
                    .join(", ")
                : null,
              c.tag_ids?.length ? undefined : "Optional. Several are allowed.",
            ))}
      <div className="ix-do">
        {waiting ? (
          <>
            <button
              type="button"
              className={`btn pri${c.category || c.skip || purchase ? "" : " off"}`}
              onClick={() => press("Enter")}
            >
              <Key k="Enter" />
              {c.skip
                ? "Accept: ignore"
                : c.category || purchase
                  ? touched
                    ? "Record"
                    : "Accept and record"
                  : "Nothing to accept yet"}
            </button>
            {!c.skip && (
              <button type="button" className="btn" onClick={() => press("s")}>
                <Key k="s" />
                Ignore
              </button>
            )}
          </>
        ) : it.status === "conflict" ? (
          <button type="button" className="btn pri" onClick={() => press("Enter")}>
            <Key k="Enter" />
            Resolve conflict
          </button>
        ) : it.status === "skipped" ? (
          <button type="button" className="btn" onClick={() => press("s")}>
            <Key k="s" />
            Return to inbox
          </button>
        ) : (
          <button type="button" className="btn" onClick={() => press("z")}>
            <Key k="z" />
            Undo the last action
          </button>
        )}
      </div>
    </>
  );
}

/** The batch panel: what the selection will record, and one choice set on all of it. */
function BatchDetail({
  its,
  cs,
  choices,
  busy,
  press,
}: {
  its: StagedTransaction[];
  cs: Completion[];
  choices: Choices;
  busy: boolean;
  press: (key: string) => void;
}) {
  const ready = its.filter((it, i) => !cs[i].skip && !precheck(it, cs[i])).length;
  const ignoring = cs.filter((c) => c.skip).length;
  const needs = its.length - ready - ignoring;
  /** The one value every selected item shares, or "Mixed". */
  const shared = (value: (c: Completion) => string | null) => {
    const values = new Set(cs.map(value));
    return values.size === 1 ? [...values][0] : "Mixed";
  };
  const category = shared((c) => c.category ?? null);
  const line = category && category !== "Mixed" ? CATEGORY[category as InboxCategory] : null;
  const outflows = cs.filter(
    (c, i) => !isInflow(its[i]) && c.category && !["saving", "income"].includes(c.category),
  );
  const tagged = (choices.tags ?? []).filter((tag) =>
    cs.every((c) => c.tag_ids?.includes(tag.uuid)),
  );
  const field = (key: string, label: string, value: string | null, extra?: string) => (
    <button type="button" className="ix-fld" onClick={() => press(key)}>
      <Key k={key} />
      <span>
        <span className="fl">{label}</span>
        <span className={`fv${value ? "" : " none"}`}>{value ?? "Not chosen"}</span>
        {extra && <span className="fx">{extra}</span>}
      </span>
    </button>
  );
  return (
    <>
      <div className="ix-d-h">
        <div>
          <div className="ix-d-t">{its.length} selected</div>
          <div className="note">
            {[
              `${ready} ready to record`,
              needs && `${needs} need${needs === 1 ? "s" : ""} a choice`,
              ignoring && `${ignoring} set to ignore`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>
        <div className="ix-fig">{money(its.reduce((sum, it) => sum + Math.abs(cents(it)), 0))}</div>
      </div>
      <div className="lab">Set for all {its.length}</div>
      <div className="ix-cats">
        {CATEGORIES.map((x, i) => (
          <button
            key={x.id}
            type="button"
            aria-pressed={category === x.id}
            onClick={() => press(String(i + 1))}
          >
            <Key k={String(i + 1)} />
            <i className="dot" style={tint(x.kind)} />
            {x.name}
          </button>
        ))}
      </div>
      {line &&
        field(
          "a",
          line.line ?? "Assignment",
          shared((c) => lineName(choices, c) ?? (line.article ? null : "Unassigned")),
        )}
      {outflows.length > 0 &&
        field(
          "f",
          "Funding origin",
          new Set(outflows.map((c) => fundingName(choices, c))).size === 1
            ? fundingName(choices, outflows[0])
            : "Mixed",
          outflows.length < its.length ? `Applies to the ${outflows.length} outflows.` : undefined,
        )}
      {category &&
        field(
          "t",
          "Tags",
          tagged.length ? tagged.map((tag) => tag.name).join(", ") : null,
          "Optional. A tag chosen here is added to every selected item.",
        )}
      <div className="ix-msg">
        Each item records on its own, from its proposal or these choices. Any that cannot stay
        selected, with the reason on its row.
      </div>
      <div className="ix-do">
        <button
          type="button"
          className={`btn pri${ready + ignoring ? "" : " off"}`}
          disabled={busy}
          onClick={() => press("Enter")}
        >
          <Key k="Enter" />
          Record {its.length} selected
        </button>
        <button type="button" className="btn" disabled={busy} onClick={() => press("s")}>
          <Key k="s" />
          Ignore {its.length}
        </button>
        <button type="button" className="btn quiet" onClick={() => press("Escape")}>
          <Key k="Esc" />
          Clear selection
        </button>
      </div>
    </>
  );
}

const HELP: Array<[string, string]> = [
  ["j k", "Next and previous item. ↓ and ↑ also work."],
  [
    "Enter",
    "Accept the proposal, record the actual entry, and advance. With a selection, records every selected item; any that cannot stay selected with the reason on its row. On a conflict, opens the resolution choices.",
  ],
  [
    "1 – 6",
    "Set the category: income, fixed costs, guilt-free spending, saving, investing, giving. Opens the assignment picker when one is needed.",
  ],
  ["a", "Choose the assignment. Type to filter."],
  ["f", "Choose the funding origin: current income or a saving goal."],
  ["t", "Add or remove tags. A refund carries its purchase's tags."],
  ["r", "Link an inflow as a refund from ranked purchase candidates."],
  [
    "s",
    "Ignore: it stays out of totals, even after a re-sync. Under Ignored, return it to the inbox.",
  ],
  [
    "x",
    "Select or deselect for a batch; shift-click a box to select a range. X selects every waiting item shown. With a selection, 1–6, a, f and t set the same choice on all of them, Enter records them, s ignores them, and Esc clears it.",
  ],
  ["z", "Undo the last recording or ignore."],
  ["v", "Change the view: Waiting, Ignored, Recorded."],
  ["p", "Show only items with a proposal, or all items again."],
  [
    "F",
    "Flow: one waiting item at a time. Enter accepts, l or → leaves it for later (nothing is saved), s ignores, e edits, z undoes, Esc leaves.",
  ],
  ["↑ ↓ Enter Esc", "In a picker: move, choose, cancel."],
  ["?", "Show or hide this help."],
];
function Help({ close }: { close: () => void }) {
  return (
    <div className="ix-ov help" onClick={close} onKeyDown={undefined}>
      {/* biome-ignore lint/a11y/useSemanticElements: Help over the inbox; focus stays with its key handler. */}
      <div className="ix-pal" role="dialog" aria-label="Inbox keyboard shortcuts">
        <div className="ix-pal-h">
          <b>Keyboard shortcuts</b>
          <button type="button" className="btn quiet sm" onClick={close}>
            <Key k="Esc" />
          </button>
        </div>
        <dl className="ix-keys">
          {HELP.map(([k, what]) => (
            <div key={k}>
              <dt>{k.split(" ").map((x) => (x === "–" ? " – " : <Key key={x} k={x} />))}</dt>
              <dd>{what}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
