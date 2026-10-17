import { useState } from "react";
import {
  type Contribution,
  type ContributionInput,
  type Destination,
  type DestinationKind,
  destinations,
} from "../../lib/destinations";
import { LoadMessage, MoneyInput, type ScreenProps, dollars, useLoad } from "../workspace/shared";

type DestinationForm = {
  name: string;
  target: string;
  active: boolean;
  openingDate: string;
  openingAmount: string;
};
const blank = (today: string): DestinationForm => ({
  name: "",
  target: "",
  active: true,
  openingDate: today,
  openingAmount: "",
});

export function Destinations(p: ScreenProps) {
  const [kind, setKind] = useState<DestinationKind>("investment");
  const [reload, setReload] = useState(0);
  const rows = useLoad(
    () => destinations.list(p.entity.id, kind),
    [p.entity.id, kind, p.refresh, reload],
  );
  const history = useLoad(
    () => destinations.history(p.entity.id, kind),
    [p.entity.id, kind, p.refresh, reload],
  );
  const [selected, setSelected] = useState<Destination | null>(null);
  const [destinationForm, setDestinationForm] = useState<DestinationForm | null>(null);
  const [entry, setEntry] = useState<Contribution | null>(null);
  const [entryForm, setEntryForm] = useState<ContributionInput | null>(null);
  const named = rows.kind === "ready" ? rows.data : [];
  const entries = history.kind === "ready" ? history.data : [];
  function done() {
    setDestinationForm(null);
    setEntryForm(null);
    setSelected(null);
    setEntry(null);
    p.dirty(false);
    setReload((value) => value + 1);
  }
  function editDestination(row: Destination | null) {
    if (!p.guard()) return;
    setEntryForm(null);
    setSelected(row);
    setDestinationForm(
      row
        ? {
            name: row.name,
            target: row.target ?? "",
            active: row.active,
            openingDate: row.opening?.date ?? p.entity.today,
            openingAmount: row.opening?.amount ?? "",
          }
        : blank(p.entity.today),
    );
    p.dirty(false);
  }
  function editEntry(row: Contribution | null) {
    if (!p.guard()) return;
    setDestinationForm(null);
    setEntry(row);
    setEntryForm(
      row
        ? {
            date: row.financial_date,
            amount: row.amount,
            destination_id: row.destination_id,
            note: row.note,
            is_adjustment: row.is_adjustment,
            expected_revision: row.revision,
          }
        : {
            date: p.entity.today,
            amount: "",
            destination_id: null,
            note: "",
            is_adjustment: false,
          },
    );
    p.dirty(false);
  }
  if (p.concealed) return null;
  const label = kind === "investment" ? "Investment" : "Giving";
  return (
    <section aria-labelledby="destinations-title">
      <div className="section-heading">
        <div>
          <h2 id="destinations-title">Investments and giving</h2>
          <p>
            Targets track cumulative contributions. Investment value and tax eligibility are
            separate.
          </p>
        </div>
      </div>
      <fieldset>
        <legend>Destination type</legend>
        {(["investment", "giving"] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={kind === value}
            onClick={() => {
              if (kind !== value && p.guard()) {
                setKind(value);
                done();
              }
            }}
          >
            {value === "investment" ? "Investments" : "Giving recipients"}
          </button>
        ))}
      </fieldset>
      <LoadMessage state={rows} retry={() => setReload((value) => value + 1)} />
      <LoadMessage state={history} retry={() => setReload((value) => value + 1)} />
      <div className="section-heading">
        <h3>{label} destinations</h3>
        <button type="button" disabled={p.busy} onClick={() => editDestination(null)}>
          Add {kind === "investment" ? "investment" : "recipient"}
        </button>
      </div>
      {rows.kind === "empty" && <p>No {label.toLowerCase()} destinations yet.</p>}
      <div className="record-list">
        {named.map((row) => (
          <article key={row.uuid}>
            <h4>{row.name}</h4>
            <p>
              {row.active ? "Active" : "Inactive"} · Contributions{" "}
              {dollars(row.contribution_progress)}
            </p>
            <p>
              {row.target ? `Cumulative target ${dollars(row.target)}` : "No cumulative target"}
            </p>
            {row.opening && (
              <p>
                Opening observed value {dollars(row.opening.amount)} on {row.opening.date}; excluded
                from contribution progress.
              </p>
            )}
            <button type="button" disabled={p.busy} onClick={() => editDestination(row)}>
              Edit {row.name}
            </button>
          </article>
        ))}
      </div>
      {destinationForm && (
        <form
          className="editor"
          onSubmit={(event) => {
            event.preventDefault();
            const target = destinationForm.target || null;
            p.save(
              selected
                ? destinations.edit(p.entity.id, kind, selected.uuid, {
                    name: destinationForm.name,
                    target,
                    active: destinationForm.active,
                    expected_revision: selected.revision,
                  })
                : destinations.create(p.entity.id, kind, {
                    name: destinationForm.name,
                    target,
                    opening:
                      kind === "investment" && destinationForm.openingAmount
                        ? {
                            date: destinationForm.openingDate,
                            amount: destinationForm.openingAmount,
                          }
                        : null,
                  }),
              done,
            );
          }}
        >
          <fieldset disabled={p.busy}>
            <legend>
              {selected
                ? `Edit ${label.toLowerCase()} destination`
                : `Add ${label.toLowerCase()} destination`}
            </legend>
            <label>
              Name
              <input
                required
                maxLength={120}
                value={destinationForm.name}
                onChange={(event) => {
                  setDestinationForm({ ...destinationForm, name: event.target.value });
                  p.dirty(true);
                }}
              />
            </label>
            <MoneyInput
              label="Cumulative contribution target (USD, optional)"
              value={destinationForm.target}
              required={false}
              onChange={(target) => {
                setDestinationForm({ ...destinationForm, target });
                p.dirty(true);
              }}
            />
            {!selected && kind === "investment" && (
              <>
                <p>An opening observed value is optional and does not count as a contribution.</p>
                <label>
                  Opening date
                  <input
                    type="date"
                    value={destinationForm.openingDate}
                    onChange={(event) => {
                      setDestinationForm({ ...destinationForm, openingDate: event.target.value });
                      p.dirty(true);
                    }}
                  />
                </label>
                <MoneyInput
                  label="Opening observed value (USD, optional)"
                  value={destinationForm.openingAmount}
                  required={false}
                  onChange={(openingAmount) => {
                    setDestinationForm({ ...destinationForm, openingAmount });
                    p.dirty(true);
                  }}
                />
              </>
            )}
            {selected && (
              <label>
                <input
                  type="checkbox"
                  checked={destinationForm.active}
                  onChange={(event) => {
                    setDestinationForm({ ...destinationForm, active: event.target.checked });
                    p.dirty(true);
                  }}
                />
                Active for new contributions
              </label>
            )}
            <button className="primary" type="submit">
              Save destination
            </button>
            <button type="button" onClick={done}>
              Cancel
            </button>
          </fieldset>
        </form>
      )}
      <div className="section-heading">
        <h3>{kind === "investment" ? "Investment" : "Donation"} history</h3>
        <button type="button" disabled={p.busy} onClick={() => editEntry(null)}>
          Record contribution
        </button>
      </div>
      {history.kind === "empty" && <p>No recorded {label.toLowerCase()} activity yet.</p>}
      <div className="record-list">
        {entries.map((row) => (
          <article key={row.uuid}>
            <p>
              <time>{row.financial_date}</time> ·{" "}
              {row.is_adjustment ? "Adjustment" : "Contribution"}
            </p>
            <strong>{dollars(row.amount)}</strong>
            <p>{named.find((item) => item.uuid === row.destination_id)?.name ?? "Unassigned"}</p>
            {row.note && <p>{row.note}</p>}
            <button type="button" disabled={p.busy} onClick={() => editEntry(row)}>
              Correct entry on {row.financial_date}
            </button>
          </article>
        ))}
      </div>
      {entryForm && (
        <form
          className="editor"
          onSubmit={(event) => {
            event.preventDefault();
            p.save(
              entry
                ? destinations.correct(p.entity.id, kind, entry.uuid, entryForm)
                : destinations.record(p.entity.id, kind, entryForm),
              done,
            );
          }}
        >
          <fieldset disabled={p.busy}>
            <legend>{entry ? "Correct contribution" : "Record contribution"}</legend>
            <label>
              Financial date
              <input
                type="date"
                required
                value={entryForm.date}
                onChange={(event) => {
                  setEntryForm({ ...entryForm, date: event.target.value });
                  p.dirty(true);
                }}
              />
            </label>
            <MoneyInput
              label="Amount (USD)"
              signed={entryForm.is_adjustment}
              value={entryForm.amount}
              onChange={(amount) => {
                setEntryForm({ ...entryForm, amount });
                p.dirty(true);
              }}
            />
            <label>
              <input
                type="checkbox"
                checked={entryForm.is_adjustment}
                onChange={(event) => {
                  setEntryForm({ ...entryForm, is_adjustment: event.target.checked });
                  p.dirty(true);
                }}
              />
              Adjustment to recorded total
            </label>
            <label>
              Destination
              <select
                value={entryForm.destination_id ?? ""}
                onChange={(event) => {
                  setEntryForm({ ...entryForm, destination_id: event.target.value || null });
                  p.dirty(true);
                }}
              >
                <option value="">Unassigned</option>
                {named
                  .filter((row) => row.active || row.uuid === entry?.destination_id)
                  .map((row) => (
                    <option key={row.uuid} value={row.uuid}>
                      {row.name}
                      {row.active ? "" : " (inactive)"}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Note
              <textarea
                maxLength={2000}
                value={entryForm.note}
                onChange={(event) => {
                  setEntryForm({ ...entryForm, note: event.target.value });
                  p.dirty(true);
                }}
              />
            </label>
            <button className="primary" type="submit">
              Save contribution
            </button>
            {entry && (
              <button
                type="button"
                onClick={() => {
                  if (window.confirm("Delete this mistaken entry? Its history is retained.")) {
                    p.save(
                      destinations.remove(p.entity.id, kind, entry.uuid, entry.revision),
                      done,
                    );
                  }
                }}
              >
                Delete contribution
              </button>
            )}
            <button type="button" onClick={done}>
              Cancel
            </button>
          </fieldset>
        </form>
      )}
    </section>
  );
}
