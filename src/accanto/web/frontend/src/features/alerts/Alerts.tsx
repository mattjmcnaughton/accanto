import { useState } from "react";
import { decimalToCents, formatMoney, money } from "../../lib/format";
import { monthly } from "../../lib/monthly";
import {
  type AlertTarget,
  DEFAULT_THRESHOLDS,
  PRESETS,
  type SpendingAlert,
  type SpendingAlerts,
  TYPE_NAMES,
  spendingAlerts as api,
  waitingText,
} from "../../lib/spendingAlerts";
import { spendingSubcategories } from "../../lib/spendingSubcategories";
import { Dialog, Empty, Head, Icon, Wait } from "../../ui";
import { type ScreenProps, useLoad } from "../workspace/shared";
import "./alerts.css";

/** Something a Spending alert can watch, named for the picker. */
export type AlertChoice = AlertTarget & { name: string; group?: string };
export const alertKey = (t: AlertTarget) =>
  `${t.category}:${t.spending_subcategory_id ?? ""}:${t.fixed_cost_id ?? ""}`;
/** "70 · 90%": a rule's thresholds, short enough for a bell. */
export const thresholdsShort = (values: number[]) => `${values.join(" · ")}%`;

/** What one rule reads this month, in words. */
export function alertStatus(alert: SpendingAlert) {
  if (alert.waiting) return waitingText[alert.waiting];
  const word = alert.basis === "estimate" ? "estimate" : "plan";
  if (alert.recorded === null)
    return `Nothing recorded this month, ${formatMoney(alert.amount)} ${word}`;
  return `${alert.percent}% of its ${formatMoney(alert.amount)} ${word} so far`;
}

/**
 * One Spending alert's thresholds (TDD 23), shown in a dialog from the Alerts screen or a Plan
 * worksheet bell. With `alert` it edits or deletes that rule; otherwise it creates one for a
 * target, chosen from `targets` when there is more than one.
 */
