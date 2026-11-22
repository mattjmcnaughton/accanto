/**
 * A stateful, synthetic Transactions inbox for stories: reads and every inbox command, so keys
 * pressed in Storybook really record, skip and undo. The checks here only imitate the server's
 * record command closely enough to show its rejections; the backend is the authority.
 */
import { http, HttpResponse, delay } from "msw";
import type { Completion, StagedTransaction, TransactionSource } from "../../lib/inbox";
import type { Activity } from "../../lib/monthly";
import * as data from "./fixtures";

const entity = "/api/entities/:entity";
const SOURCE = "0b5e7c1d-0000-4000-8000-00000000a001";
export const IDS = {
  primaryPay: "8fa97fe8-4901-41cc-8796-cf84eaf97119",
  rent: "6e8226b8-189a-433f-b49b-37865af43cf5",
  kitchen: "adfc1a96-d20b-42f9-b488-c0d1f2f0fa00",
  tripGoal: "470c29f0-b477-4fc8-bfa1-aa1f14e81676",
  travelUnallocated: "a3f961ab-8b03-4932-8072-769a49a2b7ed",
  outfittersPurchase: "c0ffee00-0000-4000-8000-00000000b001",
  bookshopEntry: "c0ffee00-0000-4000-8000-00000000b002",
};
const AGENT = {
  user_id: data.session.user.id,
  interface: "direct_api",
  at: "2026-11-20T14:05:00Z",
};

let serial = 0;
function staged(
  date: string,
  amount: string,
  payee: string,
  category: string | null,
  extra: Partial<StagedTransaction> = {},
  proposal?: Completion & { rationale: string },
): StagedTransaction {
  serial += 1;
  const n = String(serial).padStart(4, "0");
  return {
    id: `5ea9ed00-0000-4000-8000-00000000${n}`,
    source_id: SOURCE,
    source_ref: `tx-${n}`,
    parent_ref: null,
    split: null,
    account_ref: "acc-checking",
    account_name: "Example Checking",
    financial_date: date,
    amount,
    payee,
    source_category: category ? { id: `cat-${category}`, name: category } : null,
    memo: null,
    kind: "ordinary",
    cleared: true,
    approved: true,
    deleted_in_source: false,
    status: "waiting",
    actual_entry_id: null,
    rejection: null,
    changed_after_staging: false,
    proposal: proposal ?? null,
    proposal_rejection: null,
    proposed_by: proposal ? AGENT : null,
    staged_at: "2026-11-20T13:00:00Z",
    revision: proposal ? 2 : 1,
    ...extra,
  };
}

