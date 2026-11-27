/**
 * Presentation model for the Transactions inbox. The server is the authority for every
 * financial rule; `precheck` only explains, before a round trip, why Enter cannot record yet.
 */
import { daysBetween, decimalToCents, fmtShort, formatMoney } from "../../lib/format";
import type { Completion, InboxCategory, StagedTransaction } from "../../lib/inbox";
import type { Activity } from "../../lib/monthly";
import { type Searchable, searchable as searchFields } from "../../lib/search";
import type { Tag } from "../../lib/tags";

export type View = "waiting" | "skipped" | "recorded";
export const CATEGORIES: Array<{
  id: InboxCategory;
  name: string;
  kind: string;
  line?: string;
  article?: string;
}> = [
  {
    id: "income",
    name: "Income",
    kind: "income",
    line: "Income source",
    article: "an Income source",
  },
  {
    id: "fixed_cost",
    name: "Fixed costs",
    kind: "fixed",
    line: "Fixed cost",
    article: "a fixed cost",
  },
  // Optional assignment: no article, so Enter records it Unassigned when none is chosen.
  { id: "spending", name: "Guilt-free spending", kind: "free", line: "Subcategory" },
  { id: "saving", name: "Saving", kind: "save", line: "Saving goal", article: "a saving goal" },
  {
    id: "investing",
    name: "Investing",
    kind: "invest",
    line: "Investment",
    article: "an investment",
  },
  {
    id: "giving",
    name: "Giving",
    kind: "give",
    line: "Giving recipient",
    article: "a giving recipient",
  },
];
export const CATEGORY = Object.fromEntries(CATEGORIES.map((c) => [c.id, c])) as Record<
  InboxCategory,
  (typeof CATEGORIES)[number]
>;
export const SKIP_REASONS: Record<string, [string, string]> = {
  transfer_on_budget: [
    "transfer between imported accounts",
    "This moves existing money between accounts. It is neither income nor spending.",
  ],
  card_payment: [
    "credit card payment",
    "The card's purchases are their own items. Recording the payment as well would count that spending twice.",
  ],
  transfer_tracking: [
    "transfer to a tracking account",
    "Money moving to an account outside the plan. Record it as an investing contribution or skip it.",
  ],
};

export type Option = { id: string; name: string; note?: string; sub?: string; warn?: boolean };
export interface Choices {
  lines: Record<InboxCategory, Option[]>;
  goals: Array<Option & { saved: number }>;
  purchases: Activity[];
  entries: Activity[];
  tags?: Tag[];
}

export const cents = (it: StagedTransaction) => decimalToCents(it.amount) ?? 0;
export const isInflow = (it: StagedTransaction) => cents(it) > 0;
export const isReadyToAssign = (it: StagedTransaction) =>
  /ready to assign/i.test(it.source_category?.name ?? "");

/** The local edit if there is one, otherwise the stored proposal. */
export function effective(it: StagedTransaction, draft?: Completion): Completion {
  return draft ?? it.proposal ?? {};
}

/** Why Enter cannot record this completion yet, mirroring the server's record command. */
export function precheck(it: StagedTransaction, c: Completion): string | null {
  const inflow = isInflow(it);
  if (c.skip) return null;
  if (c.refund_of) return inflow ? null : "Only an inflow can be linked as a refund.";
  if (!c.category) {
    if (inflow && !isReadyToAssign(it))
      return "This inflow has no proposal. Link the purchase it refunds (r), or choose a category (1–6).";
    if (it.kind === "transfer_tracking")
      return "Nothing is proposed here. Press 5 for an investing contribution, or s to skip.";
    return "There is no proposal to accept. Choose a category: 1–6.";
  }
  const category = CATEGORY[c.category];
  if (inflow && c.category !== "income")
    return `An inflow to ${category.name.toLowerCase()} is a refund. Link its purchase first: r.`;
  if (!inflow && c.category === "income")
    return "Income is money received, and this item is an outflow.";
  if (category.article && !c.assignment) return `Choose ${category.article} first: a.`;
  return null;
}

export function lineName(choices: Choices, c: Completion): string | null {
  if (!c.category || !c.assignment) return null;
  if (c.assignment === "unassigned") return `Unassigned ${CATEGORY[c.category].name.toLowerCase()}`;
  const pool = c.category === "saving" ? choices.goals : choices.lines[c.category];
  return pool.find((o) => o.id === c.assignment)?.name ?? "A record outside this list";
}
export function fundingName(choices: Choices, c: Completion): string {
  if (!c.funding || c.funding === "income") return "Current income";
  return `Saved money: ${choices.goals.find((g) => g.id === c.funding)?.name ?? "a saving goal"}`;
}
/** Record checks name goals by id; show the goal's name instead. */
export function readable(choices: Choices, message: string): string {
  return choices.goals.reduce((text, g) => text.split(g.id).join(g.name), message);
}
export function purchaseLabel(p: Activity) {
  return `${p.note || "Purchase"}, ${fmtShort(p.financial_date)}`;
}