export function AlertDialog({
  p,
  targets,
  alert,
  version,
  close,
  footer,
}: {
  p: ScreenProps;
  targets: AlertChoice[];
  alert?: SpendingAlert;
  version: SpendingAlerts["version"];
  close: () => void;
  footer?: React.ReactNode;
}) {
  const [target, setTarget] = useState("");
  const [chosen, setChosen] = useState<number[]>(alert?.thresholds ?? DEFAULT_THRESHOLDS);
  const [other, setOther] = useState("");
  const picked = targets.find((c) => alertKey(c) === target) ?? targets[0];
  const name = alert?.name ?? picked?.name ?? "";
  const sorted = [...chosen].sort((a, b) => a - b);
  const otherValue = Number(other);
  const otherValid = /^\d{1,3}$/.test(other) && otherValue >= 1 && otherValue <= 999;
  const toggle = (t: number) =>
    setChosen((now) => (now.includes(t) ? now.filter((x) => x !== t) : [...now, t]));
  const amountCents = alert?.amount ? decimalToCents(alert.amount) : null;
  const against = version
    ? `${version.name}, version ${version.number}`
    : "the Plan version Home compares against";
  const basis =
    alert && amountCents !== null
      ? `Against ${against}: ${alert.name}'s ${money(amountCents)} ${alert.basis === "estimate" ? "estimate" : "plan"}. ${
          sorted.length
            ? `Alerts at ${sorted.map((t) => `${money(Math.round((amountCents * t) / 100))} (${t}%)`).join(", ")}.`
            : ""
        }`
      : alert?.waiting
        ? `${waitingText[alert.waiting]}: ${against}.`
        : picked?.spending_subcategory_id
          ? `Measured against this subcategory's estimate in ${against}, the version Home compares against. Without one, the alert waits.`
          : `Measured against ${against}, the version Home compares against.`;

  return (
    <Dialog
      title={alert || targets.length === 1 ? `Alert for ${name}` : "New spending alert"}
      onClose={close}
      className="alert-dlg"
    >
      <form
        className="dlg-b alert-form"
        aria-label={alert ? `Edit ${alert.name}` : "Add a spending alert"}
        onSubmit={(event) => {
          event.preventDefault();
          if (!sorted.length) return;
          if (alert)
            p.save(
              api.edit(p.entity.id, alert.uuid, {
                thresholds: sorted,
                expected_revision: alert.revision,
              }),
              close,
            );
          else if (picked)
            p.save(
              api.create(p.entity.id, {
                category: picked.category,
                spending_subcategory_id: picked.spending_subcategory_id,
                fixed_cost_id: picked.fixed_cost_id,
                thresholds: sorted,
              }),
              close,
            );
        }}
      >
        {targets.length > 1 && !alert && (
          <label className="alert-lbl">
            Alert me about
            <select
              className="input"
              value={picked ? alertKey(picked) : ""}
              disabled={p.busy}
              onChange={(e) => setTarget(e.target.value)}
            >
              {[...new Set(targets.map((c) => c.group))].map((group) => (
                <optgroup key={group} label={group}>
                  {targets
                    .filter((c) => c.group === group)
                    .map((c) => (
                      <option key={alertKey(c)} value={alertKey(c)}>
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
        <p className="alert-basis">{basis}</p>
        {!sorted.length && <p className="note">Choose at least one threshold.</p>}
        <div className="set-actions alert-acts">
          <button type="submit" className="btn pri" disabled={p.busy || !sorted.length}>
            {alert ? "Save alert" : "Add alert"}
          </button>
          <button type="button" className="btn" onClick={close}>
            Cancel
          </button>
          {alert && (
            <button
              type="button"
              className="btn quiet danger"
              disabled={p.busy}
              onClick={() => p.save(api.remove(p.entity.id, alert.uuid, alert.revision), close)}
            >
              Delete alert
            </button>
          )}
        </div>
        {footer}
      </form>
    </Dialog>
  );
}

/**
 * Spending alerts (TDD 23): every rule with this month's progress, beside Routines and
 * Schedules. A rule holds no amount; the API reads the Plan version Home compares against.
 */
export function Alerts(p: ScreenProps) {
  const [reload, setReload] = useState(0);
  const deps = [p.entity.id, p.refresh, reload];
  const alerts = useLoad(() => api.list(p.entity.id), deps, { share: "spending-alerts" });
  const subcategories = useLoad(() => spendingSubcategories.list(p.entity.id), deps, {
    share: "spending-subcategories",
  });
  const plans = useLoad(() => monthly.plans(p.entity.id), deps, { share: "plans" });
  // undefined: no dialog; null: a new alert; a rule: editing it.
  const [open, setOpen] = useState<SpendingAlert | null>();
  if (p.concealed) return null;
  const data = alerts.kind === "ready" ? alerts.data : null;
  const list = data?.spending_alerts ?? [];
  const taken = new Set(list.map(alertKey));

  // Fixed costs come from the Plans' lines, newest name first.
  const costs = new Map<string, string>();
  for (const plan of plans.kind === "ready" ? plans.data : [])
    for (const revision of plan.revisions)
      for (const line of revision.fixed_costs)
        if (!costs.has(line.fixed_cost_id)) costs.set(line.fixed_cost_id, line.name);
  const choices: AlertChoice[] = [
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
  ].filter((c) => !taken.has(alertKey(c)));
  const startNew = () => setOpen(null);
  const newButton = (
    <button
      type="button"
      className="btn pri"
      disabled={p.busy || !data || !choices.length}
      onClick={startNew}
    >
      <Icon name="plus" />
      New alert
    </button>
  );

  return (
    <section className="screen rt-screen" aria-label="Spending alerts">
      <Head
        title="Spending alerts"
        sub={
          data?.version
            ? `This month against ${data.version.name}, version ${data.version.number}`
            : undefined
        }
        tip="When recorded spending reaches a threshold of its Plan amount, it shows in Home's Needs you and is pushed, once a month each. Set one here or with the bell on a Plan's line."
      >
        {newButton}
      </Head>
      {alerts.kind === "loading" && (
        <Wait>
          <output className="card pad sk-card" aria-label="Loading spending alerts">
            <div className="sk" style={{ width: "40%", height: 20 }} />
            <div className="sk" style={{ height: 34 }} />
          </output>
        </Wait>
      )}
      {"error" in alerts && (
        <div className="banner bad" role="alert">
          <span>Could not load spending alerts. {alerts.error.message}</span>
          <button type="button" className="btn sm" onClick={() => setReload((n) => n + 1)}>
            Try loading again
          </button>
        </div>
      )}
      {data && !list.length && (
        <Empty
          title="No spending alerts yet"
          action={
            <button
              type="button"
              className="btn pri"
              disabled={p.busy || !choices.length}
              onClick={startNew}
            >
              Add an alert
            </button>
          }
        >
          A heads-up when spending reaches a share of the Plan, such as 70% of eating out.
        </Empty>
      )}
      {list.length > 0 && (
        <ul className="card alert-list" aria-label="Spending alerts">
          {list.map((alert) => {
            const spent = alert.recorded ? decimalToCents(alert.recorded) : null;
            const planned = alert.amount ? decimalToCents(alert.amount) : null;
            return (
              <li key={alert.uuid} className="setting">
                <div>
                  {alert.name} <span className="muted">· {thresholdsShort(alert.thresholds)}</span>
                  <small>{alertStatus(alert)}</small>
                  {planned !== null && planned > 0 && (
                    <div
                      className={`alert-meter ${alert.category === "fixed_cost" ? "fixed" : "free"}`}
                      aria-hidden="true"
                    >
                      <i style={{ width: `${Math.min(100, ((spent ?? 0) / planned) * 100)}%` }} />
                      {alert.thresholds
                        .filter((t) => t <= 100)
                        .map((t) => (
                          <b key={t} style={{ left: `${t}%` }} />
                        ))}
                    </div>
                  )}
                </div>
                <span className="set-actions">
                  <button
                    type="button"
                    className="btn sm"
                    disabled={p.busy}
                    onClick={() => setOpen(alert)}
                  >
                    Edit<span className="sr-only"> {alert.name}</span>
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {open !== undefined && (
        <AlertDialog
          p={p}
          targets={open ? [] : choices}
          alert={open ?? undefined}
          version={data?.version ?? null}
          close={() => setOpen(undefined)}
        />
      )}
      <p className="note">Turn their push notifications on or off in Settings → Notifications.</p>
    </section>
  );
}
