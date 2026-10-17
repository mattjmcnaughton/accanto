import { useState } from "react";
import {
  incomeEstimates,
  type EstimateInput,
  type EstimateResult,
  type Frequency,
} from "../../lib/incomeEstimates";
import { LoadMessage, MoneyInput, type ScreenProps, useLoad } from "../workspace/shared";

type LineForm = {
  key: string;
  line_id?: string;
  name: string;
  gross: string;
  withholding: string;
  payroll: string;
  frequency: Frequency;
  paid_days: string;
};
type Draft = { id?: string; revision?: number; name: string; lines: LineForm[] };
const blankLine = (): LineForm => ({
  key: crypto.randomUUID(),
  name: "",
  gross: "",
  withholding: "0.00",
  payroll: "0.00",
  frequency: "monthly",
  paid_days: "",
});
const blank = (): Draft => ({ name: "", lines: [blankLine()] });
const fromSaved = (record: EstimateResult): Draft => ({
  id: record.uuid,
  revision: record.revision,
  name: record.name,
  lines: record.lines.map((line) => ({
    ...line,
    key: line.uuid,
    line_id: line.uuid,
    paid_days: line.paid_days ?? "",
  })),
});
function moneyLabel(value: string): string {
  const [whole, cents] = value.split(".");
  const negative = whole.startsWith("-");
  const digits = negative ? whole.slice(1) : whole;
  return `${negative ? "-" : ""}$${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${cents ?? "00"}`;
}

