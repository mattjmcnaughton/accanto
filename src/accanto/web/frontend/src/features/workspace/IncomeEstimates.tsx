import { useState } from "react";
import {
  type Frequency,
  type IncomeEstimate,
  id,
  money,
  monthlyNet,
  newDraft,
  validatePlan,
} from "./domain";
import type { Workspace } from "./domain";
import { MoneyField, Notice, type Update } from "./ui";
export function IncomeEstimates({ state, update }: { state: Workspace; update: Update }) {
  const fresh = (): IncomeEstimate => ({ id: id(), name: "New estimate", incomes: [] });
  const [draft, setDraft] = useState<IncomeEstimate>(fresh);
  const [error, setError] = useState("");
  return (
    <section className="surface editor-section">
      <h2>Saved income estimates</h2>
      <p>
        Entered withholding and deductions only. Manually copy a result into a Plan; no link is
        created.
      </p>
      <select
        aria-label="Open estimate"
        value={draft.id}
        onChange={(e) => {
          const estimate = state.estimates?.find((r) => r.id === e.target.value);
          if (estimate) setDraft(structuredClone(estimate));
        }}
      >
        <option value={draft.id}>{draft.name}</option>
        {state.estimates
          ?.filter((r) => r.id !== draft.id)
          .map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
      </select>
      <button type="button" onClick={() => setDraft(fresh())}>
        New estimate
      </button>
      <label className="field">
        <span>Estimate name</span>
        <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
      </label>
      {draft.incomes.map((r, i) => {
        const patch = (fields: Partial<typeof r>) =>
          setDraft({
            ...draft,
            incomes: draft.incomes.map((x, j) => (i === j ? { ...x, ...fields } : x)),
          });
        return (
          <div className="editor-section" key={r.id}>
            <label className="field">
              <span>Income name</span>
              <input value={r.name} onChange={(e) => patch({ name: e.target.value })} />
            </label>
            <div className="field-grid">
              <MoneyField
                label="Gross per payment"
                value={r.gross}
                onChange={(n) => patch({ gross: n ?? 0 })}
              />
              <MoneyField
                label="Withholding per payment"
                value={r.withholding}
                onChange={(n) => patch({ withholding: n ?? 0 })}
              />
              <MoneyField
                label="Payroll deductions per payment"
                value={r.payroll}
                onChange={(n) => patch({ payroll: n ?? 0 })}
              />
            </div>
            <label className="field">
              <span>Payment frequency</span>
              <select
                value={r.frequency}
                onChange={(e) => patch({ frequency: e.target.value as Frequency })}
              >
                {Object.entries({
                  annual: "Annually",
                  monthly: "Monthly",
                  semimonthly: "Twice a month (24/year)",
                  weekly: "Weekly (52/year)",
                  daily: "Daily",
                }).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            {r.frequency === "daily" && (
              <label className="field">
                <span>Paid days per year</span>
                <input
                  type="number"
                  min="1"
                  max="366"
                  value={r.paidDays}
                  onChange={(e) => patch({ paidDays: Number(e.target.value) })}
                />
              </label>
            )}
            <p>Monthly net estimate: {money(monthlyNet(r))}</p>
            <button
              type="button"
              onClick={() =>
                setDraft({ ...draft, incomes: draft.incomes.filter((x) => x.id !== r.id) })
              }
            >
              Remove income
            </button>
          </div>
        );
      })}
      <button
        type="button"
        onClick={() =>
          setDraft({
            ...draft,
            incomes: [
              ...draft.incomes,
              {
                id: id(),
                name: "",
                gross: 0,
                withholding: 0,
                payroll: 0,
                frequency: "monthly",
                paidDays: 0,
              },
            ],
          })
        }
      >
        Add estimated income
      </button>
      <p>
        Combined monthly net estimate:{" "}
        <strong>{money(draft.incomes.reduce((s, r) => s + monthlyNet(r), 0))}</strong>
      </p>
      {error && <Notice error>{error}</Notice>}
      <button
        type="button"
        className="button primary"
        onClick={() => {
          try {
            validatePlan({ ...newDraft(draft.name), model: undefined, incomes: draft.incomes });
            if (
              update(
                {
                  ...state,
                  estimates: [
                    ...(state.estimates ?? []).filter((r) => r.id !== draft.id),
                    structuredClone(draft),
                  ],
                },
                "Estimate saved",
              )
            )
              setError("");
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        Save estimate
      </button>
      <button
        type="button"
        className="button secondary"
        onClick={() =>
          setDraft({
            ...structuredClone(draft),
            id: id(),
            name: `${draft.name} copy`,
            incomes: draft.incomes.map((r) => ({ ...r, id: id() })),
          })
        }
      >
        Duplicate estimate
      </button>
    </section>
  );
}
