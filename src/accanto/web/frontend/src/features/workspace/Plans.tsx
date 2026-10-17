import { useEffect, useState } from "react";
import { IncomeEstimates } from "./IncomeEstimates";
import {
  type Plan,
  type PlanDraft,
  type Version,
  allocationTotal,
  calculate,
  editableMonthlyPlan,
  id,
  kinds,
  labels,
  money,
  monthlyNet,
  newDraft,
  roundDivide,
  validatePlan,
  versions,
} from "./domain";
import { Empty, Icon, MoneyField, Notice, PageHead, type ViewProps } from "./ui";

export function Plans({
  state,
  update,
  setDirty,
}: ViewProps & { setDirty: (value: boolean) => void }) {
  const [estimates, setEstimates] = useState(false);
  const [selected, setSelected] = useState(state.plans[0]?.id ?? "");
  const [versionId, setVersionId] = useState("");
  const [compare, setCompare] = useState("");
  const [editor, setEditor] = useState<{ planId: string; draft: PlanDraft } | null>(null);
  const plan = state.plans.find((p) => p.id === selected) ?? state.plans[0];
  const version = plan?.versions.find((v) => v.id === versionId) ?? plan?.versions.slice(-1)[0];
  const comparison = versions(state).find((v) => v.id === compare);
  const model = version?.plan ?? plan?.draft;
  const calc = version?.calculation ?? (model ? calculate(model) : null);
  const openNew = () => setEditor({ planId: id(), draft: newDraft() });
  if (editor)
    return (
      <PlanEditor
        key={editor.planId}
        initial={editor.draft}
        planId={editor.planId}
        state={state}
        update={update}
        setDirty={setDirty}
        onClose={() => setEditor(null)}
        onSaved={(saved) => {
          setSelected(saved.id);
          setVersionId("");
          setEditor(null);
        }}
      />
    );
  return (
    <>
      <button type="button" className="button secondary" onClick={() => setEstimates(!estimates)}>
        Income estimates
      </button>
      {estimates && <IncomeEstimates state={state} update={update} />}
      <PageHead
        title="Plans"
        description="Make deliberate choices. Keep a record of your intentions."
        actions={
          <button className="button primary" type="button" onClick={openNew}>
            <Icon name="plus" size={17} />
            New Plan
          </button>
        }
      />
      {!plan || !model || !calc ? (
        <section className="surface">
          <Empty
            icon="plans"
            title="Start with the life you’re planning"
            action={
              <button className="button primary" type="button" onClick={openNew}>
                Create your first Plan
              </button>
            }
          >
            Add your income, recurring costs, and priorities. Save a version when you’re ready to
            compare it with a month.
          </Empty>
        </section>
      ) : (
        <>
          <div className="plan-tabs" aria-label="Named Plans">
            {state.plans.map((p) => (
              <button
                type="button"
                key={p.id}
                className={plan.id === p.id ? "active" : ""}
                onClick={() => {
                  setSelected(p.id);
                  setVersionId("");
                  setCompare("");
                }}
              >
                {p.draft.name}
                <span>
                  {p.versions.length
                    ? `${p.versions.length} ${p.versions.length === 1 ? "version" : "versions"}`
                    : "Draft"}
                </span>
              </button>
            ))}
          </div>
          <div className="plan-read-head">
            <div>
              <h2>{model.name}</h2>
              <p>
                {model.cadence === "monthly" ? "Monthly" : "Yearly"} Plan{" "}
                <span className="dot-separator">·</span>{" "}
                {version ? `Saved version ${version.number}` : "Unpublished draft"}
              </p>
            </div>
            <div className="page-actions">
              <button
                className="button secondary"
                type="button"
                onClick={() => {
                  setEditor({
                    planId: id(),
                    draft: {
                      ...structuredClone(model),
                      incomes: model.incomes.map((r) => ({ ...r, id: id() })),
                      name: `${model.name} — scenario`,
                    },
                  });
                }}
              >
                <Icon name="copy" size={16} />
                Create scenario
              </button>
              <button
                className="button primary"
                type="button"
                onClick={() => setEditor({ planId: plan.id, draft: structuredClone(plan.draft) })}
              >
                <Icon name="edit" size={16} />
                Edit draft
              </button>
            </div>
          </div>
          <div className="plan-read-layout">
            <div>
              <section className="surface">
                <div className="section-title">
                  <div>
                    <h2>Monthly allocation</h2>
                    <p className="subtle">
                      {model.cadence === "yearly"
                        ? "Monthly equivalents of your yearly intention."
                        : "Where your planned take-home goes."}
                    </p>
                  </div>
                  <span className="pill">{version ? `v${version.number}` : "Draft"}</span>
                </div>
                <Allocation calc={calc} />
              </section>
              {model.model !== "net-v1" && (
                <Notice>
                  Historical calculation and inputs preserved. New Plans use direct monthly net
                  income.
                </Notice>
              )}
              <section className="surface plan-details">
                <div className="section-title">
                  <h2>Income sources</h2>
                  <span className="subtle">Monthly net income</span>
                </div>
                {model.incomes.map((row) => (
                  <div className="read-line" key={row.id}>
                    <span>
                      <strong>{row.name}</strong>
                      <small>
                        {row.net === undefined
                          ? "Legacy salary estimate"
                          : "Direct monthly net amount"}
                      </small>
                    </span>
                    <strong>{money(monthlyNet(row))}</strong>
                  </div>
                ))}
                {!model.incomes.length && <p className="small-empty">No Income sources yet.</p>}
              </section>
              <section className="surface plan-details">
                <div className="section-title">
                  <h2>Fixed costs</h2>
                  <span className="subtle">Monthly equivalent</span>
                </div>
                {model.costs.map((row) => (
                  <div className="read-line" key={row.id}>
                    <span>
                      <strong>{row.name}</strong>
                      <small>
                        {money(row.amount)} · {row.frequency}
                      </small>
                    </span>
                    <strong>
                      {money(row.frequency === "annual" ? roundDivide(row.amount, 12) : row.amount)}
                    </strong>
                  </div>
                ))}
                {!model.costs.length && <p className="small-empty">No fixed costs in this Plan.</p>}
              </section>
              {(["saving", "investing", "giving"] as const).map((kind) => (
                <section key={kind} className="surface plan-details">
                  <div className="section-title">
                    <h2>
                      {kind === "saving"
                        ? "Saving by goal"
                        : kind === "investing"
                          ? "Investing by destination"
                          : "Giving by recipient"}
                    </h2>
                    <span className="subtle">Monthly equivalent</span>
                  </div>
                  {kind === "giving" && (
                    <p className="footnote">
                      Tithe target: {money(roundDivide(calc.income, 10))} / month (10% of planned
                      take-home).
                    </p>
                  )}
                  {model[`${kind}Lines`]?.map((row) => (
                    <div key={row.id} className="read-line">
                      <span>{row.name}</span>
                      <strong>
                        {money(roundDivide(row.amount, model.cadence === "yearly" ? 12 : 1))}
                      </strong>
                    </div>
                  ))}
                  {model[`${kind}Lines`] === undefined && (
                    <p className="small-empty">
                      Legacy aggregate: {money(calc[kind])} / month. No destination allocation was
                      recorded.
                    </p>
                  )}
                  {model[`${kind}Lines`]?.length === 0 && (
                    <p className="small-empty">No allocations in this Plan.</p>
                  )}
                </section>
              ))}
              {comparison && (
                <section className="surface">
                  <div className="section-title">
                    <h2>Compare intentions</h2>
                  </div>
                  <div className="compare-names">
                    <span>
                      {model.name} · {version ? `v${version.number}` : "Draft"}
                    </span>
                    <Icon name="arrow" size={16} />
                    <span>
                      {comparison.plan.name} · v{comparison.number}
                    </span>
                  </div>
                  <table className="plan-compare">
                    <thead>
                      <tr>
                        <th>Monthly amount</th>
                        <th className="numeric">This Plan</th>
                        <th className="numeric">Comparison</th>
                        <th className="numeric">Change</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...kinds, "unassigned" as const].map((k) => (
                        <tr key={k}>
                          <th>{k === "unassigned" ? "Unassigned" : labels[k]}</th>
                          <td className="numeric">{money(calc[k])}</td>
                          <td className="numeric">{money(comparison.calculation[k])}</td>
                          <td className="numeric">{money(comparison.calculation[k] - calc[k])}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              )}
            </div>
            <aside className="plan-aside">
              <section className="aside-section">
                <h2>Version history</h2>
                {plan.versions.length ? (
                  <div className="version-list">
                    {[...plan.versions].reverse().map((v) => (
                      <button
                        type="button"
                        key={v.id}
                        className={v.id === version?.id ? "active" : ""}
                        onClick={() => setVersionId(v.id)}
                      >
                        <span>
                          <strong>Version {v.number}</strong>
                          <small>
                            {new Date(v.savedAt).toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            })}
                          </small>
                        </span>
                        {v.id === version?.id && <Icon name="check" size={17} />}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="subtle">Save a version to start reviewing months.</p>
                )}
                <p className="footnote">Saved versions stay unchanged when you edit your draft.</p>
              </section>
              <section className="aside-section">
                <label className="field">
                  <span>Compare with another version</span>
                  <select value={compare} onChange={(e) => setCompare(e.target.value)}>
                    <option value="">Choose a saved version</option>
                    {versions(state)
                      .filter((v) => v.id !== version?.id)
                      .map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.plan.name} · v{v.number}
                        </option>
                      ))}
                  </select>
                </label>
              </section>
            </aside>
          </div>
        </>
      )}
    </>
  );
}
function Allocation({ calc }: { calc: ReturnType<typeof calculate> }) {
  return (
    <div className="allocation">
      <div className="read-line">
        <span>Planned net income</span>
        <strong>{money(calc.income)}</strong>
      </div>
      <div className="read-line">
        <span>Planned use of savings</span>
        <strong>{money(calc.savingsFunding ?? 0)}</strong>
      </div>
      <div className="read-line">
        <span>Total planned funding</span>
        <strong>{money(calc.income + (calc.savingsFunding ?? 0))}</strong>
      </div>
      {(["fixed", "giving", "spending", "saving", "investing"] as const).map((k) => (
        <div className="read-line" key={k}>
          <span>{labels[k]}</span>
          <strong>{money(calc[k])}</strong>
        </div>
      ))}
      <div className="allocation-total">
        <span>{calc.unassigned < 0 ? "Overallocated by" : "Unassigned"}</span>
        <strong>{money(Math.abs(calc.unassigned))}</strong>
      </div>
      {(["fixed", "saving", "investing"] as const).map((k) => (
        <p className="footnote" key={k}>
          {labels[k]} ÷ planned net income: {money(calc[k])} ÷ {money(calc.income)} ={" "}
          {calc.income > 0 ? `${((calc[k] / calc.income) * 100).toFixed(1)}%` : "Unavailable"}.
          Provisional comparison formula.
        </p>
      ))}
    </div>
  );
}