/** The mockup's kinds of transaction, with proposals an agent set through the API. */
export function seedInbox(): StagedTransaction[] {
  serial = 0;
  const split = { parent_ref: "tx-split", split: { lines: 3, total: "-212.40" } };
  return [
    staged(
      "2026-10-28",
      "-46.50",
      "Sample Pharmacy",
      "Health",
      { changed_after_staging: true },
      {
        category: "spending",
        rationale: "Pharmacy purchases have been guilt-free spending.",
      },
    ),
    staged(
      "2026-10-30",
      "-15.99",
      "Example Streaming",
      "Subscriptions",
      {},
      {
        category: "fixed_cost",
        assignment: "unassigned",
        rationale: "A monthly subscription; no Fixed cost matches it yet.",
      },
    ),
    staged(
      "2026-11-02",
      "-84.37",
      "Sample Street Market",
      "Groceries",
      {},
      {
        category: "spending",
        rationale: "Groceries are guilt-free spending.",
      },
    ),
    staged("2026-11-03", "-37.15", "Placeholder Hardware", "Home Maintenance"),
    staged("2026-11-03", "-129.00", "Example Outfitters", "Clothing", {
      status: "recorded",
      actual_entry_id: IDS.outfittersPurchase,
    }),
    staged(
      "2026-11-04",
      "-6.50",
      "Example Coffee Cart",
      "Dining Out",
      {},
      {
        category: "spending",
        rationale: "Dining out has always been guilt-free spending.",
      },
    ),
    staged(
      "2026-11-05",
      "-386.40",
      "Mock Air Tickets",
      "Vacation",
      {},
      {
        category: "spending",
        funding: IDS.tripGoal,
        rationale: "Trip costs are paid from the Mountain trip goal.",
      },
    ),
    staged(
      "2026-11-06",
      "-640.00",
      "Sample Plumbing Co",
      "Home Repair",
      {
        proposal_rejection: {
          code: "invalid_savings",
          message:
            "Fixture travel · Unallocated has $400.00 saved, and this outflow needs $640.00. Shortfall: $240.00.",
        },
      },
      {
        category: "spending",
        funding: IDS.travelUnallocated,
        rationale: "Repairs come from savings when a goal can cover them.",
      },
    ),
    staged("2026-11-07", "-24.00", "Example Bookshop", "Books", {
      status: "conflict",
      deleted_in_source: true,
      actual_entry_id: IDS.bookshopEntry,
    }),
    staged("2026-11-09", "48.00", "Example Outfitters", "Clothing", { memo: "Store return" }),
    staged(
      "2026-11-13",
      "3100.00",
      "Demo Payroll Co",
      "Inflow: Ready to Assign",
      {},
      {
        category: "income",
        assignment: IDS.primaryPay,
        rationale: "Payroll from this payee is Primary pay.",
      },
    ),
    staged("2026-11-13", "85.00", "Placeholder Pay App", "Inflow: Ready to Assign"),
    staged("2026-11-14", "-150.40", "Sample Warehouse Club", "Groceries", split, {
      category: "spending",
      rationale: "Groceries are guilt-free spending.",
    }),
    staged("2026-11-14", "-32.00", "Sample Warehouse Club", "Household Goods", split, {
      category: "spending",
      rationale: "Household goods are guilt-free spending.",
    }),
    staged(
      "2026-11-14",
      "-30.00",
      "Sample Warehouse Club",
      "Charity",
      { ...split, memo: "Register round-up" },
      {
        category: "giving",
        assignment: IDS.kitchen,
        rationale: "Round-ups go to the community kitchen.",
      },
    ),
    staged(
      "2026-11-15",
      "-500.00",
      "Transfer: Example Savings",
      null,
      { kind: "transfer_on_budget", memo: "Example Checking to Example Savings" },
      { skip: true, rationale: "Both accounts are imported; this moves existing money." },
    ),
    staged(
      "2026-11-16",
      "-1240.18",
      "Payment: Sample Rewards Card",
      null,
      { kind: "card_payment" },
      { skip: true, rationale: "The card's purchases are their own items." },
    ),
    staged("2026-11-17", "-400.00", "Transfer: Sample Brokerage", null, {
      kind: "transfer_tracking",
      memo: "Example Checking to Sample Brokerage (tracking)",
    }),
    staged(
      "2026-11-19",
      "-2100.00",
      "Example Property Co",
      "Rent",
      {},
      {
        category: "fixed_cost",
        assignment: IDS.rent,
        rationale: "The landlord's payee is the Rent fixed cost.",
      },
    ),
    staged(
      "2026-11-20",
      "-58.20",
      "Example Bistro",
      "Dining Out",
      { approved: false, cleared: false },
      { category: "spending", rationale: "Dining out is guilt-free spending." },
    ),
  ].map((it) => ({
    ...it,
    source_ref: it.parent_ref ? `${it.parent_ref}:${it.source_ref}` : it.source_ref,
  }));
}

const entry = (uuid: string, date: string, amount: string, note: string): Activity => ({
  uuid,
  financial_date: date,
  category: "spending",
  amount,
  source_id: null,
  fixed_cost_id: null,
  fixed_cost_name: null,
  debt_account_id: null,
  note,
  revision: 1,
  is_adjustment: false,
  funding_origin: "income",
  saving_goal_id: null,
  destination_id: null,
  is_refund: false,
  refund_of: null,
  remaining_refundable: amount,
});
const seedActivity = () => [
  ...data.activity,
  entry(IDS.outfittersPurchase, "2026-11-03", "129.00", "Example Outfitters"),
  entry(IDS.bookshopEntry, "2026-11-07", "24.00", "Example Bookshop"),
];
export const source: TransactionSource = {
  id: SOURCE,
  kind: "ynab",
  name: "Fixture household plan",
  external_ref: "plan-fixture",
  start_date: "2026-10-01",
  connected: true,
  synced: true,
  last_synced_at: "2026-11-20T13:00:00Z",
  accounts: [{ id: "acc-checking", name: "Example Checking" }],
  waiting: 0,
  revision: 2,
};

const saved = Object.fromEntries(
  data.savingsAccounts.flatMap((a) =>
    a.goals.map((g) => [
      g.uuid,
      { name: `${a.name} · ${g.name}`, saved: Number(g.remaining_saved) },
    ]),
  ),
);
const reject = (status: number, code: string, message: string) =>
  HttpResponse.json({ detail: { code, message } }, { status });
const usd = (n: number) => `$${n.toFixed(2)}`;

