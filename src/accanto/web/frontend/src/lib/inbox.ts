/** Contracts for the Transactions inbox API. Money is transported as decimal strings. */
import {
  ApiError,
  type BrowserSession,
  type DecimalString,
  type IsoDate,
  type LoadState,
  type UUID,
  fetchJson,
  loadResource,
} from "./api";

export type InboxCategory =
  | "income"
  | "fixed_cost"
  | "spending"
  | "saving"
  | "investing"
  | "giving";
export type InboxStatus = "waiting" | "skipped" | "recorded" | "conflict" | "removed";
export type TransactionKind =
  | "ordinary"
  | "transfer_on_budget"
  | "transfer_tracking"
  | "card_payment";

/** A proposal or a record override; any subset of the inbox choices. */
export interface Completion {
  category?: InboxCategory | null;
  /** A record id, or "unassigned". */
  assignment?: string | null;
  /** "income" or a saving goal id. */
  funding?: string | null;
  refund_of?: UUID | null;
  skip?: boolean;
  /** Tag ids for the entry; a refund carries its purchase's tags instead. */
  tag_ids?: UUID[];
}
/** Only the completion fields, so a draft copied from a proposal drops its rationale. */
const completionOf = ({
  category,
  assignment,
  funding,
  refund_of,
  skip,
  tag_ids,
}: Completion): Completion => ({
  category,
  assignment,
  funding,
  refund_of,
  skip,
  tag_ids,
});
export interface Proposal extends Completion {
  rationale: string;
}
export interface Rejection {
  code: string;
  message: string;
}
export interface StagedTransaction {
  id: UUID;
  source_id: UUID;
  source_ref: string;
  parent_ref: string | null;
  split: { lines: number; total: DecimalString } | null;
  account_ref: string;
  account_name: string;
  financial_date: IsoDate;
  /** Signed; inflow positive. */
  amount: DecimalString;
  payee: string;
  source_category: { id: string; name: string } | null;
  memo: string | null;
  kind: TransactionKind;
  cleared: boolean;
  approved: boolean;
  deleted_in_source: boolean;
  status: InboxStatus;
  actual_entry_id: UUID | null;
  rejection: Rejection | null;
  changed_after_staging: boolean;
  proposal: Proposal | null;
  proposal_rejection: Rejection | null;
  proposed_by: { user_id: UUID; interface: string; at: string } | null;
  /** The owner's note: context or a correction for the agent; "" when none. */
  note: string;
  noted_at: string | null;
  staged_at: string;
  revision: number;
}
export interface TransactionSource {
  id: UUID;
  kind: "ynab";
  name: string;
  external_ref: string;
  start_date: IsoDate;
  connected: boolean;
  synced: boolean;
  last_synced_at: string | null;
  accounts: Array<{ id: string; name: string }>;
  waiting: number;
  revision: number;
}

/** Supported Transaction providers, in the order Settings offers them. */
export const PROVIDERS = [{ kind: "ynab", name: "YNAB" }] as const;
export type ProviderKind = (typeof PROVIDERS)[number]["kind"];
/** The Entity's provider credential; the token itself is never returned. */
export interface TransactionProvider {
  kind: ProviderKind | null;
  configured: boolean;
  revision: number;
}

const root = (entityId: UUID) => `/api/entities/${encodeURIComponent(entityId)}`;
const item = (entityId: UUID, id: UUID) => `${root(entityId)}/inbox/${encodeURIComponent(id)}`;

/** The background agent proposal run (TDD 12): its latest run and the waiting counts. */
export interface ProposalRun {
  run: {
    id: string;
    state: "queued" | "running" | "succeeded" | "failed" | "cancelled";
    steps: number;
    counts: { proposed?: number; needs_you?: number; failed?: number };
    error_code: string | null;
    started_at: string;
    finished_at: string | null;
  } | null;
  waiting: number;
  proposed: number;
  needs_you: number;
  chunk: number;
}

export interface InboxWrite {
  method: "POST" | "PUT" | "DELETE";
  path: string;
  body: object;
}