/** The one-line summary under each row. */
export function summary(it: StagedTransaction, c: Completion, choices: Choices) {
  const prefix = it.status === "recorded" ? "Recorded" : it.status === "skipped" ? "Ignored" : "";
  if (it.status === "conflict")
    return {
      kind: c.category ? CATEGORY[c.category].kind : "none",
      text: `Recorded, then ${it.deleted_in_source ? "deleted" : "changed"} in YNAB`,
    };
  if (c.skip)
    return {
      kind: "none",
      text: `${prefix ? `${prefix}: ` : "Ignore proposed: "}${SKIP_REASONS[it.kind]?.[0] ?? "not an actual entry"}`,
    };
  if (c.refund_of) {
    const p = choices.purchases.find((x) => x.uuid === c.refund_of);
    return {
      kind: "free",
      text: [prefix, `Refund of ${p ? purchaseLabel(p) : "an earlier purchase"}`]
        .filter(Boolean)
        .join(": "),
    };
  }
  if (!c.category)
    return {
      kind: "none",
      text:
        prefix ||
        (isInflow(it) && !isReadyToAssign(it)
          ? "Needs a refund link"
          : it.kind === "transfer_tracking"
            ? "Investing contribution or skip"
            : "No proposal"),
    };
  const parts = [
    CATEGORY[c.category].name,
    lineName(choices, c),
    !isInflow(it) && c.funding && c.funding !== "income"
      ? `from ${choices.goals.find((g) => g.id === c.funding)?.name ?? "savings"}`
      : null,
  ].filter(Boolean);
  return {
    kind: CATEGORY[c.category].kind,
    text: `${prefix ? `${prefix}: ` : ""}${parts.join(" · ")}`,
  };
}

/**
 * What inbox search reads on an item: payee, memo, source category, amount, and what the row
 * shows it as (the proposal or edit, or the recorded entry with its line) with the proposal's
 * rationale or question, the owner's note, and the tags it carries or will carry.
 */
export function searchable(
  it: StagedTransaction,
  c: Completion,
  choices: Choices,
  entry?: Activity,
): Searchable {
  const line =
    entry &&
    (entry.fixed_cost_name ??
      entry.spending_subcategory_name ??
      lineName(choices, {
        category: entry.category,
        assignment:
          entry.source_id ??
          entry.saving_goal_id ??
          entry.investment_id ??
          entry.giving_recipient_id ??
          null,
      }));
  const tagIds = entry ? (entry.tag_ids ?? []) : (c.tag_ids ?? []);
  return searchFields(
    [
      it.payee,
      it.memo,
      it.source_category?.name,
      summary(it, c, choices).text,
      line,
      it.proposal?.rationale,
      it.note,
      ...tagIds.map((id) => choices.tags?.find((tag) => tag.uuid === id)?.name),
    ],
    cents(it),
  );
}

export type Row =
  | { head: string; sub: string; warn?: boolean }
  | { parent: string; payee: string; lines: number; total: string; waiting: number }
  | { it: StagedTransaction };

/** Waiting items oldest first by month, split lines under their parent; then conflicts. */
export function rows(items: StagedTransaction[], view: View): Row[] {
  const out: Row[] = [];
  if (view === "waiting") {
    const waiting = items.filter((i) => i.status === "waiting");
    let month = "";
    let parent: string | null = null;
    for (const it of waiting) {
      const m = it.financial_date.slice(0, 7);
      if (m !== month) {
        month = m;
        parent = null;
        const n = waiting.filter((i) => i.financial_date.startsWith(m)).length;
        out.push({ head: m, sub: waitingLabel(n), warn: true });
      }
      if (it.parent_ref !== parent) {
        parent = it.parent_ref;
        if (parent && it.split)
          out.push({
            parent,
            payee: it.payee,
            lines: it.split.lines,
            total: it.split.total,
            waiting: waiting.filter((i) => i.parent_ref === parent).length,
          });
      }
      out.push({ it });
    }
    const conflicts = items.filter((i) => i.status === "conflict");
    if (conflicts.length) {
      out.push({ head: "Conflicts", sub: "recorded, then changed in YNAB" });
      for (const it of conflicts) out.push({ it });
    }
    return out;
  }
  const list = items.filter((i) => i.status === view);
  if (view === "recorded") list.reverse();
  if (list.length)
    out.push(
      view === "skipped"
        ? { head: "Ignored", sub: "not actual entries, not in any total, kept on re-sync" }
        : { head: "Recorded", sub: "most recent first" },
    );
  for (const it of list) out.push({ it });
  return out;
}
export const waitingLabel = (n: number) =>
  n === 0
    ? "No transactions waiting in the inbox"
    : `${n} transaction${n === 1 ? "" : "s"} waiting in the inbox`;

/** Purchases this inflow could refund: same payee first, then the nearest earlier date. */
export function refundCandidates(it: StagedTransaction, purchases: Activity[]): Option[] {
  const amount = cents(it);
  const payee = it.payee.toLowerCase();
  const samePayee = (p: Activity) => p.note.toLowerCase().startsWith(payee);
  return purchases
    .filter(
      (p) =>
        p.financial_date <= it.financial_date &&
        (decimalToCents(p.remaining_refundable ?? "0") ?? 0) >= amount,
    )
    .sort(
      (a, b) =>
        Number(samePayee(b)) - Number(samePayee(a)) ||
        b.financial_date.localeCompare(a.financial_date),
    )
    .map((p) => ({
      id: p.uuid,
      name: purchaseLabel(p),
      sub: `${samePayee(p) ? "Same payee" : "Different payee"}, ${daysBetween(p.financial_date, it.financial_date)} days earlier`,
      note: `${formatMoney(p.amount)} · ${formatMoney(p.remaining_refundable ?? null)} refundable`,
    }));
}
