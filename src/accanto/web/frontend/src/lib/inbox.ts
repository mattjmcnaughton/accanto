/** Contracts for the Transactions inbox API. Money is transported as decimal strings. */
import {
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
}
/** Only the completion fields, so a draft copied from a proposal drops its rationale. */
const completionOf = ({
  category,
  assignment,
  funding,
  refund_of,
  skip,
}: Completion): Completion => ({
  category,
  assignment,
  funding,
  refund_of,
  skip,
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

const root = (entityId: UUID) => `/api/entities/${encodeURIComponent(entityId)}`;
const item = (entityId: UUID, id: UUID) => `${root(entityId)}/inbox/${encodeURIComponent(id)}`;

export interface InboxWrite {
  method: "POST" | "PUT" | "DELETE";
  path: string;
  body: object;
}

export const inbox = {
  list: (entityId: UUID): Promise<LoadState<StagedTransaction[]>> =>
    loadResource(`${root(entityId)}/inbox`, () => false),
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
export function send<T>(session: BrowserSession, spec: InboxWrite, key: string): Promise<T> {
  return fetchJson<T>(spec.path, {
    method: spec.method,
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": key,
      "X-CSRF-Token": session.csrf_token,
    },
    body: JSON.stringify(spec.body),
  });
}
