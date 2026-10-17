import { useState } from "react";
import {
  type Activity,
  type ActivityInput,
  type KnownTotalInput,
  monthly,
} from "../../lib/monthly";
import { savings } from "../../lib/savings";
import {
  LoadMessage,
  MoneyInput,
  type ScreenProps,
  dollars,
  sourceChoices,
  useLoad,
} from "./shared";
export function ActivityScreen(p: ScreenProps) {
  const [reload, setReload] = useState(0);
  const entries = useLoad(() => monthly.activity(p.entity.id), [p.entity.id, p.refresh, reload]);
  const plans = useLoad(() => monthly.plans(p.entity.id), [p.entity.id, p.refresh, reload]);
  const accounts = useLoad(() => savings.list(p.entity.id), [p.entity.id, p.refresh, reload]);
  const [selected, setSelected] = useState<Activity | null>(null);
  const [form, setForm] = useState<ActivityInput | null>(null);
  const [known, setKnown] = useState<KnownTotalInput | null>(null);
  const sources = plans.kind === "ready" ? sourceChoices(plans.data) : [];
  const savingGoals =
    accounts.kind === "ready"
      ? accounts.data.flatMap((account) =>
          account.goals.map((goal) => ({
            account,
            goal,
            label: `${account.name} · ${goal.name}`,
          })),
        )
      : [];
  const goalLabel = (id: string | null) =>
    savingGoals.find(({ goal }) => goal.uuid === id)?.label ?? "Historical saving goal";
  function fingerprint(
    month: string,
    category: "income" | "spending" | "saving",
    selectionId: string | null,
  ) {
    const current = entries.kind === "ready" ? entries.data : [];
    return current
      .filter(
        (entry) =>
          entry.financial_date.slice(0, 7) === month.slice(0, 7) &&
          entry.category === category &&
          (category === "spending" ||
            (category === "income"
              ? entry.source_id === selectionId
              : entry.saving_goal_id === selectionId)),
      )
      .map(({ uuid, revision }) => ({ uuid, revision }));
  }
  function update(value: ActivityInput) {
    setForm(value);
    p.dirty(true);
  }
  function open(entry: Activity | null) {
    if (!p.guard()) return;
    setSelected(entry);
    setKnown(null);
    setForm(
      entry
        ? {
            date: entry.financial_date,
            category: entry.category,
            amount: entry.amount,
            source_id: entry.source_id,
            note: entry.note,
            expected_revision: entry.revision,
            is_adjustment: entry.is_adjustment,
            funding_origin: entry.funding_origin,
            saving_goal_id: entry.saving_goal_id,
          }
        : {
            date: p.entity.today,
            category: "spending",
            amount: "",
            source_id: null,
            note: "",
            funding_origin: "income",
            saving_goal_id: null,
          },
    );
    p.dirty(!entry);
  }
  function openKnown() {
    if ((entries.kind !== "ready" && entries.kind !== "empty") || !p.guard()) return;
    setSelected(null);
    setForm(null);
    setKnown({
      date: p.entity.today,
      month: `${p.entity.today.slice(0, 7)}-01`,
      category: "spending",
      desired_total: "",
      source_id: null,
      saving_goal_id: null,
      note: "",
      contributing_entries: fingerprint(`${p.entity.today.slice(0, 7)}-01`, "spending", null),
    });
    p.dirty(true);
  }
  function done() {
    setForm(null);
    setKnown(null);
    setSelected(null);
    p.dirty(false);
  }
  if (p.concealed) return null;
  return (
    <section aria-labelledby="activity-title">
      <div className="section-heading">
        <div>
          <h2 id="activity-title">Activity</h2>
          <p>Record what happened, independently of a Review.</p>
        </div>
        <button type="button" disabled={p.busy} onClick={() => open(null)}>
          Record activity
        </button>
        <button
          type="button"
          disabled={p.busy || (entries.kind !== "ready" && entries.kind !== "empty")}
          onClick={openKnown}
        >
          Enter known total
        </button>
      </div>
      <LoadMessage state={entries} retry={() => setReload((x) => x + 1)} />
      <LoadMessage state={plans} retry={() => setReload((x) => x + 1)} />
      <LoadMessage state={accounts} retry={() => setReload((x) => x + 1)} />
      <div className="workspace-columns">
        <div className="record-list">
          {entries.kind === "empty" && <p>No activity recorded yet.</p>}
          {entries.kind === "ready" &&
            entries.data.map((entry) => (
              <article key={entry.uuid}>
                <p>
                  <time>{entry.financial_date}</time> ·{" "}
                  {entry.category === "income"
                    ? "Income"
                    : entry.category === "saving"
                      ? "Saving"
                      : "Guilt-free spending"}
                  {entry.is_adjustment && " · Adjustment"}
                </p>
                <strong>{dollars(entry.amount)}</strong>
                <p>
                  {entry.saving_goal_id
                    ? `${entry.category === "saving" ? "To" : "Funded from"} ${goalLabel(entry.saving_goal_id)}`
                    : entry.source_id
                      ? sources.find((s) => s.id === entry.source_id)?.label ||
                        "Historical Income source"
                      : entry.category === "spending"
                        ? "Funded from current income"
                        : "Unassigned"}
                </p>
                {entry.note && <p>{entry.note}</p>}
                <button type="button" disabled={p.busy} onClick={() => open(entry)}>
                  Edit {entry.category} on {entry.financial_date}
                </button>
              </article>
            ))}
        </div>
        {form && (
          <form
            className="editor"
            onSubmit={(e) => {
              e.preventDefault();
              p.save(
                selected
                  ? monthly.editActivity(p.entity.id, selected.uuid, form)
                  : monthly.createActivity(p.entity.id, form),
                done,
              );
            }}
          >
            <fieldset disabled={p.busy}>
              <legend>{selected ? "Correct activity" : "Record activity"}</legend>
              <label>
                Financial date
                <input
                  type="date"
                  required
                  value={form.date}
                  onChange={(e) => update({ ...form, date: e.target.value })}
                />
              </label>
              <label>
                Category
                <select
                  value={form.category}
                  onChange={(e) =>
                    update({
                      ...form,
                      category: e.target.value as "income" | "spending" | "saving",
                      source_id: null,
                      funding_origin: "income",
                      saving_goal_id: null,
                    })
                  }
                >
                  <option value="income">Income</option>
                  <option value="spending">Guilt-free spending</option>
                  <option value="saving">Saving contribution</option>
                </select>
              </label>
              <MoneyInput
                label="Amount (USD)"
                value={form.amount}
                onChange={(amount) => update({ ...form, amount })}
                signed={form.is_adjustment}
              />
              <label>
                <input
                  type="checkbox"
                  checked={Boolean(form.is_adjustment)}
                  onChange={(e) => update({ ...form, is_adjustment: e.target.checked })}
                />
                Adjustment to recorded total
              </label>
              {form.category === "income" && (
                <label>
                  Income source
                  <select
                    value={form.source_id || ""}
                    onChange={(e) => update({ ...form, source_id: e.target.value || null })}
                  >
                    <option value="">Unassigned income</option>
                    {sources.map((source) => (
                      <option key={source.id} value={source.id}>
                        {source.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {form.category === "spending" && (
                <label>
                  Funding origin
                  <select
                    name="funding-origin"
                    value={form.funding_origin ?? "income"}
                    onChange={(e) =>
                      update({
                        ...form,
                        funding_origin: e.target.value as "income" | "savings",
                        saving_goal_id: null,
                      })
                    }
                  >
                    <option value="income">Current income</option>
                    <option value="savings">Previously saved money</option>
                  </select>
                </label>
              )}
              {(form.category === "saving" || form.funding_origin === "savings") && (
                <label>
                  Saving goal
                  <select
                    name="saving-goal"
                    required
                    value={form.saving_goal_id ?? ""}
                    onChange={(e) => update({ ...form, saving_goal_id: e.target.value || null })}
                  >
                    <option value="">Choose a goal</option>
                    {savingGoals
                      .filter(
                        ({ account, goal }) =>
                          account.active &&
                          account.opening_date <= form.date &&
                          (form.category !== "saving" ||
                            goal.active ||
                            goal.uuid === selected?.saving_goal_id),
                      )
                      .map(({ goal, label }) => (
                        <option key={goal.uuid} value={goal.uuid}>
                          {label}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              <label>
                Note
                <textarea
                  maxLength={2000}
                  value={form.note || ""}
                  onChange={(e) => update({ ...form, note: e.target.value })}
                />
              </label>
              <button className="primary" type="submit">
                Save activity
              </button>
              {selected && (
                <button
                  type="button"
                  onClick={() => {
                    if (
                      window.confirm(
                        "Delete this mistaken entry? It will stop contributing to totals; its history is retained.",
                      )
                    )
                      p.save(
                        monthly.deleteActivity(p.entity.id, selected.uuid, {
                          expected_revision: selected.revision,
                        }),
                        done,
                      );
                  }}
                >
                  Delete activity
                </button>
              )}
            </fieldset>
          </form>
        )}
        {known && (
          <form
            className="editor"
            onSubmit={(e) => {
              e.preventDefault();
              if (entries.kind !== "ready" && entries.kind !== "empty") return;
              p.save(monthly.recordKnownTotal(p.entity.id, known), done);
            }}
          >
            <fieldset disabled={p.busy}>
              <legend>Enter known total</legend>
              <p>A dated adjustment records the difference. Later detail adds to this total.</p>
              <p>
                {known.contributing_entries.length} contributing entries were captured for this
                total.
              </p>
              <label>
                Financial date
                <input
                  type="date"
                  required
                  value={known.date}
                  onChange={(e) => {
                    const date = e.target.value;
                    const month = `${date.slice(0, 7)}-01`;
                    setKnown({
                      ...known,
                      date,
                      month,
                      contributing_entries: fingerprint(
                        month,
                        known.category,
                        known.category === "saving"
                          ? known.saving_goal_id || null
                          : known.source_id || null,
                      ),
                    });
                    p.dirty(true);
                  }}
                />
              </label>
              <label>
                Category
                <select
                  value={known.category}
                  onChange={(e) => {
                    const category = e.target.value as "income" | "spending" | "saving";
                    setKnown({
                      ...known,
                      category,
                      source_id: null,
                      saving_goal_id: null,
                      contributing_entries: fingerprint(known.month, category, null),
                    });
                    p.dirty(true);
                  }}
                >
                  <option value="spending">Guilt-free spending</option>
                  <option value="income">Income</option>
                  <option value="saving">Saving</option>
                </select>
              </label>
              {known.category === "income" && (
                <label>
                  Income source
                  <select
                    value={known.source_id || ""}
                    onChange={(e) => {
                      const source_id = e.target.value || null;
                      setKnown({
                        ...known,
                        source_id,
                        contributing_entries: fingerprint(known.month, "income", source_id),
                      });
                      p.dirty(true);
                    }}
                  >
                    <option value="">Unassigned income</option>
                    {sources.map((source) => (
                      <option key={source.id} value={source.id}>
                        {source.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {known.category === "saving" && (
                <label>
                  Saving goal
                  <select
                    name="known-saving-goal"
                    required
                    value={known.saving_goal_id || ""}
                    onChange={(e) => {
                      const saving_goal_id = e.target.value || null;
                      setKnown({
                        ...known,
                        saving_goal_id,
                        contributing_entries: fingerprint(known.month, "saving", saving_goal_id),
                      });
                      p.dirty(true);
                    }}
                  >
                    <option value="">Choose a goal</option>
                    {savingGoals
                      .filter(
                        ({ account, goal }) =>
                          account.active && account.opening_date <= known.date && goal.active,
                      )
                      .map(({ goal, label }) => (
                        <option key={goal.uuid} value={goal.uuid}>
                          {label}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              <MoneyInput
                label="Known total (USD)"
                value={known.desired_total}
                onChange={(desired_total) => {
                  setKnown({ ...known, desired_total });
                  p.dirty(true);
                }}
              />
              <label>
                Note
                <textarea
                  maxLength={2000}
                  value={known.note || ""}
                  onChange={(e) => {
                    setKnown({ ...known, note: e.target.value });
                    p.dirty(true);
                  }}
                />
              </label>
              <button
                className="primary"
                type="submit"
                disabled={entries.kind !== "ready" && entries.kind !== "empty"}
              >
                Save adjustment
              </button>
            </fieldset>
          </form>
        )}
      </div>
    </section>
  );
}