function PlanEditor({
  initial,
  planId,
  state,
  update,
  onClose,
  onSaved,
  setDirty,
}: Omit<ViewProps, "openEntry"> & {
  initial: PlanDraft;
  planId: string;
  onClose: () => void;
  onSaved: (p: Plan) => void;
  setDirty: (v: boolean) => void;
}) {
  const [draft, setDraft] = useState(() => editableMonthlyPlan(initial));
  const [error, setError] = useState("");
  const [baseline, setBaseline] = useState(JSON.stringify(editableMonthlyPlan(initial)));
  const dirty = JSON.stringify(draft) !== baseline;
  const calc = calculate(draft);
  const existing = state.plans.find((p) => p.id === planId);
  const nextVersion = (existing?.versions.length ?? 0) + 1;
  useEffect(() => {
    setDirty(dirty);
    return () => setDirty(false);
  }, [dirty, setDirty]);
  const patch = (fields: Partial<PlanDraft>) => setDraft((d) => ({ ...d, ...fields }));
  const cancel = () => {
    if (!dirty || window.confirm("Discard unsaved Plan changes?")) {
      setDirty(false);
      onClose();
    }
  };
  const save = (publish: boolean) => {
    try {
      validatePlan(draft, publish);
      for (const line of draft.savingsFunding ?? [])
        if (!state.accounts?.find((a) => a.id === line.id)?.active)
          throw new Error("Choose an active account for each savings funding line.");
      if (draft.model !== "net-v1")
        throw new Error("Explicitly convert this legacy draft before saving a new version.");
      if (
        state.plans.some(
          (p) =>
            p.id !== planId &&
            p.draft.name.trim().toLowerCase() === draft.name.trim().toLowerCase(),
        )
      )
        throw new Error("A Plan with that name already exists.");
      const model = { ...draft, name: draft.name.trim() };
      const saved: Plan = {
        id: planId,
        draft: structuredClone(model),
        versions: existing?.versions ?? [],
      };
      if (publish) {
        const version: Version = {
          id: id(),
          number: nextVersion,
          savedAt: new Date().toISOString(),
          plan: structuredClone(model),
          calculation: calculate(model),
        };
        saved.versions = [...saved.versions, version];
      }
      if (
        update(
          { ...state, plans: [...state.plans.filter((p) => p.id !== planId), saved] },
          publish ? `Version ${nextVersion} saved` : "Draft saved in this browser",
        )
      ) {
        setBaseline(JSON.stringify(draft));
        setDirty(false);
        if (publish) onSaved(saved);
      }
    } catch (e) {
      setError((e as Error).message);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };
  const period = draft.cadence === "monthly" ? "month" : "year";
  return (
    <>
      <PageHead
        title={existing ? "Edit Plan" : "New Plan"}
        description={dirty ? "Unsaved draft changes" : "Draft · saved versions stay unchanged"}
        actions={
          <>
            <button type="button" className="button quiet" onClick={cancel}>
              Cancel
            </button>
            <button type="button" className="button secondary" onClick={() => save(false)}>
              Save draft
            </button>
            <button type="button" className="button primary" onClick={() => save(true)}>
              Save version {nextVersion}
            </button>
          </>
        }
      />
      {error && <Notice error>{error}</Notice>}
      {draft.model !== "net-v1" && (
        <Notice>
          Legacy draft preserved, including overrides and lump-sum inputs. Convert explicitly, then
          enter each monthly net amount and account funding line. Saved versions remain unchanged.{" "}
          <button
            type="button"
            onClick={() =>
              patch({
                model: "net-v1",
                incomes: draft.incomes.map((r) => ({ ...r, net: monthlyNet(r) })),
                savingsFunding: [],
              })
            }
          >
            Convert draft to direct net inputs
          </button>
        </Notice>
      )}
      <div className="mobile-cash-summary">
        <span>
          Monthly take-home<strong>{money(calc.income)}</strong>
        </span>
        <span>
          {calc.unassigned < 0 ? "Overallocated" : "Unassigned"}
          <strong>{money(Math.abs(calc.unassigned))}</strong>
        </span>
      </div>
      <div className="plan-editor-layout">
        <div className="plan-editor-main">
          <section className="surface editor-section">
            <div className="field-grid plan-identity">
              <label className="field">
                <span>Plan name</span>
                <input
                  required
                  maxLength={120}
                  value={draft.name}
                  onChange={(e) => patch({ name: e.target.value })}
                />
              </label>
              <p className="subtle">Monthly allocations</p>
            </div>
            {initial.cadence === "yearly" && (
              <Notice>
                This earlier yearly draft is shown as monthly equivalents. Saving updates only the
                draft or a new version; existing versions stay unchanged.
              </Notice>
            )}
          </section>
          <section className="surface editor-section">
            <div className="section-title">
              <div>
                <h2>Income</h2>
                <p className="subtle">
                  Enter monthly net amounts directly. Estimates are separate.
                </p>
              </div>
              <span className="section-number">{draft.incomes.length} sources</span>
            </div>
            {draft.incomes.map((row, index) => (
              <div className="income-editor" key={row.id}>
                <div className="income-main">
                  <label className="field">
                    <span>Source name</span>
                    <input
                      aria-label={`Income source ${index + 1} name`}
                      required
                      maxLength={120}
                      placeholder="Name your income source"
                      value={row.name}
                      onChange={(e) =>
                        patch({
                          incomes: draft.incomes.map((r) =>
                            r.id === row.id ? { ...r, name: e.target.value } : r,
                          ),
                        })
                      }
                    />
                  </label>
                  <MoneyField
                    label="Monthly net income"
                    value={row.net ?? 0}
                    onChange={(n) =>
                      patch({
                        incomes: draft.incomes.map((r) =>
                          r.id === row.id ? { ...r, net: n ?? 0 } : r,
                        ),
                      })
                    }
                  />
                  <button
                    type="button"
                    className="icon-button remove-line"
                    aria-label={`Remove ${row.name || "Income source"}`}
                    onClick={() => patch({ incomes: draft.incomes.filter((r) => r.id !== row.id) })}
                  >
                    <Icon name="close" size={17} />
                  </button>
                </div>
              </div>
            ))}
            {!draft.incomes.length && (
              <p className="editor-empty">Add your salary, business income, or another source.</p>
            )}
            <button
              type="button"
              className="add-line"
              onClick={() =>
                patch({
                  incomes: [
                    ...draft.incomes,
                    {
                      id: id(),
                      name: "",
                      gross: 0,
                      net: 0,
                      frequency: "monthly",
                      paidDays: 0,
                      withholding: 0,
                      payroll: 0,
                    },
                  ],
                })
              }
            >
              <Icon name="plus" size={16} />
              Add Income source
            </button>
          </section>
          <section className="surface editor-section">
            <div className="section-title">
              <div>
                <h2>Fixed costs</h2>
                <p className="subtle">Recurring commitments, monthly or annual.</p>
              </div>
            </div>
            {draft.costs.map((row) => (
              <div className="cost-editor" key={row.id}>
                <label className="field">
                  <span>Category</span>
                  <input
                    required
                    maxLength={120}
                    placeholder="Name this recurring cost"
                    value={row.name}
                    onChange={(e) =>
                      patch({
                        costs: draft.costs.map((r) =>
                          r.id === row.id ? { ...r, name: e.target.value } : r,
                        ),
                      })
                    }
                  />
                </label>
                <MoneyField
                  label="Amount"
                  value={row.amount}
                  onChange={(n) =>
                    patch({
                      costs: draft.costs.map((r) =>
                        r.id === row.id ? { ...r, amount: n ?? 0 } : r,
                      ),
                    })
                  }
                />
                <label className="field">
                  <span>Loan payment (optional)</span>
                  <select
                    value={row.debtId ?? ""}
                    onChange={(e) =>
                      patch({
                        costs: draft.costs.map((r) =>
                          r.id === row.id ? { ...r, debtId: e.target.value || undefined } : r,
                        ),
                      })
                    }
                  >
                    <option value="">Not a loan payment</option>
                    {state.debts?.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                        {d.active ? "" : " (archived: revise line)"}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Frequency</span>
                  <select
                    value={row.frequency}
                    onChange={(e) =>
                      patch({
                        costs: draft.costs.map((r) =>
                          r.id === row.id
                            ? { ...r, frequency: e.target.value as "monthly" | "annual" }
                            : r,
                        ),
                      })
                    }
                  >
                    <option value="monthly">Monthly</option>
                    <option value="annual">Annual</option>
                  </select>
                </label>
                <button
                  className="icon-button remove-line"
                  type="button"
                  aria-label={`Remove ${row.name || "fixed cost"}`}
                  onClick={() => patch({ costs: draft.costs.filter((r) => r.id !== row.id) })}
                >
                  <Icon name="close" size={17} />
                </button>
              </div>
            ))}
            {!draft.costs.length && (
              <p className="editor-empty">
                Keep each cost separate so you can compare it with actual payments.
              </p>
            )}
            <button
              className="add-line"
              type="button"
              onClick={() =>
                patch({
                  costs: [...draft.costs, { id: id(), name: "", amount: 0, frequency: "monthly" }],
                })
              }
            >
              <Icon name="plus" size={16} />
              Add fixed cost
            </button>
          </section>
          <section className="surface editor-section">
            <h2>Planned use of savings</h2>
            {(draft.savingsFunding ?? []).map((r, i) => (
              <div className="cost-editor" key={r.id}>
                <label className="field">
                  <span>Savings account</span>
                  <select
                    value={r.id}
                    onChange={(e) => {
                      const a = state.accounts?.find((a) => a.id === e.target.value);
                      if (a)
                        patch({
                          savingsFunding: draft.savingsFunding?.map((x, j) =>
                            j === i ? { ...x, id: a.id, name: a.name } : x,
                          ),
                        });
                    }}
                  >
                    <option value={r.id}>{r.name || "Choose account"}</option>
                    {state.accounts
                      ?.filter((a) => a.active)
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                  </select>
                </label>
                <MoneyField
                  label="Savings funding / month"
                  value={r.amount}
                  onChange={(n) =>
                    patch({
                      savingsFunding: draft.savingsFunding?.map((x, j) =>
                        j === i ? { ...x, amount: n ?? 0 } : x,
                      ),
                    })
                  }
                />
                <button
                  type="button"
                  onClick={() =>
                    patch({ savingsFunding: draft.savingsFunding?.filter((_, j) => i !== j) })
                  }
                >
                  Remove funding
                </button>
                {!state.accounts?.find((a) => a.id === r.id)?.active && (
                  <Notice>Choose an active account or remove this funding line explicitly.</Notice>
                )}
              </div>
            ))}
            <button
              type="button"
              className="add-line"
              onClick={() =>
                patch({
                  savingsFunding: [
                    ...(draft.savingsFunding ?? []),
                    { id: id(), name: "", amount: 0 },
                  ],
                })
              }
            >
              Add savings funding
            </button>
            <p>No receipt, transfer or reservation is created.</p>
          </section>
          <section className="surface editor-section">
            <div className="section-title">
              <div>
                <h2>Your priorities</h2>
                <p className="subtle">Allocate planned take-home, after fixed costs.</p>
              </div>
            </div>
            <div className="tithe-line">
              <span>
                Giving target / tithe <small>10% of planned take-home</small>
              </span>
              <strong>
                {money(roundDivide(calc.income, 10))}
                <small>/ {period}</small>
              </strong>
            </div>
            <div className="allocation-fields">
              <MoneyField
                label={`Guilt-free spending / ${period}`}
                value={draft.spending}
                onChange={(n) => patch({ spending: n ?? 0 })}
              />
            </div>
            {(["saving", "investing", "giving"] as const).map((kind) => {
              const lines = draft[`${kind}Lines`] ?? [];
              const destinations =
                kind === "saving"
                  ? state.goals
                  : kind === "investing"
                    ? state.investments
                    : state.recipients;
              const available = destinations.filter(
                (d) => d.active && !lines.some((r) => r.id === d.id),
              );
              const patchLines = (next: typeof lines) =>
                patch({
                  [`${kind}Lines`]: next,
                  ...(kind !== "giving" && { [kind]: next.reduce((sum, r) => sum + r.amount, 0) }),
                });
              return (
                <div key={kind} className="editor-section">
                  <div className="section-title">
                    <h3>
                      {kind === "saving"
                        ? "Saving by goal"
                        : kind === "investing"
                          ? "Investing by destination"
                          : "Giving by recipient"}
                    </h3>
                    <strong>{money(allocationTotal(draft, kind))} / month</strong>
                  </div>
                  {kind === "giving" && (
                    <p className="footnote">
                      Tithe target: {money(roundDivide(calc.income, 10))} / month. Recipient
                      allocations can differ from this target.
                    </p>
                  )}
                  {lines.map((row) => (
                    <div className="cost-editor" key={row.id}>
                      <label className="field">
                        <span>
                          {kind === "saving"
                            ? "Saving goal"
                            : kind === "investing"
                              ? "Investment destination"
                              : "Giving recipient"}
                        </span>
                        <select
                          aria-label={`${labels[kind]} destination ${row.name}`}
                          value={row.id}
                          onChange={(e) => {
                            const destination = destinations.find((d) => d.id === e.target.value);
                            if (destination)
                              patchLines(
                                lines.map((r) =>
                                  r.id === row.id
                                    ? { ...r, id: destination.id, name: destination.name }
                                    : r,
                                ),
                              );
                          }}
                        >
                          <option value={row.id}>
                            {row.name}
                            {destinations.find((d) => d.id === row.id)?.active === false
                              ? " (inactive)"
                              : ""}
                          </option>
                          {available.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <MoneyField
                        label={`${row.name} / month`}
                        value={row.amount}
                        onChange={(n) =>
                          patchLines(
                            lines.map((r) => (r.id === row.id ? { ...r, amount: n ?? 0 } : r)),
                          )
                        }
                      />
                      <button
                        type="button"
                        className="icon-button remove-line"
                        aria-label={`Remove ${labels[kind]} allocation ${row.name}`}
                        onClick={() => patchLines(lines.filter((r) => r.id !== row.id))}
                      >
                        <Icon name="close" size={17} />
                      </button>
                    </div>
                  ))}
                  {lines.some((r) => !r.id) && (
                    <Notice>
                      Legacy unallocated money is preserved. Choose a destination for this line or
                      redistribute its amount explicitly; it is included in the category total.
                    </Notice>
                  )}
                  <label className="field">
                    <span>
                      {kind === "saving"
                        ? "Add saving goal allocation"
                        : kind === "investing"
                          ? "Add investment allocation"
                          : "Add giving allocation"}
                    </span>
                    <select
                      aria-label={
                        kind === "saving"
                          ? "Add saving goal allocation"
                          : kind === "investing"
                            ? "Add investment allocation"
                            : "Add giving allocation"
                      }
                      value=""
                      onChange={(e) => {
                        const destination = available.find((d) => d.id === e.target.value);
                        if (destination)
                          patchLines([
                            ...lines,
                            { id: destination.id, name: destination.name, amount: 0 },
                          ]);
                      }}
                    >
                      <option value="">
                        Choose an active{" "}
                        {kind === "saving"
                          ? "goal"
                          : kind === "investing"
                            ? "investment"
                            : "recipient"}
                      </option>
                      {available.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {!available.length && (
                    <p className="footnote">
                      Save your draft, then create a destination in{" "}
                      {kind === "saving"
                        ? "Goals"
                        : kind === "investing"
                          ? "Investments"
                          : "Giving"}{" "}
                      if needed. Creating one does not change this Plan.
                    </p>
                  )}
                </div>
              );
            })}
          </section>
          <div className="editor-bottom">
            <span className="subtle">{dirty ? "Unsaved draft" : "Draft up to date"}</span>
            <button className="button primary" type="button" onClick={() => save(true)}>
              Save version {nextVersion}
            </button>
          </div>
        </div>
        <aside className="editor-rail">
          <section className="surface">
            <div className="section-title">
              <h2>Monthly cash allocation</h2>
            </div>
            <Allocation calc={calc} />
          </section>
          {calc.unassigned < 0 && (
            <Notice>
              Your allocations exceed planned take-home by {money(-calc.unassigned)} per month.
            </Notice>
          )}
        </aside>
      </div>
    </>
  );
}