export function IncomeEstimates(p: ScreenProps) {
  const [reload, setReload] = useState(0);
  const state = useLoad(() => incomeEstimates.list(p.entity.id), [p.entity.id, p.refresh, reload]);
  const [form, setForm] = useState<Draft | null>(null);
  const [selected, setSelected] = useState<EstimateResult | null>(null);
  const [changed, setChanged] = useState(false);
  const [copyName, setCopyName] = useState("");
  function update(value: Draft) {
    setForm(value);
    setChanged(true);
    p.dirty(true);
  }
  function open(record: EstimateResult) {
    if (!p.guard()) return;
    setForm(fromSaved(record));
    setSelected(record);
    setChanged(false);
    setCopyName(`${record.name} copy`);
    p.dirty(false);
  }
  function confirmed(record: EstimateResult) {
    setForm(fromSaved(record));
    setSelected(record);
    setChanged(false);
    setCopyName(`${record.name} copy`);
    p.dirty(false);
  }
  function updateLine(key: string, patch: Partial<LineForm>) {
    if (!form) return;
    update({
      ...form,
      lines: form.lines.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    });
  }
  if (p.concealed) return null;
  return (
    <section aria-labelledby="estimates-title">
      <div className="section-heading">
        <div>
          <h2 id="estimates-title">Income estimates</h2>
          <p>
            Save separate income assumptions. These smoothed monthly estimates are not receipts or
            Plan funding; manually copy a result into a Plan if useful.
          </p>
        </div>
        <button
          type="button"
          disabled={p.busy}
          onClick={() => {
            if (p.guard()) {
              setForm(blank());
              setSelected(null);
              setChanged(true);
              p.dirty(true);
            }
          }}
        >
          New estimate
        </button>
      </div>
      <LoadMessage state={state} retry={() => setReload((value) => value + 1)} />
      <div className="workspace-columns">
        <aside className="record-list" aria-label="Saved income estimates">
          {state.kind === "empty" && <p>No estimates yet. Create one to explore assumptions.</p>}
          {state.kind === "ready" &&
            state.data.map((record) => (
              <article key={record.uuid}>
                <h3>{record.name}</h3>
                <p>{moneyLabel(record.monthly_total)} estimated monthly net</p>
                <button type="button" disabled={p.busy} onClick={() => open(record)}>
                  Open {record.name}
                </button>
              </article>
            ))}
        </aside>
        <div>
          {form && (
            <form
              className="editor"
              onSubmit={(event) => {
                event.preventDefault();
                const body: EstimateInput = {
                  name: form.name,
                  lines: form.lines.map((line) => ({
                    ...(line.line_id ? { line_id: line.line_id } : {}),
                    name: line.name,
                    gross: line.gross,
                    withholding: line.withholding,
                    payroll: line.payroll,
                    frequency: line.frequency,
                    ...(line.frequency === "daily"
                      ? { paid_days: line.paid_days === "" ? null : line.paid_days }
                      : {}),
                  })),
                  ...(form.id ? { expected_revision: form.revision } : {}),
                };
                p.save(
                  form.id
                    ? incomeEstimates.edit(p.entity.id, form.id, body)
                    : incomeEstimates.create(p.entity.id, body),
                  confirmed,
                );
              }}
            >
              <fieldset disabled={p.busy}>
                <legend>{form.id ? "Edit estimate" : "New estimate"}</legend>
                <label>
                  Estimate name
                  <input
                    required
                    maxLength={120}
                    value={form.name}
                    onChange={(event) => update({ ...form, name: event.target.value })}
                  />
                </label>
                {form.lines.map((line, index) => (
                  <div className="income-row" key={line.key}>
                    <label>
                      Income line {index + 1}
                      <input
                        required
                        maxLength={120}
                        value={line.name}
                        onChange={(event) => updateLine(line.key, { name: event.target.value })}
                      />
                    </label>
                    <MoneyInput
                      label={`Gross per payment ${index + 1}`}
                      value={line.gross}
                      onChange={(gross) => updateLine(line.key, { gross })}
                    />
                    <MoneyInput
                      label={`Withholding per payment ${index + 1}`}
                      value={line.withholding}
                      onChange={(withholding) => updateLine(line.key, { withholding })}
                    />
                    <MoneyInput
                      label={`Payroll deductions per payment ${index + 1}`}
                      value={line.payroll}
                      onChange={(payroll) => updateLine(line.key, { payroll })}
                    />
                    <label>
                      Payment frequency {index + 1}
                      <select
                        value={line.frequency}
                        onChange={(event) =>
                          updateLine(line.key, {
                            frequency: event.target.value as Frequency,
                            paid_days: "",
                          })
                        }
                      >
                        <option value="annual">Annually</option>
                        <option value="monthly">Monthly</option>
                        <option value="twice_monthly">Twice a month (24/year)</option>
                        <option value="weekly">Weekly (52/year)</option>
                        <option value="daily">Daily (entered paid days)</option>
                      </select>
                    </label>
                    {line.frequency === "daily" && (
                      <label>
                        Paid days per year {index + 1}
                        <input
                          required
                          type="number"
                          min="0"
                          step="1"
                          value={line.paid_days}
                          onChange={(event) =>
                            updateLine(line.key, { paid_days: event.target.value })
                          }
                        />
                      </label>
                    )}
                    {form.lines.length > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          update({
                            ...form,
                            lines: form.lines.filter((item) => item.key !== line.key),
                          })
                        }
                      >
                        Remove income line {index + 1}
                      </button>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  disabled={form.lines.length >= 100}
                  onClick={() => update({ ...form, lines: [...form.lines, blankLine()] })}
                >
                  Add income line
                </button>
                <button type="submit">Save estimate</button>
              </fieldset>
            </form>
          )}
          {selected && (
            <section aria-label="Saved estimate result">
              <h3>{changed ? "Saved result before your edits" : "Saved monthly estimate"}</h3>
              <ul>
                {selected.lines.map((line) => (
                  <li key={line.uuid}>
                    {line.name}: {moneyLabel(line.monthly_net)} estimated monthly net
                  </li>
                ))}
              </ul>
              <p>Combined: {moneyLabel(selected.monthly_total)} estimated monthly net</p>
              <p>Entered withholding and deductions are assumptions, not calculated tax.</p>
              {!changed && (
                <div className="editor">
                  <label>
                    New estimate name
                    <input
                      maxLength={120}
                      value={copyName}
                      onChange={(event) => setCopyName(event.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    disabled={p.busy || !copyName.trim()}
                    onClick={() =>
                      p.save(
                        incomeEstimates.duplicate(p.entity.id, selected.uuid, {
                          name: copyName,
                          expected_revision: selected.revision,
                        }),
                        confirmed,
                      )
                    }
                  >
                    Duplicate estimate
                  </button>
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </section>
  );
}