/** Handlers over one in-memory inbox; pass items to start from another state. */
export function inboxApi(items: StagedTransaction[] = seedInbox(), sources = [source]) {
  const state = {
    items: structuredClone(items),
    activity: seedActivity() as Array<Activity & { deleted_at?: string | null }>,
  };
  const find = (id: string) => state.items.find((i) => i.id === id);
  const bump = (it: StagedTransaction, changes: Partial<StagedTransaction>) =>
    Object.assign(it, changes, { revision: it.revision + 1 });

  function recordOne(it: StagedTransaction | undefined, body: Record<string, unknown>) {
    if (!it) return { status: 404, code: "record_not_found", message: "Record is unavailable." };
    if (it.status !== "waiting")
      return { status: 409, code: "inbox_status", message: "This item is already recorded." };
    if (body.expected_revision !== it.revision)
      return { status: 409, code: "stale_revision", message: "Reload and reconcile." };
    const c = (body.completion as Completion | undefined) ?? it.proposal ?? {};
    const amount = Number(it.amount);
    const fail = (code: string, message: string) => {
      it.rejection = { code, message };
      return { status: 422, code, message };
    };
    if (!c.category && !c.refund_of) return fail("needs_choice", "Choose a category.");
    if (c.refund_of) {
      const purchase = state.activity.find((e) => e.uuid === c.refund_of);
      const left = Number(purchase?.remaining_refundable ?? 0);
      if (!purchase || left < amount)
        return fail(
          "invalid_refund",
          `Refunds exceed the purchase by ${usd(amount - left)}. Remaining refundable: ${usd(left)}.`,
        );
      purchase.remaining_refundable = (left - amount).toFixed(2);
    } else if (c.funding && c.funding !== "income") {
      const goal = saved[c.funding];
      if (goal && goal.saved < -amount)
        return fail(
          "invalid_savings",
          `${goal.name} has ${usd(goal.saved)} saved, and this outflow needs ${usd(-amount)}. Shortfall: ${usd(-amount - goal.saved)}.`,
        );
    }
    const uuid = crypto.randomUUID();
    const recorded: Activity = {
      ...entry(uuid, it.financial_date, Math.abs(amount).toFixed(2), it.payee),
      category: c.refund_of ? "spending" : (c.category ?? "spending"),
      refund_of: c.refund_of ?? null,
    };
    state.activity.push(recorded);
    bump(it, { status: "recorded", actual_entry_id: uuid, rejection: null });
    return { ok: true as const, item: it, entry: recorded };
  }

  return [
    http.get(`${entity}/inbox`, () =>
      HttpResponse.json(state.items.filter((i) => i.status !== "removed")),
    ),
    http.get(`${entity}/sources`, () =>
      HttpResponse.json(
        sources.map((s) => ({
          ...s,
          waiting: state.items.filter((i) => i.status === "waiting").length,
        })),
      ),
    ),
    http.get(`${entity}/activity`, () =>
      HttpResponse.json(state.activity.filter((e) => !e.deleted_at)),
    ),
    http.post(`${entity}/inbox/record`, async ({ request }) => {
      const body = (await request.json()) as { items: Array<Record<string, unknown>> };
      await delay(250);
      return HttpResponse.json({
        results: body.items.map((x) => {
          const r = recordOne(find(String(x.item_id)), x);
          return "ok" in r
            ? { item_id: x.item_id, ...r }
            : { item_id: x.item_id, ok: false, error: { code: r.code, message: r.message } };
        }),
      });
    }),
    http.post(`${entity}/inbox/:item/:action`, async ({ params, request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      const it = find(String(params.item));
      await delay(200);
      if (params.action === "record") {
        const r = recordOne(it, body);
        return "ok" in r ? HttpResponse.json(r) : reject(r.status, r.code, r.message);
      }
      if (!it) return reject(404, "record_not_found", "Record is unavailable.");
      if (body.expected_revision !== it.revision)
        return reject(409, "stale_revision", "Reload the current record and reconcile.");
      const action = String(params.action);
      const allowed: Record<string, string> = {
        skip: "waiting",
        unskip: "skipped",
        undo: "recorded",
        resolve: "conflict",
      };
      if (it.status !== allowed[action])
        return reject(409, "inbox_status", "This item is not in a state for that action.");
      if (action === "skip") bump(it, { status: "skipped", rejection: null });
      else if (action === "unskip") bump(it, { status: "waiting" });
      else if (action === "undo" || body.resolution === "delete") {
        const e = state.activity.find((x) => x.uuid === it.actual_entry_id);
        if (e) e.deleted_at = "2026-11-21T10:00:00Z";
        bump(it, { status: action === "undo" ? "waiting" : "removed", actual_entry_id: null });
      } else bump(it, { status: "recorded" });
      return HttpResponse.json(action === "undo" ? { item: it } : it);
    }),
    http.post(`${entity}/sources/:source/sync`, async () => {
      await delay(400);
      return HttpResponse.json({
        source: sources[0],
        counts: { added: 0, changed: 0, removed: 0, conflicts: 0, unchanged: 0, ignored: 0 },
      });
    }),
  ];
}
