import { useRef, useState } from "react";
import {
  type Entry,
  type Kind,
  type Workspace,
  deleteEntry,
  entryLabels,
  goalSavings,
  id,
  kinds,
  money,
  references,
  saveEntry,
  today,
} from "./domain";
import { Icon, Modal, MoneyField, Notice, type ViewProps } from "./ui";

export function EntryEditor({
  state,
  update,
  entry,
  initial,
  month,
  onClose,
  onDeleted,
}: Omit<ViewProps, "openEntry"> & {
  entry?: Entry;
  initial?: Pick<Entry, "kind" | "sourceId">;
  month: string;
  onClose: () => void;
  onDeleted: (entry: Entry) => void;
}) {
  const form = useRef<HTMLFormElement>(null);
  const last = state.entries[state.entries.length - 1];
  const lastDestination =
    last &&
    (last.kind === "saving"
      ? state.goals
      : last.kind === "investing"
        ? state.investments
        : last.kind === "giving"
          ? state.recipients
          : []
    ).find((r) => r.id === last.sourceId);
  const fresh = (): Entry => ({
    id: id(),
    date: month === today().slice(0, 7) ? today() : `${month}-01`,
    kind: last?.kind ?? "spending",
    amount: 0,
    sourceId: lastDestination && !lastDestination.active ? "" : (last?.sourceId ?? ""),
    label: "",
    note: "",
    tag: "",
    ...initial,
  });
  const [draft, setDraft] = useState(entry ?? fresh);
  const [error, setError] = useState("");
  const [another, setAnother] = useState(false);
  const patch = (fields: Partial<Entry>) => setDraft((d) => ({ ...d, ...fields }));
  const destinations =
    draft.kind === "saving"
      ? state.goals
      : draft.kind === "investing"
        ? state.investments
        : draft.kind === "giving"
          ? state.recipients
          : null;
  const options = references(state, draft.kind).filter(
    (r) =>
      !destinations ||
      destinations.find((d) => d.id === r.id)?.active ||
      (entry?.kind === draft.kind && entry.sourceId === r.id),
  );
  const requiresSource = draft.kind === "saving";
  const hasSource = ["income", "fixed", "saving", "investing", "giving"].includes(draft.kind);
  const sourceLabel = {
    income: "Income source",
    fixed: "Fixed-cost category",
    saving: "Saving goal",
    investing: "Investment",
    giving: "Giving recipient",
    spending: "Category",
  }[draft.kind];
  const goal = state.goals.find((g) => g.id === draft.sourceId);
  const dirty = JSON.stringify(draft) !== JSON.stringify(entry ?? { ...fresh(), id: draft.id });
  const close = () => {
    if (!dirty || window.confirm("Discard this unsaved entry?")) onClose();
  };
  return (
    <Modal title={entry ? "Edit entry" : "Add entry"} onClose={close}>
      <form
        ref={form}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
            e.preventDefault();
            form.current?.requestSubmit();
          }
        }}
        className="modal-body"
        onSubmit={(e) => {
          e.preventDefault();
          try {
            const next = saveEntry(state, draft);
            if (!update(next, entry ? "Entry updated" : "Entry recorded")) return;
            if (another && !entry) {
              setDraft({
                ...fresh(),
                kind: draft.kind,
                sourceId: draft.sourceId,
                date: draft.date,
              });
              setError("");
              requestAnimationFrame(() =>
                form.current
                  ?.querySelector<HTMLInputElement>('input[inputmode="decimal"]')
                  ?.focus(),
              );
            } else onClose();
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        {error && <Notice error>{error}</Notice>}
        {draft.adjustment && (
          <Notice>
            Adjustment entry: this amount contributes directly to totals and destination progress.
          </Notice>
        )}
        {!entry && (
          <p className="entry-hint">
            {initial
              ? "Destination selected for you."
              : last
                ? "Using your last entry’s type and destination."
                : "Record a receipt, payment or contribution."}{" "}
            <span>⌘ / Ctrl + Enter to save</span>
          </p>
        )}
        <div className="field-grid">
          <label className="field">
            <span>Type</span>
            <select
              value={draft.kind}
              onChange={(e) =>
                patch({ kind: e.target.value as Kind, sourceId: "", funding: undefined })
              }
            >
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {entryLabels[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Date</span>
            <input
              type="date"
              required
              value={draft.date}
              onChange={(e) => patch({ date: e.target.value })}
            />
          </label>
        </div>
        {hasSource && (
          <label className="field">
            <span>
              {sourceLabel}
              {!requiresSource && <span className="optional"> optional</span>}
            </span>
            <select
              aria-label={sourceLabel}
              required={requiresSource}
              value={draft.sourceId}
              onChange={(e) => patch({ sourceId: e.target.value })}
            >
              <option value="">
                {requiresSource ? "Choose a source, category or goal" : "Unassigned"}
              </option>
              {options.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
            {!options.length && (
              <small>
                {draft.kind === "saving"
                  ? "Create an active goal in Goals first."
                  : draft.kind === "investing"
                    ? "Manage named investments in Investments."
                    : draft.kind === "giving"
                      ? "Manage recipients in Charitable giving."
                      : "Choose Unassigned for unplanned activity; describe it in the note."}
              </small>
            )}
          </label>
        )}
        {draft.kind === "saving" && goal?.tag && (
          <div className="tag-line">
            <Icon name="wallet" size={17} />
            {goal.tag}
            <span>Cash-account tag</span>
          </div>
        )}
        {draft.kind === "fixed" && (
          <label className="field">
            <span>Debt account (optional)</span>
            <select
              value={draft.debtId ?? ""}
              onChange={(e) => patch({ debtId: e.target.value || undefined })}
            >
              <option value="">Not a loan payment</option>
              {state.debts
                ?.filter((d) => d.active || d.id === draft.debtId)
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
            </select>
          </label>
        )}
        <MoneyField
          key={`${draft.id}-amount`}
          label="Amount"
          value={draft.amount}
          onChange={(n) => patch({ amount: n ?? 0 })}
          signed={draft.adjustment || ["fixed", "giving", "spending"].includes(draft.kind)}
          hint={
            ["fixed", "giving", "spending"].includes(draft.kind)
              ? "Use a negative amount for a refund."
              : undefined
          }
        />
        {draft.kind !== "income" && draft.kind !== "saving" && !draft.refundOf && (
          <FundingFields
            state={state}
            funding={draft.funding}
            onChange={(funding) => patch({ funding })}
            amount={draft.amount}
          />
        )}
        <label className="field">
          <span>
            Note <span className="optional">optional</span>
          </span>
          <textarea
            rows={3}
            maxLength={2000}
            placeholder="What was this for?"
            value={draft.note}
            onChange={(e) => patch({ note: e.target.value })}
          />
        </label>
        {!entry && (
          <label className="check-label">
            <input
              type="checkbox"
              checked={another}
              onChange={(e) => setAnother(e.target.checked)}
            />
            Keep open to add another
          </label>
        )}
        {entry &&
          !entry.refundOf &&
          entry.amount > 0 &&
          ["fixed", "spending", "giving"].includes(entry.kind) && (
            <button
              type="button"
              className="button secondary"
              onClick={() => {
                const remaining =
                  entry.amount -
                  state.entries
                    .filter((e) => !e.deleted && e.refundOf === entry.id)
                    .reduce((s, e) => s - e.amount, 0);
                setDraft({
                  ...entry,
                  id: id(),
                  order: undefined,
                  refundOf: entry.id,
                  amount: -remaining,
                  date: today(),
                  note: "Refund",
                });
              }}
            >
              Record refund (remaining{" "}
              {money(
                entry.amount -
                  state.entries
                    .filter((e) => !e.deleted && e.refundOf === entry.id)
                    .reduce((s, e) => s - e.amount, 0),
              )}
              )
            </button>
          )}
        {draft.refundOf && (
          <Notice>
            Linked refund: enter a negative amount and its date. Original origin is retained.
          </Notice>
        )}
        <div className="modal-actions">
          {entry && (
            <button
              type="button"
              className="button danger-quiet"
              onClick={() => {
                try {
                  if (update(deleteEntry(state, entry))) {
                    onDeleted(entry);
                    onClose();
                  }
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              <Icon name="trash" size={17} />
              Delete entry
            </button>
          )}
          <button type="button" className="button secondary push-right" onClick={close}>
            Cancel
          </button>
          <button
            type="submit"
            className="button primary"
            disabled={requiresSource && !options.length}
          >
            {entry ? "Save changes" : "Record entry"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function FundingFields({
  state,
  funding,
  onChange,
  amount = 0,
}: {
  state: Workspace;
  funding: Entry["funding"];
  onChange: (funding: Entry["funding"]) => void;
  amount?: number;
}) {
  return (
    <>
      <label className="field">
        <span>Funding origin</span>
        <select
          value={funding ? "savings" : "income"}
          onChange={(e) =>
            onChange(e.target.value === "income" ? undefined : { account: "", goalId: "" })
          }
        >
          <option value="income">Current income</option>
          <option value="savings">Previously saved money</option>
        </select>
      </label>
      {funding && (
        <label className="field">
          <span>From saving goal</span>
          <select
            required
            value={funding.goalId}
            onChange={(e) => {
              const g = state.goals.find((g) => g.id === e.target.value);
              onChange({
                goalId: e.target.value,
                account: state.accounts?.find((a) => a.id === g?.accountId)?.name ?? "",
              });
            }}
          >
            <option value="">Choose goal, including Unallocated</option>
            {state.goals
              .filter((g) => g.accountId && g.active)
              .map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} · {money(goalSavings(state, g.id).remaining)} remaining
                </option>
              ))}
          </select>
          <small>{money(amount)} funded from this goal. One origin per outflow.</small>
        </label>
      )}
    </>
  );
}
