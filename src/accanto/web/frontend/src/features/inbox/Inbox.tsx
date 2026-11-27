import { memo, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, type BrowserSession, type LoadState } from "../../lib/api";
import { destinations } from "../../lib/destinations";
import { decimalToCents, fmtDay, fmtMonth, fmtShort, formatMoney, money } from "../../lib/format";
import { inboxRowsCommitted } from "../../lib/screenTiming";
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
import { matches } from "../../lib/search";
import { spendingSubcategories } from "../../lib/spendingSubcategories";
import { tags } from "../../lib/tags";
import { cleanName, sameName, tint } from "../../ui";
import {
  type CreateRequest,
  NOUNS,
  createSpec,
  createdId,
  fixedCostsOf,
  planDrafts,
} from "../create/create";
import { FREQUENCIES, type Frequency } from "../workspace/planWorksheetModel";
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
  searchable,
  summary,
  waitingLabel,
} from "./inboxModel";
import "./inbox.css";
import { ConnectSource } from "./ConnectSource";
import { InboxZero, type ZeroStyle } from "./InboxZero";
import { useFlowWrites } from "./useFlowWrites";

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
  /** The category whose assignment a line picker chooses. */
  category?: InboxCategory;
};
/** A new fixed cost needs its planned amount before it joins a Plan's draft. */
type FixedForm = {
  name: string;
  planId: string;
  planName: string;
  ids: string[];
  amount: string;
  frequency: Frequency;
};
/** The inbox category whose picker lists each kind of record. */
const LIST: Partial<Record<CreateRequest["kind"], InboxCategory>> = {
  spending_subcategory: "spending",
  fixed_cost: "fixed_cost",
  saving_goal: "saving",
  investment: "investing",
  giving_recipient: "giving",
};
type Outcome = { item_id: string; ok: boolean; item?: unknown; error?: { message: string } };
type Toast = { text: string; tone?: "warn" | "bad"; undo?: boolean };
type Undo = Array<{ id: string; action: "undo" | "unskip" | "skip" | "later" }>;
/**
 * Flow mode: one waiting item at a time. `queue` holds the pass's item ids in order; items
 * leave it when they stop waiting, and Later moves one to the end without saving anything.
 */
