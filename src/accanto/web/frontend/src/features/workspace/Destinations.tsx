import { useState } from "react";
import { InvestmentBalances } from "./InvestmentBalances";
import { type Destination, dateLabel, fundingLabel, id, money } from "./domain";
import { Empty, Icon, Modal, MoneyField, Notice, PageHead, type ViewProps } from "./ui";

export function Destinations({
  state,
  update,
  openEntry,
  kind,
  contribute,
}: ViewProps & { kind: "investing" | "giving"; contribute: (sourceId: string) => void }) {
  const investing = kind === "investing";
  const collection = investing ? "investments" : "recipients";
  const noun = investing ? "investment" : "recipient";
  const rows = state[collection];
  const [editing, setEditing] = useState<Destination | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [inactive, setInactive] = useState(false);
  const selected = rows.find((r) => r.id === detail);
  const entries = state.entries.filter((e) => !e.deleted && e.kind === kind);
  const total = (sourceId: string) =>
    entries.filter((e) => e.sourceId === sourceId).reduce((sum, e) => sum + e.amount, 0);
  const history = entries
    .filter((e) => e.sourceId === detail)
    .sort((a, b) => b.date.localeCompare(a.date));
  const visible = rows.filter((r) => inactive || r.active);
  const add = () => setEditing({ id: id(), name: "", target: null, active: true });
  const save = (row: Destination) =>
    update(
      { ...state, [collection]: [...rows.filter((r) => r.id !== row.id), row] },
      `${investing ? "Investment" : "Recipient"} saved`,
    );
  return (
    <>
      <PageHead
        title={investing ? "Investments" : "Charitable giving"}
        description={
          investing
            ? "Build for the future, one contribution at a time."
            : "Support the people and causes that matter to you."
        }
        actions={
          <button type="button" className="button primary" onClick={add}>
            <Icon name="plus" size={17} />
            New {noun}
          </button>
        }
      />
      {rows.some((r) => !r.active) && (
        <label className="check-label filter-row">
          <input
            type="checkbox"
            checked={inactive}
            onChange={(e) => setInactive(e.target.checked)}
          />
          Show inactive {investing ? "investments" : "recipients"}
        </label>
      )}
      {!visible.length ? (
        <section className="surface">
          <Empty
            icon={investing ? "investments" : "giving"}
            title={
              rows.length
                ? `No active ${collection}`
                : investing
                  ? "Give your investments a home"
                  : "Give with intention"
            }
            action={
              <button type="button" className="button primary" onClick={add}>
                Add your first {noun}
              </button>
            }
          >
            Name {investing ? "an investment account or destination" : "a charity or recipient"},
            optionally set a contribution target, and record activity as you go.
          </Empty>
        </section>
      ) : (
        <div className="goals-grid">
          {visible.map((row) => {
            const contributed = total(row.id);
            const observed = state.balances
              .filter((b) => !b.deleted && b.investmentId === row.id)
              .sort((a, b) => b.date.localeCompare(a.date))[0];
            return (
              <button
                key={row.id}
                type="button"
                className={`goal-card ${!row.active ? "inactive" : ""}`}
                onClick={() => setDetail(row.id)}
              >
                <div className="goal-card-top">
                  <span className="goal-symbol">
                    <Icon name={investing ? "investments" : "giving"} size={22} />
                  </span>
                  <span className="pill">
                    {!row.active
                      ? "Inactive"
                      : row.target !== null && contributed >= row.target
                        ? "Target reached"
                        : "Active"}
                  </span>
                </div>
                <h2>{row.name}</h2>
                <p>{investing ? "Contributions to date" : "Net donations to date"}</p>
                <div className="goal-amount">
                  <strong>{money(contributed)}</strong>
                  {row.target !== null && <span>of {money(row.target)}</span>}
                </div>
                {row.target !== null && (
                  <div className="progress-track">
                    <span
                      style={{
                        width: `${Math.max(0, Math.min(100, (contributed / row.target) * 100))}%`,
                      }}
                    />
                  </div>
                )}
                <div className="goal-card-bottom">
                  <span>
                    {row.target === null
                      ? "No contribution target"
                      : `${Math.round((contributed / row.target) * 100)}% contributed`}
                  </span>
                  <Icon name="arrow" size={16} />
                </div>
                {row.target !== null && (
                  <p className="footnote">
                    {investing ? "Cumulative contributions" : "Cumulative net donations"} ÷
                    contribution target: {money(contributed)} ÷ {money(row.target)}.
                  </p>
                )}
                {investing && (
                  <p className="observed-balance">
                    {observed
                      ? `${money(observed.amount)} observed · ${dateLabel(observed.date)}, ${observed.date.slice(0, 4)}`
                      : "No balance observed"}
                  </p>
                )}
              </button>
            );
          })}
        </div>
      )}
      <p className="footnote">
        Targets measure cumulative{" "}
        {investing ? "contributions, not market value" : "donations, net of refunds"}. They do not
        change your Plan’s {investing ? "investing" : "giving"} allocation.
      </p>
      {entries.some((e) => !e.sourceId) && (
        <section className="surface unassigned-history">
          <h2>Unassigned {investing ? "contributions" : "giving"}</h2>
          <p className="subtle">
            These entries still count in monthly Reviews. Open one to assign it to a {noun}.
          </p>
          <div className="detail-entries">
            {entries
              .filter((e) => !e.sourceId)
              .sort((a, b) => b.date.localeCompare(a.date))
              .map((e) => (
                <button type="button" key={e.id} onClick={() => openEntry(e)}>
                  <span>
                    {e.note || e.label}
                    <small>From {fundingLabel(state, e)}</small>
                    <small>{e.date}</small>
                  </span>
                  <strong>{money(e.amount, true)}</strong>
                  <Icon name="arrow" size={15} />
                </button>
              ))}
          </div>
        </section>
      )}
      {investing && <InvestmentBalances state={state} update={update} />}
      {editing && (
        <DestinationEditor
          key={editing.id}
          destination={editing}
          noun={noun}
          onClose={() => setEditing(null)}
          save={(row) => {
            if (save(row)) setEditing(null);
          }}
        />
      )}
      {selected && (
        <Modal title={selected.name} onClose={() => setDetail(null)}>
          <div className="modal-body">
            <div className="goal-detail-total">
              <strong>{money(total(selected.id))}</strong>
              <span>
                {selected.target === null
                  ? "contributed to date"
                  : `contributed toward ${money(selected.target)}`}
              </span>
            </div>
            <div className="detail-actions">
              {selected.active && (
                <button
                  type="button"
                  className="button primary"
                  onClick={() => {
                    setDetail(null);
                    contribute(selected.id);
                  }}
                >
                  {investing ? "Add contribution" : "Record donation"}
                </button>
              )}
              <button
                type="button"
                className="button secondary"
                onClick={() => {
                  setEditing(selected);
                  setDetail(null);
                }}
              >
                Edit {noun}
              </button>
              <button
                type="button"
                className="button quiet"
                onClick={() => save({ ...selected, active: !selected.active })}
              >
                {selected.active ? "Make inactive" : "Reactivate"}
              </button>
            </div>
            {!selected.active && (
              <Notice>
                History is preserved. Reactivate this {noun} to record new contributions.
              </Notice>
            )}
            <h3>{investing ? "Contribution history" : "Donation history"}</h3>
            {history.length ? (
              <div className="detail-entries">
                {history.map((e) => (
                  <button
                    type="button"
                    key={e.id}
                    onClick={() => {
                      setDetail(null);
                      openEntry(e);
                    }}
                  >
                    <span>
                      {e.note || e.label}
                      <small>From {fundingLabel(state, e)}</small>
                      <small>
                        {dateLabel(e.date)}, {e.date.slice(0, 4)}
                      </small>
                    </span>
                    <strong>{money(e.amount, true)}</strong>
                    <Icon name="arrow" size={15} />
                  </button>
                ))}
              </div>
            ) : (
              <p className="subtle">Nothing recorded yet.</p>
            )}
            <p className="footnote">
              Adjustment entries assigned here count toward recorded progress.
              {!investing && " Donations do not automatically become tax deductions."}
            </p>
          </div>
        </Modal>
      )}
    </>
  );
}
function DestinationEditor({
  destination,
  noun,
  save,
  onClose,
}: {
  destination: Destination;
  noun: string;
  save: (row: Destination) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(destination);
  const [error, setError] = useState("");
  return (
    <Modal
      title={`${destination.name ? "Edit" : "New"} ${noun}`}
      onClose={() => {
        if (
          JSON.stringify(draft) === JSON.stringify(destination) ||
          window.confirm("Discard unsaved changes?")
        )
          onClose();
      }}
    >
      <form
        className="modal-body"
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft.name.trim() || (draft.target !== null && draft.target <= 0)) {
            setError("Enter a name and a positive target, or leave the target blank.");
            return;
          }
          save({ ...draft, name: draft.name.trim() });
        }}
      >
        <label className="field">
          <span>{noun === "investment" ? "Investment name" : "Recipient name"}</span>
          <input
            required
            maxLength={120}
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </label>
        <MoneyField
          label="Contribution target"
          optional
          value={draft.target}
          onChange={(target) => setDraft({ ...draft, target })}
          hint="Optional cumulative target. Leave blank for ongoing contributions."
        />
        {error && <Notice error>{error}</Notice>}
        <div className="modal-actions">
          <button type="submit" className="button primary">
            Save {noun}
          </button>
        </div>
      </form>
    </Modal>
  );
}