export const inbox = {
  providerPath: (entityId: UUID) => `${root(entityId)}/transaction-provider`,
  list: (entityId: UUID): Promise<LoadState<StagedTransaction[]>> =>
    loadResource(`${root(entityId)}/inbox`, () => false),
  proposalRun: (entityId: UUID): Promise<LoadState<ProposalRun>> =>
    loadResource(`${root(entityId)}/inbox/proposal-run`, () => false),
  startRun: (entityId: UUID): InboxWrite => ({
    method: "POST",
    path: `${root(entityId)}/inbox/proposal-run`,
    body: {},
  }),
  stopRun: (entityId: UUID): InboxWrite => ({
    method: "DELETE",
    path: `${root(entityId)}/inbox/proposal-run`,
    body: {},
  }),
  sources: (entityId: UUID): Promise<LoadState<TransactionSource[]>> =>
    loadResource(`${root(entityId)}/sources`, (rows) => rows.length === 0),
  record: (entityId: UUID, it: StagedTransaction, completion?: Completion): InboxWrite => ({
    method: "POST",
    path: `${item(entityId, it.id)}/record`,
    body: {
      expected_revision: it.revision,
      ...(completion ? { completion: completionOf(completion) } : {}),
    },
  }),
  recordMany: (
    entityId: UUID,
    items: Array<{ it: StagedTransaction; completion?: Completion }>,
  ): InboxWrite => ({
    method: "POST",
    path: `${root(entityId)}/inbox/record`,
    body: {
      items: items.map(({ it, completion }) => ({
        item_id: it.id,
        expected_revision: it.revision,
        ...(completion ? { completion: completionOf(completion) } : {}),
      })),
    },
  }),
  action: (
    entityId: UUID,
    it: StagedTransaction,
    action: "skip" | "unskip" | "undo",
  ): InboxWrite => ({
    method: "POST",
    path: `${item(entityId, it.id)}/${action}`,
    body: { expected_revision: it.revision },
  }),
  /** Ignore, return or undo several items in one request; each reports its own outcome. */
  actMany: (
    entityId: UUID,
    items: StagedTransaction[],
    action: "skip" | "unskip" | "undo",
  ): InboxWrite => ({
    method: "POST",
    path: `${root(entityId)}/inbox/${action}`,
    body: { items: items.map((it) => ({ item_id: it.id, expected_revision: it.revision })) },
  }),
  /** Set or clear the owner's note on one item; "" clears it. */
  note: (entityId: UUID, it: StagedTransaction, note: string): InboxWrite => ({
    method: "PUT",
    path: `${item(entityId, it.id)}/note`,
    body: { expected_revision: it.revision, note },
  }),
  /** The same note on several items; each reports its own outcome. */
  noteMany: (entityId: UUID, items: StagedTransaction[], note: string): InboxWrite => ({
    method: "PUT",
    path: `${root(entityId)}/inbox/note`,
    body: {
      note,
      items: items.map((it) => ({ item_id: it.id, expected_revision: it.revision })),
    },
  }),
  resolve: (entityId: UUID, it: StagedTransaction, resolution: "keep" | "delete"): InboxWrite => ({
    method: "POST",
    path: `${item(entityId, it.id)}/resolve`,
    body: { expected_revision: it.revision, resolution },
  }),
  sync: (entityId: UUID, sourceId: UUID): InboxWrite => ({
    method: "POST",
    path: `${root(entityId)}/sources/${encodeURIComponent(sourceId)}/sync`,
    body: {},
  }),
};

/** Send one inbox command. The caller supplies the current session for its CSRF token. */
export function send<T>(
  session: BrowserSession,
  spec: InboxWrite,
  key: string,
  keepalive = false,
): Promise<T> {
  return fetchJson<T>(spec.path, {
    method: spec.method,
    keepalive,
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": key,
      "X-CSRF-Token": session.csrf_token,
    },
    body: JSON.stringify(spec.body),
  });
}

/**
 * A browser-session call for source and provider setup, with a fresh retry identity and one
 * sign-in retry. Tokens sent this way stay in the caller's state, never in a recoverable write.
 */
export async function browserCall<T>(
  credentials: (signIn?: boolean) => Promise<BrowserSession>,
  path: string,
  method: "GET" | "POST" | "PUT" | "DELETE",
  body?: object,
): Promise<T> {
  const key = crypto.randomUUID();
  const init = (s: BrowserSession): RequestInit =>
    method === "GET"
      ? {}
      : {
          method,
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": s.csrf_token,
            "Idempotency-Key": key,
          },
          body: body ? JSON.stringify(body) : undefined,
        };
  try {
    return await fetchJson<T>(path, init(await credentials()));
  } catch (issue) {
    if (!(issue instanceof ApiError) || issue.kind !== "unauthenticated") throw issue;
    return await fetchJson<T>(path, init(await credentials(true)));
  }
}
