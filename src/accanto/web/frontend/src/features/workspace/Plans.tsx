import { useState } from "react";
import { balances } from "../../lib/balances";
import { destinations } from "../../lib/destinations";
import { type PlanRevision, monthly } from "../../lib/monthly";
import { savings } from "../../lib/savings";
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
type AllocationRow = { key: string; id: string; amount: string };
type Draft = {
  planId?: string;
  revision?: number;
  name: string;
  incomes: IncomeRow[];
  fixed_costs: FixedRow[];
  spending: string;
  savings_funding: AllocationRow[];
  saving_goals: AllocationRow[];
  investments: AllocationRow[];
  giving: AllocationRow[];
};
const blank = (): Draft => ({
  name: "",
  incomes: [{ key: crypto.randomUUID(), name: "", amount: "" }],
  fixed_costs: [],
  spending: "",
  savings_funding: [],
  saving_goals: [],
  investments: [],
  giving: [],
});
type AllocationKind = "savings_funding" | "saving_goals" | "investments" | "giving";
const allocationRows = (revision: PlanRevision): Pick<Draft, AllocationKind> => ({
  savings_funding: (revision.savings_funding ?? []).map((line) => ({
    key: crypto.randomUUID(),
    id: line.account_id,
    amount: line.amount,
  })),
  saving_goals: (revision.saving_goals ?? []).map((line) => ({
    key: crypto.randomUUID(),
    id: line.goal_id,
    amount: line.amount,
  })),
  investments: (revision.investments ?? []).map((line) => ({
    key: crypto.randomUUID(),
    id: line.destination_id,
    amount: line.amount,
  })),
  giving: (revision.giving ?? []).map((line) => ({
    key: crypto.randomUUID(),
    id: line.destination_id,
    amount: line.amount,
  })),
});
export function Plans(p: ScreenProps) {
  const [copying, setCopying] = useState(false);
  const [reload, setReload] = useState(0);
  const state = useLoad(() => monthly.plans(p.entity.id), [p.entity.id, p.refresh, reload]);
  const loans = useLoad(() => balances.loans(p.entity.id), [p.entity.id, p.refresh, reload]);
  const accounts = useLoad(() => savings.list(p.entity.id), [p.entity.id, p.refresh, reload]);
  const investments = useLoad(
    () => destinations.list(p.entity.id, "investment"),
    [p.entity.id, p.refresh, reload],
  );
  const recipients = useLoad(
    () => destinations.list(p.entity.id, "giving"),
    [p.entity.id, p.refresh, reload],
  );
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
      ...allocationRows(revision),
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
      ...allocationRows(revision),
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
  const choices: Record<AllocationKind, Array<{ id: string; label: string; active: boolean }>> = {
    savings_funding:
      accounts.kind === "ready"
        ? accounts.data.map((account) => ({
            id: account.uuid,
            label: account.name,
            active: account.active,
          }))
        : [],
    saving_goals:
      accounts.kind === "ready"
        ? accounts.data.flatMap((account) =>
            (account.goals ?? []).map((goal) => ({
              id: goal.uuid,
              label: `${account.name} · ${goal.name}`,
              active: account.active && goal.active,
            })),
          )
        : [],
    investments:
      investments.kind === "ready"
        ? investments.data.map((item) => ({ id: item.uuid, label: item.name, active: item.active }))
        : [],
    giving:
      recipients.kind === "ready"
        ? recipients.data.map((item) => ({ id: item.uuid, label: item.name, active: item.active }))
        : [],
  };
  const catalogState = {
    savings_funding: accounts,
    saving_goals: accounts,
    investments,
    giving: recipients,
  };
  const catalogs = [
    { name: "Savings accounts and goals", state: accounts },
    { name: "Investments", state: investments },
    { name: "Giving recipients", state: recipients },
    { name: "Loan accounts", state: loans },
  ];
  const allocationEditor = (kind: AllocationKind, title: string) =>
    form && (
      <section aria-label={title}>
        <h3>{title}</h3>
        {form[kind].map((line, index) => {
          const selected = choices[kind].find((choice) => choice.id === line.id);
          return (
            <div className="income-row" key={line.key}>
              <label>
                {title}{" "}
                {kind === "savings_funding"
                  ? "account"
                  : kind === "saving_goals"
                    ? "goal"
                    : "destination"}{" "}
                {index + 1}
                <select
                  required
                  value={line.id}
                  onChange={(event) =>
                    update({
                      ...form,
                      [kind]: form[kind].map((row) =>
                        row.key === line.key ? { ...row, id: event.target.value } : row,
                      ),
                    })
                  }
                >
                  <option value="">Choose a destination</option>
                  {choices[kind].map((choice) => (
                    <option key={choice.id} value={choice.id}>
                      {choice.label}
                      {choice.active ? "" : " (inactive: revise allocation)"}
                    </option>
                  ))}
                  {line.id && !selected && (
                    <option value={line.id}>Historical reference (revise allocation)</option>
                  )}
                </select>
              </label>
              {line.id && (!selected || !selected.active) && (
                <p className="warning">
                  {catalogState[kind].kind === "ready" || catalogState[kind].kind === "empty"
                    ? "This reference is inactive or unavailable. Review this draft allocation explicitly."
                    : "Current reference status could not be checked. Retry loading before revising this allocation."}
                </p>
              )}
              <MoneyInput
                label={`${title} amount ${index + 1} (USD)`}
                value={line.amount}
                onChange={(amount) =>
                  update({
                    ...form,
                    [kind]: form[kind].map((row) =>
                      row.key === line.key ? { ...row, amount } : row,
                    ),
                  })
                }
              />
              <button
                type="button"
                onClick={() =>
                  update({ ...form, [kind]: form[kind].filter((row) => row.key !== line.key) })
                }
              >
                Remove {title.toLowerCase()} line {index + 1}
              </button>
            </div>
          );
        })}
        <button
          type="button"
          disabled={form[kind].length >= 100 || choices[kind].length === 0}
          onClick={() =>
            update({
              ...form,
              [kind]: [...form[kind], { key: crypto.randomUUID(), id: "", amount: "" }],
            })
          }
        >
          Add {title.toLowerCase()} line
        </button>
      </section>
    );
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
      {form &&
        catalogs.map(({ name, state: catalog }) =>
          catalog.kind === "ready" || catalog.kind === "empty" ? null : (
            <div key={name}>
              <p>{name} catalog</p>
              <LoadMessage state={catalog} retry={() => setReload((x) => x + 1)} />
            </div>
          ),
        )}
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
                  savings_funding: form.savings_funding.map(({ id, amount }) => ({
                    account_id: id,
                    amount,
                  })),
                  saving_goals: form.saving_goals.map(({ id, amount }) => ({
                    goal_id: id,
                    amount,
                  })),
                  investments: form.investments.map(({ id, amount }) => ({
                    destination_id: id,
                    amount,
                  })),
                  giving: form.giving.map(({ id, amount }) => ({ destination_id: id, amount })),
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
                <p>
                  Planned use of savings is funding from named accounts. Planning does not move or
                  reserve money.
                </p>
                {allocationEditor("savings_funding", "Planned use of savings")}
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
                {allocationEditor("saving_goals", "Saving allocations")}
                {allocationEditor("investments", "Investing allocations")}
                {allocationEditor("giving", "Giving allocations")}
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
                <dt>Planned use of savings</dt>
                <dd>{dollars(snapshot.savings_funding_total ?? null)}</dd>
                <dt>Total planned funding</dt>
                <dd>{dollars(snapshot.funding_total ?? null)}</dd>
                <dt>Guilt-free spending</dt>
                <dd>{dollars(snapshot.spending)}</dd>
                <dt>Fixed costs (monthly)</dt>
                <dd>{dollars(snapshot.fixed_cost_total)}</dd>
                <dt>Saving allocations</dt>
                <dd>{dollars(snapshot.saving_total ?? null)}</dd>
                <dt>Investing allocations</dt>
                <dd>{dollars(snapshot.investing_total ?? null)}</dd>
                <dt>Giving allocations</dt>
                <dd>{dollars(snapshot.giving_total ?? null)}</dd>
                <dt>Tithe target (10% of net income)</dt>
                <dd>{dollars(snapshot.tithe_target)}</dd>
                <dt>Giving allocated less tithe target</dt>
                <dd>{dollars(snapshot.giving_difference ?? null)}</dd>
                <dt>Total allocated</dt>
                <dd>{dollars(snapshot.allocation_total ?? null)}</dd>
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
                        {line.debt_account_id
                          ? ` · loan: ${line.debt_account_name ?? "historical loan"}`
                          : ""}
                      </li>
                    ))}
                  </ul>
                  <h4>Planned use of savings by account</h4>
                  <ul>
                    {(snapshot.savings_funding ?? []).map((line) => (
                      <li key={line.account_id}>
                        {line.account_name}: {dollars(line.amount)}
                      </li>
                    ))}
                  </ul>
                  <h4>Saving allocations by goal</h4>
                  <ul>
                    {(snapshot.saving_goals ?? []).map((line) => (
                      <li key={line.goal_id}>
                        {line.goal_name}: {dollars(line.amount)}
                      </li>
                    ))}
                  </ul>
                  <h4>Investing allocations</h4>
                  <ul>
                    {(snapshot.investments ?? []).map((line) => (
                      <li key={line.destination_id}>
                        {line.destination_name}: {dollars(line.amount)}
                      </li>
                    ))}
                  </ul>
                  <h4>Giving allocations</h4>
                  <ul>
                    {(snapshot.giving ?? []).map((line) => (
                      <li key={line.destination_id}>
                        {line.destination_name}: {dollars(line.amount)}
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
