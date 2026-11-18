import { useState } from "react";
import { monthly, type PlanGroup, type PlanRevision } from "../../lib/monthly";
import type { ScreenProps } from "./shared";

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
          Choose the stored draft or saved version to copy. The copy has independent Income sources
          and shared Fixed cost and destination references. Existing Reviews, receipts, and payments
          stay unchanged. Copying does not move or reserve savings.
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
