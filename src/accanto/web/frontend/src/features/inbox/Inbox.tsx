import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, type BrowserSession, type LoadState } from "../../lib/api";
import { destinations } from "../../lib/destinations";
import { decimalToCents, fmtDay, fmtMonth, fmtShort, formatMoney, money } from "../../lib/format";
import {
  type Completion,
  type InboxCategory,
  type InboxWrite,
  type StagedTransaction,
  inbox,
  send,
} from "../../lib/inbox";
import { monthly } from "../../lib/monthly";
import { savings } from "../../lib/savings";
import { tags } from "../../lib/tags";
import { tint } from "../../ui";
import { LoadProblem, LoadingCard } from "../workspace/Activity";
import { type ScreenProps, sourceChoices, useLoad } from "../workspace/shared";
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
};
type Toast = { text: string; tone?: "warn" | "bad"; undo?: boolean };
type Undo = Array<{ id: string; action: "undo" | "unskip" | "skip" }>;
const VIEWS: View[] = ["waiting", "skipped", "recorded"];
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
 * The Transactions inbox: staged transactions from a source, recorded or skipped from the keyboard.
 * Every write is an explicit inbox command; the server re-runs every check when recording.
 */
export function Inbox(
  p: ScreenProps & {
    credentials: (signIn?: boolean) => Promise<BrowserSession>;
    openSettings?: () => void;
  },
) {
  const [reload, setReload] = useState(0);
  const deps = [p.entity.id, p.refresh, reload];
  const items = useSettled(useLoad(() => inbox.list(p.entity.id), deps));
  const sources = useSettled(useLoad(() => inbox.sources(p.entity.id), deps));
  const plans = useSettled(useLoad(() => monthly.plans(p.entity.id), deps));
  const accounts = useSettled(useLoad(() => savings.list(p.entity.id), deps));
  const activity = useSettled(useLoad(() => monthly.activity(p.entity.id), deps));
  const investments = useSettled(useLoad(() => destinations.list(p.entity.id, "investment"), deps));
  const recipients = useSettled(useLoad(() => destinations.list(p.entity.id, "giving"), deps));
  const tagState = useSettled(useLoad(() => tags.list(p.entity.id), deps));
  const [view, setView] = useState<View>("waiting");
  const [cur, setCur] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
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

  const all = items.kind === "ready" ? items.data : [];
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
        spending: [],
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
  }, [plans, accounts, activity, investments, recipients, tagState]);

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
  const shown = rows(all, view);
  const ids = shown.flatMap((r) => ("it" in r ? [r.it.id] : []));
  const current = all.find((i) => i.id === cur && ids.includes(i.id)) ?? null;
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
    waiting: all.filter((i) => i.status === "waiting").length,
    skipped: all.filter((i) => i.status === "skipped").length,
    recorded: all.filter((i) => i.status === "recorded").length,
  };
  const month = (current?.financial_date ?? p.entity.today).slice(0, 7);
  const monthWaiting = all.filter(
    (i) => i.status === "waiting" && i.financial_date.startsWith(month),
  ).length;

  async function run<T>(spec: InboxWrite): Promise<T | null> {
    const key = crypto.randomUUID();
    setBusy(true);
    try {
      try {
        return await send<T>(await p.credentials(), spec, key);
      } catch (error) {
        if (!(error instanceof ApiError) || error.kind !== "unauthenticated") throw error;
        return await send<T>(await p.credentials(true), spec, key);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "The inbox could not save. Try again.";
      setToast({ text: `Not saved. ${readable(choices, message)}`, tone: "bad" });
      return null;
    } finally {
      setBusy(false);
      setReload((x) => x + 1);
    }
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

  async function record() {
    if (!current) return;
    if (current.status === "conflict") return openPicker("resolve", current);
    const c = effective(current, drafts[current.id]);
    if (c.skip) return skip(current);
    const reason = precheck(current, c);
    if (reason) {
      setHints((h) => ({ ...h, [current.id]: reason }));
      return;
    }
    const result = await run<{ item: StagedTransaction }>(
      inbox.record(p.entity.id, current, drafts[current.id]),
    );
    if (!result) return;
    clearDraft(current.id);
    undo.current.push([{ id: current.id, action: "undo" }]);
    advance([current.id]);
    setToast({ text: `Recorded ${describe(current, c)}.`, undo: true });
  }
  async function recordSelected() {
    const chosen = all.filter((i) => selected.has(i.id) && i.status === "waiting");
    const ready: StagedTransaction[] = [];
    const stayed: string[] = [];
    for (const it of chosen) {
      const reason = precheck(it, effective(it, drafts[it.id]));
      if (reason) {
        stayed.push(it.id);
        setHints((h) => ({ ...h, [it.id]: reason }));
      } else if (!effective(it, drafts[it.id]).skip) ready.push(it);
    }
    const skips = chosen.filter(
      (it) => effective(it, drafts[it.id]).skip && !stayed.includes(it.id),
    );
    setSelected(new Set());
    const done: Undo = [];
    let rejected = stayed.length;
    if (ready.length) {
      const result = await run<{ results: Array<{ item_id: string; ok: boolean }> }>(
        inbox.recordMany(
          p.entity.id,
          ready.map((it) => ({ it, completion: drafts[it.id] })),
        ),
      );
      for (const r of result?.results ?? []) {
        if (r.ok) {
          done.push({ id: r.item_id, action: "undo" });
          clearDraft(r.item_id);
        } else rejected++;
      }
    }
    for (const it of skips)
      if (await run(inbox.action(p.entity.id, it, "skip")))
        done.push({ id: it.id, action: "unskip" });
    if (done.length) undo.current.push(done);
    advance(done.map((d) => d.id));
    const recorded = done.filter((d) => d.action === "undo").length;
    setToast({
      text: `${[
        recorded && `Recorded ${recorded}`,
        done.length - recorded && `Skipped ${done.length - recorded}`,
        rejected && `${rejected} stayed in the inbox with the reason shown`,
      ]
        .filter(Boolean)
        .join(". ")}.`,
      tone: rejected ? "warn" : undefined,
      undo: done.length > 0,
    });
  }
  async function skip(it: StagedTransaction) {
    const back = it.status === "skipped";
    if (!(await run(inbox.action(p.entity.id, it, back ? "unskip" : "skip")))) return;
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
        : `Skipped ${it.payee}. It stays visible under Skipped.`,
      undo: true,
    });
  }
  async function undoLast() {
    const last = undo.current.pop();
    if (!last) return setToast({ text: "Nothing to undo.", tone: "warn" });
    let done = 0;
    for (const { id, action } of [...last].reverse()) {
      // Each command needs the item's current revision, which changed with the last action.
      const fresh = await inbox.list(p.entity.id);
      const it = fresh.kind === "ready" ? fresh.data.find((i) => i.id === id) : undefined;
      if (it && (await run(inbox.action(p.entity.id, it, action)))) done++;
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
            ? `Undone. ${name} skipped again.`
            : `Undone. ${name} back in the inbox${first.action === "undo" ? " and out of the totals" : ""}.`
          : "Undo did not finish. The reason is shown above.",
      tone: done === last.length ? undefined : "bad",
    });
  }

  function setDraft(it: StagedTransaction, c: Completion) {
    setDrafts((d) => ({ ...d, [it.id]: c }));
    setHints(({ [it.id]: _, ...rest }) => rest);
  }
  function setCategory(it: StagedTransaction, category: InboxCategory) {
    const c = effective(it, drafts[it.id]);
    if (c.refund_of)
      return setToast({
        text: "A refund keeps its purchase's category and funding origin. Press r to change or remove the link.",
        tone: "warn",
      });
    const next: Completion =
      c.category === category
        ? { ...c, skip: false }
        : {
            category,
            assignment: null,
            funding:
              isInflow(it) || category === "saving" || category === "income" ? null : "income",
            tag_ids: c.tag_ids,
          };
    setDraft(it, next);
    if (CATEGORY[category].line && !next.assignment) openPicker("line", it, next);
  }
  function openPicker(
    kind: Picker["kind"],
    it: StagedTransaction,
    c = effective(it, drafts[it.id]),
  ) {
    const base = { query: "", at: 0 };
    if (kind === "line") {
      const category = CATEGORY[c.category as InboxCategory];
      setPicker({
        ...base,
        kind,
        title: `${category.line} for ${it.payee}`,
        placeholder: `Type to filter ${category.line?.toLowerCase()}s`,
        options:
          c.category === "saving" ? choices.goals : choices.lines[c.category as InboxCategory],
        foot:
          c.category === "saving"
            ? "Saving always names a goal. Unallocated savings is a goal too."
            : undefined,
        none: "Nothing to choose here yet. Add one on its own screen first.",
      });
    } else if (kind === "funding") {
      const amount = Math.abs(cents(it));
      setPicker({
        ...base,
        kind,
        title: `Funding origin for ${it.payee}, ${money(amount)}`,
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
      const chosen = c.tag_ids ?? [];
      setPicker({
        ...base,
        kind,
        title: `Tags for ${it.payee}`,
        placeholder: "Type to filter tags",
        options: (choices.tags ?? [])
          .filter((tag) => tag.active || chosen.includes(tag.uuid))
          .map((tag) => ({
            id: tag.uuid,
            name: tag.name,
            note: chosen.includes(tag.uuid) ? "added, choose to remove" : undefined,
          })),
        foot: "An entry can carry several tags. Choose one to add or remove it.",
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
    setPicker(null);
    if (!it || !kind) return;
    const c = effective(it, drafts[it.id]);
    if (kind === "line") setDraft(it, { ...c, assignment: option.id });
    else if (kind === "funding") setDraft(it, { ...c, funding: option.id });
    else if (kind === "tag") {
      const chosen = c.tag_ids ?? [];
      setDraft(it, {
        ...c,
        tag_ids: chosen.includes(option.id)
          ? chosen.filter((id) => id !== option.id)
          : [...chosen, option.id],
      });
    } else if (kind === "refund") setDraft(it, option.id ? { refund_of: option.id } : {});
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
                ? "This item is skipped. Press s to return it to the inbox."
                : "Already recorded. z undoes the last recording.",
            tone: "warn",
          });
        return void (selected.size ? recordSelected() : record());
      case "1":
      case "2":
      case "3":
      case "4":
      case "5":
      case "6":
        if (!current || !waiting) return notHere();
        return setCategory(current, CATEGORIES[Number(key) - 1].id);
      case "a":
        if (!current || !waiting) return notHere();
        if (c.refund_of)
          return setToast({
            text: "A refund is assigned through its purchase. Press r to change the link.",
            tone: "warn",
          });
        if (!c.category)
          return setHints((h) => ({ ...h, [current.id]: "Choose a category first: 1–6." }));
        if (!CATEGORY[c.category].line)
          return setToast({
            text: "Guilt-free spending has no assignment. The payee is kept as the entry's note.",
            tone: "warn",
          });
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
        if (c.skip) return setToast({ text: "A skipped item records nothing.", tone: "warn" });
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
            text: "A conflict is not skipped. Press Enter to choose a resolution.",
            tone: "warn",
          });
        if (current.status === "recorded")
          return setToast({
            text: "Recorded items are not skipped. z undoes the last recording.",
            tone: "warn",
          });
        return void skip(current);
      case "x":
        if (!current || !waiting) return notHere();
        return setSelected((s) => {
          const next = new Set(s);
          if (next.has(current.id)) next.delete(current.id);
          else next.add(current.id);
          return next;
        });
      case "z":
        return void undoLast();
      case "v": {
        setSelected(new Set());
        return setView(VIEWS[(VIEWS.indexOf(view) + 1) % VIEWS.length]);
      }
      case "?":
        return setHelp(true);
      case "Escape":
        if (selected.size) return setSelected(new Set());
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
      if (document.querySelector("dialog[open]")) return;
      if (
        e.key.length > 1 &&
        !["Enter", "Escape", "ArrowUp", "ArrowDown", "Backspace"].includes(e.key)
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
              {v[0].toUpperCase() + v.slice(1)} <small>{counts[v]}</small>
            </button>
          ))}
        </div>
        <Key k="v" />
      </header>
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
      ) : (
        <div className="ix-cols">
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
                <b>Nothing here</b>
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
                    undo.current[undo.current.length - 1]?.some((u) => u.id === row.it.id) ?? false
                  }
                  inWaiting={view === "waiting"}
                  onClick={() => setCur(row.it.id)}
                />
              ),
            )}
          </div>
          <section className="ix-detail" aria-live="polite">
            {current ? (
              <Detail
                it={current}
                c={shownAs(current)}
                touched={Boolean(drafts[current.id])}
                choices={choices}
                hint={hints[current.id]}
                selected={selected.size}
                press={press}
              />
            ) : (
              <div className="ix-empty">
                <b>
                  {view === "waiting"
                    ? "Nothing is waiting in the inbox"
                    : view === "skipped"
                      ? "Nothing is skipped"
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
        {(picker
          ? [
              [["↑", "↓"], "Move"],
              [[], "Type to filter"],
              [["Enter"], "Choose"],
              [["Esc"], "Cancel"],
            ]
          : [
              [["j", "k"], "Move"],
              [["Enter"], selected.size ? `Record ${selected.size} selected` : "Accept"],
              [["1–6"], "Category"],
              [["a"], "Assignment"],
              [["f"], "Funding origin"],
              [["r"], "Refund"],
              [["s"], "Skip"],
              [["x"], "Select"],
              [["z"], "Undo"],
              [["v"], "View"],
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
        <span className={`ix-chk${checked ? " on" : ""}`} aria-hidden="true">
          {checked ? "✓" : ""}
        </span>
      )}
      <i className="dot" style={tint(s.kind)} />
      <div className="t">
        <div className="tt">
          <span>{kid ? (it.source_category?.name ?? it.payee) : it.payee}</span>
          <span className="yc">{kid ? "split line" : it.source_category?.name}</span>
          {it.rejection && it.status === "waiting" && (
            <span className="chip bad">Not recorded</span>
          )}
          {hint && <span className="chip warn">Needs a choice</span>}
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
        </small>
      </div>
      <div className={`a${isInflow(it) ? " good" : ""}`}>{signed(it)}</div>
    </div>
  );
}

function Detail({
  it,
  c,
  touched,
  choices,
  hint,
  selected,
  press,
}: {
  it: StagedTransaction;
  c: Completion;
  touched: boolean;
  choices: Choices;
  hint?: string;
  selected: number;
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
            {it.status === "skipped" ? "Skipped" : "Proposed: skip"}
            <span>{SKIP_REASONS[it.kind]?.[0]}</span>
          </div>
          <div className="ix-msg">
            {SKIP_REASONS[it.kind]?.[1]} A skipped item is not an actual entry and counts in no
            total.
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
                <Key k="5" /> an investing contribution, or <Key k="s" /> skip.
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
                ? "Skipped. Was set to"
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
      {category?.line && !purchase && field("a", category.line, lineName(choices, c))}
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
              className={`btn pri${selected || c.category || c.skip || purchase ? "" : " off"}`}
              onClick={() => press("Enter")}
            >
              <Key k="Enter" />
              {selected
                ? `Record ${selected} selected`
                : c.skip
                  ? "Accept skip"
                  : c.category || purchase
                    ? touched
                      ? "Record"
                      : "Accept and record"
                    : "Nothing to accept yet"}
            </button>
            {!c.skip && (
              <button type="button" className="btn" onClick={() => press("s")}>
                <Key k="s" />
                Skip
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

const HELP: Array<[string, string]> = [
  ["j k", "Next and previous item. ↓ and ↑ also work."],
  [
    "Enter",
    "Accept the proposal, record the actual entry, and advance. Records every selected item. On a conflict, opens the resolution choices.",
  ],
  [
    "1 – 6",
    "Set the category: income, fixed costs, guilt-free spending, saving, investing, giving. Opens the assignment picker when one is needed.",
  ],
  ["a", "Choose the assignment. Type to filter."],
  ["f", "Choose the funding origin: current income or a saving goal."],
  ["t", "Add or remove tags. A refund carries its purchase's tags."],
  ["r", "Link an inflow as a refund from ranked purchase candidates."],
  ["s", "Skip. Under Skipped, return the item to the inbox."],
  ["x", "Select or deselect for Enter. Esc clears the selection."],
  ["z", "Undo the last recording or skip."],
  ["v", "Change the view: Waiting, Skipped, Recorded."],
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
