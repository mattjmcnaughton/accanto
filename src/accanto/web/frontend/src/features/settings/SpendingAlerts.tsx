import { useState } from "react";
import { decimalToCents, formatMoney, money } from "../../lib/format";
import { monthly } from "../../lib/monthly";
import {
  type AlertTarget,
  DEFAULT_THRESHOLDS,
  PRESETS,
  type SpendingAlert,
  TYPE_NAMES,
  spendingAlerts as api,
  waitingText,
} from "../../lib/spendingAlerts";
import { spendingSubcategories } from "../../lib/spendingSubcategories";
import { type ScreenProps, useLoad } from "../workspace/shared";

type Choice = AlertTarget & { key: string; name: string; group: string };
const keyOf = (t: AlertTarget) =>
  `${t.category}:${t.spending_subcategory_id ?? ""}:${t.fixed_cost_id ?? ""}`;
const percents = (values: number[]) => values.map((t) => `${t}%`).join(", ");

/** What one rule reads this month, in words. */
export function alertStatus(alert: SpendingAlert) {
  if (alert.waiting) return waitingText[alert.waiting];
  const word = alert.basis === "estimate" ? "estimate" : "plan";
  if (alert.recorded === null)
    return `Nothing recorded this month, ${formatMoney(alert.amount)} ${word}`;
  return `${alert.percent}% of its ${formatMoney(alert.amount)} ${word} so far`;
}

/**
 * Spending alerts (TDD 23): thresholds on guilt-free spending, fixed costs, one subcategory or
 * one fixed cost. A rule holds no amount; the API reads the Plan version Home compares against.
 */