type Flow = { ids: string[]; queue: string[]; later: string[]; editing: boolean };
type Noting = { ids: string[]; text: string };
/** Statuses whose note can still change; a recorded item's note is on its actual entry. */
const NOTABLE = new Set(["waiting", "skipped"]);
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
const focusCard = (card: HTMLElement | null) => card?.focus({ preventScroll: true });
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
    session?: BrowserSession;
    changed?: () => void;
    openSettings?: () => void;
    /** Opens a month's Review, the next step once nothing is waiting. */
    openReview?: (month: string) => void;
    /** Which inbox zero design to show; Storybook compares them. */
    zeroStyle?: ZeroStyle;
    /** A one-shot request to start flow mode, from the Ask bar's /inbox; a new value asks again. */
    flow?: number;
    flowStarted?: () => void;
  },
) {
  const [reload, setReload] = useState(0);
  const [proposalRevision, setProposalRevision] = useState(0);
  const deps = [p.entity.id, p.refresh, reload];
  // Proposals and keyboard pickers need their options as soon as the rows arrive.
  const enabled = !p.concealed;
  const items = useSettled(
    useLoad(() => inbox.list(p.entity.id), [...deps, proposalRevision], { enabled }),
  );
  const sources = useSettled(useLoad(() => inbox.sources(p.entity.id), deps, { enabled }));
  useEffect(() => {
    if (enabled && items.kind === "ready" && (sources.kind === "ready" || sources.kind === "empty"))
      inboxRowsCommitted();
  }, [enabled, items.kind, sources.kind]);
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
  /** Search typed in the inbox; it narrows every view, like the proposals filter. */
  const [query, setQuery] = useState("");
  const search = useRef<HTMLInputElement>(null);
  const [cur, setCur] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** The last checkbox toggled; a shift-click selects the rows between it and the click. */
  const anchor = useRef<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Completion>>({});
  const [hints, setHints] = useState<Record<string, string>>({});
  const [picker, setPicker] = useState<Picker | null>(null);
  /** The note being written: the items it is for and its text so far. */
  const [noting, setNoting] = useState<Noting | null>(null);
  const [fixedForm, setFixedForm] = useState<FixedForm | null>(null);
  /** Records this screen created, named until the reloaded lists include them. */
  const [made, setMade] = useState<
    Array<{ list: InboxCategory | "tag"; id: string; name: string }>
  >([]);
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
  const refreshOnDrain = useRef(false);
  const writes = useFlowWrites({
    entity: p.entity.id,
    session: p.session,
    credentials: p.credentials,
    dirty: p.dirty,
    settled({ it }, item, rejection) {
      if (item) {
        setPatched((previous) => ({ ...previous, [item.id]: item }));
        clearDraft(it.id);
      } else {
        undo.current = undo.current.filter(
          (group) => !group.some((x) => x.id === it.id && x.action !== "later"),
        );
        setHints((h) => ({
          ...h,
          [it.id]: `Not saved. ${readable(choices, rejection ?? "Try again.")}`,
        }));
        setFlow(
          (f) =>
            f && {
              ...f,
              queue: [
                ...f.queue.filter((id) => id !== it.id && !f.later.includes(id)),
                it.id,
                ...f.later,
              ],
            },
        );
      }
    },
    drained() {
      if (refreshOnDrain.current) {
        refreshOnDrain.current = false;
        refreshAll();
      }
    },
  });
  const pendingIds = new Set(writes.pending.map((i) => i.it.id));

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
    const base: Choices = {
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
      tags: tagState.kind === "ready" ? [...tagState.data] : [],
    };
    const tagList = base.tags ?? [];
    for (const record of made) {
      if (record.list === "tag") {
        if (!tagList.some((tag) => tag.uuid === record.id))
          tagList.push({
            uuid: record.id,
            name: record.name,
            active: true,
            revision: 1,
            entries: 0,
          });
      } else if (record.list === "saving") {
        // Saving's options are the goals list itself.
        if (!base.goals.some((goal) => goal.id === record.id))
          base.goals.unshift({ id: record.id, name: record.name, saved: 0, note: "$0.00 saved" });
      } else if (!base.lines[record.list].some((option) => option.id === record.id))
        base.lines[record.list].unshift({ id: record.id, name: record.name });
    }
    return base;
  }, [plans, accounts, activity, investments, recipients, tagState, subcategoryState, made]);

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
  // Every item is loaded already, so search filters in the browser with no request (§9).
  // biome-ignore lint/correctness/useExhaustiveDependencies: `all` and `shownAs` derive from these.
  const texts = useMemo(() => {
    const entries = new Map(choices.entries.map((e) => [e.uuid, e]));
    return new Map(
      all.map((i) => [
        i.id,
        searchable(i, shownAs(i), choices, entries.get(i.actual_entry_id ?? "")),
      ]),
    );
  }, [items, patched, drafts, choices]);
  const found = (i: StagedTransaction) => {
    const entry = texts.get(i.id);
    return !entry || matches(entry, query);
  };
  /** Items seen waiting while the inbox is open; those recorded or ignored since are this session's. */
  const waitedHere = useRef(new Set<string>());
  for (const i of all) if (i.status === "waiting") waitedHere.current.add(i.id);
  const cleared = all.flatMap((it) => {
    if (!waitedHere.current.has(it.id) || (it.status !== "recorded" && it.status !== "skipped"))
      return [];
    // In flow the entries reload only when it ends, so a fresh record falls back to its proposal.
    const c = it.status === "recorded" ? shownAs(it) : {};
    return [{ it, category: c.category ?? (c.refund_of ? null : (it.proposal?.category ?? null)) }];
  });
  // A decision still saving counts as made; one the server may not have received does not.
  const unsure = new Set(writes.pending.flatMap((i) => (i.state === "uncertain" ? [i.it.id] : [])));
  /** What still needs a decision anywhere in the inbox, whatever the view, filter or search. */
  const left = all.filter(
    (i) =>
      i.status === "conflict" ||
      (i.status === "waiting" && (!pendingIds.has(i.id) || unsure.has(i.id))),
  );
  const zero = items.kind === "ready" && !left.length;
  const scope = all.filter(
    (i) => !pendingIds.has(i.id) && (!proposedOnly || i.proposal) && found(i),
  );
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
  const queue = flow ? flow.queue.filter((id) => waitingIds.has(id) && !pendingIds.has(id)) : [];
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
    // A confirmation only acknowledges the action; z still undoes it after it fades.
    const timer = window.setTimeout(() => setToast(null), toast.tone ? 6000 : 2500);
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
  const pendingCount = flow ? writes.pending.filter((i) => flow.ids.includes(i.it.id)).length : 0;
  const reviewed = flowDone.recorded + flowDone.ignored + pendingCount;
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
    if (flow) return enqueue(current, "record");
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
    if (flow) return enqueue(it, "skip");
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
  /**
   * Same money from a schedule and from YNAB (TDD 18): ignore the waiting one of the pair,
   * keeping the other, so it counts once. When both wait, the other one is ignored.
   */
  async function ignorePair(it: StagedTransaction): Promise<boolean> {
    const pair = it.pair;
    if (!pair) return false;
    const other = all.find((x) => x.id === pair.item_id);
    const drop = pair.status === "waiting" && other ? other : it;
    if (!(await run(inbox.action(p.entity.id, drop, "skip")))) return false;
    undo.current.push([{ id: drop.id, action: "unskip" }]);
    advance([drop.id]);
    const kept = drop === it ? pair.payee : it.payee;
    setToast({
      text: `Ignored ${drop.payee} on ${fmtShort(drop.financial_date)} as the same money as ${kept}. It counts once.`,
      undo: true,
    });
    return true;
  }
  async function undoLast(): Promise<boolean> {
    const id = undo.current[undo.current.length - 1]?.[0]?.id;
    if (id && pendingIds.has(id)) {
      if (writes.cancel(id)) {
        undo.current.pop();
        setCur(id);
        return true;
      }
      setToast({ text: "This write was sent. Undo after its result is confirmed." });
      return false;
    }
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
  function enqueue(it: StagedTransaction, action: "record" | "skip") {
    if (!writes.enqueue(it, action, drafts[it.id])) return false;
    undo.current.push([{ id: it.id, action: action === "skip" ? "unskip" : "undo" }]);
    setFlow((f) => f && { ...f, editing: false, later: f.later.filter((id) => id !== it.id) });
    return true;
  }
  function startFlow() {
    const order = rows(all, "waiting").flatMap((r) =>
      "it" in r && r.it.status === "waiting" && !pendingIds.has(r.it.id) ? [r.it.id] : [],
    );
    if (!order.length) return setToast({ text: "Nothing is waiting in the inbox.", tone: "warn" });
    setSelected(new Set());
    setProposedOnly(false);
    setQuery("");
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
    if (writes.pending.length) {
      refreshOnDrain.current = true;
      void writes.flush();
    } else refreshAll();
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
    if (id && pendingIds.has(id) && !writes.cancel(id)) {
      // A sent write cannot be cancelled; undo it once its result patches the item.
      if (writes.pending.some((i) => i.it.id === id && i.state === "sending")) {
        setUndoAfterSave(id);
        return setToast({ text: "Undoing once the save is confirmed." });
      }
      return setToast({ text: "This write was sent. Undo after its result is confirmed." });
    }
    if (last?.length === 1 && (last[0].action === "later" || (id && pendingIds.has(id)))) {
      undo.current.pop();
      setFlow(front);
      return setToast({ text: "Undone. Back on that item." });
    }
    if (await undoLast()) setFlow(front);
  }
  /** z pressed while that item's write was in flight: undo once it settles. */
  const [undoAfterSave, setUndoAfterSave] = useState<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Run once the awaited write leaves the queue.
  useEffect(() => {
    if (!undoAfterSave || pendingIds.has(undoAfterSave)) return;
    setUndoAfterSave(null);
    // A rejected write already left the undo stack, and a later action replaces this undo.
    if (flow && undo.current[undo.current.length - 1]?.[0]?.id === undoAfterSave) void flowUndo();
  }, [undoAfterSave, writes.pending]);
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
      if (["1", "2", "3", "4", "5", "6", "a", "f", "t", "r", "c"].includes(key)) return false;
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
      case "m":
        if (current?.pair) void ignorePair(current);
        break;
      case "e":
        editing(true);
        break;
      case "c":
        if (current) openNote([current]);
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

  // A note being written belongs to the item or selection it was opened on.
  // biome-ignore lint/correctness/useExhaustiveDependencies: Close it when the cursor or selection moves.
  useEffect(() => setNoting(null), [current?.id, chosen.length]);

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
    if (seen.current !== null && proposals.proposed > seen.current)
      setProposalRevision((x) => x + 1);
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
  /** c: write a note on the current item, or one note for every selected item. */
  function openNote(its: StagedTransaction[]) {
    const open = its.filter((it) => NOTABLE.has(it.status));
    if (!open.length)
      return setToast({
        text: "A recorded item's note is on its actual entry. Change it in Activity.",
        tone: "warn",
      });
    const shared = new Set(open.map((it) => it.note));
    setNoting({ ids: open.map((it) => it.id), text: shared.size === 1 ? [...shared][0] : "" });
  }
  /** Save the note on the items it was opened for; an empty note clears it. */
  async function saveNote() {
    if (!noting) return;
    const its = noting.ids.flatMap((id) => all.find((it) => it.id === id) ?? []);
    const text = noting.text.trim();
    const saved =
      its.length === 1
        ? (await run(inbox.note(p.entity.id, its[0], text)))
          ? 1
          : 0
        : (await many(inbox.noteMany(p.entity.id, its, text), its)).filter((r) => r.ok).length;
    if (!saved) return;
    setNoting(null);
    const what = its.length === 1 ? its[0].payee : `${saved} of ${its.length} selected`;
    setToast({
      text: text ? `Saved the note on ${what}.` : `Cleared the note on ${what}.`,
    });
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
        category: c.category as InboxCategory,
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
            ? "No subcategories yet. Type a name to create one."
            : c.category === "income"
              ? "No Income sources yet. Add them to a Plan."
              : "Nothing to choose here yet. Type a name to create one.",
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
        foot: ids ? "Adds to every selected item; removes when all carry it." : undefined,
        none: "No tags yet. Type a name to create one.",
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
        foot: "Same payee first, then nearest earlier date.",
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
        foot: "Nothing changes until you choose.",
      });
    }
  }
  /** Change the drafts of these items, from their latest drafts after an awaited create. */
  function assign(ids: string[], change: (c: Completion) => Completion) {
    setDrafts((d) => {
      const next = { ...d };
      for (const id of ids) {
        const it = all.find((x) => x.id === id);
        if (it) next[id] = change(effective(it, d[id]));
      }
      return next;
    });
    setHints((h) => Object.fromEntries(Object.entries(h).filter(([id]) => !ids.includes(id))));
  }
  /**
   * Create a record through its own create command, with one retry identity across a sign-in,
   * then choose it for these items. Lists reload so every picker has it.
   */
  async function create(request: CreateRequest, ids: string[], kind: "line" | "tag") {
    const key = crypto.randomUUID();
    const spec = createSpec(p.entity.id, request);
    setBusy(true);
    try {
      let data: unknown;
      try {
        data = await send(await p.credentials(), spec, key);
      } catch (error) {
        if (!(error instanceof ApiError) || error.kind !== "unauthenticated") throw error;
        data = await send(await p.credentials(true), spec, key);
      }
      const id = createdId(request, data);
      const list = kind === "tag" ? "tag" : LIST[request.kind];
      const shown =
        request.kind === "saving_goal"
          ? `${request.account.name} · ${cleanName(request.name)}`
          : cleanName(request.name);
      if (id && list) setMade((all) => [...all, { list, id, name: shown }]);
      if (id && kind === "line") assign(ids, (c) => ({ ...c, assignment: id }));
      else if (id)
        assign(ids, (c) => ({ ...c, tag_ids: [...(c.tag_ids ?? []).filter((t) => t !== id), id] }));
      setToast({ text: `Created the ${NOUNS[request.kind]} ${cleanName(request.name)}.` });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Try again.";
      setToast({ text: `Not created. ${message}`, tone: "bad" });
      return false;
    } finally {
      setBusy(false);
      refreshAll();
    }
  }
  function chooseCreate(option: Option, pick: Picker, ids: string[]) {
    const [, kind, ref] = option.id.split(":");
    const name = cleanName(pick.query);
    if (kind === "fixed_cost") {
      const plan = planDrafts(plans.kind === "ready" ? plans.data : []).find(
        (x) => x.planId === ref,
      );
      if (plan)
        setFixedForm({
          name,
          planId: plan.planId,
          planName: plan.draft.name,
          ids,
          amount: "",
          frequency: "Monthly",
        });
      return;
    }
    if (kind === "saving_goal") {
      const account =
        accounts.kind === "ready" ? accounts.data.find((a) => a.uuid === ref) : undefined;
      if (account) void create({ kind, name, account }, ids, "line");
      return;
    }
    void create(
      { kind: kind as "tag" | "spending_subcategory" | "investment" | "giving_recipient", name },
      ids,
      pick.kind === "tag" ? "tag" : "line",
    );
  }
  function submitFixed(form: FixedForm) {
    const plan = planDrafts(plans.kind === "ready" ? plans.data : []).find(
      (x) => x.planId === form.planId,
    );
    if (!plan || decimalToCents(form.amount.trim()) === null || form.amount.trim().startsWith("-"))
      return;
    setFixedForm(null);
    void create(
      {
        kind: "fixed_cost",
        name: form.name,
        planId: plan.planId,
        draft: plan.draft,
        amount: form.amount,
        frequency: form.frequency,
      },
      form.ids,
      "line",
    );
  }
  async function choose(option: Option) {
    const it = current;
    const kind = picker?.kind;
    const ids = picker?.ids;
    const pick = picker;
    setPicker(null);
    const targets = ids ? chosen.filter((x) => ids.includes(x.id)) : it ? [it] : [];
    if (!it || !kind || !targets.length || !pick) return;
    if (option.id.startsWith("create:"))
      return chooseCreate(
        option,
        pick,
        targets.map((x) => x.id),
      );
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
  /** "Create …" rows for a typed name that no option has, in CONTEXT.md's names. */
  function createRows(pick: Picker): Option[] {
    const typed = cleanName(pick.query);
    if (!typed || typed.length > 120 || pick.options.some((o) => sameName(o.name, typed)))
      return [];
    const row = (kind: string, ref = "", where = "") => ({
      id: `create:${kind}:${ref}`,
      name: `Create “${typed}”${where ? ` in ${where}` : ""}`,
      note: `New ${NOUNS[kind as keyof typeof NOUNS]}`,
    });
    const named = (names: string[]) => names.some((n) => sameName(n, typed));
    if (pick.kind === "tag")
      return named(tagState.kind === "ready" ? tagState.data.map((t) => t.name) : [])
        ? []
        : [row("tag")];
    if (pick.kind !== "line") return [];
    switch (pick.category) {
      case "spending":
        return named(
          subcategoryState.kind === "ready" ? subcategoryState.data.map((x) => x.name) : [],
        )
          ? []
          : [row("spending_subcategory")];
      case "investing":
        return [row("investment")];
      case "giving":
        return [row("giving_recipient")];
      case "saving":
        // A goal belongs to one savings account: offer each open account.
        return accounts.kind === "ready"
          ? accounts.data
              .filter((a) => a.active && !named(a.goals.map((g) => g.name)))
              .map((a) => ({ ...row("saving_goal", a.uuid, a.name), note: "New ongoing goal" }))
          : [];
      case "fixed_cost": {
        // A fixed cost is a line of a Plan: it joins a draft. Saved versions never change.
        const all = plans.kind === "ready" ? plans.data : [];
        if (named(fixedCostsOf(all).flatMap((c) => [c.name, c.canonical_name]))) return [];
        return planDrafts(all).map(({ planId, draft }) => ({
          ...row("fixed_cost", planId, `${draft.name}'s draft`),
          note: "Planned amount next",
        }));
      }
      default:
        return [];
    }
  }
  const filtered = picker
    ? [
        ...picker.options.filter((o) =>
          `${o.name} ${o.note ?? ""} ${o.sub ?? ""}`
            .toLowerCase()
            .includes(picker.query.toLowerCase()),
        ),
        ...createRows(picker),
      ]
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
    } else if (key === "c") openNote(chosen);
    else if (key === "r")
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
    if (fixedForm) return;
    if (picker) {
      if (key === "Escape") setPicker(null);
      else if (key === "ArrowDown")
        setPicker({ ...picker, at: Math.min(filtered.length - 1, picker.at + 1) });
      else if (key === "ArrowUp") setPicker({ ...picker, at: Math.max(0, picker.at - 1) });
      else if (key === "Enter") {
        if (filtered[picker.at]) void choose(filtered[picker.at]);
      } else if (key === "Backspace")
        setPicker({ ...picker, query: picker.query.slice(0, -1), at: 0 });
      else if (key.length === 1) setPicker({ ...picker, query: picker.query + key, at: 0 });
      return;
    }
    if (busy && !["j", "k", "ArrowDown", "ArrowUp", "?", "v", "/", "Escape"].includes(key)) return;
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
      case "c":
        if (!current) return notHere();
        return openNote([current]);
      case "m":
        if (!current || !waiting) return notHere();
        if (!current.pair)
          return setToast({
            text: "Nothing else in the inbox looks like the same money. Record or ignore it instead.",
            tone: "warn",
          });
        return void ignorePair(current);
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
      case "/":
        // Select what is there, so typing starts a new search.
        search.current?.focus();
        return search.current?.select();
      case "?":
        return setHelp(true);
      case "Escape":
        if (current) setHints(({ [current.id]: _, ...rest }) => rest);
    }
  }
  const keys = useRef(press);
  keys.current = press;
  const overlay = useRef(false);
  overlay.current = Boolean(picker) || help || Boolean(fixedForm);
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
      if (
        e.key === "Enter" &&
        e.target instanceof HTMLElement &&
        e.target.closest("button,summary")
      )
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
  const zeroProps = source && {
    look: p.zeroStyle,
    cleared,
    sourceName: source.name,
    lastSynced: source.last_synced_at,
    timeZone: p.entity.time_zone,
    month: p.entity.today.slice(0, 7),
    syncing: Boolean(syncing),
    busy,
    sync: () => void sync(),
    openReview: p.openReview && (() => p.openReview?.(p.entity.today.slice(0, 7))),
  };
  /** Waiting items the search or the proposals filter hides from an empty Waiting view. */
  const held =
    view === "waiting" && !counts.waiting
      ? left.filter((i) => i.status === "waiting" && !pendingIds.has(i.id))
      : [];
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

  const note: NoteEdit = {
    text: noting?.text ?? null,
    busy,
    setText: (text) => setNoting((n) => n && { ...n, text }),
    save: () => void saveNote(),
    cancel: () => setNoting(null),
  };

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
        {flow && (
          <button className="btn ix-leave" type="button" onClick={endFlow}>
            Leave flow
          </button>
        )}
        {source && !flow && (
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
                {reviewed} / {flow.ids.length}
              </b>{" "}
              · {flowDone.recorded} recorded · {flowDone.ignored} ignored · {flow.later.length}{" "}
              later{pendingCount > 0 && ` · ${pendingCount} unconfirmed`}
            </span>
            <span className="ix-track">
              <span
                style={{
                  width: `${(100 * reviewed) / Math.max(1, flow.ids.length)}%`,
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
            <div className="ix-search">
              <input
                ref={search}
                className="input"
                type="search"
                placeholder="Search payee, memo, note, amount…"
                aria-label="Search the inbox"
                aria-keyshortcuts="/"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  // Esc clears the search, then gives the keys back to the list; Enter or ↓ keep it.
                  if (e.key === "Escape") {
                    e.preventDefault();
                    if (query) setQuery("");
                    else e.currentTarget.blur();
                  } else if (e.key === "Enter" || e.key === "ArrowDown") {
                    e.preventDefault();
                    e.currentTarget.blur();
                  }
                }}
              />
              {!query && <Key k="/" />}
            </div>
          </>
        )}
      </header>
      {writes.storageProblem && (
        <div className="ix-msg warn" role="alert">
          Nothing queued. The browser cannot mark an interrupted flow. Leave flow to save one item
          at a time.
        </div>
      )}
      {writes.otherReceipts.length > 0 && (
        <div className="ix-msg warn" role="alert">
          Another or interrupted tab had unconfirmed flow decisions. Check that tab and the Waiting,
          Recorded and Ignored lists before repeating them.{" "}
          <button type="button" className="btn sm" onClick={writes.acknowledge}>
            I’ve checked
          </button>
        </div>
      )}
      {writes.pending.length > 0 && (
        <details
          className="ix-pending"
          open={writes.pending.some((i) => i.state === "uncertain") || undefined}
        >
          <summary>{writes.pending.length} unconfirmed · Keep this tab open</summary>
          {writes.pending.map((i) => (
            <div key={i.it.id}>
              {i.it.payee} · {i.action === "skip" ? "Ignore" : "Record"} ·{" "}
              {i.state === "uncertain" ? (
                <>
                  {i.reason}{" "}
                  <button className="btn sm" type="button" onClick={() => writes.retry(i.it.id)}>
                    {i.signIn ? "Sign in and retry" : "Retry"}
                  </button>
                </>
              ) : i.state === "queued" ? (
                "Queued"
              ) : (
                "Saving…"
              )}
            </div>
          ))}
        </details>
      )}
      {proposals && proposing ? (
        <output className="ix-syncing ix-run">
          <span className="ix-bar" aria-hidden="true" />
          <span>
            <span className="ix-spin" aria-hidden="true" /> <b>Agent proposing</b> ·{" "}
            {proposals.proposed} of {proposals.waiting} proposed. Safe to close this tab.
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
      ) : !flow && proposals?.run && proposals.waiting > 0 ? (
        <div className="ix-ready">
          <b>
            Proposals ready: {proposals.proposed - proposals.needs_you} proposed,{" "}
            {proposals.needs_you} need you
          </b>
        </div>
      ) : null}
      {syncing && (
        <output className="ix-syncing">
          <span className="ix-bar" aria-hidden="true" />
          <span>
            <span className="ix-spin" aria-hidden="true" /> Syncing {syncing} from YNAB
          </span>
        </output>
      )}
      {monthWaiting > 0 && (
        <div className="ix-strip">
          <b>Review {fmtMonth(month)}</b>
          {waitingLabel(monthWaiting)}
          <span>as this month's Review shows it</span>
        </div>
      )}
      <LoadProblem states={failed} retry={() => setReload((x) => x + 1)} />
      {items.kind === "loading" && !syncing ? (
        <LoadingCard label="Loading the inbox" />
      ) : syncing && !all.length ? (
        <LoadingCard label={`Syncing ${syncing}`} />
      ) : source && !source.synced && source.accounts.length && !all.length ? (
        <div className="ix-empty">
          <b>Ready to sync {source.name}</b>
          <p className="note">
            {source.accounts.length} account{source.accounts.length === 1 ? "" : "s"} chosen
          </p>
          <button type="button" className="btn pri sm" disabled={busy} onClick={() => void sync()}>
            Sync {source.name} now
          </button>
        </div>
      ) : (sources.kind === "empty" && !all.length) || (source && !source.accounts.length) ? (
        <div className="ix-empty">
          {p.entity.role === "member" ? (
            <p className="note">
              Only this Entity's owner connects a transaction source and chooses its accounts.
            </p>
          ) : (
            <ConnectSource
              key={source?.id ?? "new"}
              entityId={p.entity.id}
              today={p.entity.today}
              source={source}
              credentials={p.credentials}
              openSettings={p.openSettings}
              connected={(saved) => void sync(saved)}
            />
          )}
        </div>
      ) : flow ? (
        <div className="ix-flow">
          {(passOver || !current) && zero && zeroProps ? (
            <InboxZero {...zeroProps} flow={{ undo: () => void flowUndo(), leave: endFlow }} />
          ) : passOver || !current ? (
            <article
              className="ix-card ix-end"
              aria-label="Pass complete"
              ref={focusCard}
              tabIndex={-1}
            >
              <div className="ix-d-t">Pass complete</div>
              <p>
                {flowDone.recorded} recorded · {flowDone.ignored} ignored · {flow.later.length} left
                for later
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
                key={current.id}
                tabIndex={-1}
                ref={focusCard}
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
                      note={note}
                    />
                    <button type="button" className="btn quiet" onClick={() => press("Escape")}>
                      Back to flow <Key k="Esc" />
                    </button>
                  </>
                ) : (
                  <>
                    {hints[current.id] && (
                      <div role="alert" className="ix-msg warn">
                        {hints[current.id]}
                      </div>
                    )}
                    <FlowCard
                      it={current}
                      c={shownAs(current)}
                      choices={choices}
                      later={flow.later.includes(current.id)}
                      press={press}
                      note={note}
                    />
                  </>
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
      ) : zero && view === "waiting" && zeroProps ? (
        <div className={`ix-zero-wrap${p.zeroStyle === "quiet" ? " quiet" : ""}`}>
          <InboxZero {...zeroProps} />
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
                    : `Select all ${selectable.length}${query.trim() ? " matching" : ""}`}
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
              onKeyDown={undefined}
              onClick={(event) => {
                if (!(event.target instanceof Element)) return;
                const id = event.target.closest<HTMLElement>("[data-id]")?.dataset.id;
                if (!id) return;
                if (event.target.closest('[role="checkbox"]')) toggle(id, event.shiftKey);
                else setCur(id);
              }}
            >
              {shown.length === 0 && (
                <div className="ix-empty">
                  <b>
                    {query.trim()
                      ? `Nothing ${VIEW_NAMES[view].toLowerCase()} matches “${query.trim()}”`
                      : proposedOnly
                        ? "No proposals here"
                        : "Nothing here"}
                  </b>
                  {held.length ? (
                    // Waiting items outside the search or filter: not inbox zero yet.
                    <>
                      <p>
                        {held.length} still waiting{" "}
                        {query.trim() ? "outside this search" : "without a proposal"}.
                      </p>
                      <p>
                        <button
                          type="button"
                          className="btn sm"
                          onClick={() => {
                            setQuery("");
                            setProposedOnly(false);
                          }}
                        >
                          Show all {held.length} waiting
                        </button>
                      </p>
                    </>
                  ) : (
                    query.trim() && (
                      <p>
                        <button type="button" className="btn sm" onClick={() => setQuery("")}>
                          Clear search
                        </button>
                      </p>
                    )
                  )}
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
                note={note}
              />
            ) : current ? (
              <Detail
                it={current}
                c={shownAs(current)}
                touched={Boolean(drafts[current.id])}
                choices={choices}
                hint={hints[current.id]}
                press={press}
                note={note}
              />
            ) : held.length ? null : (
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
                ...(flow.later.length ? [[["l"], "Go through later"]] : []),
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
                  [["c"], "Note"],
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
                  [["c"], "Note for all"],
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
                  [["t"], "Tags"],
                  [["c"], "Note"],
                  [["s"], "Ignore"],
                  [["x"], "Select"],
                  [["z"], "Undo"],
                  [["v"], "View"],
                  [["p"], "Proposals"],
                  [["F"], "Flow"],
                  [["/"], "Search"],
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
      {fixedForm && (
        <div className="ix-ov" onClick={() => setFixedForm(null)} onKeyDown={undefined}>
          <form
            className="ix-pal create-form"
            aria-label={`New fixed cost ${fixedForm.name}`}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                setFixedForm(null);
              }
            }}
            onSubmit={(e) => {
              e.preventDefault();
              submitFixed(fixedForm);
            }}
          >
            <b>New fixed cost “{fixedForm.name}”</b>
            <p className="note">Joins {fixedForm.planName}&apos;s draft.</p>
            <div className="two">
              <label className="field">
                <span>Planned amount (USD)</span>
                <input
                  // biome-ignore lint/a11y/noAutofocus: The form opens to ask for this amount.
                  autoFocus
                  required
                  inputMode="decimal"
                  pattern="[0-9]{1,9}([.][0-9]{1,2})?"
                  placeholder="0.00"
                  value={fixedForm.amount}
                  onChange={(e) => setFixedForm({ ...fixedForm, amount: e.target.value })}
                />
              </label>
              <label className="field">
                <span>Frequency</span>
                <select
                  value={fixedForm.frequency}
                  onChange={(e) =>
                    setFixedForm({ ...fixedForm, frequency: e.target.value as Frequency })
                  }
                >
                  {Object.keys(FREQUENCIES).map((name) => (
                    <option key={name}>{name}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="create-form-actions">
              <button type="submit" className="btn pri" disabled={busy}>
                Create and choose
              </button>
              <button type="button" className="btn" onClick={() => setFixedForm(null)}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
      {help && <Help close={() => setHelp(false)} />}
    </div>
  );
}

const ItemRow = memo(function ItemRow({
  it,
  c,
  choices,
  current,
  checked,
  hint,
  undoable,
  inWaiting,
}: {
  it: StagedTransaction;
  c: Completion;
  choices: Choices;
  current: boolean;
  checked: boolean;
  hint?: string;
  undoable: boolean;
  inWaiting: boolean;
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
      aria-selected={current}
      data-id={it.id}
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
          {it.schedule && <span className="chip">Scheduled</span>}
          {it.pair && it.status === "waiting" && <span className="chip warn">Same money?</span>}
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
          {it.note && (
            <span className="ix-note-row">
              {" "}
              · <span aria-hidden="true">✎</span> {it.note}
            </span>
          )}
        </small>
      </div>
      <div className={`a${isInflow(it) ? " good" : ""}`}>{signed(it)}</div>
    </div>
  );
});

/** Flow mode's card: the item, the agent's proposal and why, and the flow's keys. */
function PairNotice({ it, press }: { it: StagedTransaction; press: (key: string) => void }) {
  const pair = it.pair;
  if (!pair || it.status !== "waiting") return null;
  const other = pair.from_schedule ? `your schedule ${pair.payee}` : `${pair.payee} from YNAB`;
  const recorded = pair.status === "recorded";
  return (
    <output className="ix-msg warn ix-match">
      <b>Likely the same money</b> as {other}, {formatMoney(pair.amount.replace("-", ""))} on{" "}
      {fmtDay(pair.financial_date)}
      {recorded ? ", already recorded" : ""}. Keep one and ignore the other so it counts once.
      <div className="ix-do">
        <button type="button" className="btn pri" onClick={() => press("m")}>
          {recorded ? "Ignore this one" : "Keep this, ignore the other"} <Key k="m" />
        </button>
      </div>
    </output>
  );
}

function FlowCard({
  it,
  c,
  choices,
  later,
  press,
  note,
}: {
  it: StagedTransaction;
  c: Completion;
  choices: Choices;
  later: boolean;
  press: (key: string) => void;
  note: NoteEdit;
}) {
  const unsure = !c.skip && !c.category && !c.refund_of;
  const inflow = isInflow(it);
  return (
    <>
      <div className="ix-d-h">
        <div>
          <div className="ix-d-t">{it.payee}</div>
          <div className="note">
            {fmtDay(it.financial_date)} · {it.schedule ? "Scheduled" : it.account_name}
            {it.source_category && ` · YNAB: ${it.source_category.name}`}
            {it.memo && ` · ${it.memo}`}
          </div>
        </div>
        <div className={`ix-fig${inflow ? " good" : ""}`}>{signed(it)}</div>
      </div>
      {later && <div className="ix-msg">You passed this one with Later.</div>}
      <PairNotice it={it} press={press} />
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
      <NoteBox its={[it]} edit={note} press={press} />
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
        <button type="button" className="btn" onClick={() => press("c")}>
          {it.note ? "Edit note" : "Note"} <Key k="c" />
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
  note,
}: {
  it: StagedTransaction;
  c: Completion;
  touched: boolean;
  choices: Choices;
  hint?: string;
  press: (key: string) => void;
  note: NoteEdit;
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
        {it.schedule ? (
          <>
            From your schedule {it.schedule.name}, planned for {fmtDay(it.schedule.scheduled_on)}
          </>
        ) : (
          <>
            Source YNAB: {it.source_category?.name ?? "Uncategorized"} · {it.account_name} ·{" "}
            {it.cleared ? "cleared" : "uncleared"}, {it.approved ? "approved" : "unapproved"}
          </>
        )}
        {it.split && ` · split line in a ${formatMoney(it.split.total.replace("-", ""))} split`}
        {it.kind !== "ordinary" && ` · ${it.kind.split("_").join(" ")}`}
        {it.memo && (
          <>
            <br />
            Memo: {it.memo}
          </>
        )}
      </div>
      <PairNotice it={it} press={press} />
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
        <div className="ix-msg">Updated in YNAB since it was staged.</div>
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
      <NoteBox its={[it]} edit={note} press={press} />
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
                Likely a refund: <Key k="r" /> links its purchase.
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
            ? `${formatMoney(purchase.remaining_refundable ?? null)} refundable`
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
              c.tag_ids?.length ? undefined : "Optional",
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

type NoteEdit = {
  /** The text being written, or null when no note is open. */
  text: string | null;
  busy: boolean;
  setText: (text: string) => void;
  save: () => void;
  cancel: () => void;
};

/**
 * The owner's note on an item or a selection: context, or why the agent's proposal is wrong.
 * It is an annotation only; recording keeps it on the actual entry's note.
 */
function NoteBox({
  its,
  edit,
  press,
}: {
  its: StagedTransaction[];
  edit: NoteEdit;
  press: (key: string) => void;
}) {
  const one = its.length === 1 ? its[0] : null;
  const open = its.some((it) => NOTABLE.has(it.status));
  if (edit.text !== null)
    return (
      <div className="ix-note editing">
        <label className="lab" htmlFor="ix-note-text">
          {one ? "Your note" : `One note for all ${its.length}`}
          <span>Kept on the actual entry</span>
        </label>
        <textarea
          id="ix-note-text"
          // biome-ignore lint/a11y/noAutofocus: c opens the note to type in it.
          autoFocus
          rows={3}
          maxLength={1000}
          value={edit.text}
          placeholder="Context, or why the proposal is wrong, such as: a birthday gift for a friend."
          onChange={(e) => edit.setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              edit.cancel();
            } else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              edit.save();
            }
          }}
        />
        <div className="ix-note-do">
          <button type="button" className="btn pri sm" disabled={edit.busy} onClick={edit.save}>
            Save note <Key k="Enter" />
          </button>
          <button type="button" className="btn quiet sm" onClick={edit.cancel}>
            Cancel <Key k="Esc" />
          </button>
        </div>
      </div>
    );
  if (!one) {
    const notes = new Set(its.map((it) => it.note));
    const shared = notes.size === 1 ? [...notes][0] : "Mixed";
    return (
      <button type="button" className="ix-fld" onClick={() => press("c")}>
        <Key k="c" />
        <span>
          <span className="fl">Note</span>
          <span className={`fv${shared ? "" : " none"}`}>{shared || "None"}</span>
          <span className="fx">Optional. One note replaces each selected item's note.</span>
        </span>
      </button>
    );
  }
  if (!one.note)
    return open ? (
      <button type="button" className="ix-fld" onClick={() => press("c")}>
        <Key k="c" />
        <span>
          <span className="fl">Note</span>
          <span className="fv none">Add a note</span>
          <span className="fx">Context, or why the proposal is wrong. Kept on the entry.</span>
        </span>
      </button>
    ) : null;
  return (
    <div className="ix-note">
      <div className="lab">
        Your note
        <span>
          {one.noted_at && fmtShort(one.noted_at.slice(0, 10))}
          {!open && " · on the actual entry"}
        </span>
      </div>
      <p className="ix-why">{one.note}</p>
      {open && (
        <button type="button" className="btn quiet sm" onClick={() => press("c")}>
          Edit note <Key k="c" />
        </button>
      )}
    </div>
  );
}

/** The batch panel: what the selection will record, and one choice set on all of it. */
function BatchDetail({
  its,
  cs,
  choices,
  busy,
  press,
  note,
}: {
  its: StagedTransaction[];
  cs: Completion[];
  choices: Choices;
  busy: boolean;
  press: (key: string) => void;
  note: NoteEdit;
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
          "Optional; added to every selected item",
        )}
      <NoteBox its={its} edit={note} press={press} />
      <div className="ix-msg">Any that cannot record stay selected, with the reason.</div>
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
    "c",
    "Write a note: context, or why the proposal is wrong. With a selection, one note for all of them. In the note, Enter saves, Shift Enter adds a line, Esc cancels. Recording keeps it on the actual entry.",
  ],
  [
    "s",
    "Ignore: it stays out of totals, even after a re-sync. Under Ignored, return it to the inbox.",
  ],
  [
    "x",
    "Select or deselect for a batch; shift-click a box to select a range. X selects every waiting item shown. With a selection, 1–6, a, f, t and c set the same choice on all of them, Enter records them, s ignores them, and Esc clears it.",
  ],
  [
    "m",
    "Same money from a schedule and from YNAB: keep this item and ignore its pair (or this one, when the pair is recorded), so it counts once. z returns it.",
  ],
  ["z", "Undo the last recording or ignore."],
  ["v", "Change the view: Waiting, Ignored, Recorded."],
  ["p", "Show only items with a proposal, or all items again."],
  [
    "/",
    "Search by payee, memo, YNAB category, amount, the proposal and its question, your note, or what was recorded, including its line or subcategory and tags. Every word must match. It narrows every view and the proposals filter, and X selects only matching rows. Enter returns to the list; Esc clears the search.",
  ],
  [
    "F",
    "Flow: one waiting item at a time. Enter accepts, l or → leaves it for later (nothing is saved), s ignores, e edits, c writes a note, z undoes, Esc leaves.",
  ],
  [
    "↑ ↓ Enter Esc",
    "In a picker: move, choose, cancel. Type a name it does not have to create it: a tag, subcategory, goal, investment, giving recipient or fixed cost.",
  ],
  [
    "Ctrl K",
    "Ask, or jump to another screen (⌘ K on a Mac). Ctrl J or ⌘ J opens the assistant and n adds activity.",
  ],
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
