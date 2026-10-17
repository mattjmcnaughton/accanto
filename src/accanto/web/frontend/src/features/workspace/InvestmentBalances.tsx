import { useState } from "react";
import { type Balance, type Destination, dateLabel, id, money, saveBalance, today } from "./domain";
import { Icon, Modal, MoneyField, Notice, type ViewProps } from "./ui";
export function InvestmentBalances({ state, update }: Pick<ViewProps, "state" | "update">) {
  const [balance, setBalance] = useState<Balance | null>(null);
  return (
    <>
      <section className="surface balance-section">
        <div className="section-title">
          <div>
            <h2>Investment balances</h2>
            <p className="subtle">Dated observations, separate from contributions.</p>
          </div>
          <button
            type="button"
            className="button secondary"
            onClick={() =>
              setBalance({ id: id(), name: "", date: today(state.timeZone), amount: 0 })
            }
          >
            <Icon name="plus" size={16} />
            Record balance
          </button>
        </div>
        {state.balances.length ? (
          <div className="balance-list">
            {state.balances
              .filter((b) => !b.deleted && !b.debtId)
              .sort((a, b) => b.date.localeCompare(a.date))
              .map((b) => (
                <button
                  key={b.id}
                  className="balance-row"
                  type="button"
                  onClick={() => setBalance(b)}
                >
                  <span>
                    <strong>
                      {state.investments.find((i) => i.id === b.investmentId)?.name ?? b.name}
                    </strong>
                    <small>
                      Observed {dateLabel(b.date)}, {b.date.slice(0, 4)}
                    </small>
                  </span>
                  <strong className="numeric">{money(b.amount, true)}</strong>
                  <Icon name="edit" size={16} />
                </button>
              ))}
          </div>
        ) : (
          <div className="small-empty">No investment balances recorded.</div>
        )}
      </section>
      {balance && (
        <BalanceEditor
          balance={balance}
          investments={state.investments}
          onClose={() => setBalance(null)}
          save={(b) => {
            if (update(saveBalance(state, b), "Investment balance recorded")) setBalance(null);
          }}
          remove={
            state.balances.some((b) => b.id === balance.id)
              ? () => {
                  if (
                    window.confirm("Delete this balance observation?") &&
                    update(
                      saveBalance(state, { ...balance, deleted: true }),
                      "Balance observation deleted",
                    )
                  )
                    setBalance(null);
                }
              : undefined
          }
        />
      )}
    </>
  );
}
function BalanceEditor({
  balance,
  investments,
  save,
  remove,
  onClose,
}: {
  balance: Balance;
  investments: Destination[];
  save: (b: Balance) => void;
  remove?: () => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(balance);
  const [error, setError] = useState("");
  return (
    <Modal
      title="Investment balance"
      onClose={() => {
        if (
          JSON.stringify(draft) === JSON.stringify(balance) ||
          window.confirm("Discard unsaved balance changes?")
        )
          onClose();
      }}
    >
      <form
        className="modal-body"
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft.name.trim()) {
            setError("Give this observation a name or choose an investment.");
            return;
          }
          try {
            save({ ...draft, name: draft.name.trim() });
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        <label className="field">
          <span>Investment</span>
          <select
            aria-label="Investment"
            value={draft.investmentId ?? ""}
            onChange={(e) =>
              setDraft({
                ...draft,
                investmentId: e.target.value,
                name: investments.find((i) => i.id === e.target.value)?.name ?? draft.name,
              })
            }
          >
            <option value="">Unassigned observation</option>
            {investments.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </label>
        {!draft.investmentId && (
          <label className="field">
            <span>Investment name</span>
            <input
              required
              maxLength={120}
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
        )}
        <label className="field">
          <span>Observed on</span>
          <input
            required
            type="date"
            value={draft.date}
            onChange={(e) => setDraft({ ...draft, date: e.target.value })}
          />
        </label>
        <MoneyField
          label="Balance"
          value={draft.amount}
          onChange={(n) => setDraft({ ...draft, amount: n ?? 0 })}
        />
        <p className="footnote">An observation does not count as money newly invested.</p>
        {error && <Notice error>{error}</Notice>}
        <div className="modal-actions">
          {remove && (
            <button className="button danger-quiet" type="button" onClick={remove}>
              Delete observation
            </button>
          )}
          <button className="button primary push-right" type="submit">
            Save balance
          </button>
        </div>
      </form>
    </Modal>
  );
}
