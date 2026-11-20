import { useState } from "react";
import { type PlanGroup, type PlanRevision, monthly } from "../../lib/monthly";
import { Field } from "../../ui";
import type { ScreenProps } from "./shared";

export function CopyPlan({
  plans,
  screen,
  copied,
  initial,
  onCancel,
}: {
  plans: PlanGroup[];
  screen: ScreenProps;
  copied: (planId: string, revision: PlanRevision) => void;
  /** A revision UUID to preselect, such as the draft that is open. */
  initial?: string;
  onCancel?: () => void;
}) {
  const choices = plans.flatMap((plan) =>
    plan.revisions.map((revision) => ({ planId: plan.plan_id, revision })),
  );
  const [selected, setSelected] = useState<{ planId: string; revision: PlanRevision } | null>(
    () => choices.find(({ revision }) => revision.uuid === initial) ?? null,
  );
  const [name, setName] = useState("");
  const current = choices.find(({ revision }) => revision.uuid === selected?.revision.uuid);
  const changed = selected && current && selected.revision.revision !== current.revision.revision;
  return (
    <form
      className="plan-copy"
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
        <div className="dlg-b">
          <p className="ink2">
            Choose the stored draft or saved version to copy. The copy has independent Income
            sources and shared Fixed cost and destination references. Existing Reviews, receipts,
            and payments stay unchanged. Copying does not move or reserve savings.
          </p>
          <Field label="Copy from">
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
          </Field>
          <Field label="New Plan name">
            <input
              required
              maxLength={120}
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                screen.dirty(true);
              }}
            />
          </Field>
          <p className="note">
            New copy results use current calculation rules. Saved scenarios retain their original
            results.
          </p>
          {changed && (
            <div role="alert" className="banner">
              <span>The selected source changed. Review its current contents before copying.</span>
              <button type="button" className="btn sm" onClick={() => setSelected(current)}>
                Use current source revision
              </button>
            </div>
          )}
        </div>
        <div className="dlg-f">
          {onCancel && (
            <button type="button" className="btn quiet" onClick={onCancel}>
              Cancel
            </button>
          )}
          <button type="submit" className="btn pri" disabled={Boolean(changed)}>
            Create copy
          </button>
        </div>
      </fieldset>
    </form>
  );
}