export function SpendingAlertsSettings(p: ScreenProps) {
  const deps = [p.entity.id, p.refresh];
  const alerts = useLoad(() => api.list(p.entity.id), deps, { share: "spending-alerts" });
  const subcategories = useLoad(() => spendingSubcategories.list(p.entity.id), deps, {
    share: "spending-subcategories",
  });
  const plans = useLoad(() => monthly.plans(p.entity.id), deps, { share: "plans" });
  // null: the add form; a rule: editing its thresholds.
  const [editing, setEditing] = useState<SpendingAlert | null>(null);
  const [target, setTarget] = useState("");
  const [chosen, setChosen] = useState<number[]>(DEFAULT_THRESHOLDS);
  const [other, setOther] = useState("");
  if (alerts.kind !== "ready") return null;
  const list = alerts.data.spending_alerts;
  const taken = new Set(list.map(keyOf));

  // Fixed costs come from the Plans' lines, newest name first.
  const costs = new Map<string, string>();
  for (const plan of plans.kind === "ready" ? plans.data : [])
    for (const revision of plan.revisions)
      for (const line of revision.fixed_costs)
        if (!costs.has(line.fixed_cost_id)) costs.set(line.fixed_cost_id, line.name);
  const choices: Choice[] = [
    ...(["spending", "fixed_cost"] as const).map((category) => ({
      category,
      spending_subcategory_id: null,
      fixed_cost_id: null,
      name: TYPE_NAMES[category],
      group: "Spending type",
    })),
    ...(subcategories.kind === "ready" ? subcategories.data : [])
      .filter((s) => s.active)
      .map((s) => ({
        category: "spending" as const,
        spending_subcategory_id: s.uuid,
        fixed_cost_id: null,
        name: s.name,
        group: "Subcategory, against its estimate",
      })),
    ...[...costs].map(([id, name]) => ({
      category: "fixed_cost" as const,
      spending_subcategory_id: null,
      fixed_cost_id: id,
      name,
      group: "Fixed cost",
    })),
  ]
    .map((c) => ({ ...c, key: keyOf(c) }))
    .filter((c) => !taken.has(c.key));
  const groups = [...new Set(choices.map((c) => c.group))];
  const picked = choices.find((c) => c.key === target) ?? choices[0];
  const sorted = [...chosen].sort((a, b) => a - b);
  const otherValue = Number(other);
  const otherValid = /^\d{1,3}$/.test(other) && otherValue >= 1 && otherValue <= 999;
  const toggle = (t: number) => {
    setChosen((now) => (now.includes(t) ? now.filter((x) => x !== t) : [...now, t]));
    p.dirty(true);
  };
  const reset = () => {
    setEditing(null);
    setTarget("");
    setChosen(DEFAULT_THRESHOLDS);
    setOther("");
    p.dirty(false);
  };
  const amountCents = editing?.amount ? decimalToCents(editing.amount) : null;
  const version = alerts.data.version;

  return (
    <section aria-labelledby="spending-alerts-heading">
      <h2 className="h2" id="spending-alerts-heading">
        Spending alerts <span>Once a month per threshold, on Home and as a notification</span>
      </h2>
      {list.length > 0 && (
        <ul className="card alert-list" aria-label="Spending alerts">
          {list.map((alert) => (
            <li key={alert.uuid} className="setting">
              <div>
                {alert.name}
                <small>
                  {alertStatus(alert)} · alerts at {percents(alert.thresholds)}
                </small>
              </div>
              <span className="set-actions">
                <button
                  type="button"
                  className="btn sm"
                  disabled={p.busy}
                  onClick={() => {
                    setEditing(alert);
                    setChosen(alert.thresholds);
                    setOther("");
                  }}
                >
                  Edit<span className="sr-only"> {alert.name}</span>
                </button>
                <button
                  type="button"
                  className="btn sm quiet"
                  disabled={p.busy}
                  onClick={() =>
                    p.save(api.remove(p.entity.id, alert.uuid, alert.revision), () => {
                      if (editing?.uuid === alert.uuid) reset();
                    })
                  }
                >
                  Delete<span className="sr-only"> {alert.name}</span>
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {(editing || picked) && (
        <form
          className="card pad alert-form"
          aria-label={editing ? `Edit ${editing.name}` : "Add a spending alert"}
          onSubmit={(event) => {
            event.preventDefault();
            if (!sorted.length) return;
            if (editing)
              p.save(
                api.edit(p.entity.id, editing.uuid, {
                  thresholds: sorted,
                  expected_revision: editing.revision,
                }),
                reset,
              );
            else if (picked)
              p.save(
                api.create(p.entity.id, {
                  category: picked.category,
                  spending_subcategory_id: picked.spending_subcategory_id,
                  fixed_cost_id: picked.fixed_cost_id,
                  thresholds: sorted,
                }),
                reset,
              );
          }}
        >
          {editing ? (
            <p className="alert-lbl">{editing.name}</p>
          ) : (
            <label className="alert-lbl">
              Alert me about
              <select
                className="input"
                value={picked?.key}
                disabled={p.busy}
                onChange={(e) => setTarget(e.target.value)}
              >
                {groups.map((group) => (
                  <optgroup key={group} label={group}>
                    {choices
                      .filter((c) => c.group === group)
                      .map((c) => (
                        <option key={c.key} value={c.key}>
                          {c.name}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
            </label>
          )}
          <fieldset className="alert-ths">
            <legend className="alert-lbl">When recorded spending reaches</legend>
            <div className="alert-opts">
              {[...new Set([...PRESETS, ...sorted])]
                .sort((a, b) => a - b)
                .map((t) => (
                  <button
                    key={t}
                    type="button"
                    className="chip alert-opt"
                    aria-pressed={chosen.includes(t)}
                    disabled={p.busy}
                    onClick={() => toggle(t)}
                  >
                    {t}%
                  </button>
                ))}
              <input
                className="input alert-other"
                inputMode="numeric"
                aria-label="Another percentage, 1 to 999"
                placeholder="Other %"
                value={other}
                disabled={p.busy}
                onChange={(e) => setOther(e.target.value.trim())}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (otherValid && !chosen.includes(otherValue)) toggle(otherValue);
                    setOther("");
                  }
                }}
              />
              <button
                type="button"
                className="btn sm"
                disabled={p.busy || !otherValid || chosen.includes(otherValue)}
                onClick={() => {
                  toggle(otherValue);
                  setOther("");
                }}
              >
                Add
              </button>
            </div>
            <small className="note">
              Whole percentages from 1 to 999. Over 100% means overspent: 125% is a quarter over.
            </small>
          </fieldset>
          <p className="alert-basis">
            {editing && amountCents !== null && version
              ? `Against ${version.name}, version ${version.number}: ${editing.name}'s ${money(amountCents)} ${editing.basis === "estimate" ? "estimate" : "plan"}. ${
                  sorted.length
                    ? `Alerts at ${sorted.map((t) => `${money(Math.round((amountCents * t) / 100))} (${t}%)`).join(", ")}.`
                    : ""
                }`
              : picked?.spending_subcategory_id
                ? "Measured against this subcategory's estimate in the Plan version Home compares against. Without one, the alert waits."
                : "Measured against the Plan version Home compares against: this month's Review version, or the latest saved one."}
          </p>
          {!sorted.length && <p className="note">Choose at least one threshold.</p>}
          <div className="set-actions">
            <button type="submit" className="btn pri" disabled={p.busy || !sorted.length}>
              {editing ? "Save alert" : "Add alert"}
            </button>
            {editing && (
              <button type="button" className="btn" onClick={reset}>
                Cancel
              </button>
            )}
          </div>
        </form>
      )}
    </section>
  );
}
