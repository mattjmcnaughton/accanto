import { useState } from "react";
import { monthly, type PlanGroup, type PlanRevision } from "../../lib/monthly";
import { dollars, type ScreenProps } from "./shared";

export function CopyPlan({
  plans,
  screen,
  copied,
}: {
  plans: PlanGroup[];
  screen: ScreenProps;
  copied: (planId: string, revision: PlanRevision) => void;
}) {
  const [selected, setSelected] = useState<{ planId: string; revision: PlanRevision } | null>(null);
  const [name, setName] = useState("");
  const choices = plans.flatMap((plan) =>
    plan.revisions.map((revision) => ({ planId: plan.plan_id, revision })),
  );
  const current = choices.find(({ revision }) => revision.uuid === selected?.revision.uuid);
  const changed = selected && current && selected.revision.revision !== current.revision.revision;
  return (
    <form
      className="editor"
      onSubmit={(event) => {
        event.preventDefault();
        if (selected && !changed)
          screen.save(
            monthly.copyPlan(screen.entity.id, selected.planId, {
              name,
              source_revision_id: selected.revision.uuid,
              expected_revision: selected.revision.revision,
            }),
            (result) => copied(result.plan_id, result.draft),
          );
      }}
    >
      <fieldset disabled={screen.busy || plans.length === 0}>
        <legend>Copy a Plan</legend>
        <p>
          Choose the stored draft or saved version to copy. The copy has independent Income sources.
          Existing Reviews, receipts, and fixed-cost payments stay unchanged.
        </p>
        <label>
          Copy from
          <select
            required
            value={selected?.revision.uuid ?? ""}
            onChange={(event) => {
              setSelected(
                choices.find(({ revision }) => revision.uuid === event.target.value) ?? null,
              );
              screen.dirty(true);
            }}
          >
            <option value="">Choose a draft or saved version</option>
            {choices.map(({ revision }) => (
              <option key={revision.uuid} value={revision.uuid}>
                {revision.name} · {revision.saved ? `saved version ${revision.number}` : "draft"}
              </option>
            ))}
          </select>
        </label>
        <label>
          New Plan name
          <input
            required
            maxLength={120}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              screen.dirty(true);
            }}
          />
        </label>
        <p>
          New copy results use current calculation rules. Saved scenarios retain their original
          results.
        </p>
        {changed && (
          <div role="alert">
            <p>The selected source changed. Review its current contents before copying.</p>
            <button type="button" onClick={() => setSelected(current)}>
              Use current source revision
            </button>
          </div>
        )}
        <button type="submit" disabled={Boolean(changed)}>
          Create copy
        </button>
      </fieldset>
    </form>
  );
}

export function ComparePlans({ plans }: { plans: PlanGroup[] }) {
  const [first, setFirst] = useState("");
  const [second, setSecond] = useState("");
  const versions = plans.flatMap((plan) => plan.revisions.filter((revision) => revision.saved));
  if (versions.length === 0) return null;
  return (
    <section className="plan-summary" aria-label="Compare saved scenarios">
      <h3>Compare saved scenarios</h3>
      <p>
        Original inputs and results are shown as saved. Draft edits and newer calculation rules do
        not change these scenarios.
      </p>
      <div className="workspace-columns">
        {[
          { label: "First saved scenario", value: first, select: setFirst },
          { label: "Second saved scenario", value: second, select: setSecond },
        ].map(({ label, value, select }) => {
          const version = versions.find((revision) => revision.uuid === value);
          return (
            <div key={label}>
              <label>
                {label}
                <select value={value} onChange={(event) => select(event.target.value)}>
                  <option value="">Choose a saved version</option>
                  {versions.map((revision) => (
                    <option key={revision.uuid} value={revision.uuid}>
                      {revision.name} · saved version {revision.number}
                    </option>
                  ))}
                </select>
              </label>
              {version && (
                <div>
                  <h4>
                    {version.name} · version {version.number}
                  </h4>
                  <dl>
                    <dt>Calculation version</dt>
                    <dd>{version.rule_version}</dd>
                    <dt>Planned net income</dt>
                    <dd>{dollars(version.income)}</dd>
                    <dt>Guilt-free spending</dt>
                    <dd>{dollars(version.spending)}</dd>
                    <dt>Tithe target</dt>
                    <dd>{dollars(version.tithe_target)}</dd>
                    <dt>Fixed costs (monthly)</dt>
                    <dd>{dollars(version.fixed_cost_total)}</dd>
                    <dt>Unassigned</dt>
                    <dd>{dollars(version.unassigned)}</dd>
                  </dl>
                  <ul>
                    {version.incomes.map((line) => (
                      <li key={line.source_id}>
                        {line.name}: {dollars(line.amount)}
                      </li>
                    ))}
                  </ul>
                  <ul>
                    {version.fixed_costs.map((line) => (
                      <li key={line.fixed_cost_id}>
                        {line.name}: {dollars(line.amount)} {line.frequency} →{" "}
                        {dollars(line.monthly_amount)} monthly
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
