import { useState } from "react";
import { balances } from "../../lib/balances";
import { type PlanRevision, monthly } from "../../lib/monthly";
import { LoadMessage, MoneyInput, type ScreenProps, dollars, useLoad } from "./shared";

import { ComparePlans, CopyPlan } from "./PlanScenarios";

type IncomeRow = {
  key: string;
  source_id?: string;
  name: string;
  amount: string;
};
type FixedRow = {
  key: string;
  fixed_cost_id?: string;
  debt_account_id?: string | null;
  name: string;
  amount: string;
  frequency: "monthly" | "annual";
};
type Draft = {
  planId?: string;
  revision?: number;
  name: string;
  incomes: IncomeRow[];
  fixed_costs: FixedRow[];
  spending: string;
};
const blank = (): Draft => ({
  name: "",
  incomes: [{ key: crypto.randomUUID(), name: "", amount: "" }],
  fixed_costs: [],
  spending: "",
});
export function Plans(p: ScreenProps) {
  const [copying, setCopying] = useState(false);
  const [reload, setReload] = useState(0);
  const state = useLoad(() => monthly.plans(p.entity.id), [p.entity.id, p.refresh, reload]);
  const loans = useLoad(() => balances.loans(p.entity.id), [p.entity.id, p.refresh, reload]);
  const [form, setForm] = useState<Draft | null>(null);
  const [snapshot, setSnapshot] = useState<PlanRevision | null>(null);
  const [changed, setChanged] = useState(false);
  function update(value: Draft) {
    setForm(value);
    setChanged(true);
    p.dirty(true);
  }
  function edit(planId: string, revision: PlanRevision) {
    if (!p.guard()) return;
    setCopying(false);
    setForm({
      planId,
      revision: revision.revision,
      name: revision.name,
      spending: revision.spending,
      incomes: revision.incomes.map((line) => ({
        ...line,
        key: line.source_id,
      })),
      fixed_costs: revision.fixed_costs.map((line) => ({
        ...line,
        key: line.fixed_cost_id,
      })),
    });
    setSnapshot(revision);
    setChanged(false);
    p.dirty(false);
  }
  function saved(planId: string, revision: PlanRevision) {
    setCopying(false);
    setForm({
      planId,
      revision: revision.revision,
      name: revision.name,
      spending: revision.spending,
      incomes: revision.incomes.map((line) => ({
        ...line,
        key: line.source_id,
      })),
      fixed_costs: revision.fixed_costs.map((line) => ({
        ...line,
        key: line.fixed_cost_id,
      })),
    });
    setSnapshot(revision);
    setChanged(false);
    p.dirty(false);
  }
  if (p.concealed) return null;
  return (
    <section aria-labelledby="plans-title">
      <div className="section-heading">
        <div>
          <h2 id="plans-title">Plans</h2>
          <p>Set monthly intentions. Save versions to keep a comparison unchanged.</p>
        </div>
        <button
          type="button"
          disabled={p.busy}
          onClick={() => {
            if (p.guard()) {
              setCopying(false);
              setForm(blank());
              setSnapshot(null);
              setChanged(true);
              p.dirty(true);
            }
          }}
        >
          New Plan
        </button>
        <button
          type="button"
          disabled={p.busy || state.kind !== "ready"}
          onClick={() => {
            if (p.guard()) {
              setCopying(true);
              setForm(null);
              setSnapshot(null);
              setChanged(false);
              p.dirty(false);
            }
          }}
        >
          Copy Plan
        </button>
      </div>
      <LoadMessage state={state} retry={() => setReload((x) => x + 1)} />
      <div className="workspace-columns">
        <aside className="record-list" aria-label="Your Plans">
          {state.kind === "empty" && <p>No Plans yet. Create one to start planning.</p>}
          {state.kind === "ready" &&
            state.data.map((plan) => {
              const draft = plan.revisions.find((r) => !r.saved);
              return (
                <article key={plan.plan_id}>
                  <h3>{draft?.name}</h3>
                  {draft && (
                    <button
                      type="button"
                      disabled={p.busy}
                      onClick={() => edit(plan.plan_id, draft)}
                    >
                      Edit {draft.name}
                    </button>
                  )}
                  <ul>
                    {plan.revisions
                      .filter((r) => r.saved)
                      .map((version) => (
                        <li key={version.uuid}>
                          <button
                            type="button"
                            disabled={p.busy}
                            onClick={() => {
                              if (p.guard()) {
                                setCopying(false);
                                setForm(null);
                                setChanged(false);
                                p.dirty(false);
                                setSnapshot(version);
                              }
                            }}
                          >
                            View {version.name} v{version.number}
                          </button>
                        </li>
                      ))}
                  </ul>
                </article>
              );
            })}
        </aside>
        <div>
          {copying && (
            <CopyPlan plans={state.kind === "ready" ? state.data : []} screen={p} copied={saved} />
          )}
          {form && (
            <form
              className="editor"
              onSubmit={(e) => {
                e.preventDefault();
                const body = {
                  name: form.name,
                  spending: form.spending,
                  incomes: form.incomes.map(({ source_id, name, amount }) => ({
                    source_id,
                    name,
                    amount,
                  })),
                  fixed_costs: form.fixed_costs.map(
                    ({ fixed_cost_id, debt_account_id, name, amount, frequency }) => ({
                      fixed_cost_id,
                      debt_account_id,
                      name,
                      amount,
                      frequency,
                    }),
                  ),
                  ...(form.planId ? { expected_revision: form.revision } : {}),
                };
                p.save(
                  form.planId
                    ? monthly.editPlan(p.entity.id, form.planId, body)
                    : monthly.createPlan(p.entity.id, body),
                  (result) => saved(result.plan_id, result.draft),
                );
              }}
            >
              <fieldset disabled={p.busy}>
                <legend>{form.planId ? "Edit draft" : "New Plan"}</legend>
                <label>
                  Plan name
                  <input
                    required
                    maxLength={120}
                    value={form.name}
                    onChange={(e) => update({ ...form, name: e.target.value })}
                  />
                </label>
                <h3>Monthly net income</h3>
                {form.incomes.map((line, index) => (
                  <div className="income-row" key={line.key}>
                    <label>
                      Income source {index + 1}
                      <input
                        required
                        maxLength={120}
                        value={line.name}
                        onChange={(e) =>
                          update({
                            ...form,
                            incomes: form.incomes.map((row) =>
                              row.key === line.key ? { ...row, name: e.target.value } : row,
                            ),
                          })
                        }
                      />
                    </label>
                    <MoneyInput
                      label={`Net amount ${index + 1}`}
                      value={line.amount}
                      onChange={(amount) =>
                        update({
                          ...form,
                          incomes: form.incomes.map((row) =>
                            row.key === line.key ? { ...row, amount } : row,
                          ),
                        })
                      }
                    />
                    <button
                      type="button"
                      disabled={form.incomes.length === 1}
                      onClick={() =>
                        update({
                          ...form,
                          incomes: form.incomes.filter((row) => row.key !== line.key),
                        })
                      }
                    >
                      Remove source {index + 1}
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  disabled={form.incomes.length >= 100}
                  onClick={() =>
                    update({
                      ...form,
                      incomes: [
                        ...form.incomes,
                        { key: crypto.randomUUID(), name: "", amount: "" },
                      ],
                    })
                  }
                >
                  Add income source
                </button>
                <MoneyInput
                  label="Monthly guilt-free spending"
                  value={form.spending}
                  onChange={(spending) => update({ ...form, spending })}
                />
                <h3>Fixed costs</h3>
                {form.fixed_costs.map((line, index) => (
                  <div className="income-row" key={line.key}>
                    <label>
                      Fixed cost {index + 1}
                      <input
                        required
                        maxLength={120}
                        value={line.name}
                        onChange={(e) =>
                          update({
                            ...form,
                            fixed_costs: form.fixed_costs.map((row) =>
                              row.key === line.key ? { ...row, name: e.target.value } : row,
                            ),
                          })
                        }
                      />
                    </label>
                    <MoneyInput
                      label={`Fixed cost amount ${index + 1} (USD)`}
                      value={line.amount}
                      onChange={(amount) =>
                        update({
                          ...form,
                          fixed_costs: form.fixed_costs.map((row) =>
                            row.key === line.key ? { ...row, amount } : row,
                          ),
                        })
                      }
                    />
                    <label>
                      Frequency
                      <select
                        value={line.frequency}
                        onChange={(e) =>
                          update({
                            ...form,
                            fixed_costs: form.fixed_costs.map((row) =>
                              row.key === line.key
                                ? {
                                    ...row,
                                    frequency: e.target.value as FixedRow["frequency"],
                                  }
                                : row,
                            ),
                          })
                        }
                      >
                        <option value="monthly">Monthly</option>
                        <option value="annual">Annual</option>
                      </select>
                    </label>
                    <label>
                      Loan account (optional)
                      <select
                        value={line.debt_account_id ?? ""}
                        onChange={(e) =>
                          update({
                            ...form,
                            fixed_costs: form.fixed_costs.map((row) =>
                              row.key === line.key
                                ? {
                                    ...row,
                                    debt_account_id: e.target.value || null,
                                  }
                                : row,
                            ),
                          })
                        }
                      >
                        <option value="">Ordinary fixed cost</option>
                        {loans.kind === "ready" &&
                          loans.data
                            .filter((loan) => loan.active || loan.uuid === line.debt_account_id)
                            .map((loan) => (
                              <option key={loan.uuid} value={loan.uuid}>
                                {loan.name}
                                {loan.active ? "" : " (archived: revise allocation)"}
                              </option>
                            ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        update({
                          ...form,
                          fixed_costs: form.fixed_costs.filter((row) => row.key !== line.key),
                        })
                      }
                    >
                      Remove fixed cost {index + 1}
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  disabled={form.fixed_costs.length >= 100}
                  onClick={() =>
                    update({
                      ...form,
                      fixed_costs: [
                        ...form.fixed_costs,
                        {
                          key: crypto.randomUUID(),
                          name: "",
                          amount: "",
                          frequency: "monthly",
                        },
                      ],
                    })
                  }
                >
                  Add fixed cost
                </button>
                <button className="primary" type="submit">
                  Save draft
                </button>
                {form.planId && (
                  <button
                    type="button"
                    disabled={changed}
                    onClick={() => {
                      if (form.planId && form.revision)
                        p.save(
                          monthly.saveVersion(p.entity.id, form.planId, {
                            expected_revision: form.revision,
                          }),
                          (result) => saved(form.planId as string, result.draft),
                        );
                    }}
                  >
                    Save version
                  </button>
                )}
                {changed && form.planId && <p>Save draft changes before saving a version.</p>}
              </fieldset>
            </form>
          )}
          {snapshot && (
            <section className="plan-summary" aria-label="Stored Plan results">
              <h3>
                {snapshot.saved
                  ? `${snapshot.name} · saved version ${snapshot.number}`
                  : "Saved draft results"}
              </h3>
              {changed && <p>These results describe the last saved draft.</p>}
              <dl>
                <dt>Planned net income</dt>
                <dd>{dollars(snapshot.income)}</dd>
                <dt>Guilt-free spending</dt>
                <dd>{dollars(snapshot.spending)}</dd>
                <dt>Fixed costs (monthly)</dt>
                <dd>{dollars(snapshot.fixed_cost_total)}</dd>
                <dt>Tithe target (10% of net income)</dt>
                <dd>{dollars(snapshot.tithe_target)}</dd>
                <dt>Unassigned</dt>
                <dd>{dollars(snapshot.unassigned)}</dd>
              </dl>
              {snapshot.unassigned.startsWith("-") && (
                <output className="warning">
                  Overallocated by {dollars(snapshot.unassigned.slice(1))}. You can still save this
                  Plan.
                </output>
              )}
              {snapshot.saved && (
                <>
                  <ul>
                    {snapshot.incomes.map((line) => (
                      <li key={line.source_id}>
                        {line.name}: {dollars(line.amount)}
                      </li>
                    ))}
                  </ul>
                  <h4>Fixed-cost inputs and monthly results</h4>
                  <ul>
                    {snapshot.fixed_costs.map((line) => (
                      <li key={line.fixed_cost_id}>
                        {line.name}: {dollars(line.amount)} {line.frequency} →{" "}
                        {dollars(line.monthly_amount)} monthly
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          )}
          {!copying && !form && !snapshot && <p>Select a Plan or create a new one.</p>}
        </div>
      </div>
      {state.kind === "ready" && <ComparePlans plans={state.data} />}
    </section>
  );
}
